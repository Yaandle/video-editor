// text.js — the text engine behind the `text` component, Text Studio and every
// scene headline. Layout is measured once per input set (memoized, pure);
// drawing applies per-unit spring transforms computed from local time.
//
// Markup: [[word]] → highlight block behind the run, {{word}} → accent colour,
// \n → hard line break. Layout is cap-top: a block's y is the top of its
// capitals, so headlines sit on the grid optically, not by font bounding box.

import { sp, fade, lerp, staggerStep, exitLength, hash1 } from './motion.js';

const LAYOUT_CACHE = new Map();
const MAX_CACHE = 600;

export function parseRich(text) {
  const runs = [];
  const re = /\[\[(.+?)\]\]|\{\{(.+?)\}\}/gs;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], highlight: true });
    else runs.push({ text: m[2], accent: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

export function plain(text) {
  return String(text ?? '').replace(/\[\[(.+?)\]\]/gs, '$1').replace(/\{\{(.+?)\}\}/gs, '$1');
}

export function applyCase(text, mode) {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  return text;
}

/** True when a string reads as ALL CAPS (anti-slop check for headlines). */
export function isAllCaps(text) {
  const letters = plain(text).replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function setFont(ctx, spec) {
  ctx.font = spec.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(spec.tracking ?? 0) * spec.size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/**
 * spec: { text, font, size, leading, tracking, maxWidth, align, case }
 * → { lines:[{ y, width, words:[{ text, x, w, highlight, accent, chars:[{ ch, x, w }] }] }],
 *     width, height, lineH, cap, desc, overflow, unitCount:{line,word,char} }
 */
export function layoutText(ctx, spec) {
  const key = JSON.stringify([spec.text, spec.font, spec.size, spec.leading, spec.tracking, Math.round(spec.maxWidth ?? 0), spec.align, spec.case]);
  const hit = LAYOUT_CACHE.get(key);
  if (hit) return hit;

  setFont(ctx, spec);
  const text = applyCase(String(spec.text ?? ''), spec.case);
  const maxWidth = spec.maxWidth ?? Infinity;
  const space = ctx.measureText(' ').width;
  const capM = ctx.measureText('H');
  const cap = capM.actualBoundingBoxAscent || spec.size * 0.72;
  const desc = spec.size * 0.22;
  const lineH = spec.size * (spec.leading ?? 1.2);

  // Tokenize into words that remember their run styling; \n forces a break.
  const words = [];
  for (const run of parseRich(text)) {
    const parts = run.text.split(/(\n| )/);
    for (const p of parts) {
      if (p === ' ' || p === '') continue;
      if (p === '\n') { words.push({ br: true }); continue; }
      words.push({ text: p, highlight: !!run.highlight, accent: !!run.accent });
    }
  }

  const lines = [];
  let cur = [], curW = 0, overflow = false;
  const flush = () => { lines.push(cur); cur = []; curW = 0; };
  for (const w of words) {
    if (w.br) { flush(); continue; }
    const ww = ctx.measureText(w.text).width;
    if (ww > maxWidth) overflow = true;
    if (cur.length && curW + space + ww > maxWidth) flush();
    cur.push({ ...w, w: ww });
    curW += (cur.length > 1 ? space : 0) + ww;
  }
  if (cur.length || !lines.length) flush();

  let gWord = 0, gChar = 0, width = 0;
  const outLines = lines.map((line, li) => {
    let x = 0;
    const ws = line.map((w, wi) => {
      if (wi > 0) x += space;
      const chars = [];
      let cx = 0;
      for (const ch of w.text) {
        const cw = ctx.measureText(ch).width;
        chars.push({ ch, x: cx, w: cw, index: gChar++ });
        cx += cw;
      }
      const word = { text: w.text, x, w: w.w, highlight: w.highlight, accent: w.accent, chars, index: gWord++ };
      x += w.w;
      return word;
    });
    width = Math.max(width, x);
    return { y: li * lineH, width: x, words: ws, index: li };
  });

  const align = spec.align ?? 'left';
  for (const l of outLines) {
    const free = (Number.isFinite(maxWidth) ? maxWidth : width) - l.width;
    l.offset = align === 'right' ? free : align === 'center' ? free / 2 : 0;
  }

  const result = {
    lines: outLines, width, lineH, cap, desc,
    height: cap + (outLines.length - 1) * lineH + desc,
    overflow,
    unitCount: { line: outLines.length, word: gWord, char: gChar, block: 1 },
    spec: { ...spec },
  };
  if (LAYOUT_CACHE.size > MAX_CACHE) LAYOUT_CACHE.clear();
  LAYOUT_CACHE.set(key, result);
  return result;
}

/** Duration (s) of the staggered entrance for a layout — used by events(). */
export function entranceSpan(unitCount, anim) {
  if (!anim || anim.from === 'none') return 0;
  const unit = anim.unit ?? 'word';
  const n = unitCount[unit] ?? 1;
  const step = anim.stagger ?? staggerStep(unit);
  return (anim.delay ?? 0) + Math.max(0, n - 1) * step;
}

/**
 * Draw a laid-out block with its top-left (cap-top) at (x, y).
 * opts: { color, accent, highlight, highlightInk, lt, duration, enter, exit, stroke, shadow }
 *   enter: { unit: 'block'|'line'|'word'|'char', from: 'rise'|'drop'|'left'|'right'|'scale'|'mask'|'type'|'none',
 *            preset, stagger, delay }
 *   exit:  { to: 'drop'|'rise'|'left'|'right'|'mask'|'none', preset, length }
 */
export function drawText(ctx, lay, x, y, opts = {}) {
  const spec = lay.spec;
  setFont(ctx, spec);
  const color = opts.color ?? '#121212';
  const accent = opts.accent ?? color;
  const lt = opts.lt ?? 1e9;
  const enter = opts.enter ?? null;
  const exit = opts.exit ?? null;
  const unit = enter?.unit ?? 'word';
  const step = enter?.stagger ?? staggerStep(unit);
  const delay = enter?.delay ?? 0;
  const preset = enter?.preset ?? 'snappy';
  const exitLen = exit?.length ?? exitLength();
  const exitStart = (opts.duration ?? Infinity) - exitLen;
  const exitPreset = exit?.preset ?? 'quick';
  const nUnits = lay.unitCount[unit] ?? 1;

  // Typewriter: characters appear on a fixed cadence; the caret blinks on t.
  if (enter?.from === 'type') return drawTypewriter(ctx, lay, x, y, { ...opts, color, accent, lt, delay });

  const unitIndex = (line, word, ch) =>
    unit === 'line' ? line.index : unit === 'char' ? ch.index : unit === 'block' ? 0 : word.index;

  const transformFor = (idx, line) => {
    let dx = 0, dy = 0, s = 1, rot = 0, a = 1, clipLine = false;
    if (enter && enter.from && enter.from !== 'none') {
      const e = lt - delay - idx * step;
      if (e <= 0) return null;
      const p = sp(e, preset, 'position');
      const dist = spec.size * 0.7;
      switch (enter.from) {
        case 'rise': dy += dist * (1 - p); a *= fade(e * 1.5, preset); break;
        case 'drop': dy -= dist * (1 - p); a *= fade(e * 1.5, preset); break;
        case 'left': dx -= dist * 1.4 * (1 - p); a *= fade(e * 1.5, preset); break;
        case 'right': dx += dist * 1.4 * (1 - p); a *= fade(e * 1.5, preset); break;
        case 'scale': s *= lerp(0.35, 1, sp(e, preset, 'scale')); a *= fade(e * 2, preset); break;
        case 'mask': dy += lay.lineH * 1.08 * (1 - p); clipLine = true; break;
        case 'tilt': dy += dist * (1 - p); rot += 0.35 * (1 - sp(e, preset, 'rotation')) * (hash1(7, idx) > 0 ? 1 : -1); a *= fade(e * 1.5, preset); break;
      }
    }
    if (exit && exit.to && exit.to !== 'none' && lt > exitStart) {
      // Exits run in reading order too, compressed into a third of the stagger.
      const xT = lt - exitStart - (idx / Math.max(1, nUnits)) * Math.min(0.12, exitLen * 0.3);
      if (xT > 0) {
        const q = sp(xT, exitPreset, 'position');
        const d = exit.to === 'mask' ? lay.lineH * 1.08 : spec.size * 2.2;
        switch (exit.to) {
          case 'drop': dy += d * q; break;
          case 'rise': dy -= d * q; break;
          case 'left': dx -= d * 2 * q; break;
          case 'right': dx += d * 2 * q; break;
          case 'mask': dy -= d * q; clipLine = true; break;
          case 'fade': a *= 1 - Math.min(1, q); break;
        }
      }
    }
    return { dx, dy, s, rot, a, clipLine };
  };

  const capTop = (line) => y + line.y;          // cap top of this line
  const baseline = (line) => capTop(line) + lay.cap;

  // Highlight blocks first (behind), drawn per word so they ride with their unit.
  for (const line of lay.lines) {
    for (const word of line.words) {
      if (!word.highlight) continue;
      const idx = unitIndex(line, word, word.chars[0] ?? { index: 0 });
      const tf = transformFor(idx, line);
      if (!tf) continue;
      const padX = spec.size * 0.12, padY = spec.size * 0.1;
      const hx = x + line.offset + word.x - padX;
      const hy = capTop(line) - padY;
      const hw = word.w + padX * 2;
      const hh = lay.cap + padY * 2 + spec.size * 0.06;
      // The block grows from the left after its word lands — a marker swipe.
      const e = lt - delay - idx * step - 0.08;
      const grow = enter && enter.from !== 'none' ? Math.max(0, Math.min(1.04, sp(e, 'snappy', 'scale'))) : 1;
      ctx.save();
      withLineClip(ctx, tf.clipLine, x, capTop(line), lay, () => {
        ctx.translate(tf.dx, tf.dy);
        ctx.globalAlpha *= tf.a;
        ctx.fillStyle = opts.highlight ?? '#CDF545';
        ctx.fillRect(hx, hy, hw * grow, hh);
      });
      ctx.restore();
    }
  }

  for (const line of lay.lines) {
    const lx = x + line.offset;
    if (unit === 'line' || unit === 'block') {
      const tf = transformFor(unit === 'block' ? 0 : line.index, line);
      if (!tf) continue;
      ctx.save();
      withLineClip(ctx, tf.clipLine, x, capTop(line), lay, () => {
        applyTf(ctx, tf, lx + line.width / 2, baseline(line));
        drawWords(ctx, line.words, lx, baseline(line), color, accent, opts);
      });
      ctx.restore();
      continue;
    }
    for (const word of line.words) {
      if (unit === 'word') {
        const tf = transformFor(word.index, line);
        if (!tf) continue;
        ctx.save();
        withLineClip(ctx, tf.clipLine, x, capTop(line), lay, () => {
          applyTf(ctx, tf, lx + word.x + word.w / 2, baseline(line));
          drawWords(ctx, [word], lx, baseline(line), color, accent, opts);
        });
        ctx.restore();
      } else {
        for (const ch of word.chars) {
          const tf = transformFor(ch.index, line);
          if (!tf) continue;
          ctx.save();
          withLineClip(ctx, tf.clipLine, x, capTop(line), lay, () => {
            applyTf(ctx, tf, lx + word.x + ch.x + ch.w / 2, baseline(line));
            paintGlyphs(ctx, ch.ch, lx + word.x + ch.x, baseline(line), inkFor(word, color, accent, opts), opts);
          });
          ctx.restore();
        }
      }
    }
  }
}

function withLineClip(ctx, on, x, top, lay, fn) {
  if (on) {
    ctx.beginPath();
    const w = Number.isFinite(lay.spec.maxWidth) ? lay.spec.maxWidth : lay.width;
    ctx.rect(x - lay.spec.size, top - lay.spec.size * 0.25, w + lay.spec.size * 2, lay.cap + lay.spec.size * 0.5);
    ctx.clip();
  }
  fn();
}

function applyTf(ctx, tf, ox, oy) {
  ctx.globalAlpha *= tf.a;
  ctx.translate(tf.dx, tf.dy);
  if (tf.s !== 1 || tf.rot) {
    ctx.translate(ox, oy);
    if (tf.rot) ctx.rotate(tf.rot);
    ctx.scale(tf.s, tf.s);
    ctx.translate(-ox, -oy);
  }
}

function inkFor(word, color, accent, opts) {
  if (word.highlight && opts.highlightInk) return opts.highlightInk;
  return word.accent ? accent : color;
}

function drawWords(ctx, words, lx, by, color, accent, opts) {
  for (const w of words) paintGlyphs(ctx, w.text, lx + w.x, by, inkFor(w, color, accent, opts), opts);
}

function paintGlyphs(ctx, str, x, y, fill, opts) {
  if (opts.shadow) {
    ctx.fillStyle = opts.shadow.color;
    ctx.fillText(str, x + opts.shadow.x, y + opts.shadow.y);
  }
  if (opts.stroke && opts.stroke.width > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = opts.stroke.width * 2;
    ctx.strokeStyle = opts.stroke.color;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}

function drawTypewriter(ctx, lay, x, y, opts) {
  const cps = opts.enter?.cps ?? 28;
  const shown = Math.floor(Math.max(0, opts.lt - opts.delay) * cps);
  let caret = null;
  for (const line of lay.lines) {
    const lx = x + line.offset, by = y + line.y + lay.cap;
    for (const word of line.words) {
      for (const ch of word.chars) {
        if (ch.index >= shown) continue;
        paintGlyphs(ctx, ch.ch, lx + word.x + ch.x, by, inkFor(word, opts.color, opts.accent, opts), opts);
        caret = { x: lx + word.x + ch.x + ch.w, y: y + line.y };
      }
    }
  }
  const done = shown >= lay.unitCount.char;
  const blinkOn = Math.floor(opts.lt * 2.5) % 2 === 0;
  if (!done || blinkOn) {
    const c = caret ?? { x, y };
    ctx.fillStyle = opts.color;
    ctx.fillRect(c.x + lay.spec.size * 0.06, c.y, Math.max(3, lay.spec.size * 0.09), lay.cap);
  }
}
