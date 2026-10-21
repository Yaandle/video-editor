// glyphs.js — the per-glyph text engine every style pack builds on.
//
//   fontString({ family, size, weight, width, italic })   variable axes → a ctx.font string
//   measureRun(ctx, text, font, tracking)                  per-glyph advances (memoized)
//   fitSize(ctx, text, face, boxW, boxH)                   largest size that fills the box
//   pathFor(kind, rect, o) / pointAt(path, s)              text on a path (arc, wave, circle, spiral, line)
//   drawGlyphRun(ctx, run, x, y, each)                     one transform per glyph
//
// Weight is continuous (ctx.font accepts any number 1–1000 for variable
// fonts). Width is continuous through assets.widthFamily(), which picks the
// FontFace registered at that wdth (see assets.loadWidthInstances). Layout is
// measured once per input and cached; drawing is a pure function of t.

import { widthFamily } from './assets.js';

const RUNS = new Map();
const MAX_RUNS = 2000;

/** ctx.font for a face: family, size px, weight 1–1000, width % (needs width instances), italic. */
export function fontString({ family, size, weight = 400, width = 100, italic = false }) {
  const fam = width === 100 ? family : widthFamily(family, width);
  return `${italic ? 'italic ' : ''}${Math.round(Math.max(1, Math.min(1000, weight)))} ${size.toFixed(2)}px "${fam}"`;
}

/** Glyph advances for `text` in `font` with `tracking` (em): { glyphs:[{ch, x, w}], width }. */
export function measureRun(ctx, text, font, tracking = 0) {
  const key = `${font}|${tracking}|${text}`;
  const hit = RUNS.get(key);
  if (hit) return hit;
  ctx.save();
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const size = parseFloat(font.match(/([\d.]+)px/)?.[1] ?? '16');
  const track = tracking * size;
  const glyphs = [];
  const chars = [...text];
  // Advance = prefix width including this glyph minus the prefix before it, so
  // kerning pairs are folded into the advances and the run sets like a string.
  let prev = 0, cx = 0;
  for (let i = 0; i < chars.length; i++) {
    const after = ctx.measureText(chars.slice(0, i + 1).join('')).width;
    const w = after - prev;
    prev = after;
    glyphs.push({ ch: chars[i], x: cx, w, i });
    cx += w + track;
  }
  const m = ctx.measureText('H');
  const run = { glyphs, width: Math.max(0, cx - track), cap: m.actualBoundingBoxAscent || size * 0.72, size };
  ctx.restore();
  if (RUNS.size > MAX_RUNS) RUNS.clear();
  RUNS.set(key, run);
  return run;
}

/**
 * Largest font size at which `text` (single line) fits `boxW` wide and `boxH`
 * cap-high. face: { family, weight, width, italic, tracking }. Measured at a
 * reference size and scaled (advances are linear in size).
 */
export function fitSize(ctx, text, face, boxW, boxH = Infinity) {
  const ref = 100;
  const run = measureRun(ctx, text, fontString({ ...face, size: ref }), face.tracking ?? 0);
  if (!run.width) return ref;
  const byW = (boxW / run.width) * ref;
  const byH = (boxH / run.cap) * ref;
  return Math.max(1, Math.min(byW, byH));
}

// ── Text on a path ────────────────────────────────────────────────────────────

/**
 * A sampled path inside rect {x, y, w, h}: 'line' | 'arc' | 'wave' | 'circle' | 'spiral'.
 * o.bend (arc sagitta as a share of h), o.waves (wave count), o.turns (spiral).
 * Returns { pts: [{x, y, s}], length } — s is arc length along the path.
 */
export function pathFor(kind, rect, o = {}) {
  const N = 240;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let x, y;
    switch (kind) {
      case 'arc': {
        const bend = o.bend ?? 0.5;
        x = rect.x + rect.w * u;
        y = rect.y + rect.h * (1 - bend * 4 * u * (1 - u));
        break;
      }
      case 'wave': {
        const waves = o.waves ?? 1.5;
        x = rect.x + rect.w * u;
        y = rect.y + rect.h / 2 - Math.sin(u * Math.PI * 2 * waves) * rect.h * 0.4;
        break;
      }
      case 'circle': {
        const a = -Math.PI / 2 + u * Math.PI * 2 * (o.sweep ?? 1);
        x = rect.x + rect.w / 2 + Math.cos(a) * rect.w / 2;
        y = rect.y + rect.h / 2 + Math.sin(a) * rect.h / 2;
        break;
      }
      case 'spiral': {
        const turns = o.turns ?? 1.6;
        const a = u * Math.PI * 2 * turns;
        const r = 0.15 + 0.85 * u;
        x = rect.x + rect.w / 2 + Math.cos(a) * r * rect.w / 2;
        y = rect.y + rect.h / 2 + Math.sin(a) * r * rect.h / 2;
        break;
      }
      default:
        x = rect.x + rect.w * u;
        y = rect.y + rect.h;
    }
    pts.push({ x, y, s: 0 });
  }
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    pts[i].s = s;
  }
  return { pts, length: s };
}

/** Point and tangent angle at arc length s along a path (clamped, extrapolated linearly past the ends). */
export function pointAt(path, s) {
  const p = path.pts;
  if (s <= 0) {
    const a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    return { x: p[0].x + Math.cos(a) * s, y: p[0].y + Math.sin(a) * s, angle: a };
  }
  if (s >= path.length) {
    const n = p.length - 1;
    const a = Math.atan2(p[n].y - p[n - 1].y, p[n].x - p[n - 1].x);
    const over = s - path.length;
    return { x: p[n].x + Math.cos(a) * over, y: p[n].y + Math.sin(a) * over, angle: a };
  }
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].s < s) lo = mid; else hi = mid; }
  const a = p[lo], b = p[hi];
  const u = (s - a.s) / Math.max(1e-9, b.s - a.s);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * Draw a measured run with one transform per glyph. `each(g, i)` returns
 * { dx, dy, rot, scale, sx, sy, alpha, fill, font } or null to skip the glyph;
 * glyphs pivot on their baseline centre.
 */
export function drawGlyphRun(ctx, run, x, y, font, each, defaults = {}) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  for (const g of run.glyphs) {
    const tf = each ? each(g, g.i) : {};
    if (!tf) continue;
    const cx = x + g.x + g.w / 2;
    ctx.save();
    ctx.globalAlpha *= tf.alpha ?? 1;
    ctx.translate(cx + (tf.dx ?? 0), y + (tf.dy ?? 0));
    if (tf.rot) ctx.rotate(tf.rot);
    const s = tf.scale ?? 1;
    if (s !== 1 || tf.sx || tf.sy) ctx.scale(s * (tf.sx ?? 1), s * (tf.sy ?? 1));
    ctx.font = tf.font ?? font;
    ctx.fillStyle = tf.fill ?? defaults.fill ?? '#121212';
    if (tf.stroke) { ctx.lineWidth = tf.stroke.width; ctx.strokeStyle = tf.stroke.color; ctx.lineJoin = 'round'; ctx.strokeText(g.ch, -g.w / 2, 0); }
    ctx.fillText(g.ch, -g.w / 2, 0);
    ctx.restore();
  }
  ctx.restore();
}
