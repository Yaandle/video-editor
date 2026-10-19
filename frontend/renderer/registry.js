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
//   label(clip) -> string              // timeline label
// }

const TYPES = new Map();
const PACKS = new Map();
const PASSES = new Map();

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
    type: d.type, kind: d.kind, label: d.label ?? d.type, category: d.category,
    description: d.description ?? '', duration: d.duration, llm: d.llm !== false,
    props: jsonSchema(d.type),
  }));
}

// ── Style packs + pass pipeline ───────────────────────────────────────────────
// A style pack = { id, label, tokens?: partial tokens override, passes: [{ id, params }],
//                  sound?: profile name for studio/audio }. Passes are pure functions
// (srcCanvas, dstCtx, t, params, env) => void, run in order after the scene draw.

export function registerStylePack(pack) { PACKS.set(pack.id, { passes: [], ...pack }); }
export const stylePack = (id) => PACKS.get(id) ?? PACKS.get('neo-brutal') ?? null;
export const stylePacks = () => [...PACKS.values()];

export function registerPass(id, fn) { PASSES.set(id, fn); }
export const pass = (id) => PASSES.get(id) ?? null;

// The identity pass and default pack ship with the core so the pipeline is always exercised.
registerPass('identity', (src, dst) => { dst.drawImage(src, 0, 0); });
registerStylePack({ id: 'neo-brutal', label: 'Neo-brutal', passes: [{ id: 'identity', params: {} }], sound: 'neo-brutal' });
