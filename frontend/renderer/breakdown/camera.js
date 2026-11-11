// camera.js — which part of the footage the panel shows. Pure (no DOM).
//
// A window is { cx, cy, w } in video px; its height is w / aspect, where aspect
// is the footage panel's (w / h). The *base* window is the largest one that fits
// inside the video (crop to fill the panel); the *contain* window is the
// smallest one that holds the whole video (letterbox). Freezes fit the window
// to the annotations so the marked area is always on screen.

import { clamp, lerp } from '../motion.js';
import { smoother } from './keys.js';

export function baseWindow(src, aspect) {
  const sa = src.w / src.h;
  const w = aspect >= sa ? src.w : src.h * aspect;
  return { cx: src.w / 2, cy: src.h / 2, w };
}

export function containWindow(src, aspect) {
  const sa = src.w / src.h;
  const w = aspect >= sa ? src.h * aspect : src.w;
  return { cx: src.w / 2, cy: src.h / 2, w };
}

/** Keep the window on the video; a dimension larger than the video is centred (letterbox). */
export function clampWindow(win, src, aspect) {
  const h = win.w / aspect;
  const cx = win.w >= src.w ? src.w / 2 : clamp(win.cx, win.w / 2, src.w - win.w / 2);
  const cy = h >= src.h ? src.h / 2 : clamp(win.cy, h / 2, src.h - h / 2);
  return { cx, cy, w: win.w };
}

/** Base-size window (× zoom) centred on a focus point, clamped to the video. */
export function followWindow(focus, src, aspect, zoom = 1) {
  const b = baseWindow(src, aspect);
  return clampWindow({ cx: focus?.x ?? b.cx, cy: focus?.y ?? b.cy, w: b.w / Math.max(0.05, zoom) }, src, aspect);
}

/**
 * Smallest window that holds `box` (video px) plus a margin, never tighter than
 * base / maxZoom and never wider than the contain window.
 */
export function fitWindow(box, src, aspect, { margin = 0.18, maxZoom = 1.6, minZoom = 1 } = {}) {
  const b = baseWindow(src, aspect), c = containWindow(src, aspect);
  if (!box) return clampWindow({ ...b, w: b.w / minZoom }, src, aspect);
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0);
  const need = Math.max(bw * (1 + 2 * margin), bh * (1 + 2 * margin) * aspect);
  const w = clamp(need, b.w / maxZoom, Math.max(c.w, b.w / minZoom));
  return clampWindow({ cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, w }, src, aspect);
}

/** Blend two windows (position linear, size in log space), p already eased or not. */
export function blendWindow(a, b, p) {
  return { cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p), w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), p)) };
}

/** Eased progress of a move that runs from frame n0 for `len` frames. */
export function moveProgress(n, n0, len) {
  if (len <= 0) return n >= n0 ? 1 : 0;
  return smoother((n - n0) / len);
}

/**
 * Mapping from video px to panel px for a window shown in `rect` ({x, y, w, h}).
 * Returns { s, toPanel(x, y), src: {x, y, w, h} } where src is the video region drawn.
 */
export function mapping(win, rect) {
  const s = rect.w / win.w;
  const vx = win.cx - win.w / 2, vy = win.cy - (rect.h / s) / 2;
  return {
    s,
    view: { x: vx, y: vy, w: win.w, h: rect.h / s },
    toPanel: (x, y) => ({ x: rect.x + (x - vx) * s, y: rect.y + (y - vy) * s }),
  };
}
