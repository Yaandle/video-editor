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

const { compile, parse } = await import('../renderer/expr.js');
const plot = await import('../renderer/components/plot.js');
const diagram = await import('../renderer/components/diagram.js');

test('expr: safe parser handles functions, implicit products and precedence', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(compile('sigmoid(0)').f(0), 0.5);
  near(compile('1/(1+e^(-x))').f(1), 1 / (1 + Math.exp(-1)));
  near(compile('2x^2 - 3').f(2), 5);
  near(compile('-x^2').f(3), -9);          // unary minus binds looser than ^
  near(compile('2^3^2').f(0), 512);        // right-associative
  near(compile('max(0, x)').f(-4), 0);
  near(compile('σ(x)').f(0), 0.5);
  assert.match(compile('alert(1)').error, /unknown name/);
  assert.throws(() => parse('1 +'));
});

test('plot: the pen starts and arrives on grid lines', () => {
  const s = plot.drawSchedule({ start: 0 }, { draw_beat: 1, draw_beats: 3 }, beat, 30);
  assert.ok(onGrid(s.start) && onGrid(s.end), `${s.start} ${s.end}`);
  assert.equal(s.at(s.start), 0);
  assert.ok(s.at(s.end) > 0.99 && s.at(s.end + 1) === 1);
  assert.ok(plot.sample('1/x', -1, 1, 4).some((q) => !Number.isFinite(q.y)));
});

test('diagram: layers and stages land on grid lines in order', () => {
  const { land, steady } = diagram.buildSchedule({ start: 2 }, { start_beat: 1, beats_per_step: 1 }, 4, beat, 30);
  assert.deepEqual(land.map((l) => l.hit), [2.5, 3, 3.5, 4]);
  assert.ok(onGrid(steady.hit) && steady.hit > land[3].hit);
  assert.deepEqual(diagram.sizes('3, 5, x, 40'), [3, 5, 1, 16]);
});

const math = await import('../renderer/components/math.js');
// A fake 2D context: every glyph is 0.5 em wide (size parsed from ctx.font).
const fake = { font: '10px x', measureText(s) { const px = parseFloat(this.font.match(/([\d.]+)px/)[1]); return { width: [...s].length * px * 0.5 }; } };

test('math: | splits terms; scripts, fractions, Greek and big operators parse', () => {
  const { terms } = math.parseTex(String.raw`\sigma(x) | = | \frac{1}{1 + e^{-x}}`);
  assert.equal(terms.length, 3);
  assert.equal(terms[0].items[0].text, 'σ');
  assert.equal(terms[2].items[0].k, 'frac');
  const ws = math.parseTex(String.raw`\sum_{i=1}^{n} w_i`).terms[0].items;
  assert.equal(ws[0].k, 'scripts');
  assert.equal(ws[0].base.k, 'bigop');
  assert.ok(ws[0].sub && ws[0].sup);
  assert.throws(() => math.parseTex(String.raw`\nope{x}`), /unknown command/);
  for (const t of Object.values(math.TEMPLATES)) assert.ok(math.parseTex(t).terms.length >= 3, t);
});

test('math: fractions stand taller than a symbol; scripts add width', () => {
  const sym = math.measure(fake, { k: 'sym', text: 'x' }, 100);
  const frac = math.measure(fake, math.parseTex(String.raw`\frac{1}{x}`).terms[0].items[0], 100);
  assert.ok(frac.asc > sym.asc && frac.desc > sym.desc);
  const sup = math.measure(fake, math.parseTex(String.raw`x^2`).terms[0].items[0], 100);
  assert.ok(sup.w > sym.w);
});

test('math: terms and the highlight land on grid lines', () => {
  const s = math.termSchedule({ start: 0 }, { start_beat: 1, beats_per_term: 1 }, 3, beat, 30);
  assert.deepEqual(s.map((l) => l.hit), [0.5, 1, 1.5]);
  assert.deepEqual(math.highlights('3, 0, x, 1'), [3, 1]);
});
