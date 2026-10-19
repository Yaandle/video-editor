// model.js — the editor's project model (schema v1), DOM-free so it is unit
// tested under Node. studio/schema.py is the authority; this mirrors it for the
// browser and never invents fields the server would reject.

import * as registry from './renderer/registry.js';

const CLIP_ENVELOPE = {
  id: '', type: 'text', name: null, layer: 0, start: 0, duration: 4,
  x: 0.5, y: 0.5, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1,
  crop: null, keyframes: [], keyframe_mode: 'spring', enter: null, exit: null,
  src: null, source_start: 0, speed: 1, props: {},
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export class Clip {
  constructor(data = {}) {
    for (const [k, def] of Object.entries(CLIP_ENVELOPE)) this[k] = clone(data[k] ?? def);
  }
  end() { return this.start + this.duration; }
  get def() { return registry.get(this.type); }
  get kind() { return this.def?.kind ?? 'component'; }
  get visual() { return this.def?.visual !== false; }
  label() {
    const d = this.def;
    if (d?.label && typeof d.label === 'function') return d.label(this);
    return this.name || d?.label || this.type;
  }
  toDict() {
    const out = {};
    for (const k of Object.keys(CLIP_ENVELOPE)) out[k] = clone(this[k]);
    return out;
  }
}

export const DEFAULT_SETTINGS = {
  width: 1920, height: 1080, fps: 30, bpm: 120, subdivision: 1, beat_offset: 0, beat_lock: true,
  duration: 24, background: 'paper', style_pack: 'neo-brutal',
};

export class Project {
  constructor(d = {}) {
    this.schema = 'vidkit.project';
    this.version = 1;
    this.name = d.name ?? 'untitled';
    this.settings = { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) };
    this.tracks = clone(d.tracks ?? [{ index: 0, name: 'L1', hidden: false, muted: false, locked: false }]);
    this.clips = (d.clips ?? []).map((c) => new Clip(c));
    this.audio = clone(d.audio ?? { music: { preset: 'brutal-bounce', seed: 7, gain_db: -2, end_hit: true }, auto_sfx: true, sfx_gain_db: 0, target_lufs: -14, cues: [] });
    this.meta = clone(d.meta ?? {});
  }
  get duration() { return this.settings.duration; }
  set duration(v) { this.settings.duration = v; }
  get fps() { return this.settings.fps; }
  track(layer) {
    let t = this.tracks.find((x) => x.index === layer);
    if (!t) { t = { index: layer, name: `L${layer + 1}`, hidden: false, muted: false, locked: false }; this.tracks.push(t); this.tracks.sort((a, b) => a.index - b.index); }
    return t;
  }
  isLayerHidden(layer) { return !!this.tracks.find((t) => t.index === (layer ?? 0))?.hidden; }
  setLayerHidden(layer, hidden) { this.track(layer).hidden = !!hidden; }
  toggleLayerHidden(layer) { this.setLayerHidden(layer, !this.isLayerHidden(layer)); return this.isLayerHidden(layer); }
  toDict() {
    const used = new Set(this.clips.map((c) => c.layer));
    return {
      schema: 'vidkit.project', version: 1, name: this.name,
      settings: clone(this.settings),
      tracks: this.tracks.filter((t) => used.has(t.index) || t.hidden || t.name),
      clips: this.clips.map((c) => c.toDict()),
      audio: clone(this.audio), meta: clone(this.meta),
    };
  }
}

export function genId(prefix = 'c') {
  // Deterministic enough for ids (not used in rendering); no Math.random in renderer code.
  genId.n = (genId.n ?? 0) + 1;
  return `${prefix}${Date.now().toString(36).slice(-5)}${genId.n.toString(36)}`;
}

/** New clip of a registry type with that type's default props and duration. */
export function newClip(type, start = 0, extra = {}) {
  const def = registry.get(type);
  const props = registry.defaults(type);
  const base = { id: genId(type.startsWith('scene.') ? 's' : 'c'), type, start, duration: def?.duration ?? 4, props };
  if (def?.kind === 'scene') Object.assign(base, { x: 0.5, y: 0.5 });
  else if (type === 'text') Object.assign(base, { x: 0.08, y: 0.3 });
  return new Clip({ ...base, ...extra });
}

// True when some other clip's [start, end) shares any time with `clip`'s.
export function hasOverlappingClip(clips, clip) {
  return clips.some((c) => c !== clip && c.start < clip.end() && c.end() > clip.start);
}

// Bring to Front / Forward / Backward / Back — pure layer permutation among the
// clips that time-overlap `clip` (kept from vidkit; lower layer draws on top).
export function computeLayerReorder(clips, clip, direction) {
  const group = clips
    .filter((c) => c.start < clip.end() && c.end() > clip.start)
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  if (group.length < 2) return null;
  const idx = group.indexOf(clip);
  const layers = group.map((c) => c.layer ?? 0);
  const newIdx =
    direction === 'front' ? 0 :
    direction === 'back' ? group.length - 1 :
    direction === 'forward' ? Math.max(0, idx - 1) :
    Math.min(group.length - 1, idx + 1);
  if (newIdx === idx) return null;
  const reordered = group.slice();
  reordered.splice(idx, 1);
  reordered.splice(newIdx, 0, clip);
  return reordered.map((c, i) => ({ id: c.id, layer: layers[i] }));
}
