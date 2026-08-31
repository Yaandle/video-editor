import { test } from 'node:test';
import assert from 'node:assert/strict';

// See easing_parity.test.mjs for why this stub is needed and why it must
// come before a dynamic import() rather than a (hoisted) static import.
globalThis.window ??= { addEventListener() {} };
const { clipsInRange } = await import('../timeline.js');

function clip(start, duration) {
  return { start, duration, end() { return this.start + this.duration; } };
}

test('clipsInRange excludes clips fully before or after the range', () => {
  const clips = [clip(0, 5), clip(10, 5), clip(20, 5)];
  const result = clipsInRange(clips, 10, 15);
  assert.deepEqual(result, [clips[1]]);
});

test('clipsInRange includes clips that partially overlap the range edges', () => {
  const clips = [clip(8, 4), clip(14, 4)]; // [8,12) and [14,18)
  const result = clipsInRange(clips, 10, 16);
  assert.deepEqual(result, clips);
});

test('clipsInRange excludes a clip that ends exactly at range start', () => {
  const clips = [clip(0, 10)]; // ends at 10
  assert.deepEqual(clipsInRange(clips, 10, 20), []);
});

test('clipsInRange excludes a clip that starts exactly at range end', () => {
  const clips = [clip(20, 10)];
  assert.deepEqual(clipsInRange(clips, 10, 20), []);
});

test('clipsInRange preserves relative order of the input array', () => {
  const clips = [clip(0, 5), clip(1, 5), clip(2, 5)];
  const result = clipsInRange(clips, 0, 100);
  assert.deepEqual(result, clips);
});

test('clipsInRange stays fast with many clips (viewport-culling perf smoke check)', () => {
  const clips = [];
  for (let i = 0; i < 10000; i++) clips.push(clip(i * 3, 2));
  const start = performance.now();
  const result = clipsInRange(clips, 15000, 15100);
  const elapsedMs = performance.now() - start;
  assert.ok(result.length > 0 && result.length < 100, `expected a small visible subset, got ${result.length}`);
  assert.ok(elapsedMs < 50, `clipsInRange took ${elapsedMs.toFixed(1)}ms for 10k clips`);
});
