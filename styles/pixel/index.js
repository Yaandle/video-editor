// Pixel art — everything renders into a native low-res buffer (320×180 or
// 480×270), is quantized to the PICO-8 palette on the CPU (optional Bayer
// dither for photos) and upscaled by an exact integer with no smoothing. All
// positions snap to whole native pixels after their springs are evaluated, so
// motion steps cleanly. Text uses a bitmap font drawn for the pack; sprites
// and tiles are palette-index grids. Each bar downbeat shakes the screen by a
// few whole pixels and flashes a palette swap for two frames.

import { register } from '#renderer/registry.js';
import { color as coreColor } from '#renderer/tokens.js';
import { sp, clamp, clamp01, settle, peak, arrivalFrames, exitProgress } from '#renderer/motion.js';
import { quantize, parsePalette, nearest } from '#renderer/raster.js';
import { landing } from '#renderer/kit.js';
import { srand } from '#renderer/prng.js';
import { scheduleText } from '#renderer/components/text.js';
import * as font from './font.js';
import { SPRITES, TILES, blit } from './sprites.js';
import tokens from './tokens.json' with { type: 'json' };

const ID = 'pixel';
const PAL = tokens.palette_order.map((k) => tokens.palette[k]);
const RES = { '320x180': { w: 320, h: 180 }, '480x270': { w: 480, h: 270 } };
// Palette swap on the downbeat flash: every colour jumps one step brighter.
const SWAP = [1, 13, 8, 11, 9, 6, 7, 7, 14, 10, 7, 10, 6, 6, 15, 7];
const ROLE_SCALE = { hero: 4, display: 3, h1: 3, h2: 2, body: 1, label: 1, micro: 1 };

/** Native buffer for a frame: the named resolution, rotated for portrait frames. */
export function nativeSize(params, frame) {
  const r = RES[params.res] ?? RES['320x180'];
  return frame.h > frame.w ? { w: r.h, h: r.w } : r;
}

/** Seconds since the last bar downbeat (Infinity before the second bar). */
function sinceBar(t, beat) {
  if (!beat?.valid || t < beat.offset + beat.bar - 1e-9) return Infinity;
  return ((t - beat.offset) % beat.bar + beat.bar) % beat.bar;
}

const pal = (i) => PAL[i];
const PAL_RGB = parsePalette(PAL);
/** A core colour name or hex → the nearest PICO-8 entry, so flat type is exactly a palette colour. */
const ink = (c) => {
  if (tokens.palette[c]) return tokens.palette[c];          // PICO-8 names first ("orange" = #FFA300)
  const [rgb] = parsePalette([coreColor(c)]);
  return PAL[nearest(PAL_RGB, ...rgb)];
};

// ── Components ───────────────────────────────────────────────────────────────

register({
  type: 'pixel.sprite', pack: ID, kind: 'component', category: 'Shapes',
  label: 'Pixel sprite',
  description: 'A sprite from the pack sheet (coin, heart, star, player). Drops in on a spring snapped to whole pixels, then idles, bounces on the beat, spins or walks.',
  duration: 4,
  schema: {
    sprite: { type: 'enum', options: Object.keys(SPRITES), default: 'coin', label: 'Sprite' },
    scale: { type: 'number', min: 1, max: 12, step: 1, default: 4, label: 'Scale (native px per sprite px)' },
    anim: { type: 'enum', options: ['bounce', 'spin', 'walk', 'idle'], default: 'bounce', label: 'Animation' },
    land_beat: { type: 'number', min: 0, max: 64, step: 1, default: 1, label: 'Land on beat #' },
    walk_speed: { type: 'number', min: -400, max: 400, step: 1, default: 0, label: 'Walk speed (native px/s)' },
    flip: { type: 'bool', default: false, label: 'Mirror' },
  },
  clipLabel: (clip) => `sprite · ${clip.props?.sprite ?? 'coin'}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const px = env.px || env.u * 6;
    const sh = SPRITES[p.sprite];
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    const L = landing(clip.start, 'slam', env.beat, env.settings.fps, p.land_beat);
    const e = env.t - L.start;
    if (e <= 0) return;
    const rows0 = sh.frames[0];
    const u = px * p.scale;
    const w = rows0[0].length * u, h = rows0.length * u;
    // Drop from above onto the anchor; afterwards a hop on every beat (bounce) or a walk.
    let dy = -env.frame.h * 0.6 * (1 - sp(e, 'slam', 'position'));
    let fi = 0;
    const sinceBeat = ((env.t - (env.beat?.offset ?? 0)) % B + B) % B;
    const nBeat = Math.floor((env.t - (env.beat?.offset ?? 0)) / B);
    if (e > settle('slam')) {
      if (p.anim === 'bounce') dy -= Math.max(0, Math.sin(Math.PI * clamp01(sinceBeat / (B * 0.7)))) * u * 3;
      if (p.anim === 'spin') fi = Math.floor(sinceBeat / (B / sh.fps)) % sh.frames.length;
      if (p.anim === 'walk') fi = Math.floor((env.t * sh.fps) / B) % sh.frames.length;
    }
    if (p.anim === 'walk') fi = Math.floor((env.t * sh.fps) / B) % sh.frames.length;
    const walk = p.walk_speed * px * Math.max(0, lt);
    const ex = exitProgress(lt, clip.duration, 0.4, 'quick');
    const x = env.snap(env.anchor.x - w / 2 + walk), y = env.snap(env.anchor.y - h / 2 + dy + env.frame.h * ex);
    blit(ctx, sh.frames[fi], x, y, u, PAL, p.flip);
    env.box({ kind: 'box', name: p.sprite, x, y, w, h, settled: e > settle('slam') && !ex });
    env.animating();
    void nBeat;
  },
  events(clip, env) {
    const L = landing(clip.start, 'slam', env.beat, env.fps, env.props.land_beat);
    const out = [{ kind: 'hit', t: L.hit, sound: env.props.sprite === 'coin' ? 'pop' : 'impact', gain_db: -8 },
      { kind: 'motion', role: 'sprite', start: L.start, peak: L.start + peak('slam'), settle: L.start + settle('slam'), preset: 'slam' }];
    return out;
  },
});

register({
  type: 'pixel.tiles', pack: ID, kind: 'component', category: 'Shapes',
  label: 'Pixel tiles',
  description: 'Tile background: sky, scrolling clouds (parallax) and a ground strip of grass over dirt, every position on whole pixels.',
  duration: 8,
  schema: {
    sky: { type: 'number', min: 0, max: 15, step: 1, default: 12, label: 'Sky colour (palette index)' },
    ground_rows: { type: 'number', min: 0, max: 8, step: 1, default: 3, label: 'Ground rows (tiles)' },
    clouds: { type: 'number', min: 0, max: 8, step: 1, default: 3, label: 'Clouds' },
    speed: { type: 'number', min: -200, max: 200, step: 1, default: 12, label: 'Cloud speed (native px/s)' },
    tile: { type: 'number', min: 1, max: 6, step: 1, default: 2, label: 'Tile scale' },
    cloud_tone: { type: 'enum', options: ['day', 'night'], default: 'day', label: 'Clouds' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props;
    const px = env.px || env.u * 6;
    const F = env.frame;
    ctx.fillStyle = pal(p.sky);
    ctx.fillRect(0, 0, F.w, F.h);
    const T = 8 * p.tile * px;
    // Clouds: seeded positions, two parallax depths, wrapping across the frame.
    for (let i = 0; i < p.clouds; i++) {
      const depth = i % 2 ? 0.5 : 1;
      const cw = 16 * p.tile * px * depth;
      const span = F.w + cw;
      const x0 = (0.5 + 0.5 * srand(env.seed, clip.id, 'cx', i)) * span;
      const x = env.snap(((x0 - p.speed * px * depth * env.t) % span + span) % span - cw);
      const y = env.snap((0.06 + 0.3 * (0.5 + 0.5 * srand(env.seed, clip.id, 'cy', i))) * F.h);
      // Night clouds: lavender and dark grey, quiet enough to sit behind type.
      blit(ctx, TILES.cloud, x, y, p.tile * px * depth, PAL, false, p.cloud_tone === 'night' ? { 7: 13, 6: 5 } : null);
    }
    const top = env.snap(F.h - p.ground_rows * T);
    for (let r = 0; r < p.ground_rows; r++) {
      for (let x = 0; x < F.w; x += T) blit(ctx, r === 0 ? TILES.ground : TILES.dirt, x, top + r * T, p.tile * px, PAL);
    }
    env.box({ kind: 'box', name: 'tiles', x: 0, y: 0, w: F.w, h: F.h, bleed: true });
    if (p.speed && p.clouds) env.animating();
  },
});

// ── Text in the bitmap font (re-skins `text`) ────────────────────────────────

function pixelText(ctx, clip, lt, env) {
  const p = env.props;
  const px = env.px || env.u * 6;
  const scale = ROLE_SCALE[p.role] ?? 2;
  const u = px * scale;
  const maxW = Math.floor((p.width * env.frame.w) / u);
  const lines = font.wrap(String(p.text ?? '').replace(/\[\[|\]\]|\{\{|\}\}/g, ''), maxW);
  // Markup → accent ranges in the plain text.
  const accentIdx = new Set();
  {
    let plainI = 0;
    const re = /\{\{(.+?)\}\}|\[\[(.+?)\]\]|([\s\S])/g;
    let m;
    while ((m = re.exec(String(p.text ?? '')))) {
      const run = m[1] ?? m[2];
      if (run !== undefined) { for (let k = 0; k < run.length; k++) accentIdx.add(plainI + k); plainI += run.length; }
      else plainI += 1;
    }
  }
  const sched = scheduleText(clip, p, env.beat, env.settings.fps);
  const lineH = font.LINE * u;
  const x0 = env.snap(p.align === 'right' ? env.anchor.x - font.measure(lines[0] ?? '') * u : env.anchor.x);
  let charBase = 0;
  const typeCps = 18;
  lines.forEach((line, li) => {
    const e = lt - sched.delay - (p.anim_unit === 'line' ? li : 0) * sched.stagger;
    const typing = p.anim_from === 'type';
    if (!typing && p.anim_from !== 'none' && e <= 0) { charBase += line.length + 1; return; }
    const drop = typing || p.anim_from === 'none' ? 0 : -12 * u * (1 - sp(e, p.anim_preset, 'position'));
    const ex = p.exit_to !== 'none' ? exitProgress(lt, clip.duration, 0.4, 'quick', -li * 0.04) : 0;
    const y = env.snap(env.anchor.y + li * lineH + drop + ex * env.frame.h * 0.6);
    const base = charBase;
    const shown = typing ? Math.floor(Math.max(0, lt - sched.delay) * typeCps) : Infinity;
    // Draw run by run so accent characters take the accent colour.
    let cx = x0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const g = font.glyph(ch);
      if (base + i < shown) font.draw(ctx, ch, cx, y, u, ink(accentIdx.has(base + i) ? p.accent : p.color));
      cx += (g.w + 1) * u;
    }
    env.box({ kind: 'text', role: p.role, x: x0, y, w: font.measure(line) * u, h: font.CAP * u, fg: ink(p.color), size: font.CAP * u / 0.72,
      text: line, settled: (typing ? shown >= base + line.length : e > settle(p.anim_preset)) && !ex });
    charBase += line.length + 1;
  });
  if (lt < sched.delay + lines.length * sched.stagger + 1 || lt > clip.duration - 0.45) env.animating();
}

export default {
  id: ID,
  label: tokens.label,
  description: 'A 320×180 native buffer in the PICO-8 palette, upscaled ×6 with no smoothing. Whole-pixel motion, a bitmap font, sprites and tiles, beat shakes and palette flashes.',
  tokens,
  schema: {
    res: { type: 'enum', options: Object.keys(RES), default: '320x180', label: 'Native resolution' },
    dither: { type: 'bool', default: true, label: 'Dither photos' },
    shake: { type: 'number', min: 0, max: 6, step: 1, default: 2, label: 'Downbeat shake (native px)' },
    flash: { type: 'bool', default: true, label: 'Palette flash on downbeats' },
  },
  overrides: { text: pixelText },
  treatment: {
    transformAll: true,
    native: nativeSize,
    transform(p, env) {
      const s = sinceBar(env.t, env.beat);
      if (!p.shake || s > 0.2) return null;
      const f = Math.round(env.t * env.settings.fps);
      const k = p.shake * (1 - s / 0.2);
      return { dx: Math.round(srand(env.seed, 'shake-x', f) * k) * env.px, dy: Math.round(srand(env.seed, 'shake-y', f) * k) * env.px };
    },
    animating(p, env) {
      return sinceBar(env.t, env.beat) < 0.2;
    },
    cpu(canvas, p, env) {
      const s = sinceBar(env.t, env.beat);
      const flash = p.flash && s < 2 / env.settings.fps - 1e-6;
      quantize(canvas, PAL, { alpha: 0.5, dither: p.dither ? 40 : 0, swap: flash ? SWAP : null });
    },
  },
};
