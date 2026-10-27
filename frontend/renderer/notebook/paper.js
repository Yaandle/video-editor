// notebook/paper.js — the maths notebook look: squared paper, a margin rule,
// a simple sans (Jost) for words and a maths serif for equations, and pen
// strokes that draw on along their length. Pure: every helper is a function of
// its arguments.
//
// Scale is honest: a figure's view (makeView) puts its origin on a grid line
// and gives one unit a whole, "nice" number of squares (or one square a nice
// number of units), so the paper grid is the figure's own grid.

import { family } from '../tokens.js';

export const NB = {
  paper: '#FAF8F2',
  grid: '#DCE3EA',
  margin: '#E7A3A3',
  ink: '#1F2328',
  soft: '#59626C',
  faint: '#98A1AB',
  white: '#FFFFFF',
};

/** Grid square at a 1080-px short side. */
export const STEP = 40;

export const MATH_FACE = '"Cambria Math", Cambria, Georgia, serif';
export const textFace = () => `"${family('notebook')}", "Segoe UI", sans-serif`;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Sub-progress of k over [a, b]. */
export const seg = (k, a, b) => clamp01((k - a) / Math.max(1e-9, b - a));
/** Smooth 0 → 1 (cubic Hermite) for pen speed: starts and lands softly. */
export const smooth = (k) => { const x = clamp01(k); return x * x * (3 - 2 * x); };

/** Alpha of `hex` as an rgba() string. */
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${a})`;
}

/** Squared paper with an optional margin rule; grid lines sit on multiples of the step from the frame origin. */
export function drawPaper(ctx, frame, u, o = {}) {
  const step = STEP * u;
  ctx.fillStyle = o.paper ?? NB.paper;
  ctx.fillRect(0, 0, frame.w, frame.h);
  ctx.fillStyle = o.grid ?? NB.grid;
  const lw = Math.max(1, Math.round(1.2 * u));
  for (let x = step; x < frame.w; x += step) ctx.fillRect(Math.round(x) - (lw >> 1), 0, lw, frame.h);
  for (let y = step; y < frame.h; y += step) ctx.fillRect(0, Math.round(y) - (lw >> 1), frame.w, lw);
  if (o.margin !== false) {
    ctx.fillStyle = o.marginColor ?? NB.margin;
    ctx.fillRect(Math.round(3.3 * step), 0, Math.max(1, Math.round(2 * u)), frame.h);
  }
  return step;
}

export function font(size, weight = 400, o = {}) {
  return `${o.italic ? 'italic ' : ''}${weight} ${size}px ${o.math ? MATH_FACE : textFace()}`;
}

/** Text at a baseline. o: { size, weight, color, align, italic, math, tracking (em), alpha }. Returns its width. */
export function text(ctx, str, x, y, o = {}) {
  const s = String(str ?? '');
  if (!s) return 0;
  ctx.save();
  ctx.font = font(o.size ?? 28, o.weight ?? 400, o);
  ctx.fillStyle = o.color ?? NB.ink;
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((o.tracking ?? 0) * (o.size ?? 28)).toFixed(2)}px`;
  const w = ctx.measureText(s).width;
  const ax = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillText(s, ax, y);
  ctx.restore();
  return w;
}

export function measureText(ctx, str, o = {}) {
  ctx.save();
  ctx.font = font(o.size ?? 28, o.weight ?? 400, o);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((o.tracking ?? 0) * (o.size ?? 28)).toFixed(2)}px`;
  const w = ctx.measureText(String(str ?? '')).width;
  ctx.restore();
  return w;
}

// ── Pen strokes ───────────────────────────────────────────────────────────────

/** Cumulative lengths of a polyline (NaN points break it into runs). */
function lengths(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ok = Number.isFinite(a[1]) && Number.isFinite(b[1]) && Number.isFinite(a[0]) && Number.isFinite(b[0]);
    L.push(L[i - 1] + (ok ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0));
  }
  return L;
}

/** Stroke the first k (0..1) of a polyline's length. Returns the pen tip [x, y] or null. */
export function stroke(ctx, pts, k, o = {}) {
  if (k <= 0 || pts.length < 2) return null;
  const L = lengths(pts);
  const total = L.at(-1);
  if (total <= 0) return null;
  const upTo = total * clamp01(k);
  ctx.save();
  ctx.strokeStyle = o.color ?? NB.ink;
  ctx.lineWidth = o.width ?? 3;
  ctx.lineCap = o.cap ?? 'round';
  ctx.lineJoin = 'round';
  if (o.dash) ctx.setLineDash(o.dash);
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.beginPath();
  let pen = false, tip = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; continue; }
    if (L[i] > upTo) {
      const a = pts[i - 1];
      if (pen && a) {
        const f = (upTo - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
        tip = [a[0] + (p[0] - a[0]) * f, a[1] + (p[1] - a[1]) * f];
        ctx.lineTo(tip[0], tip[1]);
      }
      break;
    }
    if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    pen = true;
    tip = p;
  }
  ctx.stroke();
  if (o.fill && k >= 1) { ctx.fillStyle = o.fill; ctx.fill(); }
  ctx.restore();
  return tip;
}

/** A pen arrow from (x0, y0) to (x1, y1), drawn on by k; the head appears as the shaft lands. */
export function arrow(ctx, x0, y0, x1, y1, k, o = {}) {
  const tip = stroke(ctx, [[x0, y0], [x1, y1]], k, o);
  if (!tip || k < 0.92) return tip;
  const a = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const hs = Math.min(o.head ?? (o.width ?? 3) * 4.2, len * 0.45);
  stroke(ctx, [[x1 - hs * Math.cos(a - 0.42), y1 - hs * Math.sin(a - 0.42)], [x1, y1], [x1 - hs * Math.cos(a + 0.42), y1 - hs * Math.sin(a + 0.42)]], 1, o);
  return tip;
}

export function circlePts(cx, cy, rx, ry = rx, a0 = 0, a1 = Math.PI * 2, n = 120) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + rx * Math.cos(a), cy - ry * Math.sin(a)]); }
  return out;
}

export function dot(ctx, x, y, r, color, k = 1) {
  if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * Math.min(1, k * 1.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Highlighter swash behind a span (grows left to right with k). */
export function highlight(ctx, x, y, w, h, color, k) {
  if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = alpha(color, 0.2);
  const ww = w * smooth(k);
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.12);
  ctx.lineTo(x + ww, y);
  ctx.lineTo(x + ww, y + h * 0.9);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Views: data coordinates on the paper grid ─────────────────────────────────

const NICE = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 8, 10, 16, 20, 40];

/** Largest px-per-unit that is a nice multiple (or fraction) of the grid step and fits `room` px for `range` units. */
export function snapScale(range, room, step) {
  let best = step * NICE[0];
  for (const m of NICE) if (range * step * m <= room + 1e-6) best = step * m;
  return best;
}

/**
 * Map data coordinates into rect {x, y, w, h} (frame px) with the origin on a grid line.
 * view: { x: [a, b], y: [c, d], equal: bool }. Returns { X, Y, sx, sy, xr, yr, rect }.
 */
export function makeView(rect, view, step) {
  const [xa, xb] = view.x, [ya, yb] = view.y;
  let sx = snapScale(xb - xa, rect.w, step), sy = snapScale(yb - ya, rect.h, step);
  if (view.equal) sx = sy = Math.min(sx, sy);
  // Centre the view in the rect, then nudge so data 0 (or the nearest whole unit) lands on a grid line.
  const ox = rect.x + (rect.w - (xb - xa) * sx) / 2 - xa * sx;    // screen x of data x = 0
  const oy = rect.y + (rect.h - (yb - ya) * sy) / 2 + yb * sy;    // screen y of data y = 0
  const X0 = Math.round(ox / step) * step, Y0 = Math.round(oy / step) * step;
  const X = (v) => X0 + v * sx;
  const Y = (v) => Y0 - v * sy;
  return { X, Y, sx, sy, X0, Y0, rect, xr: [xa, xb], yr: [ya, yb], step };
}

/** Sample f(x) over [a, b]; breaks at poles (a jump across the view whose midpoint is not between its ends). */
export function curvePts(V, f, a, b, n = 400) {
  const out = [];
  const [lo, hi] = V.yr;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = f(x);
    if (prev && Number.isFinite(prev[1]) && Number.isFinite(y) && ((prev[1] > hi && y < lo) || (prev[1] < lo && y > hi))) {
      const m = f((prev[0] + x) / 2);
      if (!(m >= Math.min(prev[1], y) && m <= Math.max(prev[1], y))) out.push([NaN, NaN]);
    }
    prev = [x, y];
    out.push(prev);
  }
  // Clip to a margin around the view so off-page values never draw.
  const pad = (hi - lo) * 0.6;
  return out.map(([x, y]) => (Number.isFinite(y) && y >= lo - pad && y <= hi + pad ? [V.X(x), V.Y(y)] : [NaN, NaN]));
}

/** Format a number for a tick label: true minus, no float noise. */
export function num(v, dp = null) {
  const d = dp ?? (Math.abs(v - Math.round(v)) < 1e-9 ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2);
  const s = (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
  return s.replace(/^-/, '−');
}

/**
 * Axes with arrowheads, tick marks and labels, drawn on by k.
 * o: { ticksX: [v | [v, label]], ticksY, xName, yName, color, u, size }
 */
export function axes(ctx, V, k, o = {}) {
  const u = o.u ?? 1, c = o.color ?? NB.ink, w = Math.max(1.5, 2.2 * u);
  const [xa, xb] = V.xr, [ya, yb] = V.yr;
  const yAt = Math.min(Math.max(0, ya), yb), xAt = Math.min(Math.max(0, xa), xb);
  const ext = 0.35 * V.step;
  if (o.x !== false) arrow(ctx, V.X(xa) - ext * 0.3, V.Y(yAt), V.X(xb) + ext, V.Y(yAt), seg(k, 0, 0.55), { color: c, width: w, head: 13 * u });
  if (o.y !== false) arrow(ctx, V.X(xAt), V.Y(ya) + ext * 0.3, V.X(xAt), V.Y(yb) - ext, seg(k, 0.15, 0.7), { color: c, width: w, head: 13 * u });
  const kt = seg(k, 0.55, 1);
  if (kt <= 0) return;
  const size = o.size ?? 22 * u;
  const tick = 7 * u;
  ctx.save();
  ctx.globalAlpha *= kt;
  ctx.fillStyle = c;
  for (const t of o.ticksX ?? []) {
    const [v, lab] = Array.isArray(t) ? t : [t, num(t)];
    if (Math.abs(v) < 1e-12 && o.ticksY?.length) continue;
    ctx.fillRect(V.X(v) - w / 2, V.Y(yAt) - tick, w, tick * 2);
    text(ctx, lab, V.X(v), V.Y(yAt) + size * 1.25, { size, color: NB.soft, align: 'center', math: o.mathTicks });
  }
  for (const t of o.ticksY ?? []) {
    const [v, lab] = Array.isArray(t) ? t : [t, num(t)];
    if (Math.abs(v) < 1e-12 && o.ticksX?.length) continue;
    ctx.fillRect(V.X(xAt) - tick, V.Y(v) - w / 2, tick * 2, w);
    text(ctx, lab, V.X(xAt) - size * 0.55, V.Y(v) + size * 0.35, { size, color: NB.soft, align: 'right', math: o.mathTicks });
  }
  if (o.origin !== false && (o.ticksX?.length || o.ticksY?.length) && xa <= 0 && ya <= 0) text(ctx, '0', V.X(0) - size * 0.5, V.Y(0) + size * 1.15, { size, color: NB.soft, align: 'right' });
  if (o.xName) text(ctx, o.xName, V.X(xb) + ext, V.Y(yAt) + size * 1.3, { size: size * 1.15, color: c, align: 'right', math: true, italic: true });
  if (o.yName) text(ctx, o.yName, V.X(xAt) + size * 0.5, V.Y(yb) - ext * 0.2, { size: size * 1.15, color: c, math: true, italic: true });
  ctx.restore();
}

/** Ticks every `d` units over [a, b] (whole multiples of d only). */
export function ticks(a, b, d) {
  const out = [];
  for (let i = Math.ceil(a / d - 1e-9); i * d <= b + 1e-9; i++) out.push(Math.round(i * d * 1e9) / 1e9);
  return out;
}
