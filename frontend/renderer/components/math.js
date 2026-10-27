// math — equations from a small TeX-like language (renderer/tex.js), revealed
// term by term on the beat with highlight plates.
//
//   \frac \sqrt \sum \int \lim, ^ _ ', accents (\hat \vec \bar), \left( \right),
//   matrices (\begin{pmatrix} a & b \\ c & d \end{pmatrix}), \mathbb{R}, Greek, relations
//   \hl{…}  a highlight plate around part of a term
//   |       splits the top level into reveal terms (not drawn); \abs{x} for |x|
//
// Layout is a box tree measured with ctx.measureText (pure: same inputs → same
// boxes). The face is the body font (sans) or a maths serif (Cambria Math).

import { register } from '../registry.js';
import { color, unit, type as typeRole, family } from '../tokens.js';
import { sp, fade, clamp01, settle, peak, exitProgress } from '../motion.js';
import { landOnBeat, setFont } from '../kit.js';
import { parseTex, measure, drawNode, withFamily, setDefaultFamily, plainTex } from '../tex.js';

export { parseTex, measure, drawNode, withFamily, plainTex };

export const SERIF = '"Cambria Math", Cambria, Georgia, serif';

export const TEMPLATES = {
  sigmoid: String.raw`\sigma(x) | = | \frac{1}{1 + e^{-x}}`,
  neuron: String.raw`a | = | \sigma( | w \cdot x | + b | )`,
  'weighted-sum': String.raw`z | = | \sum_{i=1}^{n} w_i x_i | + | b`,
  mse: String.raw`L | = | \frac{1}{n} | \sum_{i=1}^{n} (y_i - \hat{y}_i)^2`,
  'gradient-step': String.raw`w | \leftarrow | w | - \eta \frac{\partial L}{\partial w}`,
  softmax: String.raw`p_k | = | \frac{e^{z_k}}{\sum_j e^{z_j}}`,
  quadratic: String.raw`x | = | \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
  derivative: String.raw`f'(x) | = | \lim_{h \to 0} | \frac{f(x+h) - f(x)}{h}`,
  'fundamental-theorem': String.raw`\int_a^b f(x)\,dx | = | F(b) - F(a)`,
  taylor: String.raw`e^x | = | \sum_{n=0}^{\infty} \frac{x^n}{n!} | = | 1 + x + \frac{x^2}{2!} + \cdots`,
  gradient: String.raw`\nabla f | = | \left( \frac{\partial f}{\partial x}, \frac{\partial f}{\partial y} \right)`,
  heat: String.raw`\frac{\partial u}{\partial t} | = | \alpha \frac{\partial^2 u}{\partial x^2}`,
  eigen: String.raw`A\vec{v} | = | \lambda \vec{v}`,
  binomial: String.raw`\binom{n}{k} | = | \frac{n!}{k!\,(n-k)!}`,
  pythagoras: String.raw`a^2 + b^2 | = | c^2`,
  euler: String.raw`e^{i\pi} | + 1 | = | 0`,
};

const SANS = () => `"${family('body')}", "${family('code')}"`;

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
  description: 'An equation (fractions, roots, Σ ∫ lim, matrices, accents, sub/superscripts, Greek) that lands term by term on the beat, with highlight plates on chosen terms. Templates for ML, calculus, linear algebra, combinatorics and geometry.',
  duration: 6,
  schema: {
    template: { type: 'enum', options: ['custom', ...Object.keys(TEMPLATES)], default: 'sigmoid', label: 'Template' },
    tex: { type: 'text', default: 'y | = | w \\cdot x | + b', label: 'Equation (custom; | splits terms)', maxLength: 300 },
    caption: { type: 'text', default: 'The sigmoid squashes any score into a probability.', label: 'Caption', maxLength: 120 },
    size: { type: 'enum', options: Object.keys(SIZES), default: 'display', label: 'Size' },
    color: { type: 'color', default: 'ink', label: 'Ink' },
    face: { type: 'enum', options: ['sans', 'serif'], default: 'sans', label: 'Face (serif = printed maths)' },
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
    setDefaultFamily(p.face === 'serif' ? SERIF : SANS());
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
    env.box({ kind: 'text', role: p.size, name: 'equation', x: x0, y: base - asc, w: totalW, h: asc + desc, fg: ink, bg: color(env.settings.background), size, text: plainTex(src), settled });
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
