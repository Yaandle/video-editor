// kit.js — helpers shared by components and scenes: token-driven text blocks
// that report their boxes, tinted grid lines, and colour utilities. Pure.

import { layoutText, drawText, isAllCaps, plain } from './text.js';
import { type as typeRole, color, layoutGrid, unit, contrast, onColor } from './tokens.js';
import { arrivalFrames } from './motion.js';

/** Flat mix of two colours (still a flat fill — used for grid hairlines). */
export function tint(a, b, amt) {
  const pa = color(a).slice(1), pb = color(b).slice(1);
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * amt));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Lay out + draw a text block on the type ramp and report it.
 * o: { text, role, x, y, maxWidth, align, color, accent, highlight, bg, case,
 *      enter, exit, lt, duration, font, sizePx, weight, leading, tracking,
 *      stroke, shadow, gridBreak, bleed, name }
 * (x, y) is the block's anchor: left/centre/right edge by align, cap-top.
 */
export function textBlock(ctx, env, o) {
  const r = typeRole(o.role ?? 'body', env.frame, {
    ...(o.font ? { font: o.font } : {}),
    ...(o.sizePx ? { size: o.sizePx / unit(env.frame) } : {}),
    ...(o.weight ? { weight: o.weight } : {}),
    ...(o.leading ? { leading: o.leading } : {}),
    ...(o.tracking !== undefined && o.tracking !== null ? { tracking: o.tracking } : {}),
    ...(o.italic ? { italic: true } : {}),
  });
  const spec = {
    text: o.text ?? '', font: r.font, size: r.size, leading: r.leading, tracking: r.tracking,
    maxWidth: o.maxWidth ?? Infinity, align: o.align ?? 'left', case: o.case,
  };
  const lay = layoutText(ctx, spec);
  const boxW = Number.isFinite(spec.maxWidth) ? spec.maxWidth : lay.width;
  const left = spec.align === 'right' ? o.x - boxW : spec.align === 'center' ? o.x - boxW / 2 : o.x;
  drawText(ctx, lay, left, o.y, {
    color: color(o.color ?? 'ink'), accent: color(o.accent ?? o.color ?? 'ink'),
    highlight: color(o.highlight ?? 'lime'),
    highlightInk: onColor(o.highlight ?? 'lime'),
    lt: o.lt, duration: o.duration, enter: o.enter, exit: o.exit,
    stroke: o.stroke, shadow: o.shadow,
  });
  const inkLeft = left + Math.min(...lay.lines.map((l) => l.offset));
  const box = {
    kind: 'text', role: o.role ?? 'body', name: o.name, text: plain(o.text ?? ''),
    x: inkLeft, y: o.y, w: lay.width, h: lay.height,
    container: Number.isFinite(spec.maxWidth) ? { x: left, w: spec.maxWidth } : null,
    fg: color(o.color ?? 'ink'), bg: o.bg ? color(o.bg) : null,
    size: r.size, lines: lay.lines.length, overflow: lay.overflow,
    gridBreak: !!o.gridBreak, bleed: !!o.bleed,
    allCaps: isAllCaps(o.text ?? ''),
  };
  env.box(box);
  if (box.allCaps && ['hero', 'display', 'h1', 'h2'].includes(box.role)) env.warn(`all-caps ${box.role}: "${box.text.slice(0, 30)}"`);
  return { lay, box, left };
}

/** Column hairlines that make the grid visible; colour derived from the bg. */
export function gridLines(ctx, env, bg, o = {}) {
  const g = layoutGrid(env.frame);
  const c = tint(bg, contrast(bg, 'ink') > 4 ? 'ink' : 'paper', o.amount ?? 0.09);
  const w = Math.max(1, Math.round(2 * env.u));
  const top = o.top ?? 0, h = (o.bottom ?? env.frame.h) - top;
  ctx.fillStyle = c;
  for (let i = 0; i < g.columns; i++) {
    ctx.fillRect(Math.round(g.colX(i)), top, w, h);
    ctx.fillRect(Math.round(g.colX(i) + g.colW - w), top, w, h);
  }
  return g;
}

/**
 * Beat landing: given the earliest moment an element may start moving, return
 * { start, hit } where `hit` is the first grid line its spring can reach and
 * `start` = hit − arrival (whole frames). Without a grid, hit = start + arrival.
 */
export function landing(earliest, preset, beat, fps, stepsLater = 0) {
  const lead = arrivalFrames(fps, preset) / fps;
  if (!beat || !beat.valid) return { start: earliest + stepsLater * 0.5, hit: earliest + stepsLater * 0.5 + lead };
  const k = Math.ceil((earliest + lead - beat.offset) / beat.step - 1e-6) + stepsLater;
  const hit = beat.offset + k * beat.step;
  return { start: hit - lead, hit };
}

/** Grid line `n` steps after the clip start (n = 0 → the clip start itself). */
export function onBeat(clipStart, n, beat) {
  if (!beat || !beat.valid) return clipStart + n * 0.5;
  return clipStart + n * beat.beat;
}

/** Report a non-text element (block, image, sticker) for grid/safe checks. */
export function reportBox(env, b) {
  env.box({ kind: 'box', ...b });
}
