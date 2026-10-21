// ASCII art — any layer (type, photo, video, shapes, 3D) re-drawn as
// characters from a real monospace font on a fixed cell grid. Pass 1 averages
// each cell; pass 2 picks a glyph on the set's density ramp and draws it from
// an atlas built at load. Cells reveal on their own springs as a front sweeps
// across, and a second character set can take over cell by cell on a beat.

import { color as coreColor } from '#renderer/tokens.js';
import { params as springParams, settle } from '#renderer/motion.js';
import { loadFontFile } from '#renderer/assets.js';
import { strHash } from '#renderer/prng.js';
import tokens from './tokens.json' with { type: 'json' };

const ID = 'ascii';
const SH = {};
const SETS = tokens.sets;                          // name -> ramp, light → dense
const SET_NAMES = Object.keys(SETS);
const ATLAS_CELL = { w: 40, h: 64 };
const MAX_CHARS = Math.max(...Object.values(SETS).map((s) => [...s].length));
const ASPECT = 0.6;                                // mono advance / cell height
const MODES = { ink: 0, duotone: 1, source: 2 };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const col = (name) => hex(tokens.palette[name] ?? coreColor(name));

function buildAtlas() {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ATLAS_CELL.w * MAX_CHARS, ATLAS_CELL.h * SET_NAMES.length) : null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(ATLAS_CELL.h * 0.78)}px "${tokens.font.family}"`;
  SET_NAMES.forEach((name, row) => {
    [...SETS[name]].forEach((ch, i) => {
      // Full-cell glyphs (blocks) fill their slot exactly; everything else is set as type.
      if ('█▓▒░'.includes(ch)) {
        const a = { '█': 1, '▓': 0.75, '▒': 0.5, '░': 0.25 }[ch];
        ctx.globalAlpha = a;
        ctx.fillRect(i * ATLAS_CELL.w + 2, row * ATLAS_CELL.h + 2, ATLAS_CELL.w - 4, ATLAS_CELL.h - 4);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillText(ch, i * ATLAS_CELL.w + ATLAS_CELL.w / 2, row * ATLAS_CELL.h + ATLAS_CELL.h * 0.54);
      }
    });
  });
  return c;
}

/** Cell geometry for a target size: cell height `cell` px at 1080 on the short side. */
export function grid(p, w, h) {
  const k = Math.min(w, h) / 1080;
  const ch = p.cell * k, cw = ch * ASPECT;
  return { cw, ch, cols: Math.ceil(w / cw), rows: Math.ceil(h / ch) };
}

export default {
  id: ID,
  label: tokens.label,
  description: 'Any layer re-drawn as characters from a real mono font on a fixed grid. Cells reveal on their own springs; character sets swap cell by cell on the beat.',
  tokens,
  schema: {
    set: { type: 'enum', options: SET_NAMES, default: 'letters', label: 'Characters' },
    switch_to: { type: 'enum', options: ['none', ...SET_NAMES], default: 'none', label: 'Swap to set' },
    switch_beat: { type: 'number', min: 0, max: 64, step: 1, default: 8, label: 'Swap on beat #' },
    cell: { type: 'number', min: 10, max: 64, step: 1, default: 22, label: 'Cell height px (at 1080)' },
    mode: { type: 'enum', options: Object.keys(MODES), default: 'duotone', label: 'Colour' },
    ink: { type: 'color', default: 'ink', label: 'Ink' },
    accent: { type: 'color', default: 'orange', label: 'Accent (duotone)' },
    gamma: { type: 'number', min: 0.3, max: 2.5, step: 0.05, default: 0.8, label: 'Density gamma' },
    reveal_beats: { type: 'number', min: 0, max: 8, step: 0.5, default: 1.5, label: 'Reveal sweep (beats)' },
    ground: { type: 'enum', options: ['auto', 'paper', 'clear'], default: 'auto', label: 'Ground' },
  },
  treatment: {
    animating(p, env) {
      const B = env.beat?.valid ? env.beat.beat : 0.5;
      const sweep = p.reveal_beats * B;
      if (env.lt < sweep + 0.12 + settle('snappy', 'scale')) return true;
      const sw = p.switch_to !== 'none' ? p.switch_beat * B : -1;
      return sw >= 0 && env.lt >= sw && env.lt < sw + sweep + 0.12 + settle('snappy', 'scale');
    },
    passes(p, env) {
      const { w, h } = env.size;
      const g = grid(p, w, h);
      const B = env.beat?.valid ? env.beat.beat : 0.5;
      const sp = springParams('snappy', 'scale');
      const ground = p.ground === 'paper' || (p.ground === 'auto' && env.scope === 'frame') ? 1 : 0;
      const counts = SET_NAMES.map((n) => [...SETS[n]].length);
      while (counts.length < 4) counts.push(1);
      return [
        { frag: SH.cells, size: { w: g.cols, h: g.rows }, uniforms: { u_cellpx: [g.cw, g.ch] } },
        {
          frag: SH.glyphs, filter: 'nearest',
          uniforms: {
            u_cellpx: [g.cw, g.ch], u_grid: [g.cols, g.rows], u_atlasCols: MAX_CHARS, u_atlasRows: SET_NAMES.length,
            u_count: counts, u_setA: SET_NAMES.indexOf(p.set), u_setB: SET_NAMES.indexOf(p.switch_to === 'none' ? p.set : p.switch_to),
            u_lt: env.lt, u_sweep: p.reveal_beats * B, u_switch: p.switch_to === 'none' ? -1 : p.switch_beat * B,
            u_spring: [sp.stiffness, sp.damping, sp.mass], u_settle: settle('snappy', 'scale'), u_mode: MODES[p.mode], u_ink: hex(coreColor(p.ink)), u_accent: hex(coreColor(p.accent)),
            u_paper: col('paper'), u_ground: ground, u_gamma: p.gamma, u_seed: strHash(env.clip?.id ?? 'frame') ^ (env.seed >>> 0),
          },
          textures: { u_atlas: { src: SH.atlas, static: true } },
        },
      ];
    },
  },
  async load(api) {
    await loadFontFile(tokens.font.family, tokens.font.file, { weight: '100 800' });
    SH.cells = await api.shader('cells.glsl');
    SH.glyphs = await api.shader('glyphs.glsl');
    SH.atlas = buildAtlas();
  },
};
