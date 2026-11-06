// registry.js — plugin registry for clip types (components + scenes), style
// packs and post-process passes. Adding a new scene type = one file that calls
// register({...}) plus one import line in renderer/index.js.
//
// A definition:
// {
//   type: 'scene.title-slam',          // unique id stored in clip.type
//   kind: 'scene' | 'component',       // scenes are full-frame compositions
//   label, category, description,      // editor + LLM catalogue text
//   duration: 4,                       // default seconds when added
//   schema: { prop: { type, default, label, ... } },   // drives validation, editor UI, JSON Schema
//   visual: true,                      // false for audio-only clips
//   render(ctx, clip, lt, env),        // draw at clip-local time lt (pure)
//   events(clip, env) -> [{ t, kind: 'cue'|'hit'|'motion', ... }],   // pure, DOM-free
//   clipLabel(clip) -> string          // timeline label (label is the type name)
// }

const TYPES = new Map();
const PACKS = new Map();

const PROP_TYPES = new Set(['text', 'number', 'bool', 'enum', 'color', 'asset', 'list', 'object']);

export function register(def) {
  if (!def || !def.type) throw new Error('register(): missing type');
  if (TYPES.has(def.type)) throw new Error(`register(): duplicate type ${def.type}`);
  if (def.visual !== false && typeof def.render !== 'function') throw new Error(`register(${def.type}): render() required`);
  for (const [k, s] of Object.entries(def.schema ?? {})) {
    if (!PROP_TYPES.has(s.type)) throw new Error(`register(${def.type}): prop ${k} has unknown type ${s.type}`);
  }
  TYPES.set(def.type, { kind: 'component', visual: true, duration: 4, category: 'Other', schema: {}, ...def });
  return def;
}

export const get = (type) => TYPES.get(type) ?? null;
export const all = () => [...TYPES.values()];
export const has = (type) => TYPES.has(type);

export function defaults(type) {
  const def = get(type);
  const out = {};
  for (const [k, s] of Object.entries(def?.schema ?? {})) {
    out[k] = structuredCloneSafe(s.default);
  }
  return out;
}

function structuredCloneSafe(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Props merged over defaults, with type errors collected (never thrown mid-render). */
export function resolveProps(type, props) {
  const def = get(type);
  const errors = [];
  if (!def) return { value: { ...(props ?? {}) }, errors: [`unknown clip type "${type}"`] };
  const value = defaults(type);
  for (const [k, v] of Object.entries(props ?? {})) {
    const s = def.schema[k];
    if (!s) { errors.push(`${type}: unknown prop "${k}"`); continue; }
    const err = checkProp(s, v);
    if (err) errors.push(`${type}.${k}: ${err}`);
    else value[k] = v;
  }
  return { value, errors };
}

function checkProp(s, v) {
  if (v === null || v === undefined) return s.nullable ? null : 'is required';
  switch (s.type) {
    case 'text': case 'color': case 'asset':
      if (typeof v !== 'string') return 'must be a string';
      if (s.maxLength && v.length > s.maxLength) return `longer than ${s.maxLength}`;
      return null;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
      if (s.min !== undefined && v < s.min) return `below ${s.min}`;
      if (s.max !== undefined && v > s.max) return `above ${s.max}`;
      return null;
    case 'bool': return typeof v === 'boolean' ? null : 'must be true/false';
    case 'enum': return s.options.includes(v) ? null : `must be one of ${s.options.join(', ')}`;
    case 'list': return Array.isArray(v) ? null : 'must be a list';
    case 'object': return typeof v === 'object' ? null : 'must be an object';
  }
  return null;
}

/** JSON Schema for a type's props — exported to Python (schema checks) and the LLM. */
export function jsonSchema(type) {
  const def = get(type);
  const properties = {};
  for (const [k, s] of Object.entries(def?.schema ?? {})) {
    const base = { description: s.label ?? k };
    switch (s.type) {
      case 'text': properties[k] = { ...base, type: 'string', ...(s.maxLength ? { maxLength: s.maxLength } : {}) }; break;
      case 'color': properties[k] = { ...base, type: 'string' }; break;
      case 'asset': properties[k] = { ...base, type: 'string' }; break;
      case 'number': properties[k] = { ...base, type: 'number', ...(s.min !== undefined ? { minimum: s.min } : {}), ...(s.max !== undefined ? { maximum: s.max } : {}) }; break;
      case 'bool': properties[k] = { ...base, type: 'boolean' }; break;
      case 'enum': properties[k] = { ...base, enum: s.options }; break;
      case 'list': properties[k] = { ...base, type: 'array', items: { type: s.of === 'number' ? 'number' : s.of === 'object' ? 'object' : 'string' }, ...(s.maxItems ? { maxItems: s.maxItems } : {}) }; break;
      case 'object': properties[k] = { ...base, type: 'object' }; break;
    }
  }
  return { type: 'object', additionalProperties: false, properties };
}

/** Catalogue for the editor's Add menu and the LLM storyboard prompt. */
export function catalogue() {
  return all().map((d) => ({
    type: d.type, kind: d.kind, label: d.label ?? d.type, category: d.category, pack: d.pack ?? null,
    description: d.description ?? '', duration: d.duration, llm: d.llm !== false,
    props: jsonSchema(d.type),
  }));
}

// ── Style packs ───────────────────────────────────────────────────────────────
// A style pack is one folder, styles/<id>/, whose index.js default-exports:
//   { id, label, description, tokens,            // tokens.json (palette, type, springs, sfx, music)
//     schema,                                    // style_params the pack accepts (same prop types as clips)
//     overrides: { [clipType]: render },          // re-skin existing components in this look
//     eventOverrides: { [clipType]: events },      // …and their timing/sounds when the look changes them
//     treatment: {                               // how any content is rendered in this look
//       native(params, frame) -> { w, h } | null,  // low-res native buffer (pixel art, ASCII…)
//       holdFrames,                              // animate on twos (paper cutout)
//       perClip,                                 // as the project style, still one layer per clip
//       transform(params, env) -> { dx, dy, rot, scale },   // transformAll: also on the pack's own types
//       cpu(canvas, params, env),                // in-place CPU pass (palette quantize)
//       passes(params, env) -> [GL passes],      // gl.js runPasses
//       blend,                                   // composite op for the finished layer
//       animating(params, env) -> bool,          // the treatment itself is moving (reveals, jolts)
//     },
//     load(api) }                                // async: shaders, textures, fonts (browser only)
// Pack components register themselves with types "<id>.<name>".
// The loader (styles.js) imports the folder on demand, so adding a pack touches nothing else.

export const DEFAULT_STYLE = 'neo-brutal';
export const MAX_PACKS_PER_SCENE = 2;

export function registerStylePack(pack) {
  if (!pack?.id) throw new Error('registerStylePack(): missing id');
  for (const [k, s] of Object.entries(pack.schema ?? {})) {
    if (!PROP_TYPES.has(s.type)) throw new Error(`style ${pack.id}: param ${k} has unknown type ${s.type}`);
  }
  const full = { label: pack.id, description: '', schema: {}, overrides: {}, eventOverrides: {}, treatment: null, tokens: {}, ...pack };
  PACKS.set(pack.id, full);
  return full;
}
export const stylePack = (id) => PACKS.get(id ?? DEFAULT_STYLE) ?? null;
export const stylePacks = () => [...PACKS.values()];
export const hasStylePack = (id) => PACKS.has(id);

/** Pack params: pack schema defaults ← overrides, type-checked like clip props. */
export function styleParams(id, params) {
  const pack = stylePack(id);
  const value = {}, errors = [];
  if (!pack) return { value, errors: [`unknown style "${id}"`] };
  for (const [k, s] of Object.entries(pack.schema)) value[k] = structuredCloneSafe(s.default);
  for (const [k, v] of Object.entries(params ?? {})) {
    const s = pack.schema[k];
    if (!s) { errors.push(`style ${id}: unknown param "${k}"`); continue; }
    const err = checkProp(s, v);
    if (err) errors.push(`style ${id}.${k}: ${err}`); else value[k] = v;
  }
  return { value, errors };
}

/** The pack a clip is drawn in: its own `style`, else the project's. (A clip styled with
 *  DEFAULT_STYLE under a pixel-treated project look is drawn on top, untreated.) */
export function clipStyle(clip, settings) {
  return clip.style ?? settings?.style ?? DEFAULT_STYLE;
}

/** Pack ids a project needs: project style, clip styles, and "<pack>.<name>" clip types. */
export function stylesUsed(project) {
  const ids = new Set();
  const s = project.settings ?? {};
  if (s.style) ids.add(s.style);
  for (const c of project.clips ?? []) {
    if (c.style) ids.add(c.style);
    const prefix = String(c.type).split('.')[0];
    if (prefix !== 'scene' && String(c.type).includes('.')) ids.add(prefix);
  }
  ids.delete(DEFAULT_STYLE);
  return [...ids];
}

/**
 * At most MAX_PACKS_PER_SCENE distinct non-default looks may be on screen at
 * once (project style + clip styles + pack components). Checked at every
 * moment a clip starts, which is where the set can grow.
 */
export function checkStyles(project) {
  const errors = [];
  const s = project.settings ?? {};
  const clips = project.clips ?? [];
  const lookOf = (c) => {
    if (c.style) return c.style;
    const prefix = String(c.type).split('.')[0];
    return prefix !== 'scene' && String(c.type).includes('.') ? prefix : null;
  };
  for (const t of [...new Set(clips.map((c) => c.start))]) {
    const looks = new Set(s.style && s.style !== DEFAULT_STYLE ? [s.style] : []);
    for (const c of clips) {
      if (c.start <= t + 1e-9 && t < c.start + c.duration - 1e-9) {
        const l = lookOf(c);
        if (l && l !== DEFAULT_STYLE) looks.add(l);
      }
    }
    if (looks.size > MAX_PACKS_PER_SCENE) {
      errors.push(`at ${t.toFixed(2)} s ${looks.size} style packs are on screen (${[...looks].join(', ')}); the limit is ${MAX_PACKS_PER_SCENE} per scene`);
    }
  }
  for (const id of new Set(clips.map((c) => c.style).filter(Boolean).concat(s.style ? [s.style] : []))) {
    if (!PACKS.has(id)) errors.push(`unknown style "${id}"`);
  }
  for (const c of clips) {
    if (c.style_params && Object.keys(c.style_params).length) {
      errors.push(...styleParams(clipStyle(c, s), c.style_params).errors.map((m) => `clip ${c.id}: ${m}`));
    }
  }
  if (s.style_params && Object.keys(s.style_params).length) errors.push(...styleParams(s.style, s.style_params).errors);
  return [...new Set(errors)];
}

// The default look ships with the core: no treatment, the neo-brutal tokens as they are.
registerStylePack({ id: DEFAULT_STYLE, label: 'Neo-brutal', description: 'Flat fills, thick ink borders, hard offset shadows.' });
