// graph — bar and line charts. Data format kept from both old systems
// ("label:value, label:value"); axis maths ported from text_to_video's
// graph_visualiser._nice_tick. Bars land on beats with slam springs and count up.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, type as typeRole } from '../tokens.js';
import { box } from '../draw.js';
import { sp, peak, settle } from '../motion.js';
import { landing } from '../kit.js';

export function parseData(str) {
  return String(str ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.lastIndexOf(':');
    return i < 0 ? null : { label: pair.slice(0, i).trim(), value: parseFloat(pair.slice(i + 1)) };
  }).filter((d) => d && Number.isFinite(d.value));
}

/** Decimal places a value is written with (capped), so labels never round data away. */
export function decimalsOf(v, cap = 4) {
  if (!Number.isFinite(v)) return 0;
  for (let d = 0; d <= cap; d++) if (Math.abs(Math.round(v * 10 ** d) - v * 10 ** d) < 1e-6) return d;
  return cap;
}

/** A value at a fixed number of decimals ("-" for minus becomes a true minus sign). */
export function fmtNum(v, decimals = 0) {
  const s = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  return s.replace(/^-/, '−');
}

export function niceTick(range, divisions = 4) {
  if (range <= 0) return 1;
  const raw = range / divisions;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function schedule(clip, p, n, beat, fps) {
  // Bar i lands on grid line i+1 after the clip starts (or every `stagger` s without a grid).
  const out = [];
  for (let i = 0; i < n; i++) {
    if (beat?.valid) out.push(landing(clip.start, 'slam', beat, fps, i * Math.max(1, Math.round(p.stagger / beat.step))));
    else { const l = landing(clip.start, 'slam', null, fps); out.push({ start: l.start + i * p.stagger, hit: l.hit + i * p.stagger }); }
  }
  return out;
}

register({
  type: 'graph',
  kind: 'component',
  label: 'Chart',
  category: 'Data',
  description: 'Bar or line chart from "label:value" pairs; bars slam in on the beat and count up.',
  duration: 5,
  schema: {
    data: { type: 'text', default: 'Mon:12, Tue:19, Wed:15, Thu:27, Fri:31', label: 'Data (label:value, …)', maxLength: 600 },
    chart: { type: 'enum', options: ['bar', 'line'], default: 'bar', label: 'Chart' },
    title: { type: 'text', default: 'Renders per day', label: 'Title', maxLength: 80 },
    unit: { type: 'text', default: '', label: 'Value suffix', maxLength: 8 },
    fill: { type: 'color', default: 'lime', label: 'Bar fill' },
    highlight_max: { type: 'bool', default: true, label: 'Highlight max in orange' },
    width: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.7, label: 'Width (frame)' },
    height: { type: 'number', min: 0.2, max: 1, step: 0.01, default: 0.6, label: 'Height (frame)' },
    stagger: { type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.5, label: 'Bar stagger s' },
  },
  clipLabel: (clip) => `chart · ${clip.props?.title ?? ''}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const data = parseData(p.data);
    if (!data.length) return;
    const u = unit(env.frame);
    const W = p.width * env.frame.w * env.xf.sx, H = p.height * env.frame.h * env.xf.sy;
    const x = env.anchor.x - W / 2, y = env.anchor.y - H / 2;
    const lab = typeRole('label', env.frame);
    const ttl = typeRole('h2', env.frame);
    const bw = border(env.frame);
    const titleH = ttl.size * 1.5;
    ctx.font = ttl.font; ctx.fillStyle = color('ink'); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillText(p.title, x, y + ttl.size * 0.8);
    env.box({ kind: 'text', role: 'h2', x, y, w: ctx.measureText(p.title).width, h: ttl.size, fg: color('ink'), size: ttl.size, text: p.title });

    const max = Math.max(...data.map((d) => d.value), 0);
    const min = Math.min(...data.map((d) => d.value), 0);
    const tick = niceTick(max - min);
    const top = Math.ceil(max / tick - 1e-9) * tick || (min < 0 ? 0 : 1);
    const bottom = Math.floor(min / tick + 1e-9) * tick;
    const span = top - bottom || 1;
    const dp = Math.max(...data.map((d) => decimalsOf(d.value)));      // labels keep the data's precision
    const tickDp = decimalsOf(tick);
    const plotX = x + lab.size * 3.2, plotY = y + titleH, plotW = W - lab.size * 3.2, plotH = H - titleH - lab.size * 2.2;
    const Y = (v) => plotY + plotH - ((v - bottom) / span) * plotH;
    ctx.font = lab.font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; bottom + k * tick <= top + 1e-9; k++) {
      const v = bottom + k * tick;
      const gy = Y(v);
      ctx.fillStyle = Math.abs(v) < 1e-9 && min < 0 ? color('ink') : color('paper-deep');
      ctx.fillRect(plotX, gy - u, plotW, Math.max(1, 2 * u));
      ctx.fillStyle = color('ink-soft');
      ctx.fillText(fmtNum(v, tickDp), plotX - lab.size * 0.6, gy);
    }
    const sched = schedule(clip, p, data.length, env.beat, env.settings.fps);
    const n = data.length;
    const slot = plotW / n, barW = slot * 0.62;
    const maxIdx = data.findIndex((d) => d.value === max);
    // Category labels shrink to fit their slot rather than run into each other.
    const widest = Math.max(...data.map((d) => ctx.measureText(d.label).width), 1);
    const labFit = Math.min(1, (slot * 0.94) / widest);
    const catFont = labFit < 1 ? lab.font.replace(`${lab.size}px`, `${Math.max(10, lab.size * labFit).toFixed(1)}px`) : lab.font;
    ctx.textAlign = 'center';
    if (p.chart === 'bar') {
      data.forEach((d, i) => {
        const e = env.t - sched[i].start;
        const g = Math.max(0, sp(e, 'slam', 'position'));
        const y0 = Y(0), y1 = Y(d.value * g);
        const h = Math.abs(y1 - y0);
        const bx = plotX + i * slot + (slot - barW) / 2;
        const by = Math.min(y0, y1);
        if (h > 0.5) {
          box(ctx, bx, by, barW, h, {
            fill: color(p.highlight_max && i === maxIdx && max > 0 ? 'orange' : p.fill),
            stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame),
          });
        }
        ctx.fillStyle = color('ink');
        ctx.textBaseline = 'alphabetic';
        ctx.font = lab.font;
        const shown = d.value * Math.min(1, g);
        const vy = d.value < 0 ? by + h + shadowTok(env.frame).y + lab.size * 1.1 : by - lab.size * 0.6;
        if (e > 0) ctx.fillText(`${fmtNum(shown, dp)}${p.unit}`, bx + barW / 2, vy);
        ctx.font = catFont;
        ctx.fillText(d.label, bx + barW / 2, plotY + plotH + lab.size * 1.5);
        if (e > 0 && e < settle('slam')) env.animating();
      });
    } else {
      const pts = data.map((d, i) => ({ x: plotX + i * slot + slot / 2, y: Y(d.value) }));
      ctx.strokeStyle = color('ink');
      ctx.lineWidth = bw * 1.2;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      let drawn = 0;
      pts.forEach((pt, i) => {
        const e = env.t - sched[i].start;
        if (e <= 0) return;
        const g = Math.min(1, Math.max(0, sp(e, 'snappy', 'position')));
        if (i === 0) { ctx.moveTo(pt.x, pt.y); drawn++; return; }
        const prev = pts[i - 1];
        ctx.lineTo(prev.x + (pt.x - prev.x) * g, prev.y + (pt.y - prev.y) * g);
        drawn++;
      });
      if (drawn) ctx.stroke();
      pts.forEach((pt, i) => {
        const e = env.t - sched[i].start;
        if (e <= 0) return;
        const s = Math.max(0, sp(e, 'slam', 'scale'));
        const r = bw * 2.4 * s;
        box(ctx, pt.x - r, pt.y - r, r * 2, r * 2, { fill: color(i === maxIdx && p.highlight_max ? 'orange' : p.fill), stroke: color('ink'), strokeW: bw * 0.8 });
        ctx.fillStyle = color('ink');
        ctx.textBaseline = 'alphabetic';
        ctx.font = lab.font;
        if (s > 0.9) ctx.fillText(`${fmtNum(data[i].value, dp)}${p.unit}`, pt.x, pt.y - r - lab.size * 0.5);
        ctx.font = catFont;
        ctx.fillText(data[i].label, pt.x, plotY + plotH + lab.size * 1.5);
      });
    }
    env.box({ kind: 'box', x, y, w: W, h: H });
  },
  events(clip, env) {
    const p = env.props;
    const data = parseData(p.data);
    const sched = schedule(clip, p, data.length, env.beat, env.fps);
    const out = [];
    sched.forEach((s, i) => {
      out.push({ kind: 'hit', t: s.hit, sound: i === data.length - 1 ? 'impact' : 'pop', gain_db: -8 });
      out.push({ kind: 'motion', role: 'bar', start: s.start, peak: s.start + peak('slam'), settle: s.start + settle('slam'), preset: 'slam' });
    });
    return out;
  },
});
