// draw.js — neo-brutal drawing primitives. Flat fills only: no gradients, no
// blur, no glow, no soft shadows, 0 radius. Every function is pure drawing
// (inputs → pixels) and reports nothing; components call env.box() for that.

import { getIconPaths } from './assets.js';

/** Bordered block with a hard offset shadow. Stroke sits inside the rect so
 *  (x, y, w, h) is the true outer edge — layout maths stay exact. */
export function box(ctx, x, y, w, h, o = {}) {
  const sw = o.strokeW ?? 0;
  if (o.shadow) {
    ctx.fillStyle = o.shadow.color;
    ctx.fillRect(x + o.shadow.x, y + o.shadow.y, w, h);
  }
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fillRect(x, y, w, h);
  }
  if (sw > 0 && o.stroke) frame(ctx, x, y, w, h, sw, o.stroke);
}

/** Inner frame drawn as four filled bars (crisper than strokeRect at any scale). */
export function frame(ctx, x, y, w, h, sw, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, sw);
  ctx.fillRect(x, y + h - sw, w, sw);
  ctx.fillRect(x, y, sw, h);
  ctx.fillRect(x + w - sw, y, sw, h);
}

export function rule(ctx, x, y, w, sw, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, sw);
}

/** Image scaled to cover (x, y, w, h), cropped around a focus point. */
export function imageCover(ctx, img, x, y, w, h, o = {}) {
  if (!img) return false;
  const iw = img.naturalWidth || img.videoWidth || img.width;
  const ih = img.naturalHeight || img.videoHeight || img.height;
  if (!iw || !ih) return false;
  const zoom = o.zoom ?? 1;
  const s = Math.max(w / iw, h / ih) * zoom;
  const sw = w / s, sh = h / s;
  const fx = o.focusX ?? 0.5, fy = o.focusY ?? 0.5;
  const sx = Math.max(0, Math.min(iw - sw, fx * iw - sw / 2));
  const sy = Math.max(0, Math.min(ih - sh, fy * ih - sh / 2));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  return true;
}

/** Diagonal hatch fill (flat lines, used as a print-style texture). */
export function hatch(ctx, x, y, w, h, o = {}) {
  const gap = o.gap ?? 18, lw = o.width ?? 3;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = o.color ?? '#121212';
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += gap) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Halftone-free dot grid (flat), for empty panels that must not look dead. */
export function dots(ctx, x, y, w, h, o = {}) {
  const gap = o.gap ?? 24, r = o.r ?? 2.5;
  ctx.fillStyle = o.color ?? '#121212';
  for (let yy = y + gap / 2; yy < y + h; yy += gap) {
    for (let xx = x + gap / 2; xx < x + w; xx += gap) {
      ctx.fillRect(xx - r, yy - r, r * 2, r * 2);
    }
  }
}

export function star(ctx, cx, cy, rOut, rIn, points, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = rot - Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Circular sticker: scalloped/round badge with text set on a circle. */
export function sticker(ctx, cx, cy, r, o = {}) {
  const sw = o.strokeW ?? 6;
  const ink = o.ink ?? '#121212';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(o.rotation ?? 0);
  if (o.shadow) {
    ctx.fillStyle = o.shadow.color;
    drawBadge(ctx, o.shadow.x, o.shadow.y, r, o.points);
    ctx.fill();
  }
  ctx.fillStyle = o.fill ?? '#CDF545';
  drawBadge(ctx, 0, 0, r, o.points);
  ctx.fill();
  ctx.lineWidth = sw;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  // inner ring
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, sw * 0.6);
  ctx.stroke();
  if (o.text) circularText(ctx, o.text, r * 0.79, o.font, ink, o.textRotation ?? 0);
  if (o.center) {
    ctx.fillStyle = ink;
    star(ctx, 0, 0, r * 0.36, r * 0.15, 8, o.textRotation ?? 0);
    ctx.fill();
  }
  ctx.restore();
}

function drawBadge(ctx, x, y, r, points = 0) {
  ctx.beginPath();
  if (!points) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.9;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Text on a circle, evenly spaced to fill the full turn. */
export function circularText(ctx, text, radius, font, color, rot = 0) {
  ctx.save();
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const step = (Math.PI * 2) / chars.length;
  for (let i = 0; i < chars.length; i++) {
    const a = rot + i * step;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -radius);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Horizontal ticker band: repeating items separated by a glyph, scrolled by offset px. */
export function ticker(ctx, x, y, w, h, o = {}) {
  const items = o.items?.length ? o.items : ['vidkit'];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = o.fill ?? '#121212';
  ctx.fillRect(x, y, w, h);
  ctx.font = o.font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.tracking ?? 0}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const gap = o.gap ?? h * 0.9;
  const sepR = o.sepSize ?? h * 0.16;
  const widths = items.map((s) => ctx.measureText(s).width);
  const cycle = widths.reduce((a, b) => a + b + gap * 2 + sepR * 2, 0);
  let start = x - (((o.offset ?? 0) % cycle) + cycle) % cycle;
  const cy = y + h / 2 + (o.baselineNudge ?? 0);
  while (start < x + w) {
    let cx = start;
    for (let i = 0; i < items.length; i++) {
      ctx.fillStyle = o.ink ?? '#F3EFE4';
      ctx.fillText(items[i], cx, cy);
      cx += widths[i] + gap;
      ctx.fillStyle = o.sep ?? o.ink ?? '#F3EFE4';
      star(ctx, cx + sepR, y + h / 2, sepR, sepR * 0.42, 4, Math.PI / 4);
      ctx.fill();
      cx += sepR * 2 + gap;
    }
    start += cycle;
  }
  ctx.restore();
}

/** Chunky arrow glyph built from rects + a triangle (no font dependency). */
export function arrow(ctx, x, y, size, o = {}) {
  const dir = o.dir ?? 'right';
  const t = size * (o.weight ?? 0.16);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2, 'up-right': -Math.PI / 4, 'down-right': Math.PI / 4 }[dir] ?? 0);
  ctx.fillStyle = o.color ?? '#121212';
  const half = size * 0.38;
  ctx.fillRect(-half, -t / 2, half * 2 - t * 0.9, t);
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(half - size * 0.34, -size * 0.32);
  ctx.lineTo(half - size * 0.34 - t * 0.9, -size * 0.32 + t * 0.9);
  ctx.lineTo(half - t * 1.4, 0);
  ctx.lineTo(half - size * 0.34 - t * 0.9, size * 0.32 - t * 0.9);
  ctx.lineTo(half - size * 0.34, size * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Phosphor icon (bold set) drawn from its SVG path data; size in px. */
export function icon(ctx, name, x, y, size, color) {
  const paths = getIconPaths(name);
  if (!paths) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 256, size / 256);
  ctx.fillStyle = color;
  for (const p of paths) ctx.fill(p);
  ctx.restore();
  return true;
}
