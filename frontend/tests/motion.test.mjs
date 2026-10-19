import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const motion = await import('../renderer/motion.js');
const { setTokens } = await import('../renderer/tokens.js');
setTokens(JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8')));
const { spring, arrival, peak, settle, overshoot, sp, envelope, hash1 } = motion;

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('spring starts at 0 and is 0 for t <= 0', () => {
  close(spring(0), 0);
  close(spring(-1), 0);
});

test('underdamped spring overshoots then settles to 1', () => {
  const p = { stiffness: 170, damping: 10 };
  const vals = Array.from({ length: 400 }, (_, i) => spring(i / 100, p));
  assert.ok(Math.max(...vals) > 1.05, 'expected overshoot');
  close(spring(10, p), 1, 1e-4);
});

test('critically damped spring never overshoots', () => {
  const p = { stiffness: 100, damping: 20 };   // z = 1
  for (let i = 0; i < 300; i++) assert.ok(spring(i / 100, p) <= 1 + 1e-12);
  close(spring(5, p), 1, 1e-4);
});

test('overdamped spring is monotone towards 1', () => {
  const p = { stiffness: 100, damping: 60 };
  let prev = 0;
  for (let i = 1; i < 500; i++) {
    const v = spring(i / 100, p);
    assert.ok(v >= prev - 1e-12 && v <= 1 + 1e-12);
    prev = v;
  }
});

test('reference implementation: v0 changes the start slope', () => {
  const a = spring(0.01, { stiffness: 170, damping: 18, v0: 0 });
  const b = spring(0.01, { stiffness: 170, damping: 18, v0: 10 });
  assert.ok(b > a);
});

test('arrival is the first crossing of the target for visible overshoot', () => {
  const t = arrival('slam');
  close(sp(t, 'slam'), 1, 1e-6);
  assert.ok(sp(t - 0.002, 'slam') < 1);
  assert.ok(peak('slam') > t);
  assert.ok(overshoot('slam') > 0.05 && overshoot('slam') < 0.2, 'slam position overshoot within design range');
});

test('scale presets barely overshoot so text never balloons mid-spring', () => {
  for (const p of ['snappy', 'slam', 'soft', 'quick']) assert.ok(overshoot(p, 'scale') < 0.03, `${p} scale overshoot ${overshoot(p, 'scale')}`);
});

test('soft preset arrives when visually landed (99.5 %), not when it grazes 1.0', () => {
  const t = arrival('soft');
  assert.ok(sp(t, 'soft') >= 0.995 && t < 0.8, `soft arrival ${t}`);
});

test('settle is after arrival and stays inside ±0.5 %', () => {
  for (const p of ['snappy', 'slam', 'soft', 'wobble']) {
    const s = settle(p);
    for (let k = 0; k < 50; k++) assert.ok(Math.abs(sp(s + k * 0.02, p) - 1) <= 0.0051, `${p} at settle+${k * 0.02}`);
  }
});

test('render maths is pure: same inputs, same outputs', () => {
  const a = envelope(0.23, 4, { preset: 'slam', from: 'rise' }, { preset: 'quick', to: 'drop' });
  const b = envelope(0.23, 4, { preset: 'slam', from: 'rise' }, { preset: 'quick', to: 'drop' });
  assert.deepEqual(a, b);
  assert.equal(hash1(3, 9), hash1(3, 9));
});

test('exit directions move the element where they say', () => {
  const frame = { w: 1920, h: 1080 };
  assert.ok(envelope(3.95, 4, null, { to: 'drop', length: 0.4 }, frame).dy > 0);
  assert.ok(envelope(3.95, 4, null, { to: 'rise', length: 0.4 }, frame).dy < 0);
  assert.ok(envelope(3.95, 4, null, { to: 'left', length: 0.4 }, frame).dx < 0);
});
