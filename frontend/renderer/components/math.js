// math — equations from a small TeX-like language, revealed term by term on
// the beat with highlight plates.
//
//   \frac{a}{b}   \sum_{i=1}^{n}   x^2  x^{-x}  w_i  \hat{y}  \sqrt? (no)
//   \alpha … \omega, \Sigma \Delta \Pi   \cdot \times \pm \to \leftarrow \leq \geq \approx \neq \partial \infty
//   \hl{…}  a highlight plate around part of a term
//   |       splits the top level into reveal terms (not drawn)
//
// Layout is a box tree measured with ctx.measureText (pure: same inputs → same
// boxes). Single latin letters are italic (variables); digits, operators and
// function names are upright. Greek falls back to JetBrains Mono when the
// display font has no glyph.

import { register } from '../registry.js';
import { color, unit, type as typeRole, family } from '../tokens.js';
import { sp, fade, clamp01, settle, peak, exitProgress } from '../motion.js';
import { landOnBeat, setFont } from '../kit.js';

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
};
const SYMS = { cdot: '·', times: '×', pm: '±', to: '→', rightarrow: '→', leftarrow: '←', leq: '≤', geq: '≥', approx: '≈', neq: '≠', partial: '∂', infty: '∞', in: '∈', ldots: '…' };
const HATS = { y: 'ŷ', x: 'x̂', w: 'ŵ', a: 'â', e: 'ê', o: 'ô' };
const OPS = new Set(['+', '−', '-', '=', '·', '×', '±', '→', '←', '≤', '≥', '≈', '≠', '<', '>', '∈']);
const FUNCS = new Set(['exp', 'log', 'ln', 'sin', 'cos', 'tan', 'max', 'min', 'softmax', 'tanh', 'ReLU', 'relu']);

export const TEMPLATES = {
  sigmoid: '\\sigma(x) | = | \\frac{1}{1 + e^{-x}}',
  neuron: 'a | = | \\sigma( | w \\cdot x | + b | )',
  'weighted-sum': 'z | = | \\sum_{i=1}^{n} w_i x_i | + | b',
  mse: 'L | = | \\frac{1}{n} | \\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2',
  'gradient-step': 'w | \\leftarrow | w | - \\eta \\frac{\\partial L}{\\partial w}',
  softmax: 'p_k | = | \\frac{e^{z_k}}{\\sum_j e^{z_j}}',
};

// ── Parse ─────────────────────────────────────────────────────────────────────

/** Source → { terms: [row, …] } where a row is { k: 'row', items: [...] }. */
export function parseTex(src) {
  const s = String(src ?? '');
  let i = 0;
  const err = (m) => { throw new Error(`math: ${m} at ${i}`); };
  function group() {
    if (s[i] === '{') { i++; const r = row('}'); if (s[i] !== '}') err('missing }'); i++; return r; }
    return atom() ?? err('expected an argument');
  }
  function command() {
    const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
    if (!m) { i++; return { k: 'sym', text: s[i] ?? '' }; }
    i += m[0].length;
    const name = m[1];
    if (name === 'frac') return { k: 'frac', num: group(), den: group() };
    if (name === 'sum' || name === 'prod') return { k: 'bigop', text: name === 'sum' ? 'Σ' : 'Π' };
    if (name === 'hl') return { k: 'hl', body: group() };
    if (name === 'hat') { const g = group(); const t = g.items?.[0]?.text ?? ''; return { k: 'sym', text: HATS[t] ?? t, italic: true }; }
    if (name === 'text' || name === 'mathrm') { const g = group(); return { k: 'sym', text: g.items.map((x) => x.text).join(''), upright: true }; }
    if (GREEK[name]) return { k: 'sym', text: GREEK[name], italic: name[0] === name[0].toLowerCase() };
    if (SYMS[name]) return { k: 'sym', text: SYMS[name] };
    if (FUNCS.has(name)) return { k: 'sym', text: name, upright: true };
    err(`unknown command \\${name}`);
  }
  function atom() {
    while (s[i] === ' ') i++;
    const c = s[i];
    if (c === undefined || c === '}' || c === '|') return null;
    if (c === '\\') return command();
    if (c === '{') return group();
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(s.slice(i))[0];
      if (FUNCS.has(m)) { i += m.length; return { k: 'sym', text: m, upright: true }; }
      i++;
      return { k: 'sym', text: c, italic: true };
    }
    if (/[0-9.]/.test(c)) { const m = /^[0-9.]+/.exec(s.slice(i))[0]; i += m.length; return { k: 'sym', text: m }; }
    i++;
    return { k: 'sym', text: c === '-' ? '−' : c === '*' ? '·' : c };
  }
  function row(end) {
    const items = [];
    for (;;) {
      while (s[i] === ' ') i++;
      if (i >= s.length || s[i] === end || s[i] === '|') break;
      let a = atom();
      if (!a) break;
      // Scripts attach to the atom before them (in either order).
      while (s[i] === '^' || s[i] === '_') {
        const kind = s[i] === '^' ? 'sup' : 'sub';
        i++;
        const g = group();
        a = a.k === 'scripts' ? { ...a, [kind]: g } : { k: 'scripts', base: a, [kind]: g };
      }
      items.push(a);
    }
    return { k: 'row', items };
  }
  const terms = [];
  for (;;) {
    terms.push(row(null));
    if (s[i] === '|') { i++; continue; }
    if (i < s.length) err(`unexpected "${s[i]}"`);
    break;
  }
  return { terms: terms.filter((t) => t.items.length) };
}

// ── Layout ────────────────────────────────────────────────────────────────────

function fontFor(n, size) {
  const fam = `"${family('body')}", "${family('code')}"`;
  if (n.k === 'bigop') return `400 ${size}px ${fam}`;
  return `${n.italic ? 'italic ' : ''}${n.upright || !n.italic ? 500 : 500} ${size}px ${fam}`;
}

/** Measure a node at `size` px: { w, asc, desc } (ascent/descent from the baseline). Memo-free and pure. */
export function measure(ctx, n, size) {
  switch (n.k) {
    case 'row': {
      let w = 0, asc = size * 0.72, desc = size * 0.22;
      n.items.forEach((it, j) => {
        const m = measure(ctx, it, size);
        w += m.w + gapBetween(n.items[j - 1], it, size, j - 1);
        asc = Math.max(asc, m.asc); desc = Math.max(desc, m.desc);
      });
      return { w, asc, desc };
    }
    case 'sym': {
      ctx.font = fontFor(n, size);
      const w = ctx.measureText(n.text).width;
      return { w: w + (n.italic ? size * 0.04 : 0), asc: size * 0.72, desc: size * 0.22 };
    }
    case 'frac': {
      const s2 = size * 0.82;
      const a = measure(ctx, n.num, s2), b = measure(ctx, n.den, s2);
      const axis = size * 0.27, gap = size * 0.12;
      return { w: Math.max(a.w, b.w) + size * 0.3, asc: axis + gap + a.desc + a.asc, desc: -axis + gap + b.asc + b.desc };
    }
    case 'scripts': {
      const base = measure(ctx, n.base, size);
      const sup = n.sup ? measure(ctx, n.sup, size * 0.62) : null, sub = n.sub ? measure(ctx, n.sub, size * 0.62) : null;
      const big = n.base.k === 'bigop';
      if (big) {
        const w = Math.max(base.w, sup?.w ?? 0, sub?.w ?? 0);
        return { w, asc: base.asc + (sup ? sup.asc + sup.desc + size * 0.08 : 0), desc: base.desc + (sub ? sub.asc + sub.desc + size * 0.08 : 0) };
      }
      return { w: base.w + Math.max(sup?.w ?? 0, sub?.w ?? 0) + size * 0.04, asc: Math.max(base.asc, sup ? size * 0.45 + sup.asc : 0), desc: Math.max(base.desc, sub ? size * 0.2 + sub.desc : 0) };
    }
    case 'bigop': return { w: size * 1.05, asc: size * 0.95, desc: size * 0.32 };
    case 'hl': { const m = measure(ctx, n.body, size); return { w: m.w + size * 0.24, asc: m.asc + size * 0.08, desc: m.desc + size * 0.08 }; }
    default: return { w: 0, asc: 0, desc: 0 };
  }
}

function gapBetween(a, b, size, prevIndex = 1) {
  if (!a) return 0;
  const op = (n) => n.k === 'sym' && OPS.has(n.text);
  if (op(a) && prevIndex === 0 && (a.text === '−' || a.text === '+')) return size * 0.02;   // unary sign hugs its operand
  if (op(a) || op(b)) return size * 0.24;
  if (a.k === 'sym' && a.upright && b.k === 'sym' && b.upright) return size * 0.12;
  return size * 0.03;
}

/** Draw a node with its left edge at x and its baseline at y. */
export function drawNode(ctx, n, x, y, size, ink, accent) {
  switch (n.k) {
    case 'row': {
      let cx = x;
      n.items.forEach((it, j) => {
        cx += gapBetween(n.items[j - 1], it, size, j - 1);
        drawNode(ctx, it, cx, y, size, ink, accent);
        cx += measure(ctx, it, size).w;
      });
      return;
    }
    case 'sym':
      ctx.font = fontFor(n, size);
      ctx.fillStyle = ink;
      ctx.fillText(n.text, x, y);
      return;
    case 'frac': {
      const s2 = size * 0.82;
      const a = measure(ctx, n.num, s2), b = measure(ctx, n.den, s2), m = measure(ctx, n, size);
      const axis = y - size * 0.27, gap = size * 0.12;
      ctx.fillStyle = ink;
      ctx.fillRect(x + size * 0.05, axis - size * 0.03, m.w - size * 0.1, Math.max(2, size * 0.06));
      drawNode(ctx, n.num, x + (m.w - a.w) / 2, axis - gap - a.desc, s2, ink, accent);
      drawNode(ctx, n.den, x + (m.w - b.w) / 2, axis + gap + b.asc, s2, ink, accent);
      return;
    }
    case 'scripts': {
      const base = measure(ctx, n.base, size);
      const ss = size * 0.62;
      if (n.base.k === 'bigop') {
        const m = measure(ctx, n, size);
        drawNode(ctx, n.base, x + (m.w - base.w) / 2, y, size, ink, accent);
        if (n.sup) { const q = measure(ctx, n.sup, ss); drawNode(ctx, n.sup, x + (m.w - q.w) / 2, y - base.asc - size * 0.08 - q.desc, ss, ink, accent); }
        if (n.sub) { const q = measure(ctx, n.sub, ss); drawNode(ctx, n.sub, x + (m.w - q.w) / 2, y + base.desc + size * 0.08 + q.asc, ss, ink, accent); }
        return;
      }
      drawNode(ctx, n.base, x, y, size, ink, accent);
      const sx = x + base.w + size * 0.04;
      if (n.sup) drawNode(ctx, n.sup, sx, y - size * 0.45, ss, ink, accent);
      if (n.sub) drawNode(ctx, n.sub, sx, y + size * 0.2, ss, ink, accent);
      return;
    }
    case 'bigop':
      ctx.font = `400 ${size * 1.45}px "${family('body')}", "${family('code')}"`;
      ctx.fillStyle = ink;
      ctx.fillText(n.text, x, y + size * 0.22);
      return;
    case 'hl': {
      const m = measure(ctx, n, size);
      ctx.fillStyle = accent;
      ctx.fillRect(x, y - m.asc, m.w, m.asc + m.desc);
      drawNode(ctx, n.body, x + size * 0.12, y, size, color('ink'), accent);
      return;
    }
    default:
  }
}

/** Reveal times: term g lands on beat start_beat + g × beats_per_term. */
export function termSchedule(clip, p, n, beat, fps) {
  return Array.from({ length: n }, (_, g) => landOnBeat(clip.start, p.start_beat + g * p.beats_per_term, 'slam', beat, fps));
}

export const highlights = (s) => String(s ?? '').split(',').map((v) => parseInt(v, 10)).filter((v) => v >= 1);

const SIZES = { hero: 200, display: 140, h1: 100, h2: 70 };

register({
  type: 'math',
  kind: 'component',
  label: 'Equation',
  category: 'Text',
  description: 'An equation (fractions, Σ, sub/superscripts, Greek) that lands term by term on the beat, with highlight plates on chosen terms. Templates: sigmoid, neuron, weighted sum, MSE, gradient step, softmax.',
  duration: 6,
  schema: {
    template: { type: 'enum', options: ['custom', ...Object.keys(TEMPLATES)], default: 'sigmoid', label: 'Template' },
    tex: { type: 'text', default: 'y | = | w \\cdot x | + b', label: 'Equation (custom; | splits terms)', maxLength: 300 },
    caption: { type: 'text', default: 'The sigmoid squashes any score into a probability.', label: 'Caption', maxLength: 120 },
    size: { type: 'enum', options: Object.keys(SIZES), default: 'display', label: 'Size' },
    color: { type: 'color', default: 'ink', label: 'Ink' },
    accent: { type: 'color', default: 'lime', label: 'Highlight' },
    start_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 1, label: 'First term on beat #' },
    beats_per_term: { type: 'number', min: 0.5, max: 8, step: 0.5, default: 1, label: 'Beats per term' },
    highlight: { type: 'text', default: '3', label: 'Highlight terms (1-based, e.g. 3)', maxLength: 40 },
    highlight_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 6, label: 'Highlight on beat #' },
  },
  textStudio: false,
  clipLabel: (clip) => `math · ${clip.props?.template ?? 'custom'}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const src = p.template === 'custom' ? p.tex : TEMPLATES[p.template];
    let parsed;
    try { parsed = parseTex(src); } catch (e) { env.warn(e.message); return; }
    const size = SIZES[p.size] * unit(env.frame) * (env.xf.sx ?? 1);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const gap = size * 0.24;
    const ms = parsed.terms.map((t) => measure(ctx, t, size));
    const totalW = ms.reduce((a, m) => a + m.w, 0) + gap * (ms.length - 1);
    const asc = Math.max(...ms.map((m) => m.asc)), desc = Math.max(...ms.map((m) => m.desc));
    const x0 = env.anchor.x, base = env.anchor.y + asc;
    const sched = termSchedule(clip, p, parsed.terms.length, env.beat, env.settings.fps);
    const hlT = landOnBeat(clip.start, p.highlight_beat, 'snappy', env.beat, env.settings.fps);
    const hk = clamp01(sp(env.t - hlT.start, 'snappy', 'scale'));
    const hls = new Set(highlights(p.highlight));
    const ink = color(p.color), accent = color(p.accent);
    let x = x0, settled = true;
    parsed.terms.forEach((term, g) => {
      const m = ms[g];
      const e = env.t - sched[g].start;
      const ex = exitProgress(lt, clip.duration, 0.4, 'quick', (parsed.terms.length - g) * 0.03);
      if (e > 0) {
        const pr = sp(e, 'slam', 'position');
        ctx.save();
        ctx.globalAlpha *= fade(e * 2.5, 'slam') * (1 - ex);
        ctx.translate(0, size * 0.55 * (1 - pr) + size * 0.8 * ex);
        if (hls.has(g + 1) && hk > 0) {
          // Highlight plate grows from the left behind the term, ink border, hard shadow.
          const pad = size * 0.1;
          const w = (m.w + pad * 2) * hk;
          ctx.fillStyle = ink;
          ctx.fillRect(x - pad + size * 0.06, base - m.asc - pad + size * 0.06, w, m.asc + m.desc + pad * 2);
          ctx.fillStyle = accent;
          ctx.fillRect(x - pad, base - m.asc - pad, w, m.asc + m.desc + pad * 2);
        }
        drawNode(ctx, term, x, base, size, ink, accent);
        ctx.restore();
        if (e < settle('slam') || ex > 0) settled = false;
      } else settled = false;
      x += m.w + gap;
    });
    env.box({ kind: 'text', role: p.size, name: 'equation', x: x0, y: base - asc, w: totalW, h: asc + desc, fg: ink, bg: color(env.settings.background), size, text: src.replace(/\|/g, ''), settled });
    if (p.caption) {
      const lab = typeRole('h2', env.frame);
      const ce = env.t - (sched.at(-1)?.hit ?? clip.start);
      if (ce > 0) {
        setFont(ctx, lab);
        ctx.save();
        ctx.globalAlpha *= fade(ce * 2, 'soft') * (1 - exitProgress(lt, clip.duration, 0.4, 'quick'));
        ctx.fillStyle = color('ink-soft');
        ctx.fillText(p.caption, x0, base + desc + lab.size * 1.6 + size * 0.1 * (1 - clamp01(sp(ce, 'soft'))));
        ctx.restore();
        env.box({ kind: 'text', role: 'h2', name: 'caption', x: x0, y: base + desc + lab.size * 0.8, w: ctx.measureText(p.caption).width, h: lab.size * 0.78, fg: color('ink-soft'), size: lab.size, text: p.caption, settled: ce > 1 && lt < clip.duration - 0.4 });
      }
    }
    env.animating();
  },
  events(clip, env) {
    const p = env.props;
    let parsed;
    try { parsed = parseTex(p.template === 'custom' ? p.tex : TEMPLATES[p.template]); } catch { return []; }
    const out = [];
    termSchedule(clip, p, parsed.terms.length, env.beat, env.fps).forEach((l, g, all) => {
      out.push({ kind: 'hit', t: l.hit, sound: g === all.length - 1 ? 'impact' : 'pop', gain_db: g === all.length - 1 ? -6 : -10 });
      out.push({ kind: 'motion', role: 'term', start: l.start, peak: l.start + peak('slam'), settle: l.start + settle('slam'), preset: 'slam' });
    });
    if (highlights(p.highlight).length) {
      const h = landOnBeat(clip.start, p.highlight_beat, 'snappy', env.beat, env.fps);
      out.push({ kind: 'hit', t: h.hit, sound: 'click', gain_db: -8 });
    }
    return out;
  },
});
