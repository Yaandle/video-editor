// gl.js — the WebGL2 post-process pipeline shared by every style pack.
//
//   const out = runPasses(srcCanvas, [
//     { frag: HALFTONE, uniforms: { u_cell: 12, u_angle: 0.785 } },
//     { frag: GRAIN, textures: { u_paper: img } },
//   ], { width, height, t, unit });
//   ctx.drawImage(out, ...);
//
// A pass is a fragment shader over the whole target. It always gets:
//   u_src   the previous pass's output (the source canvas for the first pass)
//   u_orig  the untouched source
//   u_res   target size in px, u_t time in s, u_unit (1 at 1080 px short side)
// plus its own uniforms and textures. Uniforms are plain numbers/arrays that the
// pack computes from t — no state is kept between frames, so a frame rendered
// alone gives the same pixels as the same frame mid-sequence.
//
// The shared GLSL prelude (PRELUDE) has an integer hash identical to prng.js,
// value noise, and pix() for top-left pixel coordinates anchored in screen space
// (patterns never swim with content).

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform vec2 u_res;
uniform float u_t;
uniform float u_unit;

// lowbias32 — same constants as prng.js mix32.
uint mix32(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16; return x;
}
uint hash3(uint a, uint b, uint c) { return mix32(mix32(mix32(a ^ 0x9e3779b9u) ^ b) ^ c); }
float rand3(uint a, uint b, uint c) { return float(hash3(a, b, c)) / 4294967296.0; }
// Random in [0,1) for an integer pixel/cell and a seed.
float cellRand(ivec2 cell, uint seed) { return rand3(uint(cell.x + 32768), uint(cell.y + 32768), seed); }
float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cellRand(ivec2(i), seed), b = cellRand(ivec2(i) + ivec2(1, 0), seed);
  float c = cellRand(ivec2(i) + ivec2(0, 1), seed), d = cellRand(ivec2(i) + ivec2(1, 1), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, uint seed) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p, seed + uint(i) * 101u); p *= 2.03; a *= 0.5; }
  return s;
}
// Top-left-origin pixel coordinate of this fragment (screen-anchored).
vec2 pix() { return vec2(v_uv.x, 1.0 - v_uv.y) * u_res; }
// Sample a texture by top-left pixel coordinate.
vec4 at(sampler2D s, vec2 p) { return texture(s, vec2(p.x, u_res.y - p.y) / u_res); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hex(float h) { return vec3(floor(h / 65536.0), mod(floor(h / 256.0), 256.0), mod(h, 256.0)) / 255.0; }
`;

let G = null;   // { canvas, gl, programs, quad, targets: [tex, fbo, w, h]×2, statics }

export function glSupported() {
  try { return !!getPipeline(); } catch { return false; }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

function getPipeline() {
  if (G) return G;
  const canvas = makeCanvas(16, 16);
  if (!canvas) throw new Error('WebGL2 unavailable: no canvas in this environment');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
  if (!gl) throw new Error('WebGL2 unavailable (run doctor.bat to pick working GL flags)');
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  G = { canvas, gl, quad, programs: new Map(), targets: [], statics: new WeakMap(), dyn: [] };
  return G;
}

/** Renderer string of the active GL backend (for reports and the render cache key). */
export function glInfo() {
  const { gl } = getPipeline();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile failed: ${log}`);
  }
  return s;
}

function program(frag) {
  const g = getPipeline();
  const hit = g.programs.get(frag);
  if (hit) return hit;
  const { gl } = g;
  const src = frag.startsWith('#version') ? frag : PRELUDE + frag;
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, src));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = new Map();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms.set(info.name.replace(/\[0\]$/, ''), { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size });
  }
  const entry = { p, uniforms };
  g.programs.set(frag, entry);
  return entry;
}

// Creating or uploading a texture binds it; do that on a scratch unit so it can
// never replace a texture a pass has already bound for sampling.
const SCRATCH_UNIT = 15;

function newTexture(gl, filter) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function upload(gl, tex, source, filter, repeat = false) {
  gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/** Texture for an input: images/bitmaps and `{ src, static: true }` upload once; canvases every run. */
function inputTexture(g, spec, slot) {
  const { gl } = g;
  const src = spec?.src ?? spec;
  const filter = spec?.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  const isStatic = spec?.static || (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap);
  if (isStatic) {
    let t = g.statics.get(src);
    if (!t) { t = newTexture(gl, filter); upload(gl, t, src, filter, !!spec?.repeat); g.statics.set(src, t); }
    return t;
  }
  if (!g.dyn[slot]) g.dyn[slot] = newTexture(gl, filter);
  upload(gl, g.dyn[slot], src, filter, !!spec?.repeat);
  return g.dyn[slot];
}

function target(g, i, w, h) {
  const { gl } = g;
  let tg = g.targets[i];
  if (!tg || tg.w !== w || tg.h !== h) {
    if (tg) { gl.deleteTexture(tg.tex); gl.deleteFramebuffer(tg.fbo); }
    const tex = newTexture(gl, gl.LINEAR);   // leaves `tex` bound on the scratch unit
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    tg = g.targets[i] = { tex, fbo, w, h };
  }
  return tg;
}

function setUniform(gl, u, v) {
  if (!u) return;
  const T = gl;
  if (typeof v === 'boolean') v = v ? 1 : 0;
  switch (u.type) {
    case T.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
    case T.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
    case T.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
    case T.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
    case T.INT: case T.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
    case T.UNSIGNED_INT: gl.uniform1ui(u.loc, v >>> 0); break;
    case T.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
    default: break;
  }
}

/**
 * Run `passes` over `src` (a canvas the size of the target). Returns the GL
 * canvas holding the result, valid until the next runPasses call — draw it
 * immediately. Pass options: frag, uniforms, textures, filter ('linear' |
 * 'nearest' for sampling u_src), size: {w, h} to render that pass smaller
 * (e.g. one texel per ASCII cell); later passes sample it scaled.
 */
export function runPasses(src, passes, opts = {}) {
  const g = getPipeline();
  const { gl } = g;
  const W = opts.width ?? src.width, H = opts.height ?? src.height;
  if (g.canvas.width !== W || g.canvas.height !== H) { g.canvas.width = W; g.canvas.height = H; }
  const orig = inputTexture(g, { src, filter: opts.filter ?? 'linear' }, 0);
  let prev = orig, prevW = W, prevH = H;
  gl.bindBuffer(gl.ARRAY_BUFFER, g.quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  passes.forEach((pass, i) => {
    const last = i === passes.length - 1;
    const w = last ? W : Math.max(1, Math.round(pass.size?.w ?? W)), h = last ? H : Math.max(1, Math.round(pass.size?.h ?? H));
    const { p, uniforms } = program(pass.frag);
    gl.useProgram(p);
    let tg = null;
    if (last) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else { tg = target(g, i % 2, w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fbo); }
    gl.viewport(0, 0, w, h);
    let unit = 0;
    const bind = (name, tex, filter) => {
      const u = uniforms.get(name);
      if (!u) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (filter) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      }
      gl.uniform1i(u.loc, unit++);
    };
    const srcFilter = pass.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    // Upload every extra input first (on the scratch unit), then bind them all.
    const extra = Object.entries(pass.textures ?? {}).map(([name, spec], k) => [name, inputTexture(g, spec, 1 + k)]);
    bind('u_src', prev, srcFilter);
    bind('u_orig', orig, srcFilter);
    for (const [name, tex] of extra) bind(name, tex, null);
    setUniform(gl, uniforms.get('u_res'), [w, h]);
    setUniform(gl, uniforms.get('u_srcres'), [prevW, prevH]);
    setUniform(gl, uniforms.get('u_t'), opts.t ?? 0);
    setUniform(gl, uniforms.get('u_unit'), opts.unit ?? Math.min(W, H) / 1080);
    for (const [name, v] of Object.entries(pass.uniforms ?? {})) setUniform(gl, uniforms.get(name), v);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!last) { prev = tg.tex; prevW = w; prevH = h; }
  });
  const err = gl.getError();
  if (err !== gl.NO_ERROR) throw new Error(`WebGL error 0x${err.toString(16)} in style pass`);
  return g.canvas;
}

/** Load a GLSL file (pack shaders/) as text. */
export async function loadShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`shader missing: ${url}`);
  return res.text();
}
