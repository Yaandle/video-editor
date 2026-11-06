// Kinetic typography — words land one by one on the beat grid, each with its
// own springs for position, scale and the two variable-font axes (weight and
// width), glyphs staggered inside the word. Lines are fitted to the type frame
// at oversized scale, so line length sets size and the hierarchy comes from
// the copy itself. Modes: stack (fitted lines, paged), path (text on a curve)
// and caption (timestamped words snapped to the grid).
//
// Re-skins `text` clips (any text styled "kinetic" lands per word) and gives
// any other content a beat punch (scale hit on every beat, a tilt per bar).

import { register } from '#renderer/registry.js';
import { color } from '#renderer/tokens.js';
import { sp, fade, lerp, clamp01, arrivalFrames, peak, settle, exitProgress } from '#renderer/motion.js';
import { fontString, measureRun, fitSize, pathFor, pointAt, drawGlyphRun } from '#renderer/glyphs.js';
import { loadWidthInstances } from '#renderer/assets.js';
import { parseRich, plain } from '#renderer/text.js';
import { srand } from '#renderer/prng.js';
import tokens from './tokens.json' with { type: 'json' };

const T = tokens.type;
const ID = 'kinetic';
const GLYPH_STAGGER = 0.014;   // s between glyphs inside a word
const PAGE_LEAVE = 0.3;        // s a page takes to clear before the next lands
const MAX_LINES = 4;           // lines fitted onto one page before the copy pages

// ── Copy → words ─────────────────────────────────────────────────────────────

/** Lines of words; [[word]] = slab highlight, {{word}} = emphasis colour. */
export function parseLines(text) {
  const lines = [];
  for (const raw of String(text ?? '').split('\n')) {
    const words = [];
    for (const run of parseRich(raw)) {
      const glued = !/^\s/.test(run.text);
      run.text.split(/\s+/).filter(Boolean).forEach((w, i) => {
        // Punctuation right after markup ("{{beat}}.") belongs to the word before it.
        if (i === 0 && glued && words.length && /^[^\p{L}\p{N}]+$/u.test(w)) { words[words.length - 1].text += w; return; }
        words.push({ text: w, slab: !!run.highlight, emph: !!run.accent || !!run.highlight });
      });
    }
    if (words.length) lines.push({ words });
  }
  return lines;
}

/** Caption words: "word@1.25 word@1.6 …" (seconds from clip start) or plain words spread one per step. */
export function parseCaptions(spec, fallbackText) {
  const items = String(spec ?? '').trim().split(/\s+/).filter(Boolean).map((tok) => {
    const m = tok.match(/^(.*)@([\d.]+)$/);
    return m ? { text: m[1], at: parseFloat(m[2]) } : { text: tok, at: null };
  });
  if (items.length) return items;
  return plain(fallbackText).split(/\s+/).filter(Boolean).map((t) => ({ text: t, at: null }));
}

// ── Beat schedule (shared by render and events) ──────────────────────────────

function stepOf(beat) { return beat?.valid ? beat.step : 0.5; }
function beatOf(beat) { return beat?.valid ? beat.beat : 0.5; }

/** Snap an absolute time to the nearest grid line at or after `min`. */
function onGrid(t, beat, min = -Infinity) {
  if (!beat?.valid) return Math.max(t, min);
  let k = Math.round((t - beat.offset) / beat.step);
  let g = beat.offset + k * beat.step;
  while (g < min - 1e-9) { k++; g = beat.offset + k * beat.step; }
  return g;
}

/**
 * Hit time of every word in reading order. Stack/path: word k lands
 * `start_beat + k × beats_per_word` beats after the clip start, snapped to the
 * grid. Caption: each word's timestamp snapped to the nearest grid line (never
 * two words on one line).
 */
export function schedule(clip, p, beat, fps, wordsFlat) {
  const lead = arrivalFrames(fps, tokens.springs.land) / fps;
  const B = beatOf(beat);
  const out = [];
  let prev = -Infinity;
  wordsFlat.forEach((w, k) => {
    let want;
    if (p.mode === 'caption' && w.at != null) want = clip.start + w.at;
    else want = clip.start + (p.start_beat + k * Number(p.beats_per_word)) * B;
    const hit = onGrid(want, beat, Math.max(clip.start + lead, prev + stepOf(beat) - 1e-9));
    prev = hit;
    out.push({ hit, start: hit - lead });
  });
  return out;
}

// ── Word animation ───────────────────────────────────────────────────────────

/** Axes, scale and offsets of a word e seconds after it starts moving. */
function wordState(e, emph, size, k, seed, id) {
  const restW = emph ? T.emphasis.weight : T.rest.weight;
  const restWd = emph ? T.emphasis.width : T.rest.width;
  const a = 1 - clamp01(sp(e, tokens.springs.axes, 'opacity'));      // 1 at the hit → 0 at rest
  return {
    weight: restW + (T.hit.weight - restW) * a * (emph ? 0.4 : 1),
    width: restWd + (T.hit.width - restWd) * a,
    scale: lerp(1.42, 1, sp(e, tokens.springs.land, 'scale')),
    dy: -size * 0.55 * (1 - sp(e, tokens.springs.land, 'position')),
    rot: srand(seed, id, 'tilt', k) * 0.09 * (1 - sp(e, tokens.springs.land, 'rotation')),
    alpha: fade(e * 3, 'snappy'),
  };
}

const faceOf = (w, size, weight, width) => fontString({ family: T.family, size, weight, width });

/** Rest layout of the stack: each line fitted to the box width; paged to the box height. */
function stackLayout(ctx, lines, box) {
  const restLines = lines.map((ln) => {
    const sp1 = measureRun(ctx, ' ', faceOf(null, 100, T.rest.weight, T.rest.width)).width;
    let wsum = 0;
    for (const w of ln.words) {
      const ax = w.emph ? T.emphasis : T.rest;
      w.ref = measureRun(ctx, w.text, faceOf(w, 100, ax.weight, ax.width), T.tracking).width;
      wsum += w.ref;
    }
    const ref = wsum + sp1 * (ln.words.length - 1);
    const capRef = measureRun(ctx, 'H', faceOf(null, 100, T.rest.weight, T.rest.width)).cap;
    const size = Math.min((box.w / ref) * 100, (box.h * 0.62) / (capRef / 100) / 100 * 100);
    return { ...ln, size, cap: (capRef / 100) * size, space: (sp1 / 100) * size };
  });
  // Up to MAX_LINES lines share one page: the whole stack scales down together to fit
  // the box height (line-to-line scale contrast is kept). Longer copy pages instead.
  const lineH = (ln) => ln.cap + ln.size * (T.leading - 0.72) + ln.size * 0.16;
  const total = restLines.reduce((a, ln) => a + lineH(ln), 0) - (restLines.at(-1)?.size ?? 0) * 0.16;
  if (restLines.length <= MAX_LINES && total > box.h) {
    const k = box.h / total;
    for (const ln of restLines) { ln.size *= k; ln.cap *= k; ln.space *= k; }
  }
  if (restLines.length <= MAX_LINES) return [restLines];
  const pages = [];
  let cur = [], h = 0;
  for (const ln of restLines) {
    const lh = ln.cap + ln.size * (T.leading - 0.72);
    if (cur.length && h + lh > box.h) { pages.push(cur); cur = []; h = 0; }
    cur.push(ln); h += lh + ln.size * 0.16;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function drawStack(ctx, clip, env, p) {
  const F = env.frame;
  const box = { x: p.box_x * F.w, y: p.box_y * F.h, w: p.box_w * F.w * (env.xf.sx ?? 1), h: p.box_h * F.h * (env.xf.sy ?? 1) };
  const lines = parseLines(p.text);
  if (!lines.length) return;
  const flat = lines.flatMap((l) => l.words);
  const sched = schedule(clip, p, env.beat, env.settings.fps, flat);
  flat.forEach((w, k) => { w.k = k; w.start = sched[k].start; w.hit = sched[k].hit; });
  const pages = stackLayout(ctx, lines, box);
  const ink = color(p.color), emphC = color(p.emphasis), slab = color(p.slab);
  const t = env.t;
  // Current page: the last page whose first word has started.
  let pi = 0;
  pages.forEach((pg, i) => { if (pg[0].words[0].start <= t) pi = i; });
  const draw = (pg, leaving) => {
    let y = box.y;
    for (const ln of pg) {
      const first = ln.words[0];
      if (first.start > t) break;
      // Dynamic reflow: each word's current advance at its current axes.
      const states = ln.words.map((w) => (t - w.start > 0 ? { w, s: wordState(t - w.start, w.emph, ln.size, w.k, env.seed, clip.id) } : { w, s: null }));
      const widths = states.map(({ w, s }) => {
        const ax = w.emph ? T.emphasis : T.rest;
        const font = s ? faceOf(w, ln.size, s.weight, s.width) : faceOf(w, ln.size, ax.weight, ax.width);
        return measureRun(ctx, w.text, font, T.tracking).width;
      });
      const lineW = widths.reduce((a, b) => a + b, 0) + ln.space * (ln.words.length - 1);
      let x = p.align === 'right' ? box.x + box.w - lineW : box.x;
      const base = y + ln.cap;
      let settledLine = true;
      states.forEach(({ w, s }, i) => {
        const ww = widths[i];
        if (s) {
          // Page turn: words leave upward in reading order as the next page's first word starts.
          const le = leaving ? t - leaving.at - (w.k - pg[0].words[0].k) * 0.012 : 0;
          const leave = le > 0 ? clamp01(sp(le, tokens.springs.exit, 'position')) : 0;
          const ex = exitProgress(env.lt, clip.duration, p.exit_len, 'quick', (flat.length - w.k) * 0.012);
          const out = Math.max(leave, ex);
          const font = faceOf(w, ln.size, s.weight, s.width);
          const run = measureRun(ctx, w.text, font, T.tracking);
          const cx = x + ww / 2;
          ctx.save();
          ctx.globalAlpha *= s.alpha * (1 - out);
          ctx.translate(cx - box.w * 0.5 * leave, base + s.dy + ln.size * 1.1 * Math.max(0, out - leave));
          ctx.rotate(s.rot);
          ctx.scale(s.scale, s.scale);
          if (w.slab) {
            const grow = clamp01(sp(t - w.start - 0.05, 'snappy', 'scale'));
            ctx.fillStyle = slab;
            ctx.fillRect(-ww / 2 - ln.size * 0.08, -ln.cap - ln.size * 0.1, (ww + ln.size * 0.16) * grow, ln.cap + ln.size * 0.2);
          }
          drawGlyphRun(ctx, run, -ww / 2, 0, font, (g, j) => {
            const ge = t - w.start - j * GLYPH_STAGGER;
            if (ge <= 0) return null;
            return { dy: -ln.size * 0.18 * (1 - sp(ge, 'snappy', 'position')), fill: w.slab ? color('ink') : w.emph ? emphC : ink };
          });
          ctx.restore();
          if (t - w.start < settle(tokens.springs.land)) settledLine = false;
          if (s.alpha < 1 || out > 0) settledLine = false;
        } else settledLine = false;
        x += ww + ln.space;
      });
      env.box({ kind: 'text', role: 'display', name: `line${ln.words[0].k}`, x: p.align === 'right' ? box.x + box.w - lineW : box.x, y, w: lineW, h: ln.cap,
        fg: ink, bg: color(env.settings.background), size: ln.size, text: ln.words.map((w) => w.text).join(' '), settled: settledLine && !leaving });
      y += ln.cap + ln.size * (T.leading - 0.72) + ln.size * 0.16;
    }
  };
  // A page leaves just before the next page's first word starts, so pages never overlap.
  const next = pages[pi + 1]?.[0].words[0].start ?? Infinity;
  draw(pages[pi], t > next - PAGE_LEAVE ? { at: next - PAGE_LEAVE } : null);
  if (t - flat[flat.length - 1].start < settle(tokens.springs.land) || env.lt > clip.duration - p.exit_len - 0.05) env.animating();
}

function drawPath(ctx, clip, env, p) {
  const F = env.frame;
  const box = { x: p.box_x * F.w, y: p.box_y * F.h, w: p.box_w * F.w, h: p.box_h * F.h };
  const lines = parseLines(p.text);
  const flat = lines.flatMap((l) => l.words);
  if (!flat.length) return;
  const sched = schedule(clip, p, env.beat, env.settings.fps, flat);
  const path = pathFor(p.path, box, { bend: 0.55, waves: 1.25, turns: 1.4 });
  const full = flat.map((w) => w.text).join(' ');
  // Glyph positions word by word, each at its own rest axes (emphasis is heavier and wider).
  const layoutAt = (size) => {
    const glyphs = [];
    let x = 0, i = 0;
    const space = measureRun(ctx, ' ', faceOf(null, size, T.rest.weight, T.rest.width)).width;
    flat.forEach((w, k) => {
      const ax = w.emph ? T.emphasis : T.rest;
      const r = measureRun(ctx, w.text, faceOf(w, size, ax.weight, ax.width), T.tracking);
      for (const g of r.glyphs) glyphs.push({ ch: g.ch, w: g.w, x: x + g.x, i: i++, k });
      x += r.width;
      if (k < flat.length - 1) { glyphs.push({ ch: ' ', w: space, x, i: i++, k }); x += space; }
    });
    return { glyphs, width: x };
  };
  const ref = layoutAt(100);
  const capRef = measureRun(ctx, 'H', faceOf(null, 100, T.rest.weight, T.rest.width)).cap;
  const size = Math.min((path.length * 0.94 / ref.width) * 100, (box.h * 0.42) / (capRef / 100));
  const run = layoutAt(size);
  const s0 = (path.length - run.width) * (p.align === 'right' ? 1 : 0.06);
  const owner = run.glyphs.map((g) => g.k);
  const ink = color(p.color), emphC = color(p.emphasis);
  const t = env.t;
  const ex = (k) => exitProgress(env.lt, clip.duration, p.exit_len, 'quick', (flat.length - k) * 0.012);
  let settledAll = true;
  for (const g of run.glyphs) {
    if (g.ch === ' ') continue;
    const k = owner[g.i] ?? 0;
    const w = flat[k];
    const firstGlyph = run.glyphs.findIndex((x) => owner[x.i] === k);
    const e = t - sched[k].start - (g.i - firstGlyph) * GLYPH_STAGGER;
    if (e <= 0) { settledAll = false; continue; }
    const st = wordState(e, w.emph, size, k, env.seed, clip.id);
    // Each glyph drops onto the path along its normal on its own spring.
    const pp = 1 - sp(e, tokens.springs.land, 'position');
    const base = pointAt(path, s0 + g.x + g.w / 2);
    const pt = { x: base.x + Math.sin(base.angle) * size * 0.9 * pp, y: base.y - Math.cos(base.angle) * size * 0.9 * pp, angle: base.angle };
    const out = ex(k);
    const font = faceOf(w, size, st.weight, st.width);
    ctx.save();
    ctx.globalAlpha *= st.alpha * (1 - out);
    ctx.translate(pt.x, pt.y + size * 1.4 * out);
    ctx.rotate(pt.angle);
    ctx.scale(st.scale * 0.9 + 0.1, st.scale * 0.9 + 0.1);
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = w.emph ? emphC : ink;
    ctx.fillText(g.ch, -g.w / 2, 0);
    ctx.restore();
    if (e < settle(tokens.springs.land) || out > 0) settledAll = false;
  }
  const r = pathBounds(path);
  env.box({ kind: 'text', role: 'display', name: 'path', x: r.x, y: r.y - size * 0.72, w: r.w, h: r.h + size * 0.72, fg: ink, bg: color(env.settings.background), size, text: full, settled: settledAll, gridBreak: true });
  if (!settledAll) env.animating();
}

function pathBounds(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of path.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function drawCaption(ctx, clip, env, p) {
  const F = env.frame;
  const box = { x: p.box_x * F.w, y: p.box_y * F.h, w: p.box_w * F.w, h: p.box_h * F.h };
  const words = parseCaptions(p.captions, p.text);
  if (!words.length) return;
  const sched = schedule(clip, { ...p, mode: 'caption' }, env.beat, env.settings.fps, words);
  // Chunks of up to `chunk` words (a line break in the copy also ends a chunk).
  const chunks = [];
  let cur = [];
  words.forEach((w, k) => { cur.push(k); if (cur.length >= p.chunk || /[.!?,;:]$/.test(w.text)) { chunks.push(cur); cur = []; } });
  if (cur.length) chunks.push(cur);
  const t = env.t;
  let ci = -1;
  chunks.forEach((c, i) => { if (sched[c[0]].start <= t) ci = i; });
  if (ci < 0) return;
  const chunk = chunks[ci];
  const text = chunk.map((k) => words[k].text).join(' ');
  const face = { family: T.family, weight: T.emphasis.weight, width: T.emphasis.width, tracking: T.tracking };
  const size = Math.min(fitSize(ctx, text, face, box.w), box.h * 0.9);
  const space = measureRun(ctx, ' ', faceOf(null, size, T.rest.weight, T.rest.width)).width;
  const ink = color(p.color), emphC = color(p.emphasis);
  let active = chunk[0];
  for (const k of chunk) if (sched[k].start <= t) active = k;
  let x = box.x;
  const base = box.y + box.h * 0.8;
  const next = chunks[ci + 1] ? sched[chunks[ci + 1][0]].start : Infinity;
  const leave = next < Infinity ? 0 : exitProgress(env.lt, clip.duration, p.exit_len, 'quick');
  let settled = true;
  for (const k of chunk) {
    const e = t - sched[k].start;
    const isActive = k === active;
    const st = e > 0 ? wordState(e, isActive, size, k, env.seed, clip.id) : null;
    const weight = st ? (isActive ? st.weight : T.rest.weight) : T.rest.weight;
    const width = st ? (isActive ? st.width : T.rest.width) : T.rest.width;
    const font = faceOf(null, size, weight, width);
    const run = measureRun(ctx, words[k].text, font, T.tracking);
    if (st) {
      ctx.save();
      ctx.globalAlpha *= st.alpha * (1 - leave);
      ctx.translate(x + run.width / 2, base + st.dy * 0.6 + size * leave);
      ctx.scale(st.scale, st.scale);
      drawGlyphRun(ctx, run, -run.width / 2, 0, font, () => ({ fill: isActive ? emphC : ink }));
      ctx.restore();
      if (e < settle(tokens.springs.land)) settled = false;
    } else settled = false;
    x += run.width + space;
  }
  env.box({ kind: 'text', role: 'display', name: `caption${ci}`, x: box.x, y: base - size * 0.72, w: x - space - box.x, h: size * 0.72, fg: ink, bg: color(env.settings.background), size, text, settled: settled && !leave });
  env.animating();
}

const SCHEMA = {
  text: { type: 'text', default: 'Every frame\nis a {{function}}\nof time.', label: 'Copy (lines; {{emphasis}}, [[slab]])', multiline: true, maxLength: 400 },
  mode: { type: 'enum', options: ['stack', 'path', 'caption'], default: 'stack', label: 'Mode' },
  path: { type: 'enum', options: ['arc', 'wave', 'circle', 'spiral', 'line'], default: 'arc', label: 'Path (path mode)' },
  captions: { type: 'text', default: '', label: 'Caption timing (word@seconds …)', multiline: true, maxLength: 2000 },
  chunk: { type: 'number', min: 1, max: 6, step: 1, default: 3, label: 'Caption words per chunk' },
  box_x: { type: 'number', min: 0, max: 1, step: 0.005, default: 0.065, label: 'Frame X' },
  box_y: { type: 'number', min: 0, max: 1, step: 0.005, default: 0.16, label: 'Frame Y' },
  box_w: { type: 'number', min: 0.05, max: 1, step: 0.005, default: 0.6, label: 'Frame width' },
  box_h: { type: 'number', min: 0.05, max: 1, step: 0.005, default: 0.68, label: 'Frame height' },
  align: { type: 'enum', options: ['left', 'right'], default: 'left', label: 'Align' },
  start_beat: { type: 'number', min: 0, max: 64, step: 1, default: 1, label: 'First word on beat #' },
  beats_per_word: { type: 'enum', options: ['0.5', '1', '2'], default: '1', label: 'Beats per word' },
  color: { type: 'color', default: 'ink', label: 'Ink' },
  emphasis: { type: 'color', default: 'orange', label: 'Emphasis {{…}}' },
  slab: { type: 'color', default: 'lime', label: 'Slab [[…]]' },
  exit_len: { type: 'number', min: 0.1, max: 2, step: 0.05, default: 0.4, label: 'Exit length s' },
  sfx: { type: 'bool', default: true, label: 'Hit sounds' },
};

function render(ctx, clip, lt, env) {
  const p = env.props;
  if (p.mode === 'path') drawPath(ctx, clip, env, p);
  else if (p.mode === 'caption') drawCaption(ctx, clip, env, p);
  else drawStack(ctx, clip, env, p);
}

function events(clip, env) {
  const p = env.props;
  const words = p.mode === 'caption' ? parseCaptions(p.captions, p.text) : parseLines(p.text).flatMap((l) => l.words);
  if (!words.length) return [];
  const sched = schedule(clip, p, env.beat, env.fps, words);
  const out = [{ kind: 'motion', role: 'words', start: sched[0].start, peak: sched.at(-1).start + peak(tokens.springs.land), settle: sched.at(-1).start + settle(tokens.springs.land), preset: tokens.springs.land }];
  if (!p.sfx) return out;
  sched.forEach((s, k) => out.push({ kind: 'hit', t: s.hit, sound: words[k].emph ? 'impact' : 'pop', gain_db: words[k].emph ? -5 : -9 }));
  // A riser into every line change (stack) / chunk (caption), ending on its first word.
  if (p.mode === 'stack') {
    const B = beatOf(env.beat);
    let k = 0;
    parseLines(p.text).forEach((ln, i) => {
      if (i > 0) out.push({ kind: 'cue', t: sched[k].hit - B, sound: 'riser', length: B, ends_at: sched[k].hit, gain_db: -15 });
      k += ln.words.length;
    });
  }
  return out;
}

register({
  type: 'kinetic.type', pack: ID, kind: 'component', category: 'Text', textStudio: true,
  label: 'Kinetic type',
  description: 'Words land one per beat with spring-animated weight and width; lines fitted to the frame at oversized scale. Stack, text-on-a-path and caption modes.',
  duration: 6,
  schema: SCHEMA,
  clipLabel: (clip) => `kinetic · ${plain(clip.props?.text ?? '').split(/\s+/).slice(0, 3).join(' ')}`,
  render, events,
});

// A plain text clip styled "kinetic": the same engine, framed by the clip's own anchor and wrap width.
function asKinetic(clip, env) {
  const tp = env.props;
  const F = env.frame;
  const w = (tp.width ?? 0.7) * (env.xf.sx ?? 1);
  return {
    ...Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.default])),
    text: tp.text, mode: 'stack', box_x: env.anchor.x / F.w, box_y: env.anchor.y / F.h, box_w: w, box_h: Math.min(0.8, 1 - env.anchor.y / F.h - 0.08),
    align: tp.align === 'right' ? 'right' : 'left', start_beat: 0, beats_per_word: '1', color: tp.color, emphasis: tp.accent ?? 'orange', slab: tp.highlight ?? 'lime', sfx: tp.sfx !== false,
  };
}

export default {
  id: ID,
  label: tokens.label,
  description: 'Variable-font words that land one per beat, fitted to the frame. Text clips re-skin to per-word hits; images and shapes get a punch on every beat.',
  tokens,
  schema: {
    punch: { type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.045, label: 'Beat punch (scale)' },
    tilt: { type: 'number', min: 0, max: 6, step: 0.25, default: 1.5, label: 'Bar tilt °' },
  },
  overrides: {
    text(ctx, clip, lt, env) {
      const p = asKinetic(clip, env);
      drawStack(ctx, clip, { ...env, props: p }, p);
    },
  },
  eventOverrides: {
    text(clip, env) {
      const tp = env.props;
      const p = { ...Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.default])), text: tp.text, mode: 'stack', start_beat: 0, beats_per_word: '1', sfx: tp.sfx !== false };
      return events(clip, { ...env, props: p });
    },
  },
  treatment: {
    // Non-type content in the kinetic look: a scale hit on every beat, a tilt that flips each bar.
    transform(params, env) {
      const b = env.beat;
      if (!b?.valid) return null;
      const since = ((env.t - b.offset) % b.beat + b.beat) % b.beat;
      const bar = Math.floor((env.t - b.offset) / b.bar);
      const sinceBar = ((env.t - b.offset) % b.bar + b.bar) % b.bar;
      const tiltTo = (bar % 2 ? -1 : 1) * params.tilt, tiltFrom = -tiltTo;
      return {
        scale: 1 + params.punch * (1 - clamp01(sp(since, 'snappy', 'scale'))),
        rot: ((tiltFrom + (tiltTo - tiltFrom) * clamp01(sp(sinceBar, 'slam', 'rotation'))) * Math.PI) / 180,
      };
    },
  },
  async load() {
    await loadWidthInstances(T.family, T.file, { min: T.wdth[0], max: T.wdth[1], step: 1, weight: `${T.wght[0]} ${T.wght[1]}` });
  },
};
