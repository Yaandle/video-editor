// keys.js — tracks and points in video coordinates. Pure (no DOM).
//
// A track is a list of samples keyed by *source frame* in the clip's own pixel
// space: { f, x, y, w?, h?, conf? }. Hand-placed keys (or keys proposed from a
// vision pass) are sparse; a computer-vision tracker would write dense samples
// in exactly the same shape, so the renderer never needs to know which it got.
//
// interp:
//   'smooth' (default) — Catmull-Rom through every key, timed by frame, with
//                        zero velocity at the first and last key (eases in and out)
//   'ease'             — smootherstep between each pair: stops on every key
//   'linear'           — straight lines at constant speed
//   'hold'             — jumps to each key on its frame
// Before the first key and after the last, the track holds its end key.

import { clamp01, lerp } from '../motion.js';

/** Smootherstep: zero velocity and acceleration at both ends. */
export const smoother = (p) => { p = clamp01(p); return p * p * p * (p * (p * 6 - 15) + 10); };

const FIELDS = ['x', 'y', 'w', 'h'];

/** Keys sorted by frame, duplicates (same f) collapsed to the last one. */
export function normalizeKeys(keys) {
  const byF = new Map();
  for (const k of keys ?? []) {
    if (!k || !Number.isFinite(+k.f) || !Number.isFinite(+k.x) || !Number.isFinite(+k.y)) continue;
    byF.set(+k.f, { ...k, f: +k.f, x: +k.x, y: +k.y });
  }
  return [...byF.values()].sort((a, b) => a.f - b.f);
}

/** Index i with keys[i].f <= f < keys[i+1].f (binary search); -1 before the first key. */
function bracket(keys, f) {
  if (f < keys[0].f) return -1;
  let lo = 0, hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].f <= f) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Catmull-Rom (non-uniform in time) value between k1 and k2 at frame f. */
function catmull(k0, k1, k2, k3, f, field) {
  const v1 = k1[field], v2 = k2[field];
  const dt = k2.f - k1.f;
  // tangents in value-per-frame; ends get zero tangent so motion eases in/out
  const m1 = k0 ? ((v2 - k0[field]) / (k2.f - k0.f)) : 0;
  const m2 = k3 ? ((k3[field] - v1) / (k3.f - k1.f)) : 0;
  const s = (f - k1.f) / dt;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return h00 * v1 + h10 * dt * m1 + h01 * v2 + h11 * dt * m2;
}

/**
 * Track value at source frame f (fractional allowed). Returns { x, y, w?, h?, conf?, inRange }
 * or null for an empty track. inRange is false before the first / after the last key.
 */
export function sample(track, f) {
  const keys = track?._keys ?? normalizeKeys(track?.keys ?? track);
  if (!keys.length) return null;
  const interp = track?.interp ?? 'smooth';
  const first = keys[0], last = keys[keys.length - 1];
  const pick = (k, inRange) => {
    const o = { x: k.x, y: k.y, inRange };
    if (Number.isFinite(k.w)) o.w = k.w;
    if (Number.isFinite(k.h)) o.h = k.h;
    if (Number.isFinite(k.conf)) o.conf = k.conf;
    return o;
  };
  if (f <= first.f) return pick(first, f === first.f);
  if (f >= last.f) return pick(last, f === last.f);
  const i = bracket(keys, f);
  const a = keys[i], b = keys[i + 1];
  const p = (f - a.f) / (b.f - a.f);
  const o = { inRange: true };
  for (const fld of FIELDS) {
    if (!Number.isFinite(a[fld]) || !Number.isFinite(b[fld])) continue;
    if (interp === 'hold') o[fld] = a[fld];
    else if (interp === 'linear') o[fld] = lerp(a[fld], b[fld], p);
    else if (interp === 'ease') o[fld] = lerp(a[fld], b[fld], smoother(p));
    else {
      const k0 = i > 0 && Number.isFinite(keys[i - 1][fld]) ? keys[i - 1] : null;
      const k3 = i + 2 < keys.length && Number.isFinite(keys[i + 2][fld]) ? keys[i + 2] : null;
      o[fld] = catmull(k0, a, b, k3, f, fld);
    }
  }
  if (Number.isFinite(a.conf) && Number.isFinite(b.conf)) o.conf = Math.min(a.conf, b.conf);
  return o;
}

/** Pre-sort every track once (keeps sample() cheap per frame). */
export function prepareTracks(tracks) {
  const out = {};
  for (const [id, t] of Object.entries(tracks ?? {})) out[id] = { ...t, _keys: normalizeKeys(t.keys) };
  return out;
}

/**
 * A point reference → video coordinates at source frame f.
 *   { x, y }                       fixed point in video px
 *   { track: 'p1', dx?, dy? }       follows a track (offset in video px)
 * Returns { x, y, inRange } or null when the track is missing.
 */
export function resolvePoint(ref, tracks, f) {
  if (!ref) return null;
  if (ref.track) {
    const s = sample(tracks?.[ref.track], f);
    if (!s) return null;
    return { x: s.x + (ref.dx ?? 0), y: s.y + (ref.dy ?? 0), w: s.w, h: s.h, inRange: s.inRange };
  }
  if (Number.isFinite(+ref.x) && Number.isFinite(+ref.y)) return { x: +ref.x, y: +ref.y, inRange: true };
  return null;
}

/** Every point an annotation uses (for framing and bounds checks). */
export function annotationPoints(a) {
  const pts = [];
  for (const k of ['at', 'from', 'to', 'via']) if (a?.[k]) pts.push(a[k]);
  if (a?.track) pts.push({ track: a.track });
  for (const p of a?.points ?? []) pts.push(p);
  return pts;
}

/** Video-space bounding box of a moment's annotations at source frame f (with each ring's radius). */
export function annotationBounds(annotations, tracks, f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of annotations ?? []) {
    const r = a.kind === 'ring' || a.kind === 'spotlight' ? (a.r ?? 60) : a.kind === 'label' ? 120 : 20;
    for (const ref of annotationPoints(a)) {
      const p = resolvePoint(ref, tracks, f);
      if (!p) continue;
      x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r);
      y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
