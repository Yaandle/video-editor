// styles.js — loads style packs from styles/<id>/ on demand.
//
// A pack's index.js imports the renderer through the "#renderer/" specifier
// (an import map in every HTML page, package.json "imports" under Node), so
// the pack shares this registry instance. Loading = import the module,
// register its default export, then run its async load() for shaders,
// textures and fonts. Nothing outside the pack folder lists packs.

import * as registry from './registry.js';
import * as assets from './assets.js';
import { loadShader } from './gl.js';

const LOADING = new Map();   // id -> Promise

/** API handed to pack.load(): everything resolves inside the pack folder. */
function loadApi(id) {
  const base = `styles/${id}/`;
  return {
    id,
    url: (p) => assets.url(base + p),
    text: async (p) => {
      const res = await fetch(assets.url(base + p));
      if (!res.ok) throw new Error(`style ${id}: missing ${p}`);
      return res.text();
    },
    shader: (name) => loadShader(assets.url(`${base}shaders/${name}`)),
    image: (p) => assets.loadImage(base + p),
    font: (family, p, desc) => assets.loadFontFile(family, base + p, desc),
  };
}

export function loadPack(id) {
  if (!id || id === registry.DEFAULT_STYLE) return Promise.resolve(registry.stylePack(id));
  if (!LOADING.has(id)) {
    LOADING.set(id, (async () => {
      let mod;
      try {
        mod = await import(assets.url(`styles/${id}/index.js`));
      } catch (e) {
        throw new Error(`style pack "${id}" could not be loaded: ${e.message}`);
      }
      const pack = registry.hasStylePack(id) ? registry.stylePack(id) : registry.registerStylePack(mod.default);
      if (pack.load && typeof document !== 'undefined') await pack.load(loadApi(id));
      return pack;
    })());
  }
  return LOADING.get(id);
}

/** Load every pack a project refers to (project style, clip styles, pack components). */
export async function loadPacksFor(project) {
  await Promise.all(registry.stylesUsed(project).map(loadPack));
}

/** Editor: the list of installed packs (folders with an index.js), from the server. */
export async function installedPacks() {
  const res = await fetch(assets.url('api/styles'));
  if (!res.ok) return [];
  return res.json();
}
