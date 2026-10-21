// raster.js — layers, the low-res raster pipeline and palette quantization.
//
// A layer is an offscreen canvas the size of the output (in device pixels) or
// a fixed small size (pixel art 320×180, ASCII cell buffers…). Low-res layers
// are drawn with the frame transform scaled down, quantized to a palette on
// the CPU (a 320×180 buffer is 57 600 pixels), then upscaled by an *integer*
// factor with nearest-neighbour sampling so every source pixel becomes an
// exact k×k block — no smoothing, no half pixels.

const POOL = new Map();   // "w×h#slot" -> canvas

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** A cleared canvas from the pool. `slot` keeps nested layers apart. */
export function layer(w, h, slot = 0) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const key = `${w}x${h}#${slot}`;
  let c = POOL.get(key);
  if (!c) { c = makeCanvas(w, h); POOL.set(key, c); }
  const ctx = c.getContext('2d', { willReadFrequently: slot >= 100 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);
  return { canvas: c, ctx, w, h };
}

/**
 * Low-res size for a frame: the native buffer whose integer upscale fills the
 * output. `target` is the requested native height (e.g. 180); the scale is the
 * largest integer k with outH / k >= target… so 1080 → 180 (k=6), 720 → 180 (k=4).
 */
export function lowresSize(outW, outH, targetShort = 180) {
  const short = Math.min(outW, outH);
  const k = Math.max(1, Math.floor(short / targetShort));
  return { w: Math.ceil(outW / k), h: Math.ceil(outH / k), k };
}

/** Parse '#rrggbb' list → [[r,g,b], …]. */
export function parsePalette(hexes) {
  return hexes.map((h) => {
    const s = h.replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  });
}

/** Nearest palette entry by weighted RGB distance (redmean — cheap, perceptually decent). */
export function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const rm = (r + p[0]) / 2;
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Snap every pixel of `canvas` to `palette` in place. Alpha is thresholded
 * (pixel art has no partial coverage): below `alpha` → transparent, else the
 * colour is un-premultiplied over `under` (the colour it will sit on) first.
 */
export function quantize(canvas, palette, o = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const pal = parsePalette(palette);
  const thr = Math.round((o.alpha ?? 0.5) * 255);
  const under = o.under ? parsePalette([o.under])[0] : null;
  const cache = new Map();
  // Optional ordered dither (Bayer 4×4, anchored to buffer pixels): nudges each pixel by
  // ±spread before the nearest-colour lookup, so photos keep tone in a small palette.
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const spread = o.dither ?? 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < thr) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (under && a < 255) {
      const k = a / 255;
      r = r * k + under[0] * (1 - k); g = g * k + under[1] * (1 - k); b = b * k + under[2] * (1 - k);
    }
    if (spread) {
      const px = (i >> 2) % w, py = ((i >> 2) / w) | 0;
      const n = ((B4[(py & 3) * 4 + (px & 3)] + 0.5) / 16 - 0.5) * spread;
      r = Math.max(0, Math.min(255, r + n)); g = Math.max(0, Math.min(255, g + n)); b = Math.max(0, Math.min(255, b + n));
    }
    const key = ((r & 0xf8) << 16) | ((g & 0xf8) << 8) | (b & 0xf8);
    let idx = cache.get(key);
    if (idx === undefined) { idx = nearest(pal, r, g, b); cache.set(key, idx); }
    if (o.swap) idx = o.swap[idx] ?? idx;
    const p = pal[idx];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Draw a small canvas into ctx at (x, y) scaled by integer k with nearest-neighbour sampling. */
export function upscale(ctx, small, x, y, k, w = small.width, h = small.height) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, w, h, Math.round(x), Math.round(y), w * k, h * k);
  ctx.restore();
}

/** Device-pixel scale of a context's current transform (editor preview is dpr × zoom). */
export function deviceScale(ctx) {
  const m = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0 };
  return Math.hypot(m.a, m.b) || 1;
}
