// Accuracy regressions: charts never round data away, plots never draw false
// asymptote lines, equations keep accents, roots, fences and signs.

import test from 'node:test';
import assert from 'node:assert/strict';

const graph = await import('../renderer/components/graph.js');
const plot = await import('../renderer/components/plot.js');
const tex = await import('../renderer/tex.js');

const fake = { font: '10px x', measureText(s) { const px = parseFloat(this.font.match(/([\d.]+)px/)[1]); return { width: [...s].length * px * 0.5 }; } };

test('graph: labels keep the data precision and use a true minus', () => {
  assert.equal(graph.decimalsOf(0.82), 2);
  assert.equal(graph.decimalsOf(1.5), 1);
  assert.equal(graph.decimalsOf(72), 0);
  assert.equal(graph.fmtNum(0.07, 2), '0.07');
  assert.equal(graph.fmtNum(-0.35, 2), '−0.35');
  assert.equal(graph.fmtNum(-0.0001, 1), '0.0');
});

test('plot: a pole breaks the line; a steep but continuous curve does not', () => {
  const tan = plot.sample('tan(x)', -2, 2, 240, -4, 4);
  const breaks = tan.filter((q) => Number.isNaN(q.y)).length;
  assert.equal(breaks, 2, 'one break at each of ±π/2');
  const steep = plot.sample('50x', -1, 1, 20, -4, 4);
  assert.equal(steep.filter((q) => Number.isNaN(q.y)).length, 0);
});

test('plot: equal aspect gives one unit the same length on both axes', () => {
  const q = plot.equalAspect({ x_min: -5, x_max: 5, y_min: -4, y_max: 4 }, 1000, 500);
  assert.ok(Math.abs((q.x_max - q.x_min) / 1000 - (q.y_max - q.y_min) / 500) < 1e-9);
  assert.equal(q.y_min, -4);
});

test('tex: accents, roots, matrices, limits and fences parse', () => {
  const t = (src) => tex.parseTex(src).terms;
  assert.equal(t(String.raw`\hat{b}`)[0].items[0].k, 'accent');
  assert.equal(t(String.raw`\sqrt[3]{x}`)[0].items[0].index.items[0].text, '3');
  const m = t(String.raw`\begin{pmatrix} 2 & 1 \\ 1 & 2 \end{pmatrix}`)[0].items[0];
  assert.equal(m.k, 'fence');
  assert.deepEqual(m.body.rows.map((r) => r.length), [2, 2]);
  assert.equal(t(String.raw`\lim_{x \to 0} x`)[0].items[0].base.limits, true);
  const sq = t(String.raw`(\frac{a}{b})^2`)[0].items[0];
  assert.equal(sq.k, 'scripts');
  assert.equal(sq.base.k, 'fence', 'brackets grow around a fraction even with a superscript');
  assert.equal(t(String.raw`\abs{x}`)[0].items[0].open, '|');
  assert.equal(t(String.raw`\text{if } x`)[0].items[0].text, 'if ');
  assert.equal(t(String.raw`\mathbb{R}`)[0].items[0].text, 'ℝ');
  assert.throws(() => tex.parseTex(String.raw`\left( x`), /without \\right/);
});

test('tex: signs are unary only after nothing, an operator or an opening bracket', () => {
  const [a, , c, d] = tex.parseTex(String.raw`-x | = | -y | + z`).terms;
  assert.equal(a.items[0].unary, true);
  assert.equal(c.items[0].unary, true, 'after "=" in the previous term');
  assert.equal(d.items[0].unary, undefined, '"+" after y is binary even at the start of a term');
});

test('tex: a fence around a fraction is taller than the fraction; a root is wider than its body', () => {
  const frac = tex.parseTex(String.raw`\frac{a}{b}`).terms[0].items[0];
  const fence = tex.parseTex(String.raw`\left(\frac{a}{b}\right)`).terms[0].items[0];
  const f = tex.measure(fake, frac, 100), g = tex.measure(fake, fence, 100);
  assert.ok(g.asc > f.asc && g.desc >= f.desc && g.w > f.w);
  const root = tex.parseTex(String.raw`\sqrt{x}`).terms[0].items[0];
  assert.ok(tex.measure(fake, root, 100).w > tex.measure(fake, { k: 'sym', text: 'x' }, 100).w);
});
