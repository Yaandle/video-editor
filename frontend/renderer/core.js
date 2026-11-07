// core.js — the deterministic renderer. One instance renders one project.
//
//   const r = await createRenderer({ mode: 'export' | 'preview', base: '/' });
//   await r.load(project, { width, height });
//   await r.prepare(t);
//   const report = r.renderFrame(ctx, t, { x, y, width, height });
//   r.events();
//
// renderFrame is synchronous and a pure function of (project, t, size, tokens,
// decoded assets). It never reads a clock. Editor preview and headless export
// call exactly this function.
//
// Style packs: a clip whose look differs from the frame's is drawn into its
// own layer, run through its pack's treatment (low-res buffer, CPU pass, WebGL
// passes) and composited; the project style's treatment then runs over the
// whole frame. Packs may also override a component's render() to re-skin it.

import * as registry from './registry.js';
import { setTokens, tokens, color, layoutGrid, unit } from './tokens.js';
import * as assets from './assets.js';
import { envelope, sp, arrival, peak, settle, lerp } from './motion.js';
import { grid as beatGrid } from './beat.js';
import { layer as getLayer, deviceScale } from './raster.js';
import { runPasses } from './gl.js';
import { rand } from './prng.js';
import { loadPacksFor } from './styles.js';
import './index.js';

export const RENDERER_VERSION = '2.1.0';

/** Clip active at t: [start, start+duration). */
export function activeClips(project, t) {
  const hidden = new Set((project.tracks ?? []).filter((tr) => tr.hidden).map((tr) => tr.index));
  return project.clips
    .filter((c) => c.start <= t && t < c.start + c.duration && !hidden.has(c.layer ?? 0))
    .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
}

/** Layout frame for an output size: project dims when the aspect matches, else responsive. */
export function layoutFrame(settings, width, height) {
  const pw = settings.width, ph = settings.height;
  if (Math.abs(width / height - pw / ph) < 0.01) return { w: pw, h: ph, k: width / pw };
  const k = Math.min(width, height) / Math.min(pw, ph);
  return { w: width / k, h: height / k, k };
}

/** Position/scale from clip keyframes ({t: 0-1, x, y, scale}) at local time lt. */
export function keyframed(clip, lt) {
  const base = { x: clip.x ?? 0.5, y: clip.y ?? 0.5, sx: clip.scale_x ?? 1, sy: clip.scale_y ?? 1 };
  if (!Array.isArray(clip.keyframes) || clip.keyframes.length < 2) return base;
  const kf = [...clip.keyframes].sort((a, b) => a.t - b.t);
  const dur = Math.max(1e-6, clip.duration);
  const sOf = (k) => k.scale ?? null;
  if ((clip.keyframe_mode ?? 'spring') === 'linear') {
    const u = Math.max(0, Math.min(1, lt / dur));
    let a = kf[0], b = kf[kf.length - 1];
    for (let i = 0; i < kf.length - 1; i++) if (u >= kf[i].t && u <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; break; }
    const p = Math.max(0, Math.min(1, (u - a.t) / ((b.t - a.t) || 1)));
    const sa = sOf(a) ?? base.sx, sb = sOf(b) ?? base.sx;
    return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), sx: lerp(sa, sb, p), sy: lerp(sa, sb, p) };
  }
  // Spring mode: each stop is a camera move that starts at the previous stop's time.
  let x = kf[0].x, y = kf[0].y, s = sOf(kf[0]) ?? base.sx;
  for (let i = 1; i < kf.length; i++) {
    const p = sp(lt - kf[i - 1].t * dur, 'soft', 'position');
    x += (kf[i].x - kf[i - 1].x) * p;
    y += (kf[i].y - kf[i - 1].y) * p;
    s += ((sOf(kf[i]) ?? base.sx) - (sOf(kf[i - 1]) ?? base.sx)) * sp(lt - kf[i - 1].t * dur, 'soft', 'scale');
  }
  return { x, y, sx: s, sy: s };
}

/** True when a treatment works on pixels (needs its own layer); transform/holdFrames alone do not. */
const needsLayer = (tr) => !!(tr && (tr.native || tr.cpu || tr.passes || tr.blend));

/** Images and icons every clip can draw (decoded up front so renderFrame stays synchronous). */
function collectAssets(project, propsOf) {
  const imgs = new Set(), icons = new Set();
  for (const c of project.clips) {
    const def = registry.get(c.type);
    if (!def) continue;
    const props = propsOf(c.id);
    for (const a of def.assets?.(c, props) ?? []) imgs.add(a);
    for (const i of def.icons?.(c, props) ?? []) icons.add(i);
    if (c.src && def.media === 'image') imgs.add(c.src);
  }
  return { imgs: [...imgs], icons: [...icons] };
}

export async function createRenderer(opts = {}) {
  const mode = opts.mode ?? 'preview';
  assets.setBase(opts.base ?? '/');
  let project = null;
  let resolved = new Map();   // clip id -> resolved props
  let styleParams = new Map(); // clip id | '#frame' -> resolved pack params
  let errors = [];

  async function ensureTokens() {
    if (opts.tokens) { setTokens(opts.tokens); return; }
    const res = await fetch(assets.url('design/tokens.json'));
    if (!res.ok) throw new Error('design/tokens.json missing');
    setTokens(await res.json());
  }

  function resolveAll() {
    resolved = new Map();
    styleParams = new Map();
    errors = [];
    const s = project.settings;
    for (const c of project.clips) {
      const { value, errors: e } = registry.resolveProps(c.type, c.props);
      resolved.set(c.id, value);
      errors.push(...e.map((m) => `clip ${c.id}: ${m}`));
      if (c.style || c.style_params) styleParams.set(c.id, registry.styleParams(registry.clipStyle(c, s), c.style_params).value);
    }
    styleParams.set('#frame', registry.styleParams(s.style ?? registry.DEFAULT_STYLE, s.style_params).value);
    errors.push(...registry.checkStyles(project));
  }

  async function loadAssets(strict) {
    const { imgs, icons } = collectAssets(project, (id) => resolved.get(id));
    if (strict) await Promise.all(imgs.map((a) => assets.loadImage(a)));
    else await Promise.allSettled(imgs.map((a) => assets.loadImage(a)));
    if (icons.length) await assets.loadIcons(icons);
  }

  /** Draw one clip (envelope, keyframes, component or pack override) into ctx in layout units. */
  function drawClip(ctx, clip, t, frame, report, look) {
    const s = project.settings;
    const def = registry.get(clip.type);
    const pack = look.pack;
    const params = look.params;
    // On-twos packs hold each pose for n frames: the clip sees a quantized clock.
    const hold = pack?.treatment?.holdFrames;
    const tt = hold ? Math.floor(Math.round(t * s.fps) / hold) * hold / s.fps : t;
    const lt = tt - clip.start;
    const props = resolved.get(clip.id) ?? registry.defaults(clip.type);
    const xf = keyframed(clip, lt);
    const env = envelope(lt, clip.duration, clip.enter, clip.exit, frame);
    if (env.entering || env.exiting) report.animating = true;
    report.clips.push(clip.id);
    let ax = xf.x * frame.w, ay = xf.y * frame.h;
    // Native-resolution looks (pixel art): every position snaps to whole native pixels
    // after the springs are evaluated, so motion steps cleanly and never blurs.
    const native = pack?.treatment?.native?.(params, frame);
    const px = native ? frame.w / native.w : 0;
    const snap = (v) => (px ? Math.round(v / px) * px : v);
    if (px) { env.dx = snap(env.dx); env.dy = snap(env.dy); ax = snap(ax); ay = snap(ay); }
    const cenv = {
      t: tt, lt, frame, grid: layoutGrid(frame), beat: beatGrid(s), settings: s, project, mode, props, xf, clip,
      anchor: { x: ax, y: ay },
      u: unit(frame),
      px, snap,
      style: { id: pack?.id ?? registry.DEFAULT_STYLE, params, pack },
      seed: s.seed ?? 1,
      rand: (...k) => rand(s.seed ?? 1, clip.id, ...k),
      box: (b) => report.boxes.push({ clipId: clip.id, settled: !env.entering && !env.exiting, style: pack?.id, ...b, x: b.x + env.dx, y: b.y + env.dy }),
      animating: () => { report.animating = true; },
      warn: (m) => report.warnings.push(`${clip.id}: ${m}`),
      image: (p) => assets.getImage(p),
      // fps: decode rate (default the project's); a scene with mediaFrames() may decode at the source's own rate
      videoFrame: (src, st, fps) => assets.getVideoFrame(src, st, fps ?? s.fps, mode !== 'export'),
    };
    // A pack's transform (e.g. a beat punch) moves content it does not re-skin itself.
    // (transformAll: the look moves everything, e.g. a screen shake.)
    const reskinned = pack?.overrides?.[clip.type] || clip.type.startsWith(`${pack?.id}.`);
    const extra = reskinned && !pack?.treatment?.transformAll ? null : pack?.treatment?.transform?.(params, cenv) ?? null;
    if (extra && ((extra.scale ?? 1) !== 1 || extra.rot || extra.dx || extra.dy)) report.animating = true;
    ctx.save();
    ctx.globalAlpha *= look.composite ? 1 : (clip.opacity ?? 1) * env.alpha;
    ctx.translate(env.dx + snap(extra?.dx ?? 0), env.dy + snap(extra?.dy ?? 0));
    const rot = ((clip.rotation ?? 0) * Math.PI) / 180 + env.rot + (extra?.rot ?? 0);
    const scale = env.scale * (extra?.scale ?? 1);
    if (scale !== 1 || rot) {
      ctx.translate(ax, ay);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.translate(-ax, -ay);
    }
    const render = pack?.overrides?.[clip.type] ?? def.render;
    try {
      render(ctx, clip, lt, cenv);
    } catch (e) {
      ctx.restore();
      throw new Error(`render failed in clip ${clip.id} (${clip.type}${pack ? `, style ${pack.id}` : ''}) at t=${t.toFixed(3)}: ${e.message}`);
    }
    ctx.restore();
    return env.alpha * (clip.opacity ?? 1);
  }

  /**
   * Render `paint(layerCtx)` (in layout units) through a pack's treatment and
   * composite it onto ctx over (0, 0, W, H) in ctx's current units. paint()
   * may return an alpha to composite with (the clip's opacity × envelope).
   */
  function treated(ctx, look, frame, W, H, t, slot, paint, scope) {
    const tr = look.pack.treatment;
    const dev = deviceScale(ctx);
    const native = tr.native?.(look.params, frame) ?? null;
    const lw = native ? native.w : Math.round(W * dev), lh = native ? native.h : Math.round(H * dev);
    const L = getLayer(lw, lh, slot);
    L.ctx.setTransform(lw / frame.w, 0, 0, lh / frame.h, 0, 0);
    if (native) L.ctx.imageSmoothingEnabled = false;
    const alpha = paint(L.ctx) ?? 1;
    if (alpha <= 0) return;
    const s = project.settings;
    const env = { t, frame, size: { w: lw, h: lh }, settings: s, native: !!native, seed: s.seed ?? 1, beat: beatGrid(s), ...scope };
    tr.cpu?.(L.canvas, look.params, env);
    if (tr.animating?.(look.params, env)) scope.report.animating = true;
    const passes = tr.passes?.(look.params, env) ?? [];
    const out = passes.length ? runPasses(L.canvas, passes, { width: lw, height: lh, t, unit: Math.min(lw, lh) / 1080, filter: native ? 'nearest' : 'linear' }) : L.canvas;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (tr.blend) ctx.globalCompositeOperation = tr.blend;
    ctx.imageSmoothingEnabled = !native;
    ctx.drawImage(out, 0, 0, lw, lh, 0, 0, W, H);
    ctx.restore();
  }

  const api = {
    mode,
    get project() { return project; },
    get errors() { return errors; },

    async load(p) {
      project = p;
      await ensureTokens();
      if (!opts.skipFonts) await assets.loadFonts(tokens());
      await loadPacksFor(project);
      resolveAll();
      if (errors.length && mode === 'export') throw new Error(`invalid project:\n  ${errors.join('\n  ')}`);
      await loadAssets(true);
      return api;
    },

    /** Replace project data without reloading fonts (editor edits). */
    async update(p) {
      project = p;
      await loadPacksFor(project);
      resolveAll();
      await loadAssets(false);
    },

    props(clipId) { return resolved.get(clipId); },

    /** Decode whatever frame-dependent media t needs (video frames). */
    async prepare(t) {
      if (!project) return;
      const fps = project.settings.fps;
      const jobs = [];
      for (const c of activeClips(project, t)) {
        const def = registry.get(c.type);
        // A type that maps time to source frames itself (e.g. freezes, slow motion) lists what it needs.
        if (def?.mediaFrames) {
          const props = resolved.get(c.id) ?? registry.defaults(c.type);
          for (const f of def.mediaFrames(c, t - c.start, props, fps) ?? []) {
            const job = assets.loadVideoFrame(f.src, f.time, f.fps ?? fps);
            jobs.push(mode === 'export' ? job : job.catch(() => null));
          }
          continue;
        }
        if (def?.media !== 'video' || !c.src) continue;
        const st = (c.source_start ?? 0) + Math.max(0, t - c.start) * (c.speed ?? 1);
        jobs.push(mode === 'export' ? assets.loadVideoFrame(c.src, st, fps) : assets.loadVideoFrame(c.src, st, fps).catch(() => null));
      }
      await Promise.all(jobs);
    },

    renderFrame(ctx, t, size = {}) {
      const s = project.settings;
      const W = size.width ?? s.width, H = size.height ?? s.height;
      const lf = layoutFrame(s, W, H);
      const frame = { w: lf.w, h: lf.h };
      const report = { t, frame: Math.round(t * s.fps), size: { w: frame.w, h: frame.h }, boxes: [], animating: false, clips: [], warnings: [], styles: [] };
      const framePack = registry.stylePack(s.style);
      const frameLook = { pack: framePack, params: styleParams.get('#frame') ?? {} };
      // perClip looks (paper cutout) treat every clip on its own layer even as the project style,
      // so each piece casts its own shadow onto the pieces below it.
      const perClip = !!framePack?.treatment?.perClip;
      const frameTreated = needsLayer(framePack?.treatment) && !perClip;

      ctx.save();
      ctx.translate(size.x ?? 0, size.y ?? 0);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();

      // Under a pixel-treated project look, a clip explicitly styled with the default look
      // opts out: it is drawn after the treatment, on top (credits, UI overlays).
      const optsOut = (clip) => frameTreated && clip.style === registry.DEFAULT_STYLE;
      const paintClips = (c2, overlay = false) => {
        if (!overlay) {
          c2.fillStyle = color(s.background ?? 'paper');
          c2.fillRect(0, 0, frame.w, frame.h);
        }
        for (const clip of activeClips(project, t)) {
          const def = registry.get(clip.type);
          if (!def || def.visual === false || optsOut(clip) !== overlay) continue;
          const id = registry.clipStyle(clip, s);
          const own = id !== (s.style ?? registry.DEFAULT_STYLE) ? registry.stylePack(id) : perClip ? framePack : null;
          if (own && !report.styles.includes(own.id)) report.styles.push(own.id);
          if (needsLayer(own?.treatment)) {
            // Its own look: own layer (c2 is in layout units, so the layer covers frame.w × frame.h),
            // own treatment, composited with the clip's opacity.
            const look = { pack: own, params: styleParams.get(clip.id) ?? {}, composite: true };
            treated(c2, look, frame, frame.w, frame.h, t, 1, (lc) => drawClip(lc, clip, t, frame, report, look), { scope: 'clip', lt: t - clip.start, clip, report });
          } else {
            drawClip(c2, clip, t, frame, report, own ? { pack: own, params: styleParams.get(clip.id) ?? {} } : frameLook);
          }
        }
      };

      if (frameTreated) {
        if (!report.styles.includes(framePack.id)) report.styles.unshift(framePack.id);
        treated(ctx, frameLook, frame, W, H, t, 0, (lc) => paintClips(lc), { scope: 'frame', lt: t, clip: null, report });
        ctx.scale(lf.k, lf.k);
        paintClips(ctx, true);
      } else {
        ctx.scale(lf.k, lf.k);
        paintClips(ctx);
      }
      ctx.restore();
      return report;
    },

    events() { return collectEvents(project, (id) => resolved.get(id)); },
  };
  return api;
}

/** Map a generic sound through the clip's pack profile (tokens.sfx), e.g. impact → chip-noise. */
function voiceFor(sound, clip, settings) {
  const pack = registry.stylePack(clip ? registry.clipStyle(clip, settings) : settings.style);
  return pack?.tokens?.sfx?.[sound] ?? sound;
}

/**
 * Every timed event in the project — cuts, hits, motion windows, sound cues.
 * Pure and DOM-free: studio/jsbridge.py runs this under Node for the beat
 * validator and the audio mixer, and the critique uses the motion windows.
 * Cue sounds are resolved through each clip's style-pack sound profile.
 */
export function collectEvents(project, propsOf = null) {
  const s = project.settings;
  const fps = s.fps;
  const frame = { w: s.width, h: s.height };
  const ev = { cuts: [], hits: [], motion: [], cues: [] };
  const getProps = (c) => propsOf?.(c.id) ?? registry.resolveProps(c.type, c.props).value;
  const q = (t) => Math.round(t * fps) / fps;   // quantize to frames
  const cue = (c, item) => ev.cues.push({ ...item, sound: voiceFor(item.sound, c, s) });

  for (const c of project.clips) {
    const def = registry.get(c.type);
    if (!def) continue;
    const hidden = (project.tracks ?? []).some((tr) => tr.index === (c.layer ?? 0) && (tr.hidden || tr.muted));
    if (def.kind === 'scene') {
      ev.cuts.push({ t: q(c.start), clipId: c.id, edge: 'in' });
      ev.cuts.push({ t: q(c.start + c.duration), clipId: c.id, edge: 'out' });
    }
    if (c.enter && c.enter.from && c.enter.from !== 'none') {
      const p = c.enter.preset ?? 'snappy';
      const t0 = c.start + (c.enter.delay ?? 0);
      ev.motion.push({ clipId: c.id, role: 'enter', start: q(t0), peak: q(t0 + peak(p)), settle: q(t0 + settle(p)), preset: p });
      if (!hidden && c.enter.sfx !== false) cue(c, { t: q(t0), sound: 'whoosh', gain_db: -8, clipId: c.id });
      if (c.enter.hit) {
        const th = t0 + Math.ceil(arrival(p) * fps - 1e-9) / fps;
        ev.hits.push({ t: q(th), clipId: c.id, preset: p });
        if (!hidden) cue(c, { t: q(th), sound: 'impact', gain_db: -4, clipId: c.id });
      }
    }
    if (c.exit && c.exit.to && c.exit.to !== 'none') {
      const p = c.exit.preset ?? 'quick';
      const t0 = c.start + c.duration - (c.exit.length ?? 0.4);
      ev.motion.push({ clipId: c.id, role: 'exit', start: q(t0), peak: q(t0 + peak(p)), settle: q(Math.min(c.start + c.duration, t0 + settle(p))), preset: p });
    }
    // A pack that re-skins a component also owns its timing (e.g. kinetic words land per beat).
    const look = registry.stylePack(registry.clipStyle(c, s));
    const eventsFn = look?.eventOverrides?.[c.type] ?? def.events;
    if (eventsFn) {
      const env = { frame, fps, settings: s, beat: beatGrid(s), project, props: getProps(c), q, seed: s.seed ?? 1, rand: (...k) => rand(s.seed ?? 1, c.id, ...k),
        style: { id: look?.id, params: registry.styleParams(look?.id, c.style ? c.style_params : s.style_params).value } };
      for (const e of eventsFn(c, env) ?? []) {
        const item = { clipId: c.id, ...e };
        if (e.kind === 'hit') { ev.hits.push({ ...item, t: q(e.t) }); if (!hidden && e.sound !== null) cue(c, { t: q(e.t), sound: e.sound ?? 'impact', gain_db: e.gain_db ?? -4, clipId: c.id, pitch: e.pitch }); }
        else if (e.kind === 'motion') ev.motion.push({ ...item, start: q(e.start), peak: q(e.peak), settle: q(e.settle) });
        else if (e.kind === 'cue') { if (!hidden) cue(c, { ...item, t: q(e.t) }); }
        else if (e.kind === 'cut') ev.cuts.push({ ...item, t: q(e.t) });
      }
    }
  }
  // Risers into scene cuts (except the first), ending exactly on the cut.
  const ins = ev.cuts.filter((c) => c.edge === 'in' && c.t > 0);
  const seen = new Set();
  for (const cut of ins) {
    if (seen.has(cut.t)) continue;
    seen.add(cut.t);
    const clip = project.clips.find((c) => c.id === cut.clipId);
    const len = 60 / (s.bpm ?? 120);
    cue(clip, { t: q(Math.max(0, cut.t - len)), sound: 'riser', length: len, gain_db: -12, ends_at: cut.t });
  }
  for (const k of ['cuts', 'hits', 'cues']) ev[k].sort((a, b) => a.t - b.t);
  ev.motion.sort((a, b) => a.start - b.start);
  return ev;
}
