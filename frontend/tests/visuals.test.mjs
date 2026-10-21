// Code, graph and maths visuals: pure helpers (no canvas needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { setTokens } = await import('../renderer/tokens.js');
setTokens(JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8')));
await import('../renderer/core.js');
const { grid } = await import('../renderer/beat.js');
const code = await import('../renderer/components/code.js');

const beat = grid({ fps: 30, bpm: 120, subdivision: 1 });
const onGrid = (t) => Math.abs(t * 2 - Math.round(t * 2)) < 1e-9;

test('code: focus ranges parse "3-5, 8" and ignore junk', () => {
  assert.deepEqual([...code.parseRanges('3-5, 8, x, 10-9')].sort((a, b) => a - b), [3, 4, 5, 8, 9, 10]);
  assert.equal(code.parseRanges('').size, 0);
});

test('code: diff lines keep the marker out of the code', () => {
  assert.deepEqual(code.diffLines('+ a = 1\n- b = 2\n  c = 3'), [{ mark: '+', text: 'a = 1' }, { mark: '-', text: 'b = 2' }, { mark: ' ', text: ' c = 3' }]);
});

test('code: line reveals land on beat grid lines', () => {
  const s = code.lineSchedule({ start: 1 }, { start_beat: 1, beats_per_line: 1 }, 4, beat, 30);
  assert.equal(s.length, 4);
  for (const l of s) assert.ok(onGrid(l.hit), `hit ${l.hit} off grid`);
  assert.ok(s[0].start < s[0].hit);
  assert.deepEqual(s.map((l) => l.hit), [1.5, 2, 2.5, 3]);
});

test('code: tokenizer colours operators and 0b/0o literals (legacy vidkit rules)', () => {
  const kinds = code.tokenize('x = 0b101 + 0o17', 'python')[0].map((t) => t.k);
  assert.ok(kinds.includes('op'));
  assert.equal(kinds.filter((k) => k === 'number').length, 2);
});
