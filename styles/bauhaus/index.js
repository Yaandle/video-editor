// Bauhaus shapes — circle, square, triangle, quarter circle, semicircle and
// bar in primary red, yellow and blue with black, white and a warm paper, on
// a strict 16×9 modular grid. A composition assembles beat by beat: each
// primitive springs in from off-canvas and rotates into place, overlapping
// with multiply blending (overprinted ink, not transparency). The hold keeps a
// deliberate asymmetric balance with small grid-step moves on the beat. Type
// is Jost, a geometric sans, set small and precise against large shapes.

import { register } from '#renderer/registry.js';
import { color as coreColor, unit } from '#renderer/tokens.js';
import { sp, clamp01, arrivalFrames, settle, peak, exitProgress } from '#renderer/motion.js';
import { loadFontFile } from '#renderer/assets.js';
import { layoutText, drawText, plain } from '#renderer/text.js';
import { parsePalette, nearest } from '#renderer/raster.js';
import { scheduleText } from '#renderer/components/text.js';
import tokens from './tokens.json' with { type: 'json' };

const ID = 'bauhaus';
const P = tokens.palette;
const FAM = tokens.font.family;
const DIRS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const PITCH = { circle: 0, semi: 1, square: 2, triangle: 3, quarter: 4 };

// Compositions: grid units (16 × 9); beat = landing order; spin = rotation it springs out of.
export const PRESETS = {
  construct: {
    items: [
      { k: 'circle', x: 7.5, y: 0.75, w: 7, h: 7, c: 'red', from: 'right', beat: 0 },
      { k: 'square', x: 1, y: 1.5, w: 4, h: 4, c: 'blue', from: 'top', spin: -90, beat: 1 },
      { k: 'triangle', x: 3.5, y: 2.5, w: 5, h: 4.5, c: 'yellow', from: 'bottom', beat: 2 },
      { k: 'bar', x: 1, y: 7, w: 12, h: 0.5, c: 'black', from: 'left', beat: 3 },
      { k: 'quarter', x: 13, y: 0, w: 3, h: 3, c: 'black', from: 'top', spin: 90, beat: 4, turn: true },
      { k: 'circle', x: 9, y: 6, w: 1, h: 1, c: 'black', from: 'right', beat: 5, hop: true },
    ],
    title: { x: 1, y: 8.05 }, caption: { x: 15, y: 8.05 },
  },
  balance: {
    items: [
      { k: 'semi', x: 2, y: 1, w: 8, h: 4, c: 'blue', from: 'left', beat: 0 },
      { k: 'bar', x: 2, y: 5, w: 13, h: 0.75, c: 'black', from: 'right', beat: 1 },
      { k: 'square', x: 10, y: 1.5, w: 3.5, h: 3.5, c: 'red', from: 'top', spin: 45, beat: 2 },
      { k: 'circle', x: 11.5, y: 3.25, w: 3.5, h: 3.5, c: 'yellow', from: 'bottom', beat: 3 },
      { k: 'triangle', x: 3, y: 5.75, w: 2.5, h: 2, c: 'red', from: 'bottom', beat: 4, turn: true },
      { k: 'circle', x: 7, y: 4, w: 1, h: 1, c: 'black', from: 'top', beat: 5, hop: true },
    ],
    title: { x: 2, y: 8.05 }, caption: { x: 15, y: 8.05 },
  },
};

const hexOf = (name) => P[name] ?? coreColor(name);
const PAL_NAMES = ['red', 'yellow', 'blue', 'black', 'white'];
const PAL_RGB = parsePalette(PAL_NAMES.map((n) => P[n]));
/** Any colour → the nearest Bauhaus ink (lime → yellow, orange → red, cobalt → blue…). */
function toInk(c) {
  if (P[c]) return P[c];
  const [rgb] = parsePalette([coreColor(c)]);
  return P[PAL_NAMES[nearest(PAL_RGB, ...rgb)]];
}

function gridOf(frame) {
  const m = Math.min(frame.w / tokens.grid.columns, frame.h / tokens.grid.rows);
  return { m, ox: (frame.w - tokens.grid.columns * m) / 2, oy: (frame.h - tokens.grid.rows * m) / 2 };
}

/** Path of a primitive in a w×h box centred on the origin. */
function primitive(ctx, k, w, h) {
  ctx.beginPath();
  switch (k) {
    case 'circle': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'semi': ctx.moveTo(-w / 2, h / 2); ctx.ellipse(0, h / 2, w / 2, h, 0, Math.PI, Math.PI * 2); ctx.closePath(); break;
    case 'triangle': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); break;
    case 'quarter': ctx.moveTo(-w / 2, h / 2); ctx.lineTo(-w / 2, -h / 2); ctx.arc(-w / 2, h / 2, w, -Math.PI / 2, 0); ctx.closePath(); break;
    default: ctx.rect(-w / 2, -h / 2, w, h);
  }
}

/** First grid line after the composition has assembled and settled: hold moves land from here on. */
function holdStart(clip, beat, p, pre) {
  const B = beat?.valid ? beat.beat : 0.5;
  const allIn = hitTime(clip, beat, p.land_beat + pre.items.length - 1) + settle('slam');
  return clip.start + Math.ceil((allIn - clip.start) / B - 1e-9) * B;
}

function hitTime(clip, beat, n) {
  const B = beat?.valid ? beat.beat : 0.5;
  return clip.start + n * B;
}

function drawSmallType(ctx, env, text, x, y, size, weight, color, align = 'left', o = {}) {
  const spec = { text, font: `${weight} ${size}px "${FAM}"`, size, leading: 1.15, tracking: 0.04, maxWidth: Infinity, align: 'left' };
  const lay = layoutText(ctx, spec);
  const left = align === 'right' ? x - lay.width : x;
  drawText(ctx, lay, left, y, { color, accent: color, lt: o.lt, duration: o.duration, enter: o.enter, exit: o.exit });
  env.box({ kind: 'text', role: 'label', name: o.name, x: left, y, w: lay.width, h: lay.height, fg: color, bg: hexOf('paper'), size, text: plain(text), settled: o.settled ?? true });
}

register({
  type: 'bauhaus.composition', pack: ID, kind: 'scene', category: 'Scenes',
  label: 'Bauhaus composition',
  description: 'Primary shapes assemble beat by beat on a 16×9 grid, springing in from off-canvas and rotating into place; multiply overlaps; small geometric type.',
  duration: 8,
  schema: {
    preset: { type: 'enum', options: Object.keys(PRESETS), default: 'construct', label: 'Composition' },
    title: { type: 'text', default: 'Form follows rhythm.', label: 'Title (small)', maxLength: 60 },
    caption: { type: 'text', default: 'Studie 01 — 120 BPM', label: 'Caption', maxLength: 40 },
    land_beat: { type: 'number', min: 0, max: 32, step: 1, default: 1, label: 'First shape on beat #' },
    hold_moves: { type: 'bool', default: true, label: 'Grid-step moves on the beat' },
    background: { type: 'color', default: 'paper', label: 'Ground' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props;
    const F = env.frame;
    const { m, ox, oy } = gridOf(F);
    const pre = PRESETS[p.preset];
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    const lead = arrivalFrames(env.settings.fps, 'slam') / env.settings.fps;
    ctx.fillStyle = hexOf(p.background);
    ctx.fillRect(0, 0, F.w, F.h);
    const H = holdStart(clip, env.beat, p, pre);
    const fps = env.settings.fps;
    const leadHop = arrivalFrames(fps, 'snappy') / fps, leadTurn = arrivalFrames(fps, 'slam', 'rotation') / fps;
    let settled = true;
    pre.items.forEach((it, i) => {
      const hit = hitTime(clip, env.beat, p.land_beat + it.beat);
      const e = env.t - (hit - lead);
      if (e <= 0) { settled = false; return; }
      const pr = sp(e, 'slam', 'position');
      const dir = DIRS[it.from] ?? [0, 0];
      const ex = exitProgress(lt, clip.duration, 0.45, 'quick', (pre.items.length - i) * 0.03);
      let cx = ox + (it.x + it.w / 2) * m, cy = oy + (it.y + it.h / 2) * m;
      // Beat-locked hold moves: the bead hops one module along its bar each beat; the quarter turns each bar.
      let rot = ((it.spin ?? 0) * (1 - sp(e, 'slam', 'rotation')) * Math.PI) / 180;
      // Each step's spring starts one arrival early, so the move lands exactly on a grid line.
      if (p.hold_moves && it.hop && env.t > H - leadHop) {
        const since = env.t - (H - leadHop);
        const n = Math.floor(since / B);
        const step = (k) => (k % 6 < 3 ? k % 6 : 6 - (k % 6));          // 0 1 2 3 2 1 0 …
        cx += (step(n) + (step(n + 1) - step(n)) * clamp01(sp(since - n * B, 'snappy', 'position'))) * m;
      }
      if (p.hold_moves && it.turn && env.t > H - leadTurn) {
        const since = env.t - (H - leadTurn);
        const bars = Math.floor(since / (B * 4));
        rot += ((bars * 90 + 90 * clamp01(sp(since - bars * B * 4, 'slam', 'rotation'))) * Math.PI) / 180;
      }
      cx += dir[0] * (F.w * 0.75) * (1 - pr) + dir[0] * F.w * ex;
      cy += dir[1] * (F.h * 0.9) * (1 - pr) + dir[1] * F.h * ex;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      primitive(ctx, it.k, it.w * m, it.h * m);
      ctx.fillStyle = hexOf(it.c);
      ctx.fill();
      ctx.restore();
      if (e < settle('slam') || ex > 0) settled = false;
      env.box({ kind: 'box', name: `${it.k}${i}`, x: cx - (it.w * m) / 2, y: cy - (it.h * m) / 2, w: it.w * m, h: it.h * m, gridBreak: true, settled: e > settle('slam') && !ex });
    });
    const tLand = hitTime(clip, env.beat, p.land_beat + pre.items.length);
    const tl = env.t - tLand;
    const type = { lt: tl, duration: clip.start + clip.duration - tLand, enter: { unit: 'char', from: 'rise', preset: 'snappy', stagger: 0.012 }, exit: { to: 'fade', length: 0.3 } };
    // Small and precise, but two clear levels: title 30 px, caption 18 px (at 1080).
    const steady = tl > 1 && lt < clip.duration - 0.3;
    if (tl > -0.5) {
      drawSmallType(ctx, env, p.title, ox + pre.title.x * m, oy + pre.title.y * m, 30 * env.u, 600, hexOf('black'), 'left', { ...type, name: 'title', settled: steady });
      drawSmallType(ctx, env, p.caption, ox + pre.caption.x * m, oy + pre.caption.y * m + 6 * env.u, 18 * env.u, 450, hexOf('black'), 'right', { ...type, name: 'caption', settled: steady });
    }
    env.animating();
    void settled;
  },
  events(clip, env) {
    const p = env.props;
    const pre = PRESETS[p.preset];
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    const lead = arrivalFrames(env.fps, 'slam') / env.fps;
    const out = [];
    pre.items.forEach((it) => {
      const hit = hitTime(clip, env.beat, p.land_beat + it.beat);
      out.push({ kind: 'motion', role: it.k, start: hit - lead, peak: hit - lead + peak('slam'), settle: hit - lead + settle('slam'), preset: 'slam' });
      out.push(it.k === 'bar' ? { kind: 'hit', t: hit, sound: 'bauhaus.block', gain_db: -6 } : { kind: 'hit', t: hit, sound: 'bauhaus.marimba', pitch: PITCH[it.k] ?? 0, gain_db: -4 });
    });
    if (p.hold_moves) {
      // Hops land on every beat from the hold start; the quarter's turns land on each bar.
      const H = holdStart(clip, env.beat, p, pre);
      for (let n = 0; H + n * B < clip.start + clip.duration - 0.5; n++) {
        const t = H + n * B;
        if (n % 4 === 0 && pre.items.some((i) => i.turn)) out.push({ kind: 'hit', t, sound: 'bauhaus.marimba', pitch: 5, gain_db: -9 });
        else out.push({ kind: 'hit', t, sound: 'bauhaus.block', gain_db: -16 });
      }
    }
    return out;
  },
});

// ── Re-skins: shapes become flat primaries with multiply; type becomes small Jost ─

function bauhausShape(ctx, clip, lt, env) {
  const p = env.props;
  const w = p.size * env.u * env.xf.sx, h = p.size * env.u * env.xf.sy;
  const k = { rectangle: 'square', circle: 'circle', triangle: 'triangle', polygon: 'square', star: 'quarter', line: 'bar', arrow: 'triangle' }[p.kind] ?? 'square';
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.translate(env.anchor.x, env.anchor.y);
  primitive(ctx, k, w, k === 'bar' ? Math.max(4, h * 0.1) : h);
  ctx.fillStyle = toInk(p.fill);
  ctx.fill();
  ctx.restore();
  env.box({ kind: 'box', x: env.anchor.x - w / 2, y: env.anchor.y - h / 2, w, h });
}

function bauhausText(ctx, clip, lt, env) {
  const p = env.props;
  // Small and precise: display sizes come down a step; nothing is set heavier than 600.
  const size = { hero: 88, display: 64, h1: 52, h2: 40, body: 28, label: 22, micro: 18 }[p.role] * unit(env.frame);
  const sched = scheduleText(clip, p, env.beat, env.settings.fps);
  const spec = { text: p.text, font: `${p.role === 'body' || p.role === 'micro' ? 450 : 600} ${size}px "${FAM}"`, size, leading: 1.12, tracking: 0.02,
    maxWidth: p.width * env.frame.w, align: p.align === 'center' ? 'left' : p.align };
  const lay = layoutText(ctx, spec);
  const x = p.align === 'right' ? env.anchor.x - spec.maxWidth : env.anchor.x;
  const enter = p.anim_from === 'none' ? null : { unit: p.anim_unit, from: p.anim_from === 'mask' ? 'rise' : p.anim_from, preset: p.anim_preset, stagger: sched.stagger, delay: sched.delay };
  drawText(ctx, lay, x, env.anchor.y, { color: toInk(p.color), accent: toInk(p.accent), highlight: P.yellow, highlightInk: P.black, lt, duration: clip.duration, enter, exit: p.exit_to === 'none' ? null : { to: p.exit_to } });
  env.box({ kind: 'text', role: p.role, x, y: env.anchor.y, w: lay.width, h: lay.height, fg: toInk(p.color), size, text: plain(p.text), overflow: lay.overflow });
  if (lt < 2) env.animating();
}

export default {
  id: ID,
  label: tokens.label,
  description: 'Primary shapes on a strict modular grid, assembling on springs with multiply overlaps and a deliberate asymmetric balance; small geometric type.',
  tokens,
  schema: {},
  overrides: { shape: bauhausShape, text: bauhausText },
  async load() {
    await loadFontFile(FAM, tokens.font.file, { weight: tokens.font.weight });
  },
};
