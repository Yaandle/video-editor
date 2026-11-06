// bridge.mjs — runs the renderer's pure, DOM-free modules under Node so Python
// tools share one source of truth for motion timing, events and prop schemas.
//
//   node studio/js/bridge.mjs events    < project.json   → { cuts, hits, motion, cues }
//   node studio/js/bridge.mjs validate  < project.json   → { errors: [...] }
//   node studio/js/bridge.mjs catalogue                  → [ { type, kind, label, props }, … ]
//   node studio/js/bridge.mjs motion                     → preset timing table
//   node studio/js/bridge.mjs styles                     → installed style packs (id, label, sfx, music, palette)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const { setTokens } = await import(pathToUrl('frontend/renderer/tokens.js'));
const { collectEvents } = await import(pathToUrl('frontend/renderer/core.js'));
const registry = await import(pathToUrl('frontend/renderer/registry.js'));
const motion = await import(pathToUrl('frontend/renderer/motion.js'));

function pathToUrl(rel) {
  return new URL('file:///' + path.resolve(root, rel).replace(/\\/g, '/')).href;
}

setTokens(JSON.parse(readFileSync(path.join(root, 'design', 'tokens.json'), 'utf8')));

// Every installed style pack (styles/<id>/index.js): its components, overrides
// and sound profile take part in events and validation exactly as in the browser.
const stylesDir = path.join(root, 'styles');
const packs = existsSync(stylesDir)
  ? readdirSync(stylesDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(stylesDir, d.name, 'index.js'))).map((d) => d.name).sort()
  : [];
for (const id of packs) {
  const mod = await import(pathToUrl(`styles/${id}/index.js`));
  if (!registry.hasStylePack(id)) registry.registerStylePack(mod.default);
}

function readStdin() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

const cmd = process.argv[2];
let out;
if (cmd === 'events') {
  out = collectEvents(readStdin());
} else if (cmd === 'validate') {
  const project = readStdin();
  const errors = [];
  for (const c of project.clips ?? []) {
    const { errors: e } = registry.resolveProps(c.type, c.props);
    errors.push(...e.map((m) => `clip ${c.id}: ${m}`));
  }
  errors.push(...registry.checkStyles(project));
  out = { errors };
} else if (cmd === 'catalogue') {
  out = registry.catalogue();
} else if (cmd === 'styles') {
  out = registry.stylePacks().map((p) => ({ id: p.id, label: p.label, description: p.description, schema: p.schema,
    sfx: p.tokens?.sfx ?? {}, music: p.tokens?.music ?? null, palette: p.tokens?.palette ?? {}, cohesion: p.tokens?.cohesion ?? null,
    checks: p.tokens?.checks ?? [], native: p.tokens?.native ?? null, slop: p.tokens?.slop ?? null, demo: p.tokens?.demo ?? null,
    components: registry.all().filter((d) => d.pack === p.id).map((d) => d.type) }));
} else if (cmd === 'motion') {
  out = Object.fromEntries(motion.PRESET_NAMES().map((p) => [p, Object.fromEntries(motion.PROPERTIES.map((prop) => [prop, {
    arrival: motion.arrival(p, prop), peak: motion.peak(p, prop), settle: motion.settle(p, prop), overshoot: motion.overshoot(p, prop),
  }]))]));
} else {
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
process.stdout.write(JSON.stringify(out));
