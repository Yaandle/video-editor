// tex.js — a small TeX-like maths layout engine for Canvas 2D. Pure: the same
// source, font and size always give the same boxes. Used by the `math`
// component, the maths field pages and style packs.
//
//   \frac{a}{b} \dfrac \binom{n}{k}   \sqrt{x} \sqrt[3]{x}   x^2 x_{i} f'
//   \sum \prod \int \iint \iiint \oint \bigcup \bigcap (limits with _ and ^)
//   \lim_{x \to 0} \max \min \sup \inf \det \dim \ker \gcd \deg \arg \log \sin …
//   \hat \bar \vec \tilde \dot \ddot \overline       (accents drawn over any base)
//   \left( … \right)  and automatic growth of ( ) [ ] around tall content
//   \begin{pmatrix} a & b \\ c & d \end{pmatrix}   (matrix pmatrix bmatrix vmatrix Bmatrix cases)
//   \mathbb{R} \mathbf{v} \mathcal{L} \text{words kept as typed}   \, \; \quad \qquad
//   Greek, relations, arrows, logic and set symbols (see SYMS)
//   \hl{…}  a highlight plate around part of a term
//   |       at the top level splits the equation into reveal terms (not drawn);
//           inside braces it is a bar. Absolute values: \lvert x \rvert or \abs{x}; norms \norm{x}.
//
// Single latin letters are italic (variables); digits, operators and function
// names are upright, as in printed mathematics.

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
export const SYMS = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗',
  cup: '∪', cap: '∩', setminus: '∖', wedge: '∧', vee: '∨', land: '∧', lor: '∨', neg: '¬', lnot: '¬',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', mapsto: '↦', Rightarrow: '⇒', Leftarrow: '⇐',
  Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', uparrow: '↑', downarrow: '↓', longrightarrow: '⟶',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', cong: '≅', sim: '∼', simeq: '≃', propto: '∝',
  ll: '≪', gg: '≫', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', perp: '⊥', parallel: '∥',
  mid: '∣', nmid: '∤', forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅', varnothing: '∅', infty: '∞', partial: '∂', nabla: '∇',
  angle: '∠', triangle: '△', degree: '°', prime: '′', ell: 'ℓ', hbar: 'ℏ', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', colon: ':', therefore: '∴', because: '∵', square: '□', qed: '∎',
  langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', lbrace: '{', rbrace: '}',
};
const BIGOPS = { sum: 'Σ', prod: 'Π', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂' };
const INTEGRALS = new Set(['∫', '∬', '∭', '∮']);
export const FUNCS = new Set(['exp', 'log', 'ln', 'lg', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh',
  'tanh', 'max', 'min', 'sup', 'inf', 'lim', 'det', 'dim', 'ker', 'gcd', 'lcm', 'deg', 'arg', 'tr', 'rank', 'span', 'mod', 'Var', 'softmax', 'ReLU', 'relu', 'sgn']);
const LIMITS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'liminf', 'limsup']);
const ACCENTS = new Set(['hat', 'widehat', 'bar', 'overline', 'vec', 'tilde', 'widetilde', 'dot', 'ddot']);
const BB = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ', F: '𝔽', E: '𝔼', 1: '𝟙' };
const CAL = { L: 'ℒ', F: 'ℱ', H: 'ℋ', B: 'ℬ', E: 'ℰ', M: 'ℳ', R: 'ℛ', I: 'ℐ', O: '𝒪', A: '𝒜', C: '𝒞', D: '𝒟', N: '𝒩', P: '𝒫', S: '𝒮', T: '𝒯', X: '𝒳' };
const BIN = new Set(['+', '−', '±', '∓', '·', '×', '÷', '∗', '⋆', '∘', '⊕', '⊗', '∪', '∩', '∖', '∧', '∨']);
const REL = new Set(['=', '≠', '≈', '≡', '≅', '∼', '≃', '∝', '<', '>', '≤', '≥', '≪', '≫', '∈', '∉', '∋', '⊂', '⊆', '⊃', '⊇', '→', '←', '↔',
  '↦', '⇒', '⇐', '⇔', '⟹', '⟺', '⟶', '∣', '∤', '⊥', '∥', ':', '↑', '↓']);
const OPEN = new Set(['(', '[', '{', '⟨', '⌊', '⌈']);
const CLOSE = new Set([')', ']', '}', '⟩', '⌋', '⌉']);
const PAIR = { '(': ')', '[': ']', '{': '}', '⟨': '⟩', '⌊': '⌋', '⌈': '⌉', '|': '|', '‖': '‖' };
const DELIM_CMD = { langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', '|': '‖',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', lbrace: '{', rbrace: '}', '{': '{', '}': '}' };
const MATRIX = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] };
const SPACES = { ',': 0.17, ':': 0.22, ';': 0.28, ' ': 0.25, quad: 1, qquad: 2, '!': -0.17 };

export const cls = (n) => (n?.k === 'scripts' ? (n.base.func ? 'func' : 'ord') : n?.k !== 'sym' ? 'ord' : n.unary ? 'unary' : BIN.has(n.text) ? 'bin' : REL.has(n.text) ? 'rel'
  : n.text === ',' || n.text === ';' ? 'punct' : OPEN.has(n.text) ? 'open' : CLOSE.has(n.text) ? 'close' : n.func ? 'func' : 'ord');

// ── Parse ─────────────────────────────────────────────────────────────────────

const PARSED = new Map();

/** Source → { terms: [row, …] } where a row is { k: 'row', items: [...] }. Memoized by source. */
export function parseTex(src) {
  const key = String(src ?? '');
  if (PARSED.has(key)) return PARSED.get(key);
  const out = parseUncached(key);
  if (PARSED.size > 400) PARSED.clear();
  PARSED.set(key, out);
  return out;
}

function parseUncached(s) {
  let i = 0;
  let last = null;                          // the atom before this one (for unary signs)
  const err = (m) => { throw new Error(`math: ${m} at ${i}`); };
  const skip = () => { while (s[i] === ' ' || s[i] === '\n' || s[i] === '\t') i++; };
  const peekCmd = () => /^\\([A-Za-z]+|.)/.exec(s.slice(i))?.[1] ?? null;

  function group() {
    skip();
    if (s[i] === '{') {
      i++;
      const r = row((c) => c === '}');
      if (s[i] !== '}') err('missing }');
      i++;
      return r;
    }
    return atom() ?? err('expected an argument');
  }
  function rawGroup() {
    skip();
    if (s[i] !== '{') err('expected {');
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) break;
    }
    if (j >= s.length) err('missing }');
    const txt = s.slice(i + 1, j);
    i = j + 1;
    return txt;
  }
  function delimiter() {
    skip();
    if (s[i] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
      i += m[0].length;
      const d = DELIM_CMD[m[1]];
      if (d === undefined) err(`bad delimiter \\${m[1]}`);
      return d;
    }
    const c = s[i++];
    return c === '.' ? '' : c;
  }
  function matrix(env) {
    const rows = [[]];
    for (;;) {
      skip();
      if (i >= s.length) err(`missing \\end{${env}}`);
      if (s.startsWith('\\end', i)) {
        i += 4;
        const name = rawGroup();
        if (name !== env) err(`\\end{${name}} closes \\begin{${env}}`);
        break;
      }
      last = null;
      const cell = row((c, j) => c === '&' || s.startsWith('\\\\', j) || s.startsWith('\\end', j));
      rows.at(-1).push(cell);
      if (s[i] === '&') i++;
      else if (s.startsWith('\\\\', i)) { i += 2; rows.push([]); }
    }
    while (rows.length && !rows.at(-1).length) rows.pop();
    const [open, close] = MATRIX[env];
    return { k: 'fence', open, close, body: { k: 'matrix', rows, align: env === 'cases' ? 'left' : 'center' } };
  }
  function command() {
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
    if (!m) { i++; return { k: 'sym', text: '\\' }; }
    i += m[0].length;
    const name = m[1];
    if (name in SPACES) return { k: 'space', em: SPACES[name] };
    if (name === '{' || name === '}') return { k: 'sym', text: name };
    if (name === '|') return { k: 'sym', text: '‖' };
    if (name === '\\') err('line break outside a matrix');
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return { k: 'frac', num: group(), den: group() };
    if (name === 'binom' || name === 'tbinom') return { k: 'fence', open: '(', close: ')', body: { k: 'frac', num: group(), den: group(), nobar: true } };
    if (name === 'sqrt') {
      skip();
      let index = null;
      if (s[i] === '[') { i++; index = row((c) => c === ']'); if (s[i] !== ']') err('missing ]'); i++; }
      return { k: 'sqrt', body: group(), index };
    }
    if (name in BIGOPS) return { k: 'bigop', text: BIGOPS[name], integral: INTEGRALS.has(BIGOPS[name]) };
    if (name === 'hl') return { k: 'hl', body: group() };
    if (ACCENTS.has(name)) return { k: 'accent', acc: name.replace(/^wide/, '').replace('overline', 'bar'), body: group(), wide: name === 'overline' || name.startsWith('wide') };
    if (name === 'text' || name === 'textrm' || name === 'mathrm' || name === 'operatorname') {
      const t = rawGroup();
      return { k: 'sym', text: t, upright: true, func: name === 'operatorname' };
    }
    if (name === 'mathbb') { const t = rawGroup().trim(); return { k: 'sym', text: [...t].map((c) => BB[c] ?? c).join(''), upright: true }; }
    if (name === 'mathcal') { const t = rawGroup().trim(); return { k: 'sym', text: [...t].map((c) => CAL[c] ?? c).join(''), upright: true }; }
    if (name === 'mathbf' || name === 'boldsymbol') { const t = rawGroup().trim(); return { k: 'sym', text: t, upright: name === 'mathbf', bold: true, italic: name === 'boldsymbol' }; }
    if (name === 'abs') return { k: 'fence', open: '|', close: '|', body: group() };
    if (name === 'norm') return { k: 'fence', open: '‖', close: '‖', body: group() };
    if (name === 'left') {
      const open = delimiter();
      const body = row((c, j) => s.startsWith('\\right', j));
      if (!s.startsWith('\\right', i)) err('\\left without \\right');
      i += 6;
      const close = delimiter();
      return { k: 'fence', open, close, body, explicit: true };
    }
    if (name === 'right') err('\\right without \\left');
    if (name === 'begin') {
      const env = rawGroup();
      if (!(env in MATRIX)) err(`unknown environment ${env}`);
      return matrix(env);
    }
    if (name === 'bmod' || name === 'pmod') {
      if (name === 'bmod') return { k: 'sym', text: 'mod', upright: true, func: true, binop: true };
      return { k: 'row', items: [{ k: 'space', em: 0.5 }, { k: 'sym', text: '(' }, { k: 'sym', text: 'mod', upright: true, func: true }, { k: 'space', em: 0.25 }, group(), { k: 'sym', text: ')' }] };
    }
    if (GREEK[name]) return { k: 'sym', text: GREEK[name], italic: name[0] === name[0].toLowerCase() };
    if (name in DELIM_CMD && name !== '{' && name !== '}') return { k: 'sym', text: DELIM_CMD[name] };
    if (SYMS[name]) return { k: 'sym', text: SYMS[name] };
    if (FUNCS.has(name)) return { k: 'sym', text: name, upright: true, func: true, limits: LIMITS.has(name) };
    err(`unknown command \\${name}`);
  }
  function atom() {
    skip();
    const c = s[i];
    if (c === undefined || c === '}') return null;
    if (c === '\\') return command();
    if (c === '{') return group();
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(s.slice(i))[0];
      if (FUNCS.has(m)) { i += m.length; return { k: 'sym', text: m, upright: true, func: true, limits: LIMITS.has(m) }; }
      i++;
      return { k: 'sym', text: c, italic: true };
    }
    if (/[0-9.]/.test(c)) { const m = /^(?:[0-9]+\.?[0-9]*|\.[0-9]*)/.exec(s.slice(i))[0]; i += m.length; return { k: 'sym', text: m }; }
    i++;
    if (c === "'") return { k: 'sym', text: '′', prime: true };
    return { k: 'sym', text: c === '-' ? '−' : c === '*' ? '·' : c };
  }
  function row(stop, top = false) {
    const items = [];
    const outer = last;
    if (!top) last = null;
    for (;;) {
      skip();
      if (i >= s.length || (stop && stop(s[i], i))) break;
      if (s[i] === '|' && top) break;
      if (s[i] === '}') err('unexpected }');
      let a = s[i] === '|' ? (i++, { k: 'sym', text: '|' }) : atom();
      if (!a) break;
      if (a.k === 'sym' && (a.text === '−' || a.text === '+' || a.text === '±') && (!last || ['bin', 'rel', 'open', 'punct'].includes(cls(last)) || last.k === 'sym' && last.func && !last.binop)) {
        a = { ...a, unary: true };
      }
      // Scripts attach to the atom before them (in either order); primes join a superscript.
      for (;;) {
        skip();
        if (s[i] === '^' || s[i] === '_') {
          const kind = s[i] === '^' ? 'sup' : 'sub';
          i++;
          const g = group();
          a = a.k === 'scripts' ? { ...a, [kind]: g } : { k: 'scripts', base: a, [kind]: g };
        } else if (s[i] === "'" && a.k !== 'space') {
          i++;
          const pr = { k: 'sym', text: '′' };
          if (a.k === 'scripts' && a.sup) a = { ...a, sup: { k: 'row', items: [...(a.sup.items ?? [a.sup]), pr] } };
          else items.push(a), a = pr;
        } else break;
      }
      items.push(a);
      if (a.k !== 'space') last = a.k === 'scripts' ? a.base : a;
    }
    if (!top) last = outer;
    return { k: 'row', items: autoFence(items) };
  }
  const terms = [];
  for (;;) {
    terms.push(row(null, true));
    if (s[i] === '|') { i++; continue; }
    if (i < s.length) err(`unexpected "${s[i]}"`);
    break;
  }
  return { terms: terms.filter((t) => t.items.length) };
}

/** Wrap matched ( ) and [ ] in a row into stretchy fences (sized later; short content keeps the glyph). */
function autoFence(items) {
  const out = [];
  const stack = [];
  for (const it of items) {
    if (it.k === 'sym' && (it.text === '(' || it.text === '[')) { stack.push(out.length); out.push(it); continue; }
    const closer = it.k === 'scripts' ? it.base : it;
    if (closer.k === 'sym' && (closer.text === ')' || closer.text === ']') && stack.length && PAIR[out[stack.at(-1)].text] === closer.text) {
      const at = stack.pop();
      const open = out[at].text;
      const body = { k: 'row', items: out.splice(at + 1) };
      out.pop();
      const fence = { k: 'fence', open, close: closer.text, body, auto: true };
      out.push(it.k === 'scripts' ? { ...it, base: fence } : fence);
      continue;
    }
    out.push(it);
  }
  return out;
}

// ── Layout ────────────────────────────────────────────────────────────────────

// A caller (style pack, notebook page) can set equations in its own face for one synchronous draw.
let FAMILY = null;
let DEFAULT_FAMILY = 'serif';
export function setDefaultFamily(fam) { DEFAULT_FAMILY = fam; }
export function withFamily(fam, fn) {
  const prev = FAMILY;
  FAMILY = fam;
  try { return fn(); } finally { FAMILY = prev; }
}
const fam = () => FAMILY ?? DEFAULT_FAMILY;

function fontFor(n, size) {
  const w = n.bold ? 700 : 500;
  return `${n.italic ? 'italic ' : ''}${w} ${size}px ${fam()}`;
}

const AXIS = 0.27;          // the maths axis (centre of fraction bars, + and =) above the baseline, × size
const MEMO = new WeakMap();

/** Measure a node at `size` px: { w, asc, desc } (ascent/descent from the baseline). Memoized per node, size and face. */
export function measure(ctx, n, size) {
  let per = MEMO.get(n);
  const key = `${fam()}|${size}`;
  if (per?.has(key)) return per.get(key);
  const m = measureRaw(ctx, n, size);
  if (!per) { per = new Map(); MEMO.set(n, per); }
  per.set(key, m);
  return m;
}

function delimWidth(ch, h, size) {
  if (!ch) return size * 0.06;
  if (ch === '|' ) return size * 0.22;
  if (ch === '‖') return size * 0.32;
  if (ch === '{' || ch === '}') return size * (0.32 + Math.min(0.12, h / size * 0.03));
  return size * (0.3 + Math.min(0.1, (h / size - 1) * 0.04));
}

function fenceBox(m, size) {
  const pad = size * 0.08;
  const half = Math.max(m.asc + pad - size * AXIS, m.desc + pad + size * AXIS, size * 0.5);
  return { asc: size * AXIS + half, desc: half - size * AXIS };
}

function matrixLayout(ctx, n, size) {
  const cells = n.rows.map((r) => r.map((c) => measure(ctx, c, size)));
  const cols = Math.max(...n.rows.map((r) => r.length));
  const colW = Array.from({ length: cols }, (_, j) => Math.max(...cells.map((r) => r[j]?.w ?? 0)));
  const rowA = cells.map((r) => Math.max(size * 0.72, ...r.map((c) => c.asc)));
  const rowD = cells.map((r) => Math.max(size * 0.22, ...r.map((c) => c.desc)));
  const gapY = size * 0.32, gapX = n.align === 'left' ? size * 1.1 : size * 0.85;
  const h = rowA.reduce((a, v, k) => a + v + rowD[k], 0) + gapY * (cells.length - 1);
  const w = colW.reduce((a, v) => a + v, 0) + gapX * (cols - 1);
  return { cells, colW, rowA, rowD, gapX, gapY, w, h, asc: size * AXIS + h / 2, desc: h / 2 - size * AXIS };
}

function measureRaw(ctx, n, size) {
  switch (n.k) {
    case 'row': {
      let w = 0, asc = size * 0.72, desc = size * 0.22;
      n.items.forEach((it, j) => {
        const m = measure(ctx, it, size);
        w += m.w + gapBetween(n.items[j - 1], it, size);
        asc = Math.max(asc, m.asc); desc = Math.max(desc, m.desc);
      });
      return { w, asc, desc };
    }
    case 'space': return { w: n.em * size, asc: 0, desc: 0 };
    case 'sym': {
      ctx.font = fontFor(n, size);
      const w = ctx.measureText(n.text).width;
      return { w: w + (n.italic ? size * 0.04 : 0), asc: size * 0.72, desc: size * 0.22 };
    }
    case 'frac': {
      const s2 = size * 0.82;
      const a = measure(ctx, n.num, s2), b = measure(ctx, n.den, s2);
      const axis = size * AXIS, gap = size * 0.12;
      return { w: Math.max(a.w, b.w) + size * 0.3, asc: axis + gap + a.desc + a.asc, desc: -axis + gap + b.asc + b.desc };
    }
    case 'sqrt': {
      const m = measure(ctx, n.body, size);
      const ix = n.index ? measure(ctx, n.index, size * 0.55) : null;
      const lead = size * 0.62 + (ix ? Math.max(0, ix.w - size * 0.32) : 0);
      return { w: lead + m.w + size * 0.12, asc: m.asc + size * 0.16, desc: m.desc + size * 0.04, lead };
    }
    case 'accent': {
      const m = measure(ctx, n.body, size);
      return { w: m.w, asc: m.asc + size * (n.acc === 'vec' ? 0.26 : 0.2), desc: m.desc };
    }
    case 'fence': {
      const m = n.body.k === 'matrix' ? matrixLayout(ctx, n.body, size) : measure(ctx, n.body, size);
      const tall = n.body.k === 'matrix' || m.asc + m.desc > size * 1.12;
      if (!tall) {
        ctx.font = fontFor({}, size);
        const ow = n.open ? ctx.measureText(n.open).width : 0, cw = n.close ? ctx.measureText(n.close).width : 0;
        return { w: ow + m.w + cw + size * 0.04, asc: Math.max(m.asc, size * 0.76), desc: Math.max(m.desc, size * 0.24), ow, cw, tall };
      }
      const f = fenceBox(m, size), h = f.asc + f.desc;
      const ow = delimWidth(n.open, h, size), cw = delimWidth(n.close, h, size);
      return { w: ow + m.w + cw + size * 0.08, asc: f.asc, desc: f.desc, ow, cw, tall };
    }
    case 'matrix': return matrixLayout(ctx, n, size);
    case 'scripts': {
      const base = measure(ctx, n.base, size);
      const ss = size * 0.62;
      const sup = n.sup ? measure(ctx, n.sup, ss) : null, sub = n.sub ? measure(ctx, n.sub, ss) : null;
      if (n.base.k === 'bigop' && !n.base.integral || n.base.limits) {
        const w = Math.max(base.w, sup?.w ?? 0, sub?.w ?? 0);
        return { w, asc: base.asc + (sup ? sup.asc + sup.desc + size * 0.08 : 0), desc: base.desc + (sub ? sub.asc + sub.desc + size * 0.08 : 0) };
      }
      const { up, down } = scriptShifts(n, base, sup, sub, size);
      const { supX, subX } = scriptX(n, size);
      return {
        w: base.w + Math.max(sup ? sup.w + supX : 0, sub ? sub.w + subX : 0) + size * 0.04,
        asc: Math.max(base.asc, sup ? up + sup.asc : 0), desc: Math.max(base.desc, sub ? down + sub.desc : 0),
      };
    }
    case 'bigop': return n.integral ? { w: size * 0.62, asc: size * 1.02, desc: size * 0.42 } : { w: size * 1.05, asc: size * 0.95, desc: size * 0.32 };
    case 'hl': { const m = measure(ctx, n.body, size); return { w: m.w + size * 0.24, asc: m.asc + size * 0.08, desc: m.desc + size * 0.08 }; }
    default: return { w: 0, asc: 0, desc: 0 };
  }
}

/** Horizontal offsets of the scripts from the base's advance (italic correction; integral limits). */
function scriptX(n, size) {
  if (n.base.integral) return { supX: size * 0.2, subX: -size * 0.06 };
  if (n.base.k === 'sym' && n.base.italic) return { supX: size * 0.06, subX: -size * 0.02 };
  return { supX: 0, subX: 0 };
}

/** Superscript and subscript baseline shifts: clear of a tall base (a fence, a fraction), never cramped. */
function scriptShifts(n, base, sup, sub, size) {
  const ss = size * 0.62;
  const tallBase = n.base.k !== 'sym' && n.base.k !== 'accent';
  let up = Math.max(size * 0.42, tallBase ? base.asc - ss * 0.42 : 0);
  let down = Math.max(size * 0.2, tallBase ? base.desc - ss * 0.3 : 0);
  if (n.base.integral) { up = size * 0.86; down = size * 0.42; }
  if (sup && sub) {
    const clash = (up - sup.desc) - (sub.asc - down);
    if (clash < size * 0.1) down += size * 0.1 - clash;
  }
  return { up, down };
}

/** Space before item b when it follows item a (TeX-like classes: bin, rel, punct, open, close, func). */
export function gapBetween(a, b, size) {
  if (!a || a.k === 'space' || b.k === 'space') return 0;
  const ca = cls(a), cb = cls(b);
  if (ca === 'unary') return size * 0.02;
  if (cb === 'punct' || cb === 'close' || ca === 'open') return size * 0.02;
  if (ca === 'punct') return size * 0.2;
  if (ca === 'rel' || cb === 'rel') return size * 0.28;
  if (ca === 'bin' || cb === 'bin' || a.binop || b.binop) return size * 0.22;
  if (ca === 'func') return cb === 'open' || b.k === 'fence' ? size * 0.02 : size * 0.17;
  if (a.k === 'sym' && a.italic && (cb === 'open' || b.k === 'fence')) return size * 0.07;
  if (a.k === 'sym' && a.upright && b.k === 'sym' && b.upright) return size * 0.12;
  if (b.k === 'bigop' || a.k === 'bigop' || (a.k === 'scripts' && a.base.k === 'bigop')) return size * 0.1;
  return size * 0.03;
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function stroke(ctx, ink, lw, path) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
}

/** A delimiter of height top..bot (canvas y) drawn in the box [x, x + w]. */
function drawDelim(ctx, ch, x, w, top, bot, size, ink, right) {
  if (!ch) return;
  const lw = Math.max(1.5, size * 0.055);
  const h = bot - top, mid = (top + bot) / 2;
  const L = x + w * 0.2, R = x + w * 0.8;
  const a = right ? R : L, b = right ? L : R;              // a: the outer edge, b: the inner
  switch (ch) {
    case '(': case ')':
      stroke(ctx, ink, lw, () => { ctx.moveTo(b, top); ctx.bezierCurveTo(a - (b - a) * 0.15, top + h * 0.22, a - (b - a) * 0.15, bot - h * 0.22, b, bot); });
      return;
    case '[': case ']': case '⌊': case '⌋': case '⌈': case '⌉': {
      const hasTop = ch === '[' || ch === ']' || ch === '⌈' || ch === '⌉', hasBot = ch === '[' || ch === ']' || ch === '⌊' || ch === '⌋';
      stroke(ctx, ink, lw, () => {
        ctx.moveTo(hasTop ? b : a, top); ctx.lineTo(a, top); ctx.lineTo(a, bot); ctx.lineTo(hasBot ? b : a, bot);
      });
      return;
    }
    case '{': case '}': {
      const tip = right ? R + w * 0.1 : L - w * 0.1, inner = right ? L : R, c = (a + b) / 2;
      stroke(ctx, ink, lw, () => {
        ctx.moveTo(inner, top);
        ctx.quadraticCurveTo(c, top, c, top + h * 0.12);
        ctx.lineTo(c, mid - h * 0.1);
        ctx.quadraticCurveTo(c, mid, tip, mid);
        ctx.quadraticCurveTo(c, mid, c, mid + h * 0.1);
        ctx.lineTo(c, bot - h * 0.12);
        ctx.quadraticCurveTo(c, bot, inner, bot);
      });
      return;
    }
    case '|':
      stroke(ctx, ink, lw, () => { ctx.moveTo(x + w / 2, top); ctx.lineTo(x + w / 2, bot); });
      return;
    case '‖':
      stroke(ctx, ink, lw, () => { ctx.moveTo(x + w * 0.32, top); ctx.lineTo(x + w * 0.32, bot); ctx.moveTo(x + w * 0.68, top); ctx.lineTo(x + w * 0.68, bot); });
      return;
    case '⟨': case '⟩':
      stroke(ctx, ink, lw, () => { ctx.moveTo(b, top); ctx.lineTo(a, mid); ctx.lineTo(b, bot); });
      return;
    default:
      ctx.font = fontFor({}, h * 0.8);
      ctx.fillStyle = ink;
      ctx.fillText(ch, x, bot - h * 0.2);
  }
}

function drawAccent(ctx, n, x, y, m, body, size, ink) {
  const lw = Math.max(1.5, size * 0.05);
  const top = y - body.asc - size * 0.06;
  const skew = n.body.k === 'sym' && n.body.italic ? size * 0.07 : 0;
  const cx = x + body.w / 2 + skew;
  const half = n.wide || n.acc === 'bar' && body.w > size * 0.8 ? body.w / 2 - size * 0.04 : Math.min(body.w / 2, size * 0.2);
  switch (n.acc) {
    case 'hat':
      stroke(ctx, ink, lw, () => { ctx.moveTo(cx - half, top); ctx.lineTo(cx, top - size * 0.13); ctx.lineTo(cx + half, top); });
      return;
    case 'bar':
      stroke(ctx, ink, lw, () => { ctx.moveTo(cx - half, top - size * 0.06); ctx.lineTo(cx + half, top - size * 0.06); });
      return;
    case 'vec': {
      const y0 = top - size * 0.08, hw = Math.max(half, size * 0.24);
      stroke(ctx, ink, lw, () => {
        ctx.moveTo(cx - hw, y0); ctx.lineTo(cx + hw, y0);
        ctx.moveTo(cx + hw - size * 0.11, y0 - size * 0.08); ctx.lineTo(cx + hw, y0); ctx.lineTo(cx + hw - size * 0.11, y0 + size * 0.08);
      });
      return;
    }
    case 'tilde':
      stroke(ctx, ink, lw, () => { ctx.moveTo(cx - half, top - size * 0.03); ctx.bezierCurveTo(cx - half / 2, top - size * 0.16, cx + half / 2, top + size * 0.06, cx + half, top - size * 0.09); });
      return;
    case 'dot': case 'ddot': {
      ctx.fillStyle = ink;
      const r = size * 0.045;
      const xs = n.acc === 'dot' ? [cx] : [cx - size * 0.1, cx + size * 0.1];
      for (const dx of xs) { ctx.beginPath(); ctx.arc(dx, top - size * 0.06, r, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    default:
  }
}

/** Draw a node with its left edge at x and its baseline at y. */
export function drawNode(ctx, n, x, y, size, ink, accent, hlInk = ink) {
  switch (n.k) {
    case 'row': {
      let cx = x;
      n.items.forEach((it, j) => {
        cx += gapBetween(n.items[j - 1], it, size);
        drawNode(ctx, it, cx, y, size, ink, accent, hlInk);
        cx += measure(ctx, it, size).w;
      });
      return;
    }
    case 'space': return;
    case 'sym':
      ctx.font = fontFor(n, size);
      ctx.fillStyle = ink;
      ctx.fillText(n.text, x, y);
      return;
    case 'frac': {
      const s2 = size * 0.82;
      const a = measure(ctx, n.num, s2), b = measure(ctx, n.den, s2), m = measure(ctx, n, size);
      const axis = y - size * AXIS, gap = size * 0.12;
      ctx.fillStyle = ink;
      if (!n.nobar) ctx.fillRect(x + size * 0.05, axis - size * 0.025, m.w - size * 0.1, Math.max(1.5, size * 0.05));
      drawNode(ctx, n.num, x + (m.w - a.w) / 2, axis - gap - a.desc, s2, ink, accent, hlInk);
      drawNode(ctx, n.den, x + (m.w - b.w) / 2, axis + gap + b.asc, s2, ink, accent, hlInk);
      return;
    }
    case 'sqrt': {
      const m = measure(ctx, n, size), body = measure(ctx, n.body, size);
      const top = y - m.asc + size * 0.03, bot = y + body.desc;
      const x1 = x + m.lead - size * 0.06;
      const lw = Math.max(1.5, size * 0.05);
      stroke(ctx, ink, lw, () => {
        ctx.moveTo(x1 - size * 0.5, y - size * 0.22);
        ctx.lineTo(x1 - size * 0.38, y - size * 0.3);
        ctx.lineTo(x1 - size * 0.2, bot);
        ctx.lineTo(x1, top);
        ctx.lineTo(x + m.w - size * 0.02, top);
      });
      if (n.index) drawNode(ctx, n.index, x1 - size * 0.42 - measure(ctx, n.index, size * 0.55).w * 0.6, y - size * 0.42, size * 0.55, ink, accent, hlInk);
      drawNode(ctx, n.body, x + m.lead + size * 0.04, y, size, ink, accent, hlInk);
      return;
    }
    case 'accent': {
      const body = measure(ctx, n.body, size), m = measure(ctx, n, size);
      drawNode(ctx, n.body, x, y, size, ink, accent, hlInk);
      drawAccent(ctx, n, x, y, m, body, size, ink);
      return;
    }
    case 'fence': {
      const m = measure(ctx, n, size);
      const body = n.body.k === 'matrix' ? matrixLayout(ctx, n.body, size) : measure(ctx, n.body, size);
      if (!m.tall) {
        ctx.font = fontFor({}, size);
        ctx.fillStyle = ink;
        if (n.open) ctx.fillText(n.open, x, y);
        drawNode(ctx, n.body, x + m.ow + size * 0.02, y, size, ink, accent, hlInk);
        if (n.close) { ctx.font = fontFor({}, size); ctx.fillStyle = ink; ctx.fillText(n.close, x + m.ow + body.w + size * 0.02, y); }
        return;
      }
      const top = y - m.asc, bot = y + m.desc;
      drawDelim(ctx, n.open, x, m.ow, top, bot, size, ink, false);
      drawNode(ctx, n.body, x + m.ow + size * 0.04, y, size, ink, accent, hlInk);
      drawDelim(ctx, n.close, x + m.w - m.cw, m.cw, top, bot, size, ink, true);
      return;
    }
    case 'matrix': {
      const L = matrixLayout(ctx, n, size);
      let ry = y - L.asc;
      L.cells.forEach((r, i) => {
        const base = ry + L.rowA[i];
        let cx = x;
        n.rows[i].forEach((cell, j) => {
          const cw = r[j].w;
          drawNode(ctx, cell, n.align === 'left' ? cx : cx + (L.colW[j] - cw) / 2, base, size, ink, accent, hlInk);
          cx += L.colW[j] + L.gapX;
        });
        ry = base + L.rowD[i] + L.gapY;
      });
      return;
    }
    case 'scripts': {
      const base = measure(ctx, n.base, size);
      const ss = size * 0.62;
      const sup = n.sup ? measure(ctx, n.sup, ss) : null, sub = n.sub ? measure(ctx, n.sub, ss) : null;
      if ((n.base.k === 'bigop' && !n.base.integral) || n.base.limits) {
        const m = measure(ctx, n, size);
        drawNode(ctx, n.base, x + (m.w - base.w) / 2, y, size, ink, accent, hlInk);
        if (n.sup) drawNode(ctx, n.sup, x + (m.w - sup.w) / 2, y - base.asc - size * 0.08 - sup.desc, ss, ink, accent, hlInk);
        if (n.sub) drawNode(ctx, n.sub, x + (m.w - sub.w) / 2, y + base.desc + size * 0.08 + sub.asc, ss, ink, accent, hlInk);
        return;
      }
      drawNode(ctx, n.base, x, y, size, ink, accent, hlInk);
      const { up, down } = scriptShifts(n, base, sup, sub, size);
      const sx = x + base.w + size * 0.04;
      const { supX, subX } = scriptX(n, size);
      if (n.sup) drawNode(ctx, n.sup, sx + supX, y - up, ss, ink, accent, hlInk);
      if (n.sub) drawNode(ctx, n.sub, sx + subX, y + down, ss, ink, accent, hlInk);
      return;
    }
    case 'bigop':
      ctx.font = `400 ${size * (n.integral ? 1.6 : 1.45)}px ${fam()}`;
      ctx.fillStyle = ink;
      ctx.fillText(n.text, x + (n.integral ? size * 0.02 : 0), y + size * (n.integral ? 0.3 : 0.22));
      return;
    case 'hl': {
      const m = measure(ctx, n, size);
      ctx.fillStyle = accent;
      ctx.fillRect(x, y - m.asc, m.w, m.asc + m.desc);
      drawNode(ctx, n.body, x + size * 0.12, y, size, hlInk, accent, hlInk);
      return;
    }
    default:
  }
}

/** Plain-text reading of an equation (for reports, captions and checks). */
export function plainTex(src) {
  return String(src ?? '').replace(/\|/g, ' ').replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ?? SYMS[name] ?? BIGOPS[name] ?? name).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}
