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

import * as registry from './registry.js';
import { setTokens, tokens, color, layoutGrid, unit } from './tokens.js';
import * as assets from './assets.js';
import { envelope, sp, arrival, peak, settle, lerp } from './motion.js';
import { grid as beatGrid } from './beat.js';
import './index.js';

export const RENDERER_VERSION = '2.0.0';

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
  const kf = Array.isArray(clip.keyframes) ? [...clip.keyframes].sort((a, b) => a.t - b.t) : [];
  const base = { x: clip.x ?? 0.5, y: clip.y ?? 0.5, sx: clip.scale_x ?? 1, sy: clip.scale_y ?? 1 };
  if (kf.length < 2) return base;
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

export async function createRenderer(opts = {}) {
  const mode = opts.mode ?? 'preview';
  assets.setBase(opts.base ?? '/');
  let project = null;
  let resolved = new Map();   // clip id -> resolved props
  let errors = [];

  async function ensureTokens() {
    if (opts.tokens) { setTokens(opts.tokens); return; }
    const res = await fetch(assets.url('design/tokens.json'));
    if (!res.ok) throw new Error('design/tokens.json missing');
    setTokens(await res.json());
  }

  function resolveAll() {
    resolved = new Map();
    errors = [];
    for (const c of project.clips) {
      const { value, errors: e } = registry.resolveProps(c.type, c.props);
      resolved.set(c.id, value);
      errors.push(...e.map((m) => `clip ${c.id}: ${m}`));
    }
  }

  const api = {
    mode,
    get project() { return project; },
    get errors() { return errors; },

    async load(p, size = {}) {
      project = p;
      await ensureTokens();
      if (!opts.skipFonts) await assets.loadFonts(tokens());
      resolveAll();
      if (errors.length && mode === 'export') throw new Error(`invalid project:\n  ${errors.join('\n  ')}`);
      // Preload every image any clip can draw, plus icons scenes declare.
      const imgs = new Set(), icons = new Set();
      for (const c of project.clips) {
        const def = registry.get(c.type);
        if (!def) continue;
        const props = resolved.get(c.id);
        for (const a of def.assets?.(c, props) ?? []) imgs.add(a);
        for (const i of def.icons?.(c, props) ?? []) icons.add(i);
        if (c.src && (def.media === 'image')) imgs.add(c.src);
      }
      await Promise.all([...imgs].map((a) => assets.loadImage(a)));
      if (icons.size) await assets.loadIcons([...icons]);
      return api;
    },

    /** Replace project data without reloading fonts (editor edits). */
    async update(p) {
      project = p;
      resolveAll();
      const imgs = new Set(), icons = new Set();
      for (const c of project.clips) {
        const def = registry.get(c.type);
        if (!def) continue;
        const props = resolved.get(c.id);
        for (const a of def.assets?.(c, props) ?? []) imgs.add(a);
        for (const i of def.icons?.(c, props) ?? []) icons.add(i);
        if (c.src && def.media === 'image') imgs.add(c.src);
      }
      await Promise.allSettled([...imgs].map((a) => assets.loadImage(a)));
      if (icons.size) await assets.loadIcons([...icons]);
    },

    props(clipId) { return resolved.get(clipId); },

    /** Decode whatever frame-dependent media t needs (video frames). */
    async prepare(t) {
      if (!project) return;
      const fps = project.settings.fps;
      const jobs = [];
      for (const c of activeClips(project, t)) {
        const def = registry.get(c.type);
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
      const report = { t, frame: Math.round(t * s.fps), size: { w: frame.w, h: frame.h }, boxes: [], animating: false, clips: [], warnings: [] };

      ctx.save();
      ctx.translate(size.x ?? 0, size.y ?? 0);
      ctx.scale(lf.k, lf.k);
      ctx.beginPath();
      ctx.rect(0, 0, frame.w, frame.h);
      ctx.clip();
      ctx.fillStyle = color(s.background ?? 'paper');
      ctx.fillRect(0, 0, frame.w, frame.h);

      const grid = layoutGrid(frame);
      const bg = beatGrid(s);
      for (const clip of activeClips(project, t)) {
        const def = registry.get(clip.type);
        if (!def || def.visual === false) continue;
        const lt = t - clip.start;
        const props = resolved.get(clip.id) ?? registry.defaults(clip.type);
        const xf = keyframed(clip, lt);
        const env = envelope(lt, clip.duration, clip.enter, clip.exit, frame);
        if (env.entering || env.exiting) report.animating = true;
        report.clips.push(clip.id);
        const ax = xf.x * frame.w, ay = xf.y * frame.h;
        ctx.save();
        ctx.globalAlpha *= (clip.opacity ?? 1) * env.alpha;
        ctx.translate(env.dx, env.dy);
        if (env.scale !== 1 || clip.rotation || env.rot) {
          ctx.translate(ax, ay);
          ctx.rotate(((clip.rotation ?? 0) * Math.PI) / 180 + env.rot);
          ctx.scale(env.scale, env.scale);
          ctx.translate(-ax, -ay);
        }
        const cenv = {
          t, lt, frame, grid, beat: bg, settings: s, project, mode, props, xf,
          anchor: { x: ax, y: ay },
          u: unit(frame),
          box: (b) => report.boxes.push({ clipId: clip.id, settled: !env.entering && !env.exiting, ...b, x: b.x + env.dx, y: b.y + env.dy }),
          animating: () => { report.animating = true; },
          warn: (m) => report.warnings.push(`${clip.id}: ${m}`),
          image: (p) => assets.getImage(p),
          videoFrame: (src, st) => assets.getVideoFrame(src, st, s.fps, mode !== 'export'),
        };
        try {
          def.render(ctx, clip, lt, cenv);
        } catch (e) {
          ctx.restore();
          ctx.restore();
          throw new Error(`render failed in clip ${clip.id} (${clip.type}) at t=${t.toFixed(3)}: ${e.message}`);
        }
        ctx.restore();
      }

      // Style-pack pass pipeline (identity by default). Passes needing pixels
      // get an offscreen copy; the identity pass is skipped as a no-op.
      const pack = registry.stylePack(s.style_pack ?? 'neo-brutal');
      const active = (pack?.passes ?? []).filter((p) => p.id !== 'identity');
      if (active.length && typeof OffscreenCanvas !== 'undefined') {
        const src = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
        for (const p of active) {
          const fn = registry.pass(p.id);
          if (!fn) throw new Error(`style pack pass missing: ${p.id}`);
          src.getContext('2d').drawImage(ctx.canvas, 0, 0);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          fn(src, ctx, t, p.params ?? {}, { frame, report });
          ctx.restore();
        }
      }
      ctx.restore();
      return report;
    },

    events() { return collectEvents(project, (id) => resolved.get(id)); },
  };
  return api;
}

/**
 * Every timed event in the project — cuts, hits, motion windows, sound cues.
 * Pure and DOM-free: studio/jsbridge.py runs this under Node for the beat
 * validator and the audio mixer, and the critique uses the motion windows.
 */
export function collectEvents(project, propsOf = null) {
  const s = project.settings;
  const fps = s.fps;
  const frame = { w: s.width, h: s.height };
  const ev = { cuts: [], hits: [], motion: [], cues: [] };
  const getProps = (c) => propsOf?.(c.id) ?? registry.resolveProps(c.type, c.props).value;
  const q = (t) => Math.round(t * fps) / fps;   // quantize to frames

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
      if (!hidden && c.enter.sfx !== false) ev.cues.push({ t: q(t0), sound: 'whoosh', gain_db: -8, clipId: c.id });
      if (c.enter.hit) {
        const th = t0 + Math.ceil(arrival(p) * fps - 1e-9) / fps;
        ev.hits.push({ t: q(th), clipId: c.id, preset: p });
        if (!hidden) ev.cues.push({ t: q(th), sound: 'impact', gain_db: -4, clipId: c.id });
      }
    }
    if (c.exit && c.exit.to && c.exit.to !== 'none') {
      const p = c.exit.preset ?? 'quick';
      const t0 = c.start + c.duration - (c.exit.length ?? 0.4);
      ev.motion.push({ clipId: c.id, role: 'exit', start: q(t0), peak: q(t0 + peak(p)), settle: q(Math.min(c.start + c.duration, t0 + settle(p))), preset: p });
    }
    if (def.events) {
      const env = { frame, fps, settings: s, beat: beatGrid(s), project, props: getProps(c), q };
      for (const e of def.events(c, env) ?? []) {
        const item = { clipId: c.id, ...e };
        if (e.kind === 'hit') { ev.hits.push({ ...item, t: q(e.t) }); if (!hidden && e.sound !== null) ev.cues.push({ t: q(e.t), sound: e.sound ?? 'impact', gain_db: e.gain_db ?? -4, clipId: c.id, pitch: e.pitch }); }
        else if (e.kind === 'motion') ev.motion.push({ ...item, start: q(e.start), peak: q(e.peak), settle: q(e.settle) });
        else if (e.kind === 'cue') { if (!hidden) ev.cues.push({ ...item, t: q(e.t) }); }
        else if (e.kind === 'cut') ev.cuts.push({ ...item, t: q(e.t) });
      }
    }
  }
  // Risers into scene cuts (except the first), ending exactly on the cut.
  const ins = ev.cuts.filter((c) => c.edge === 'in' && c.t > 0).map((c) => c.t);
  for (const t of [...new Set(ins)]) ev.cues.push({ t: q(Math.max(0, t - 60 / (s.bpm ?? 120))), sound: 'riser', length: 60 / (s.bpm ?? 120), gain_db: -12, ends_at: t });
  for (const k of ['cuts', 'hits', 'cues']) ev[k].sort((a, b) => a.t - b.t);
  ev.motion.sort((a, b) => a.start - b.start);
  return ev;
}
