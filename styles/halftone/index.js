// Halftone dots — a dot-screen print look for any content: photos, video,
// type (halftone-filled glyphs) and shapes. One ink at any screen angle, or
// four-colour process (C 15°, M 75°, Y 0°, K 45°) with a few pixels of plate
// misregistration. Dots grow from zero on a spring, swept across the frame
// band by band, then hold perfectly still: the screen is anchored in screen
// space and every dot samples its cell centre once.

import { color as coreColor } from '#renderer/tokens.js';
import { sp, clamp, settle } from '#renderer/motion.js';
import tokens from './tokens.json' with { type: 'json' };

const ID = 'halftone';
const BANDS = 32;
const SH = {};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const ink = (name) => hex(tokens.palette[name] ?? coreColor(name));

/**
 * Spring-driven growth per vertical band. 'grow' — every dot at once; 'sweep' —
 * a front crosses the frame over `reveal_beats`, each band on its own slam
 * spring (a little overshoot, so dots swell past size and settle).
 */
export function bands(params, lt, beat) {
  const out = new Array(BANDS).fill(1);
  if (params.reveal === 'none') return out;
  const B = beat?.valid ? beat.beat : 0.5;
  const span = params.reveal === 'sweep' ? params.reveal_beats * B : 0;
  for (let i = 0; i < BANDS; i++) {
    const e = lt - (i / (BANDS - 1)) * span;
    out[i] = e > 0 ? clamp(sp(e, 'slam', 'scale'), 0, 1.25) : 0;
  }
  return out;
}

/** Plate jolt: on every bar downbeat the plates spring a few px out of register and back. */
export function jolt(params, t, beat) {
  if (!params.jolt || !beat?.valid) return 0;
  const since = ((t - beat.offset) % beat.bar + beat.bar) % beat.bar;
  const bar = Math.floor((t - beat.offset) / beat.bar + 1e-9);
  if (bar < 1) return 0;
  return params.jolt * (1 - clamp(sp(since, 'wobble', 'position'), -0.5, 1.5));
}

const revealEnd = (p, beat) => (p.reveal === 'sweep' ? p.reveal_beats * (beat?.valid ? beat.beat : 0.5) : 0) + settle('slam', 'scale');

export default {
  id: ID,
  label: tokens.label,
  description: 'Print dot screens: one ink at any angle or four-colour process with plate misregistration. Dots grow in on a spring sweep, then hold dead still.',
  tokens,
  schema: {
    mode: { type: 'enum', options: ['cmyk', 'single'], default: 'cmyk', label: 'Screen' },
    ink: { type: 'color', default: 'ink', label: 'Ink (single)' },
    cell: { type: 'number', min: 4, max: 48, step: 0.5, default: 11, label: 'Cell px (at 1080)' },
    angle: { type: 'number', min: 0, max: 90, step: 1, default: 45, label: 'Screen angle ° (single)' },
    gamma: { type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1, label: 'Dot gain' },
    max_cover: { type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.82, label: 'Max dot coverage' },
    misregister: { type: 'number', min: 0, max: 8, step: 0.25, default: 1.5, label: 'Misregistration px' },
    reveal: { type: 'enum', options: ['sweep', 'grow', 'none'], default: 'sweep', label: 'Reveal' },
    reveal_beats: { type: 'number', min: 0.5, max: 8, step: 0.5, default: 1.5, label: 'Sweep length (beats)' },
    jolt: { type: 'number', min: 0, max: 16, step: 0.5, default: 0, label: 'Press jolt px (each bar, CMYK)' },
    ground: { type: 'enum', options: ['auto', 'paper', 'clear'], default: 'auto', label: 'Ground' },
  },
  treatment: {
    animating(p, env) {
      if (p.reveal !== 'none' && env.lt < revealEnd(p, env.beat)) return true;
      return p.mode === 'cmyk' && Math.abs(jolt(p, env.t, env.beat)) > 0.02;
    },
    passes(p, env) {
      const ground = p.ground === 'paper' || (p.ground === 'auto' && env.scope === 'frame') ? 1 : 0;
      const common = { u_cell: p.cell, u_gamma: p.gamma, u_ground: ground, u_paper: ink('paper'), u_band: bands(p, env.lt, env.beat), u_max: p.max_cover };
      if (p.mode === 'single') {
        return [{ frag: SH.single, uniforms: { ...common, u_angle: (p.angle * Math.PI) / 180, u_ink: hex(coreColor(p.ink)) } }];
      }
      return [{ frag: SH.cmyk, uniforms: { ...common, u_mis: p.misregister + jolt(p, env.t, env.beat), u_c: ink('cyan'), u_m: ink('magenta'), u_y: ink('yellow'), u_k: ink('key') } }];
    },
  },
  async load(api) {
    SH.single = await api.shader('halftone.glsl');
    SH.cmyk = await api.shader('cmyk.glsl');
  },
};
