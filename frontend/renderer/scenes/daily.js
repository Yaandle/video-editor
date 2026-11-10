// scene.afl-daily — one piece of a daily AFL series episode, full-bleed 9:16 game footage
// in the footy/ml neo-brutal look (paper, ink, lime, orange; hard shadows).
//
//   mode 'day'     the opening card: a DAY N stamp and the series question over the first
//                  moment's first frame, dimmed, pushing in slowly
//   mode 'moment'  one highlight: footage, DAY chip, score chip (ticks over on the scoring
//                  frame), a GOAL stamp on goals, and one caption in the GF26 caption box
//   mode 'close'   the full-time card over the last frame: result, what the AI could and
//                  couldn't do, and what's next
//
// Timing is decided in Python (studio/daily/build.py) and passed as `map`: the source frame
// for every output frame. This scene only draws, so the cut, the slow-down and the holds
// live in one place and a test can check them without a browser.

import { register } from '../registry.js';
import { color, type as typeRole, shadow } from '../tokens.js';
import { sp, clamp01 } from '../motion.js';
import { setFont, textBlock, reportBox } from '../kit.js';
import { box } from '../draw.js';

const CAP = { x: 90, y: 1250, w: 900, size: 62, pad: 30 };

function frameAt(props, lt, fps) {
  const n = Math.max(0, Math.round(lt * fps));
  if (props.mode === 'moment') {
    const map = props.map ?? [];
    return { n, f: map.length ? map[Math.min(n, map.length - 1)] : 0 };
  }
  return { n, f: props.frame ?? 0 };
}

function drawFootage(ctx, img, W, H, zoom) {
  ctx.fillStyle = color('ink');
  ctx.fillRect(0, 0, W, H);
  if (!img) return;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  // cover the frame, then punch in about the centre (the game's camera keeps the ball there)
  const s = Math.max(W / iw, H / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function chip(ctx, env, text, x, y, o) {
  const { u, size = 30, fill = 'paper', ink = 'ink', align = 'left', scale = 1, name = 'chip' } = o;
  const r = typeRole('label', env.frame, { font: 'mono-bold', size: size, weight: 700, tracking: 0.04 });
  setFont(ctx, r);
  const t = String(text).toUpperCase();
  const pad = 14 * u;
  const w = ctx.measureText(t).width + pad * 2, h = r.size + pad * 1.5;
  const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.save();
  if (scale !== 1) { ctx.translate(bx + w / 2, y + h / 2); ctx.scale(scale, scale); ctx.translate(-(bx + w / 2), -(y + h / 2)); }
  box(ctx, bx, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(2, 4 * u), shadow: { x: 6 * u, y: 6 * u, color: color('ink') } });
  ctx.fillStyle = color(ink);
  ctx.fillText(t, bx + pad, y + h / 2 + r.size * 0.36);
  ctx.restore();
  env.box({ kind: 'text', role: 'label', name, x: bx, y, w, h, fg: color(ink), bg: color(fill), size: r.size, text: t });
  return { x: bx, y, w, h };
}

/** The GF26 caption box: a 900 px slab, 6 px ink border, hard shadow, heavy Archivo. Returns its height. */
function capBox(ctx, env, text, y, o) {
  const { u, fill = 'lime', size = CAP.size, appear = 1, name = 'caption' } = o;
  const x = CAP.x * u, w = CAP.w * u, pad = CAP.pad * u;
  const r = typeRole('h2', env.frame, { font: 'body', size: size, weight: 800, leading: 1.12, tracking: -0.01 });
  setFont(ctx, r);
  // measure the wrapped height first so the slab fits the text
  const words = String(text).split(/\s+/);
  let lines = 1, line = '';
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (ctx.measureText(t).width > w - pad * 2 && line) { lines++; line = wd; } else line = t;
  }
  const h = lines * r.size * r.leading + 40 * u;
  const p = clamp01(appear);
  ctx.save();
  ctx.globalAlpha *= clamp01(p * 1.4);
  ctx.translate(0, (1 - p) * 24 * u);
  box(ctx, x, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(2, 6 * u), shadow: { x: 10 * u, y: 10 * u, color: color('ink') } });
  textBlock(ctx, env, {
    text, role: 'h2', font: 'body', sizePx: r.size, weight: 800, leading: 1.12, tracking: -0.01,
    x: x + pad, y: y + 22 * u, maxWidth: w - pad * 2, color: fill === 'ink' ? 'paper' : 'ink', bg: fill, name,
  });
  ctx.restore();
  reportBox(env, { x, y, w, h, name: `${name}-box` });
  return h;
}

function dim(ctx, W, H, a) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = color('ink');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function stamp(ctx, env, text, cy, o) {
  const { u, size, fill = 'lime', t = 1, name = 'stamp' } = o;
  const r = typeRole('display', env.frame, { font: 'display', size, weight: 400, tracking: -0.01 });
  setFont(ctx, r);
  let tw = ctx.measureText(text).width;
  const maxW = 860 * u;
  const k = tw > maxW ? maxW / tw : 1;
  const fs = r.size * k;
  ctx.font = r.font.replace(`${r.size}px`, `${fs}px`);
  tw = ctx.measureText(text).width;
  const bw = tw + 90 * u, bh = fs * 1.12;
  // slam: lands oversize and settles (closed-form spring, no clocks)
  const sc = 1 + 0.6 * (1 - sp(t, 'slam', 'scale'));
  const W = env.frame.w;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.scale(sc, sc);
  box(ctx, -bw / 2, -bh / 2, bw, bh, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(3, 8 * u), shadow: { x: 16 * u, y: 16 * u, color: color('ink') } });
  ctx.fillStyle = color('ink');
  ctx.textBaseline = 'middle';
  ctx.fillText(text, -tw / 2, fs * 0.04);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
  env.box({ kind: 'text', role: 'display', name, x: W / 2 - bw / 2, y: cy - bh / 2, w: bw, h: bh, fg: color('ink'), bg: color(fill), size: fs, text, settled: t > 0.6 });
}

const scoreText = (q, s) => `${q ? `Q${q} · ` : ''}Me ${s.me} · AI ${s.ai}`;

register({
  type: 'scene.afl-daily',
  kind: 'scene',
  label: 'AFL daily episode',
  category: 'Footage',
  description: 'One piece of a daily AFL series episode: the DAY card, a highlight with its caption, score chip and GOAL stamp, or the full-time card. Built by `python -m studio.daily build`.',
  duration: 4,
  schema: {
    mode: { type: 'enum', options: ['day', 'moment', 'close'], default: 'moment', label: 'Mode' },
    clip: { type: 'object', default: { fps: 30, frames: 1, width: 1080, height: 1920 }, label: 'Clip (fps, frames, width, height)' },
    map: { type: 'list', of: 'number', default: [], label: 'Source frame per output frame (moment)' },
    frame: { type: 'number', min: 0, max: 100000, step: 1, default: 0, label: 'Source frame (day / close)' },
    day: { type: 'number', min: 0, max: 9999, step: 1, default: 1, label: 'Day number' },
    question: { type: 'text', default: 'Can the AI beat me yet?', label: 'Series line (day card)', maxLength: 60 },
    caption: { type: 'text', default: '', label: 'Caption', maxLength: 90 },
    kind: { type: 'text', default: '', label: 'Moment type', maxLength: 20 },
    quarter: { type: 'number', min: 0, max: 9, step: 1, default: 0, label: 'Quarter' },
    score: { type: 'object', default: {}, label: 'Score {before:{me,ai}, after:{me,ai}, at_n}' },
    event_n: { type: 'number', min: -1, max: 100000, step: 1, default: -1, label: 'Output frame of the event' },
    zoom: { type: 'number', min: 1, max: 2, step: 0.01, default: 1.2, label: 'Punch-in' },
    close: { type: 'object', default: {}, label: 'Closing card {head, result, could, couldnt, next}' },
    draft: { type: 'bool', default: true, label: 'Draft stamp' },
  },
  clipLabel: (clip) => `daily · ${clip.props?.mode ?? ''} ${clip.props?.caption ?? ''}`.trim(),

  mediaFrames(clip, lt, props, fps) {
    if (!clip.src) return [];
    const { f } = frameAt(props, lt, fps);
    const cf = props.clip?.fps ?? fps;
    return [{ src: clip.src, time: f / cf, fps: cf }];
  },

  render(ctx, clip, lt, env) {
    const props = env.props, u = env.u, fps = env.settings.fps;
    const W = env.frame.w, H = env.frame.h;
    const { n, f } = frameAt(props, lt, fps);
    const cf = props.clip?.fps ?? fps;
    const img = clip.src ? env.videoFrame(clip.src, f / cf, cf) : null;
    if (!img && clip.src) env.warn(`frame ${f} not decoded`);
    const dur = clip.duration ?? 4;
    let animating = false;

    if (props.mode === 'day') {
      drawFootage(ctx, img, W, H, (props.zoom ?? 1.2) * (1 + 0.05 * clamp01(lt / dur)));
      dim(ctx, W, H, 0.45);
      animating = true;   // the push-in moves every frame
      stamp(ctx, env, `DAY ${props.day}`, 780 * u, { u, size: 230, fill: 'lime', t: lt, name: 'day-stamp' });
      capBox(ctx, env, props.question ?? '', CAP.y * u, { u, fill: 'paper', appear: sp(lt - 0.25, 'snappy', 'position'), name: 'series-line' });
    } else if (props.mode === 'close') {
      drawFootage(ctx, img, W, H, props.zoom ?? 1.2);
      dim(ctx, W, H, 0.62 * clamp01(lt / 0.4));
      const c = props.close ?? {};
      let y = 300 * u;
      const step = 0.5;
      const at = (i) => lt - i * step;
      if (c.head && at(0) > 0) { const k = chip(ctx, env, c.head, 90 * u, y, { u, size: 34, fill: 'ink', ink: 'lime', name: 'close-head' }); y += k.h + 40 * u; }
      if (c.result && at(1) > 0) y += capBox(ctx, env, c.result, y, { u, fill: 'paper', size: 70, appear: sp(at(1), 'snappy', 'position'), name: 'close-result' }) + 34 * u;
      if (c.could && at(2) > 0) y += capBox(ctx, env, c.could, y, { u, fill: 'lime', size: 58, appear: sp(at(2), 'snappy', 'position'), name: 'close-could' }) + 34 * u;
      if (c.couldnt && at(3) > 0) y += capBox(ctx, env, c.couldnt, y, { u, fill: 'orange', size: 58, appear: sp(at(3), 'snappy', 'position'), name: 'close-couldnt' }) + 40 * u;
      if (c.next && at(4) > 0) chip(ctx, env, c.next, 90 * u, y, { u, size: 34, fill: 'paper', name: 'close-next' });
      if (lt < 5 * step + 0.6) animating = true;
    } else {
      drawFootage(ctx, img, W, H, props.zoom ?? 1.2);
      reportBox(env, { x: 0, y: 0, w: W, h: H, name: 'footage', kind: 'image' });
      env.box({ kind: 'meta', role: 'source-frame', name: 'source-frame', text: String(f), x: 0, y: 0, w: 0, h: 0 });
      chip(ctx, env, `Day ${props.day}`, 60 * u, 230 * u, { u, size: 30, fill: 'ink', ink: 'lime', name: 'day-chip' });
      const sc = props.score ?? {};
      if (sc.before && sc.after) {
        const after = sc.at_n !== undefined && sc.at_n >= 0 && n >= sc.at_n;
        const s = after ? sc.after : sc.before;
        const pop = after ? 1 + 0.25 * (1 - clamp01(sp((n - sc.at_n) / fps, 'snappy', 'scale'))) : 1;
        if (after && (n - sc.at_n) / fps < 0.6) animating = true;
        chip(ctx, env, scoreText(props.quarter, s), W - 60 * u, 230 * u, { u, size: 30, fill: after && pop > 1.01 ? 'lime' : 'paper', align: 'right', scale: pop, name: 'score-chip' });
      }
      if (props.kind === 'goal' && props.event_n >= 0 && n >= props.event_n) {
        const t = (n - props.event_n) / fps;
        stamp(ctx, env, 'GOAL', 620 * u, { u, size: 170, fill: 'orange', t, name: 'goal-stamp' });
        if (t < 0.8) animating = true;
      }
      if (props.caption && n >= 3) {
        const t = (n - 3) / fps;
        capBox(ctx, env, props.caption, CAP.y * u, { u, fill: 'lime', appear: sp(t, 'snappy', 'position'), name: 'caption' });
        if (t < 0.6) animating = true;
      }
    }
    if (props.draft) chip(ctx, env, 'Draft · not approved', 60 * u, 1560 * u, { u, size: 24, fill: 'orange', name: 'draft-chip' });
    if (animating) env.animating();
  },
});
