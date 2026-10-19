import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { setTokens } = await import('../renderer/tokens.js');
setTokens(JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8')));
const beat = await import('../renderer/beat.js');
const { collectEvents } = await import('../renderer/core.js');
const registry = await import('../renderer/registry.js');

const S = { fps: 30, bpm: 120, subdivision: 1, beat_offset: 0 };

test('120 BPM at 30 fps is 15 frames per beat and a valid grid', () => {
  const g = beat.grid(S);
  assert.equal(g.framesPerBeat, 15);
  assert.ok(g.valid);
});

test('subdivisions that split a frame are invalid', () => {
  assert.equal(beat.grid({ ...S, subdivision: 2 }).valid, false);   // 7.5 frames
  assert.equal(beat.grid({ ...S, fps: 60, subdivision: 2 }).valid, true);
});

test('snap() lands on the nearest grid line', () => {
  assert.equal(beat.snap(1.24, S), 1.0);
  assert.equal(beat.snap(1.26, S), 1.5);
  assert.equal(beat.snap(3.1, S, 'bar'), 4.0);
  assert.equal(beat.snap(1.26, { fps: 30 }), 1.26);   // no bpm → untouched
});

test('lines() marks bars every four beats', () => {
  const ls = beat.lines(0, 4, S, 'beat');
  assert.equal(ls.length, 8);
  assert.deepEqual(ls.filter((l) => l.onBar).map((l) => l.t), [0, 2]);
});

test('every hit in the showcase lands exactly on a frame of the beat grid', () => {
  const project = JSON.parse(readFileSync(new URL('../../projects/showcase.json', import.meta.url), 'utf8'));
  const ev = collectEvents(project);
  assert.ok(ev.hits.length > 20);
  for (const h of ev.hits) {
    assert.ok(beat.offGridFrames(h.t, project.settings) < 1e-6, `hit at ${h.t} is off grid`);
    assert.ok(Math.abs(h.t * 30 - Math.round(h.t * 30)) < 1e-6, `hit at ${h.t} is not a whole frame`);
  }
  for (const c of ev.cuts) assert.ok(beat.offGridFrames(c.t, project.settings) < 1e-6);
});

test('registry: every type has a label, category and valid default props', () => {
  for (const d of registry.all()) {
    const { errors } = registry.resolveProps(d.type, {});
    assert.deepEqual(errors, [], d.type);
    assert.ok(d.label && d.category, d.type);
  }
});

test('registry rejects unknown props instead of silently drawing them', () => {
  const { errors } = registry.resolveProps('text', { nope: 1 });
  assert.equal(errors.length, 1);
});
