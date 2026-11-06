// prng.js — seeded, platform-independent randomness for render(t).
//
// Every random-looking value in a frame comes from an integer hash of
// (seed, element id, frame/time bucket, channel). No Math.random, no state:
// the same inputs give the same bits on every machine (only 32-bit integer
// maths via Math.imul, no Math.sin). The GLSL side (gl.js HASH_GLSL) uses the
// same mixing function so CPU and shader noise agree.

/** 32-bit avalanche mix (lowbias32 by Chris Wellons). */
export function mix32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** FNV-1a of a string → uint32 (element ids, pack names). */
export function strHash(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hash any mix of numbers/strings to uint32. Numbers are quantized to 1e-4 so float noise cannot change the bits. */
export function hashKey(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' ? (Math.round(p * 10000) | 0) >>> 0 : strHash(p);
    h = mix32((h ^ v) >>> 0);
  }
  return h;
}

/** Uniform float in [0, 1) for the key. */
export function rand(...parts) { return hashKey(...parts) / 4294967296; }
/** Uniform float in [-1, 1) for the key. */
export function srand(...parts) { return rand(...parts) * 2 - 1; }

/** Value noise in [-1, 1] along a 1D axis (smooth between integer lattice points). */
export function noise1(seed, id, x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = srand(seed, id, i), b = srand(seed, id, i + 1);
  return a + (b - a) * u;
}

/** Time bucketed "on twos" (or any n): the frame index held for n frames. */
export function heldFrame(t, fps, n = 2) {
  return Math.floor(Math.round(t * fps) / n) * n;
}
