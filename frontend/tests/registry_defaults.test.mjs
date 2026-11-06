import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const { setTokens } = await import('../renderer/tokens.js');
setTokens(JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8')));
const registry = await import('../renderer/registry.js');
await import('../renderer/core.js');
// Every installed style pack registers its components too.
const stylesDir = new URL('../../styles/', import.meta.url);
if (existsSync(stylesDir)) {
  for (const d of readdirSync(stylesDir, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(new URL(`${d.name}/index.js`, stylesDir))) continue;
    const mod = await import(new URL(`${d.name}/index.js`, stylesDir));
    if (!registry.hasStylePack(d.name)) registry.registerStylePack(mod.default);
  }
}

test('every clip type accepts its own default props', () => {
  for (const def of registry.all()) {
    const { errors } = registry.resolveProps(def.type, registry.defaults(def.type));
    assert.deepEqual(errors, [], `${def.type}: ${errors.join('; ')}`);
  }
});

test('every style pack accepts its own default params and names its components <pack>.<name>', () => {
  for (const pack of registry.stylePacks()) {
    const { errors } = registry.styleParams(pack.id, {});
    assert.deepEqual(errors, [], `${pack.id}: ${errors.join('; ')}`);
  }
  for (const def of registry.all().filter((d) => d.pack)) {
    assert.ok(def.type.startsWith(`${def.pack}.`), `${def.type} should start with ${def.pack}.`);
  }
});

test('catalogue labels are names, not functions', () => {
  for (const c of registry.catalogue()) assert.equal(typeof c.label, 'string', c.type);
});

test('more than two style packs on screen at once is rejected', () => {
  const base = { settings: { style: 'neo-brutal' }, clips: [] };
  registry.registerStylePack({ id: 'test-a' }); registry.registerStylePack({ id: 'test-b' }); registry.registerStylePack({ id: 'test-c' });
  const clip = (id, style, start = 0) => ({ id, type: 'text', start, duration: 2, style });
  assert.deepEqual(registry.checkStyles({ ...base, clips: [clip('a', 'test-a'), clip('b', 'test-b')] }), []);
  assert.equal(registry.checkStyles({ ...base, clips: [clip('a', 'test-a'), clip('b', 'test-b'), clip('c', 'test-c', 1)] }).length, 1);
  assert.deepEqual(registry.checkStyles({ ...base, clips: [clip('a', 'test-a'), clip('b', 'test-b'), clip('c', 'test-c', 2)] }), []);
});
