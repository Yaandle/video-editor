// graph — bar and line charts. Data format kept from both old systems
// ("label:value, label:value"); axis maths ported from text_to_video's
// graph_visualiser._nice_tick. Bars land on beats with slam springs and count up.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit, type as typeRole } from '../tokens.js';
import { box } from '../draw.js';
import { sp, arrivalFrames, peak, settle } from '../motion.js';

export function parseData(str) {
  return String(str ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.lastIndexOf(':');
    return i < 0 ? null : { label: pair.slice(0, i).trim(), value: parseFloat(pair.slice(i + 1)) };
  }).filter((d) => d && Number.isFinite(d.value));
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
  const lead = arrivalFrames(fps, 'slam') / fps;
  const out = [];
  for (let i = 0; i < n; i++) {
    let hit;
    if (beat?.valid) {
      const k0 = Math.ceil((clip.start + lead - beat.offset) / beat.step - 1e-6);
      hit = beat.offset + (k0 + i * Math.max(1, Math.round(p.stagger / beat.step))) * beat.step;
    } else {
      hit = clip.start + lead + i * p.stagger;
    }
    out.push({ hit, start: hit - lead });
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
  label: (clip) => `chart · ${clip.props?.title ?? ''}`,
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
    const tick = niceTick(max);
    const top = Math.ceil(max / tick) * tick || 1;
    const plotX = x + lab.size * 3.2, plotY = y + titleH, plotW = W - lab.size * 3.2, plotH = H - titleH - lab.size * 2.2;
    ctx.font = lab.font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= top + 1e-9; v += tick) {
      const gy = plotY + plotH - (v / top) * plotH;
      ctx.fillStyle = color('paper-deep');
      ctx.fillRect(plotX, gy - u, plotW, Math.max(1, 2 * u));
      ctx.fillStyle = color('ink-soft');
      ctx.fillText(String(Math.round(v * 100) / 100), plotX - lab.size * 0.6, gy);
    }
    const sched = schedule(clip, p, data.length, env.beat, env.settings.fps);
    const n = data.length;
    const slot = plotW / n, barW = slot * 0.62;
    const maxIdx = data.findIndex((d) => d.value === max);
    ctx.textAlign = 'center';
    if (p.chart === 'bar') {
      data.forEach((d, i) => {
        const e = env.t - sched[i].start;
        const g = Math.max(0, sp(e, 'slam', 'position'));
        const h = (d.value / top) * plotH * g;
        const bx = plotX + i * slot + (slot - barW) / 2;
        const by = plotY + plotH - h;
        if (h > 0.5) {
          box(ctx, bx, by, barW, h, {
            fill: color(p.highlight_max && i === maxIdx ? 'orange' : p.fill),
            stroke: color('ink'), strokeW: bw, shadow: shadowTok(env.frame),
          });
        }
        ctx.fillStyle = color('ink');
        ctx.textBaseline = 'alphabetic';
        if (e > 0) ctx.fillText(`${Math.round(d.value * Math.min(1, g))}${p.unit}`, bx + barW / 2, by - lab.size * 0.6);
        ctx.fillText(d.label, bx + barW / 2, plotY + plotH + lab.size * 1.5);
        if (e > 0 && e < settle('slam')) env.animating();
      });
    } else {
      const pts = data.map((d, i) => ({ x: plotX + i * slot + slot / 2, y: plotY + plotH - (d.value / top) * plotH }));
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
