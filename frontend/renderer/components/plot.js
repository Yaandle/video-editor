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
import { niceTick } from './graph.js';

/** Draw progress 0 → 1: starts on beat `draw_beat`, arrives on beat draw_beat + draw_beats. */
export function drawSchedule(clip, p, beat, fps) {
  const start = landOnBeat(clip.start, p.draw_beat, 'quick', beat, fps).hit;   // the pen starts on a grid line
  const end = Math.max(start + 0.1, landOnBeat(clip.start, p.draw_beat + p.draw_beats, 'quick', beat, fps).hit);
  const span = end - start;                                                    // …and arrives on one
  const k = arrival('soft', 'position') / span;                                // time scale so arrival = end beat
  return { start, end, at: (t) => clamp01(sp((t - start) * k, 'soft', 'position')) };
}

/** Sample f over [x0, x1] into n+1 points (NaN/∞ break the line). */
export function sample(fn, x0, x1, n = 240) {
  const f = compile(fn).f;
  const out = [];
  for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; out.push({ x, y: f(x) }); }
  return out;
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
  },
  clipLabel: (clip) => `plot · ${clip.props?.fn ?? ''}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
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
    const px0 = x + pad + lab.size * 3, px1 = x + W - pad, py0 = y + pad + titleH, py1 = y + H - pad - lab.size * 1.6;
    const X = (v) => px0 + ((v - p.x_min) / (p.x_max - p.x_min || 1)) * (px1 - px0);
    const Y = (v) => py1 - ((v - p.y_min) / (p.y_max - p.y_min || 1)) * (py1 - py0);
    // Grid + ticks.
    setFont(ctx, lab);
    const tx = niceTick(p.x_max - p.x_min, 6), ty = niceTick(p.y_max - p.y_min, 4);
    ctx.textAlign = 'center';
    for (let v = Math.ceil(p.x_min / tx) * tx; v <= p.x_max + 1e-9; v += tx) {
      ctx.fillStyle = color('paper-deep'); ctx.fillRect(X(v) - u, py0, 2 * u, py1 - py0);
      ctx.fillStyle = color('ink-soft'); ctx.fillText(String(Math.round(v * 100) / 100), X(v), py1 + lab.size * 1.25);
    }
    ctx.textAlign = 'right';
    for (let v = Math.ceil(p.y_min / ty) * ty; v <= p.y_max + 1e-9; v += ty) {
      ctx.fillStyle = color('paper-deep'); ctx.fillRect(px0, Y(v) - u, px1 - px0, 2 * u);
      ctx.fillStyle = color('ink-soft'); ctx.fillText(String(Math.round(v * 100) / 100), px0 - lab.size * 0.5, Y(v) + lab.size * 0.35);
    }
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
      const pts = sample(f, p.x_min, p.x_min + (p.x_max - p.x_min) * prog, 240);
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
          ctx.fillText(name, Math.min(X(tip.x) + r * 2, px1 - ctx.measureText(name).width), Y(tip.y) - r * 2 - ci * lab.size * 1.4);
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
      ctx.fillStyle = color('ink');
      ctx.fillRect(X(vx) - u, Y(fx(vx)), 2 * u, py1 - Y(fx(vx)));
      box(ctx, X(vx) - r, Y(fx(vx)) - r, r * 2, r * 2, { fill: color('lime'), stroke: color('ink'), strokeW: bw * 0.7 });
      if (s > 0.9) {
        setFont(ctx, lab);
        ctx.fillStyle = color('ink');
        const txt = `${Math.round(fx(vx) * 100) / 100}`;
        ctx.fillText(txt, X(vx) + r * 1.4, Y(fx(vx)) + lab.size * 0.35);
      }
    });
    ctx.restore();
    const err = compile(p.fn).error;
    if (err) env.warn(`plot f(x): ${err}`);
    env.box({ kind: 'box', x, y, w: W, h: H, settled: prog >= 1 && !ex });
    env.box({ kind: 'text', role: 'h2', x: x + pad, y: y + pad, w: Math.min(W - pad * 2, ttl.size * p.title.length * 0.5), h: ttl.size * 0.78, fg: color('ink'), bg: color(p.panel ? 'white' : env.settings.background), size: ttl.size, text: p.title, settled: !ex });
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
