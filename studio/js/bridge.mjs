// bridge.mjs — runs the renderer's pure, DOM-free modules under Node so Python
// tools share one source of truth for motion timing, events and prop schemas.
//
//   node studio/js/bridge.mjs events    < project.json   → { cuts, hits, motion, cues }
//   node studio/js/bridge.mjs validate  < project.json   → { errors: [...] }
//   node studio/js/bridge.mjs catalogue                  → [ { type, kind, label, props }, … ]
//   node studio/js/bridge.mjs motion                     → preset timing table

import { readFileSync } from 'node:fs';
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
  out = { errors };
} else if (cmd === 'catalogue') {
  out = registry.catalogue();
} else if (cmd === 'motion') {
  out = Object.fromEntries(motion.PRESET_NAMES().map((p) => [p, Object.fromEntries(motion.PROPERTIES.map((prop) => [prop, {
    arrival: motion.arrival(p, prop), peak: motion.peak(p, prop), settle: motion.settle(p, prop), overshoot: motion.overshoot(p, prop),
  }]))]));
} else {
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
process.stdout.write(JSON.stringify(out));
