// assets.js — fonts, images, icons and video frames for the renderer.
// Loading is async and happens in load()/prepare(); drawing only reads what is
// already decoded, so renderFrame() stays synchronous and pure. Missing assets
// are hard errors (they throw), never silently skipped.

let BASE = '/';
const IMAGES = new Map();   // url -> { img, error }
const ICONS = new Map();    // name -> Path2D[]
const VFRAMES = new Map();  // key -> ImageBitmap/HTMLImageElement
const VIDEOS = new Map();   // url -> HTMLVideoElement (preview mode only)
const MAX_VFRAMES = 240;

export function setBase(b) { BASE = b.endsWith('/') ? b : b + '/'; }
export function base() { return BASE; }

/** Project-relative or absolute path → URL under the asset base. */
export function url(path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return BASE + String(path).replace(/^\/+/, '');
}

export async function loadFonts(tokens) {
  if (typeof FontFace === 'undefined') return [];
  const loaded = [];
  for (const [role, f] of Object.entries(tokens.fonts ?? {})) {
    const desc = {};
    if (f.weight) desc.weight = f.weight;
    if (f.style) desc.style = f.style;
    if (f.stretch) desc.stretch = f.stretch;
    const face = new FontFace(f.family, `url("${url(f.file)}")`, desc);
    try {
      await face.load();
    } catch (e) {
      throw new Error(`font missing: ${f.family} (${role}) from ${f.file}`);
    }
    document.fonts.add(face);
    loaded.push(f.family);
  }
  await document.fonts.ready;
  for (const [role, f] of Object.entries(tokens.fonts ?? {})) {
    const w = String(f.weight ?? '400').split(' ')[0];
    const spec = `${f.style ?? 'normal'} ${w} 16px "${f.family}"`;
    // A page may also declare the family in CSS (the editor does); load() pulls
    // in every matching face so check() is not failed by an idle CSS duplicate.
    await document.fonts.load(spec).catch(() => {});
    if (!document.fonts.check(spec)) {
      throw new Error(`font not usable after load: ${f.family} (${role})`);
    }
  }
  return loaded;
}

/** One extra font file (style packs): registers `family` and waits until it is usable. */
export async function loadFontFile(family, path, desc = {}) {
  if (typeof FontFace === 'undefined') return null;
  const face = new FontFace(family, `url("${url(path)}")`, desc);
  try { await face.load(); } catch { throw new Error(`font missing: ${family} from ${path}`); }
  document.fonts.add(face);
  return face;
}

// ── Variable-font width ───────────────────────────────────────────────────────
// Canvas only accepts keyword font-stretch values (7 steps). A FontFace whose
// `stretch` descriptor is a single percentage is rendered at that wdth (the
// requested value is clamped into the descriptor range), so one face per
// whole-percent step gives continuous width animation from a single file.

const WIDTHS = new Map();   // family -> { min, max, step }

export async function loadWidthInstances(family, path, o = {}) {
  if (typeof FontFace === 'undefined' || WIDTHS.has(family)) return;
  const min = o.min ?? 62, max = o.max ?? 125, step = o.step ?? 1;
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`font missing: ${family} from ${path}`);
  const buf = await res.arrayBuffer();
  const faces = [];
  for (let w = min; w <= max + 1e-9; w += step) {
    const face = new FontFace(`${family}@w${Math.round(w)}`, buf, { weight: o.weight ?? '100 900', stretch: `${Math.round(w)}%`, ...(o.style ? { style: o.style } : {}) });
    faces.push(face.load().then((f) => document.fonts.add(f)));
  }
  await Promise.all(faces);
  WIDTHS.set(family, { min, max, step });
}

/** Family name rendering `family` at width `wdth` (% of normal); the base family when no instances are loaded. */
export function widthFamily(family, wdth) {
  const r = WIDTHS.get(family);
  if (!r) return family;
  const w = Math.max(r.min, Math.min(r.max, r.min + Math.round((wdth - r.min) / r.step) * r.step));
  return `${family}@w${Math.round(w)}`;
}

export async function loadImage(path) {
  const u = url(path);
  if (!u) return null;
  if (IMAGES.has(u)) {
    const e = IMAGES.get(u);
    if (e.error) throw e.error;
    return e.img;
  }
  const img = new Image();
  img.decoding = 'sync';
  img.src = u;
  try {
    await img.decode();
  } catch {
    const error = new Error(`asset missing or undecodable: ${path}`);
    IMAGES.set(u, { img: null, error });
    throw error;
  }
  IMAGES.set(u, { img, error: null });
  return img;
}

export function getImage(path) {
  const e = IMAGES.get(url(path));
  return e?.img ?? null;
}

export async function loadIcons(names) {
  const todo = [...new Set(names)].filter((n) => !ICONS.has(n));
  await Promise.all(todo.map(async (n) => {
    const res = await fetch(url(`assets/icons/phosphor-bold/${n}.svg`));
    if (!res.ok) throw new Error(`icon missing: ${n}`);
    const svg = await res.text();
    const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
    ICONS.set(n, ds.map((d) => new Path2D(d)));
  }));
}

export function getIconPaths(name) { return ICONS.get(name) ?? null; }

// ── Video ─────────────────────────────────────────────────────────────────────
// 'exact' mode (export, and paused scrubbing in the editor): frames come from
// the server's /api/vframe, decoded by ffmpeg at the project frame rate, so a
// given t always yields the same pixels. 'live' mode (editor playback): an
// HTMLVideoElement the editor keeps in sync.

export function vframeUrl(src, sourceTime, fps) {
  const frame = Math.max(0, Math.round(sourceTime * fps));
  return url(`api/vframe?src=${encodeURIComponent(src)}&fps=${fps}&frame=${frame}`);
}

const LAST = new Map();       // src -> last decoded frame (editor fallback while the exact one loads)

export async function loadVideoFrame(src, sourceTime, fps) {
  const u = vframeUrl(src, sourceTime, fps);
  if (VFRAMES.has(u)) return VFRAMES.get(u);
  const img = new Image();
  img.src = u;
  try { await img.decode(); } catch { throw new Error(`video frame unavailable: ${src} @ ${sourceTime.toFixed(3)}s`); }
  if (VFRAMES.size >= MAX_VFRAMES) VFRAMES.delete(VFRAMES.keys().next().value);
  VFRAMES.set(u, img);
  LAST.set(src, img);
  return img;
}

/** Exact frame; with `fallback` (editor only) the last decoded frame of that source. */
export function getVideoFrame(src, sourceTime, fps, fallback = false) {
  return VFRAMES.get(vframeUrl(src, sourceTime, fps)) ?? (fallback ? LAST.get(src) ?? null : null);
}

export function liveVideo(src) {
  const u = url(src);
  if (!VIDEOS.has(u)) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = u;
    VIDEOS.set(u, v);
  }
  return VIDEOS.get(u);
}
