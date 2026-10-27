// plot — y = f(x) drawn on. Axes with nice ticks, up to two curves from the
// safe expression language (expr.js), drawn by a spring that starts on beat
// `draw_beat` and arrives exactly `draw_beats` later, with a marker riding
// the pen. Optional point markers land on the beat afterwards.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, type as typeRole } from '../tokens.js';
import { box } from '../draw.js';
import { sp, clamp01, arrival, settle, peak, exitProgress } from '../motion.js';
import { landOnBeat, setFont } from '../kit.js';
import { compile } from '../expr.js';
import { niceTick, decimalsOf, fmtNum } from './graph.js';

/** Draw progress 0 → 1: starts on beat `draw_beat`, arrives on beat draw_beat + draw_beats. */
export function drawSchedule(clip, p, beat, fps) {
  const start = landOnBeat(clip.start, p.draw_beat, 'quick', beat, fps).hit;   // the pen starts on a grid line
  const end = Math.max(start + 0.1, landOnBeat(clip.start, p.draw_beat + p.draw_beats, 'quick', beat, fps).hit);
  const span = end - start;                                                    // …and arrives on one
  const k = arrival('soft', 'position') / span;                                // time scale so arrival = end beat
  return { start, end, at: (t) => clamp01(sp((t - start) * k, 'soft', 'position')) };
}

/**
 * Sample f over [x0, x1] into n+1 points. NaN/∞ break the line, and so does a
 * jump across the whole y window whose midpoint is not between its ends (a pole,
 * as in tan x or 1/x), so asymptotes are never drawn as false vertical lines.
 */
export function sample(fn, x0, x1, n = 240, yMin = -Infinity, yMax = Infinity) {
  const f = compile(fn).f;
  const out = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = f(x);
    if (prev && Number.isFinite(prev.y) && Number.isFinite(y) && ((prev.y > yMax && y < yMin) || (prev.y < yMin && y > yMax))) {
      const m = f((prev.x + x) / 2);
      if (!(m >= Math.min(prev.y, y) && m <= Math.max(prev.y, y))) out.push({ x: (prev.x + x) / 2, y: NaN });
    }
    prev = { x, y };
    out.push(prev);
  }
  return out;
}

/** Equal aspect: widen the shorter range about its centre so one unit is the same length on both axes. */
export function equalAspect(p, pw, ph) {
  const rx = p.x_max - p.x_min, ry = p.y_max - p.y_min;
  if (rx <= 0 || ry <= 0 || pw <= 0 || ph <= 0) return p;
  const k = (rx / pw) / (ry / ph);                     // >1: x units are shorter than y units on screen
  if (k > 1) { const c = (p.y_min + p.y_max) / 2, h = (ry * k) / 2; return { ...p, y_min: c - h, y_max: c + h }; }
  const c = (p.x_min + p.x_max) / 2, h = (rx / k) / 2;
  return { ...p, x_min: c - h, x_max: c + h };
}

/** "-2, 0, 2" → [-2, 0, 2] */
const parseXs = (s) => String(s ?? '').split(',').map((v) => parseFloat(v)).filter(Number.isFinite);

register({
  type: 'plot',
  kind: 'component',
  label: 'Function plot',
  category: 'Data',
  description: 'y = f(x) drawn on along the beat: axes with nice ticks, up to two curves (e.g. sigmoid vs relu), a marker riding the pen and points that land on beats.',
  duration: 6,
  schema: {
    fn: { type: 'text', default: 'sigmoid(x)', label: 'f(x)', maxLength: 120 },
    fn2: { type: 'text', default: '', label: 'Second curve (optional)', maxLength: 120 },
    label: { type: 'text', default: 'σ(x)', label: 'Curve label', maxLength: 24 },
    label2: { type: 'text', default: '', label: 'Second label', maxLength: 24 },
    title: { type: 'text', default: 'The sigmoid squashes any input into 0–1', label: 'Title', maxLength: 80 },
    x_min: { type: 'number', min: -1000, max: 1000, step: 0.5, default: -6, label: 'x from' },
    x_max: { type: 'number', min: -1000, max: 1000, step: 0.5, default: 6, label: 'x to' },
    y_min: { type: 'number', min: -1000, max: 1000, step: 0.1, default: -0.2, label: 'y from' },
    y_max: { type: 'number', min: -1000, max: 1000, step: 0.1, default: 1.2, label: 'y to' },
    points: { type: 'text', default: '', label: 'Mark x values (e.g. -2, 0, 2)', maxLength: 80 },
    color: { type: 'color', default: 'cobalt', label: 'Curve colour' },
    color2: { type: 'color', default: 'orange', label: 'Second colour' },
    draw_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 1, label: 'Draw from beat #' },
    draw_beats: { type: 'number', min: 0.5, max: 32, step: 0.5, default: 4, label: 'Draw over beats' },
    width: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.62, label: 'Width (frame)' },
    height: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.66, label: 'Height (frame)' },
    panel: { type: 'bool', default: true, label: 'White panel + border' },
    x_label: { type: 'text', default: '', label: 'x-axis name', maxLength: 24 },
    y_label: { type: 'text', default: '', label: 'y-axis name', maxLength: 24 },
    aspect: { type: 'enum', options: ['fit', 'equal'], default: 'fit', label: 'Scale (equal = 1:1 units)' },
  },
  clipLabel: (clip) => `plot · ${clip.props?.fn ?? ''}`,
  render(ctx, clip, lt, env) {
    let p = env.props;
    const u = unit(env.frame);
    const W = p.width * env.frame.w * env.xf.sx, H = p.height * env.frame.h * env.xf.sy;
    const x = env.anchor.x - W / 2, y = env.anchor.y - H / 2;
    const bw = border(env.frame);
    const lab = typeRole('label', env.frame), ttl = typeRole('h2', env.frame);
    const ex = exitProgress(lt, clip.duration, 0.4, 'quick');
    ctx.save();
    ctx.translate(0, env.frame.h * 0.9 * ex);
    if (p.panel) box(ctx, x, y, W, H, { fill: color('white'), stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame) });
    const pad = 36 * u;
    setFont(ctx, ttl);
    ctx.fillStyle = color('ink');
    ctx.fillText(p.title, x + pad, y + pad + ttl.size * 0.78);
    const titleH = p.title ? ttl.size * 1.5 : 0;
    const px0 = x + pad + lab.size * 3, px1 = x + W - pad, py0 = y + pad + titleH, py1 = y + H - pad - lab.size * (p.x_label ? 2.8 : 1.6);
    if (p.aspect === 'equal') p = equalAspect(p, px1 - px0, py1 - py0);
    const X = (v) => px0 + ((v - p.x_min) / (p.x_max - p.x_min || 1)) * (px1 - px0);
    const Y = (v) => py1 - ((v - p.y_min) / (p.y_max - p.y_min || 1)) * (py1 - py0);
    // Grid + ticks (labels at the tick's own precision, true minus signs).
    setFont(ctx, lab);
    const tx = niceTick(p.x_max - p.x_min, 6), ty = niceTick(p.y_max - p.y_min, 4);
    const dx = decimalsOf(tx), dy = decimalsOf(ty);
    ctx.textAlign = 'center';
    for (let k = Math.ceil(p.x_min / tx - 1e-9); k * tx <= p.x_max + 1e-9; k++) {
      const v = k * tx;
      ctx.fillStyle = color('paper-deep'); ctx.fillRect(X(v) - u, py0, 2 * u, py1 - py0);
      ctx.fillStyle = color('ink-soft'); ctx.fillText(fmtNum(v, dx), X(v), py1 + lab.size * 1.25);
    }
    ctx.textAlign = 'right';
    for (let k = Math.ceil(p.y_min / ty - 1e-9); k * ty <= p.y_max + 1e-9; k++) {
      const v = k * ty;
      ctx.fillStyle = color('paper-deep'); ctx.fillRect(px0, Y(v) - u, px1 - px0, 2 * u);
      ctx.fillStyle = color('ink-soft'); ctx.fillText(fmtNum(v, dy), px0 - lab.size * 0.5, Y(v) + lab.size * 0.35);
    }
    ctx.fillStyle = color('ink');
    if (p.x_label) { ctx.textAlign = 'right'; ctx.fillText(p.x_label, px1, py1 + lab.size * 2.6); }
    if (p.y_label) { ctx.textAlign = 'left'; ctx.fillText(p.y_label, px0 + lab.size * 0.4, py0 + lab.size * 0.9); }
    ctx.textAlign = 'left';
    // Axes through zero when in range.
    ctx.fillStyle = color('ink');
    if (p.y_min <= 0 && p.y_max >= 0) ctx.fillRect(px0, Y(0) - bw * 0.35, px1 - px0, bw * 0.7);
    if (p.x_min <= 0 && p.x_max >= 0) ctx.fillRect(X(0) - bw * 0.35, py0, bw * 0.7, py1 - py0);
    // Curves, drawn on.
    const sch = drawSchedule(clip, p, env.beat, env.settings.fps);
    const prog = sch.at(env.t);
    const curves = [[p.fn, p.color, p.label], [p.fn2, p.color2, p.label2]].filter(([f]) => f && f.trim());
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0 - bw, px1 - px0, py1 - py0 + bw * 2); ctx.clip();
    curves.forEach(([f, c, name], ci) => {
      const n = Math.max(240, Math.round(((px1 - px0) / (1.5 * u)) * prog));        // about one sample per 1.5 px
      const pts = sample(f, p.x_min, p.x_min + (p.x_max - p.x_min) * prog, n, p.y_min, p.y_max);
      ctx.strokeStyle = color(c);
      ctx.lineWidth = bw * 1.1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false;
      for (const q of pts) {
        if (!Number.isFinite(q.y)) { pen = false; continue; }
        pen ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y));
        pen = true;
      }
      ctx.stroke();
      const tip = pts[pts.length - 1];
      if (prog > 0 && Number.isFinite(tip.y)) {
        const r = bw * 1.6;
        box(ctx, X(tip.x) - r, Y(tip.y) - r, r * 2, r * 2, { fill: color(c), stroke: color('ink'), strokeW: bw * 0.6 });
        if (name && prog > 0.98) {
          setFont(ctx, lab);
          ctx.fillStyle = color(c);
          const ly = Math.min(py1 - lab.size * 0.4, Math.max(py0 + lab.size, Y(tip.y) - r * 2 - ci * lab.size * 1.4));
          ctx.fillText(name, Math.min(X(tip.x) + r * 2, px1 - ctx.measureText(name).width), ly);
        }
      }
    });
    ctx.restore();
    // Points: land one per beat after the curve is drawn.
    const fx = compile(p.fn).f;
    parseXs(p.points).forEach((vx, i) => {
      const L = landOnBeat(clip.start, p.draw_beat + p.draw_beats + i, 'slam', env.beat, env.settings.fps);
      const e = env.t - L.start;
      if (e <= 0 || !Number.isFinite(fx(vx))) return;
      const s = Math.max(0, sp(e, 'slam', 'scale'));
      const r = bw * 2.4 * s;
      // Drop line to the x-axis (y = 0 when it is in view, else the nearer edge).
      const ya = Y(Math.min(p.y_max, Math.max(p.y_min, 0)));
      ctx.fillStyle = color('ink');
      ctx.fillRect(X(vx) - u, Math.min(ya, Y(fx(vx))), 2 * u, Math.abs(ya - Y(fx(vx))));
      box(ctx, X(vx) - r, Y(fx(vx)) - r, r * 2, r * 2, { fill: color('lime'), stroke: color('ink'), strokeW: bw * 0.7 });
      if (s > 0.9) {
        setFont(ctx, lab);
        ctx.fillStyle = color('ink');
        const txt = fmtNum(fx(vx), Math.min(3, Math.max(2, decimalsOf(fx(vx), 3))));
        ctx.fillText(txt, X(vx) + r * 1.4, Y(fx(vx)) + lab.size * 0.35);
      }
    });
    ctx.restore();
    const err = compile(p.fn).error;
    if (err) env.warn(`plot f(x): ${err}`);
    env.box({ kind: 'box', x, y, w: W, h: H, settled: prog >= 1 && !ex });
    setFont(ctx, ttl);
    if (p.title) env.box({ kind: 'text', role: 'h2', x: x + pad, y: y + pad, w: Math.min(W - pad * 2, ctx.measureText(p.title).width), h: ttl.size * 0.78, fg: color('ink'), bg: color(p.panel ? 'white' : env.settings.background), size: ttl.size, text: p.title, settled: !ex });
    if (prog < 1 || env.t < sch.end + 2 || ex > 0) env.animating();
  },
  events(clip, env) {
    const p = env.props;
    const sch = drawSchedule(clip, p, env.beat, env.fps);
    const out = [
      { kind: 'cue', t: sch.start, sound: 'whoosh', gain_db: -12 },
      { kind: 'hit', t: sch.end, sound: 'pop', gain_db: -9 },
      { kind: 'motion', role: 'plot-draw', start: sch.start, peak: sch.end, settle: sch.end + 0.2, preset: 'soft' },
    ];
    parseXs(p.points).forEach((_, i) => {
      const L = landOnBeat(clip.start, p.draw_beat + p.draw_beats + i, 'slam', env.beat, env.fps);
      out.push({ kind: 'hit', t: L.hit, sound: 'pop', gain_db: -10 });
      out.push({ kind: 'motion', role: 'plot-point', start: L.start, peak: L.start + peak('slam'), settle: L.start + settle('slam'), preset: 'slam' });
    });
    return out;
  },
});
