// tokens.js — design tokens (design/tokens.json) resolved for a frame size.
// Pure: every helper is a function of (tokens, frame). The renderer, editor
// chrome and Text Studio all read the same file.

import { setMotionTokens } from './motion.js';

let T = null;

export function setTokens(tokens) {
  T = tokens;
  setMotionTokens(tokens?.motion);
}
export function tokens() {
  if (!T) throw new Error('tokens not loaded');
  return T;
}

/** Palette name → hex. Hex strings pass through. */
export function color(c, fallback = '#121212') {
  if (!c) return fallback;
  if (c[0] === '#') return c;
  const p = T?.palette?.[c];
  return typeof p === 'string' ? p : fallback;
}

export function paletteNames() {
  return Object.entries(T?.palette ?? {}).filter(([, v]) => typeof v === 'string').map(([k]) => k);
}

/** 1 at 1080 px on the short side; every token px value scales by this. */
export function unit(frame) {
  return Math.min(frame.w, frame.h) / 1080;
}

export function orientation(frame) {
  const a = frame.w / frame.h;
  return a > 1.15 ? 'landscape' : a < 0.87 ? 'portrait' : 'square';
}

export function family(fontRole) {
  return T?.fonts?.[fontRole]?.family ?? fontRole;
}

/** Type role (hero/display/h1/h2/body/label/micro) resolved to px for this frame. */
export function type(role, frame, overrides = {}) {
  const r = { ...(T?.type?.[role] ?? T?.type?.body), ...overrides };
  const size = Math.round(r.size * unit(frame));
  const fam = family(r.font);
  const weight = r.weight ?? 400;
  return {
    role, size, weight,
    family: fam,
    leading: r.leading ?? 1.2,
    tracking: r.tracking ?? 0,
    mono: r.font === 'mono' || r.font === 'code',
    font: `${r.italic ? 'italic ' : ''}${weight} ${size}px "${fam}"`,
  };
}

export function px(n, frame) { return n * unit(frame); }

export function border(frame) { return Math.max(1, Math.round((T?.border?.video ?? 6) * unit(frame))); }

export function shadow(frame, size = 'video') {
  const s = T?.shadow?.[size] ?? { x: 14, y: 14, color: 'ink' };
  return { x: Math.round(s.x * unit(frame)), y: Math.round(s.y * unit(frame)), color: color(s.color) };
}

/** Column grid for the frame; spans return pixel rects on the grid. */
export function layoutGrid(frame) {
  const g = T?.grid?.[orientation(frame)] ?? { columns: 12, margin: 96, gutter: 24, baseline: 8, safe: 0.05 };
  const u = unit(frame);
  const margin = Math.round(g.margin * u);
  const gutter = Math.round(g.gutter * u);
  const baseline = g.baseline * u;
  const colW = (frame.w - margin * 2 - gutter * (g.columns - 1)) / g.columns;
  const colX = (i) => margin + i * (colW + gutter);
  return {
    columns: g.columns, margin, gutter, baseline, colW,
    colX,
    /** x and width of `n` columns starting at column i (0-based). */
    span: (i, n) => ({ x: colX(i), w: n * colW + (n - 1) * gutter }),
    /** Snap a y value down to the baseline grid. */
    row: (y) => Math.round(y / baseline) * baseline,
    top: margin,
    bottom: frame.h - margin,
    safe: { x: frame.w * g.safe, y: frame.h * g.safe, w: frame.w * (1 - 2 * g.safe), h: frame.h * (1 - 2 * g.safe) },
  };
}

export function spaceStep(i, frame) {
  const s = T?.space ?? [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192];
  return s[Math.max(0, Math.min(s.length - 1, i))] * unit(frame);
}

/** WCAG relative luminance + contrast (used for picking text colour on fills). */
export function luminance(hex) {
  const h = color(hex).slice(1);
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Ink or paper, whichever reads best on `bg`. */
export function onColor(bg) {
  return contrast('ink', bg) >= contrast('paper', bg) ? color('ink') : color('paper');
}
