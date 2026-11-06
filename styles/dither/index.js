// Dithering — the picture reduced to 2–4 inks by ordered dither at a fixed
// native resolution (frame ÷ `pixel`), upscaled by an integer with nearest
// sampling. The threshold matrix (Bayer 2/4/8 or a generated blue-noise map)
// is anchored to native pixels, so held frames are bit-identical and the
// pattern never crawls. Reveals and transitions animate the threshold bias
// and contrast with springs; nothing else changes the pattern.
//
// Floyd–Steinberg error diffusion is available for stills only (an image clip
// with no motion): on moving content the error field changes every frame and
// shimmers, so anything else falls back to the ordered matrix.

import { color as coreColor } from '#renderer/tokens.js';
import { sp, clamp01, settle } from '#renderer/motion.js';
import { parsePalette } from '#renderer/raster.js';
import tokens from './tokens.json' with { type: 'json' };

const ID = 'dither';
const SH = {};
const MATRIX = { 'blue-noise': 0, bayer2: 1, bayer4: 2, bayer8: 3 };

const hexOf = (name) => tokens.palette[name] ?? coreColor(name);

/** The chosen inks as RGB, sorted dark → light by the same luma the shader uses. */
export function inks(name) {
  const rgb = parsePalette((tokens.inks[name] ?? tokens.inks.mono).map(hexOf));
  return rgb.map((c) => ({ c, l: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 })).sort((a, b) => a.l - b.l);
}

/** Develop bias (1 = blank paper → 0 = picture) on a soft spring over `reveal_beats`. */
export function bias(p, lt, beat) {
  if (p.reveal === 'none') return 0;
  const B = beat?.valid ? beat.beat : 0.5;
  const k = settle('soft', 'opacity') / Math.max(0.05, p.reveal_beats * B);
  return lt <= 0 ? 1 : 1 - clamp01(sp(lt * k, 'soft', 'opacity'));
}

/** Contrast punch on every bar downbeat after the first (levels animated by a spring). */
export function punch(p, t, beat) {
  if (!p.level_punch || !beat?.valid || t < beat.offset + beat.bar) return 0;
  const since = ((t - beat.offset) % beat.bar + beat.bar) % beat.bar;
  return p.level_punch * (1 - clamp01(sp(since, 'snappy', 'opacity')));
}

/** Still image clip with no motion at all — the only case error diffusion is allowed. */
export function isStill(clip) {
  if (!clip || clip.type !== 'image') return false;
  const moves = (clip.enter && clip.enter.from !== 'none') || (clip.exit && clip.exit.to !== 'none') || (clip.keyframes?.length > 1) || clip.props?.drift;
  return !moves;
}

const diffuse = (p, env) => p.method === 'error-diffusion' && env.scope === 'clip' && isStill(env.clip);

/** Floyd–Steinberg in RGB to the nearest ink, in place, at native resolution (stills only). */
function floydSteinberg(canvas, p) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const pal = inks(p.inks).map((q) => q.c);
  const E = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) E[i * 3 + k] = Math.min(255, Math.max(0, (d[i * 4 + k] - 127.5) * p.contrast + 127.5));
  const spread = (i, e, f) => { for (let k = 0; k < 3; k++) E[i * 3 + k] += e[k] * f; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i * 4 + 3] < 128) { d[i * 4 + 3] = 0; continue; }
      const c = [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]];
      let best = pal[0], bd = Infinity;
      for (const q of pal) { const dd = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = q; } }
      const e = [c[0] - best[0], c[1] - best[1], c[2] - best[2]];
      if (x + 1 < w) spread(i + 1, e, 7 / 16);
      if (y + 1 < h) {
        if (x > 0) spread(i + w - 1, e, 3 / 16);
        spread(i + w, e, 5 / 16);
        if (x + 1 < w) spread(i + w + 1, e, 1 / 16);
      }
      d[i * 4] = best[0]; d[i * 4 + 1] = best[1]; d[i * 4 + 2] = best[2]; d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export default {
  id: ID,
  label: tokens.label,
  description: 'Ordered dither in 1-bit to four inks at a fixed native resolution. The pattern is locked to the pixel grid; reveals and bar punches animate the threshold.',
  tokens,
  schema: {
    inks: { type: 'enum', options: Object.keys(tokens.inks), default: 'tri', label: 'Inks' },
    matrix: { type: 'enum', options: ['bayer8', 'bayer4', 'bayer2', 'blue-noise'], default: 'bayer8', label: 'Threshold' },
    method: { type: 'enum', options: ['ordered', 'error-diffusion'], default: 'ordered', label: 'Method (error diffusion: stills only)' },
    pixel: { type: 'enum', options: ['2', '3', '4', '6'], default: '3', label: 'Dither pixel (px at 1080)' },
    contrast: { type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1.15, label: 'Contrast' },
    reveal: { type: 'enum', options: ['develop', 'none'], default: 'develop', label: 'Reveal' },
    reveal_beats: { type: 'number', min: 0.5, max: 8, step: 0.5, default: 2, label: 'Develop length (beats)' },
    level_punch: { type: 'number', min: 0, max: 1.5, step: 0.05, default: 0, label: 'Contrast punch each bar' },
    ground: { type: 'enum', options: ['auto', 'opaque', 'clear'], default: 'auto', label: 'Ground' },
  },
  treatment: {
    native(p, frame) {
      const k = Number(p.pixel);
      return { w: Math.round(frame.w / k), h: Math.round(frame.h / k) };
    },
    animating(p, env) {
      return bias(p, env.lt, env.beat) > 1e-3 || punch(p, env.t, env.beat) > 1e-3;
    },
    cpu(canvas, p, env) {
      if (diffuse(p, env)) floydSteinberg(canvas, p);
    },
    passes(p, env) {
      if (diffuse(p, env)) return [];
      const pal = inks(p.inks);
      const flat = new Array(12).fill(0);
      pal.forEach((q, i) => { flat.splice(i * 3, 3, ...q.c.map((v) => v / 255)); });
      const ground = p.ground === 'opaque' || (p.ground === 'auto' && env.scope === 'frame') ? 1 : 0;
      return [{
        frag: SH.dither, filter: 'nearest',
        uniforms: { u_matrix: MATRIX[p.matrix], u_pal: flat, u_n: pal.length, u_bias: bias(p, env.lt, env.beat),
          u_contrast: p.contrast * (1 + punch(p, env.t, env.beat)), u_ground: ground },
        textures: { u_noise: { src: SH.noise, filter: 'nearest', static: true } },
      }];
    },
  },
  async load(api) {
    SH.dither = await api.shader('dither.glsl');
    SH.noise = await api.image('assets/bluenoise64.png');
  },
};
