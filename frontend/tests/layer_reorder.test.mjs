// See easing_parity.test.mjs for why this stub is needed and why it must
// come before a dynamic import() rather than a (hoisted) static import.
globalThis.window ??= { addEventListener() {} };
const { computeLayerReorder, hasOverlappingClip } = await import('../app.js');

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Plain object stand-ins are enough — computeLayerReorder only reads
// start/end()/layer, same shape the real Clip class provides.
function clip(id, start, duration, layer) {
  return { id, start, duration, layer, end() { return this.start + this.duration; } };
}

function applyResult(clips, result) {
  if (!result) return clips;
  const byId = new Map(clips.map(c => [c.id, c]));
  for (const { id, layer } of result) byId.get(id).layer = layer;
  return clips;
}

test('three time-overlapping clips: bring to front moves the back one to layer 0', () => {
  const a = clip('a', 0, 5, 0); // front
  const b = clip('b', 0, 5, 1); // middle
  const c = clip('c', 0, 5, 2); // back
  const clips = [a, b, c];

  const result = computeLayerReorder(clips, c, 'front');
  assert.ok(result, 'expected a reorder, got null');
  applyResult(clips, result);

  assert.equal(c.layer, 0);
  // a and b keep the two remaining layer numbers (0 and 1 minus c's new 0),
  // in their original relative order — i.e. now {1, 2} in some assignment
  // that preserves a still being in front of b.
  assert.ok(a.layer < b.layer, `expected a still in front of b, got a=${a.layer} b=${b.layer}`);
  const usedLayers = new Set(clips.map(x => x.layer));
  assert.deepEqual([...usedLayers].sort(), [0, 1, 2]); // same three numbers, just reassigned
});

test('send to back moves the front clip to the highest layer in the group', () => {
  const a = clip('a', 10, 5, 3);
  const b = clip('b', 10, 5, 7);
  const clips = [a, b];

  applyResult(clips, computeLayerReorder(clips, a, 'back'));
  assert.equal(a.layer, 7); // takes b's old (higher/back) layer number
  assert.equal(b.layer, 3); // b takes a's old layer number
});

test('bring forward swaps with the immediate neighbour, one step at a time', () => {
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 0, 5, 5);
  const c = clip('c', 0, 5, 9);
  const clips = [a, b, c];

  applyResult(clips, computeLayerReorder(clips, c, 'forward'));
  assert.equal(c.layer, 5); // swapped with b, not jumped straight to front
  assert.equal(b.layer, 9);
  assert.equal(a.layer, 0); // untouched — not part of the swap
});

test('send backward swaps with the immediate neighbour behind', () => {
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 0, 5, 5);
  const clips = [a, b];

  applyResult(clips, computeLayerReorder(clips, a, 'backward'));
  assert.equal(a.layer, 5);
  assert.equal(b.layer, 0);
});

test('already at the front/back is a no-op (returns null)', () => {
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 0, 5, 5);
  const clips = [a, b];

  assert.equal(computeLayerReorder(clips, a, 'front'), null);
  assert.equal(computeLayerReorder(clips, a, 'forward'), null);
  assert.equal(computeLayerReorder(clips, b, 'back'), null);
  assert.equal(computeLayerReorder(clips, b, 'backward'), null);
});

test('a clip with nothing overlapping it is a no-op', () => {
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 100, 5, 1); // far away in time, never overlaps a
  const clips = [a, b];

  assert.equal(computeLayerReorder(clips, a, 'front'), null);
  assert.equal(hasOverlappingClip(clips, a), false);
});

test('reordering never touches a clip outside the time-overlapping group, even if it shares a layer number elsewhere', () => {
  // d sits on layer 0 too, but at a completely different time — moving c to
  // the front of {a,b,c} must not renumber or collide with d.
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 0, 5, 1);
  const c = clip('c', 0, 5, 2);
  const d = clip('d', 50, 5, 0);
  const clips = [a, b, c, d];

  applyResult(clips, computeLayerReorder(clips, c, 'front'));
  assert.equal(d.layer, 0, 'clip outside the overlap group must be untouched');
});

test('hasOverlappingClip is true only when another clip actually shares time', () => {
  const a = clip('a', 0, 5, 0);
  const b = clip('b', 4, 5, 1); // overlaps a in [4,5)
  const c = clip('c', 5, 5, 2); // starts exactly when a ends — no overlap
  assert.equal(hasOverlappingClip([a, b], a), true);
  assert.equal(hasOverlappingClip([a, c], a), false);
});
