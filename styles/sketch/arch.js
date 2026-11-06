// Technical Architecture Study: the sketchbook diagram (remade in Canva as a
// GIF), rebuilt as a sketch-pack scene. Each of its five parts is updated to the
// current Aussie Rules 2 architecture (the review notes); the look is the
// GIF's. White page; the The Seasons title and the Gotham red part headings
// are cut from the GIF's own frames (styles/sketch/arch/make_crops.py), so
// those letterforms are exact. Box text is in the Gotham role (Montserrat until
// the licensed face is added). 4 px charcoal boxes, blue annotations with thin
// curved arrows, and a purple underlined side note.
//
// The motion is the GIF's too. The title's words rise in behind their line,
// then the title lifts and grows. A part heading fades in at the centre and
// slides left. Outlines wipe in left to right, text fades in cell by cell, and
// lists type in word by word. A page push leads to part 2 and cross-fades lead
// to parts 3, 4 and 5. Each part builds on, then holds long enough to read.

import { register } from '#renderer/registry.js';
import { clamp01, sp, fade, peak, settle } from '#renderer/motion.js';
import { onBeat } from '#renderer/kit.js';
import { getImage } from '#renderer/assets.js';
import tokens from './tokens.json' with { type: 'json' };
import crops from './arch/crops.json' with { type: 'json' };

const W = 1920, H = 1080;
const C = {
  ink: '#000000', line: '#2A2A2A', red: '#FF5757', note: '#2A2A2A', white: '#FFFFFF',
  blue: '#4493F8',     // annotations, frame corners
  deep: '#2682D5',     // "Frame Timing"
  bright: '#2082FF',   // the skeleton box, footers
  purple: '#6F6CD9',   // side-note headings
};

const DIR = 'styles/sketch/arch/';
const IMG = {
  title: `${DIR}title.png`,
  head: (n) => `${DIR}h${n}.png`,
  digit: (n) => `${DIR}d${n}.png`,
};
export const IMAGES = ['arch/title.png', ...[1, 2, 3, 4, 5].flatMap((n) => [`arch/h${n}.png`, `arch/d${n}.png`])];

// ── Type: the Gotham role, sized so cap heights and widths sit on the GIF's ────

const G = tokens.type.gotham;
const FAM = `"${G.family}", ${G.fallback}`;
const ROLE = {
  box:     { w: 700, size: 32, track: -0.035 },   // box titles
  step:    { w: 700, size: 44, track: -0.04 },    // part 3 step titles
  bullet:  { w: 700, size: 15, track: -0.02 },
  bulletL: { w: 700, size: 18.5, track: -0.03 },  // part 3 bullets (five columns, not three)
  cap:     { w: 700, size: 15, track: -0.02 },    // (parenthetical) captions, chips
  label:   { w: 700, size: 21, track: -0.03 },    // bracket labels, lock labels
  ann:     { w: 700, size: 19.5, track: -0.045 }, // blue annotations and captions
  noteH:   { w: 700, size: 30, track: -0.035 },   // purple side-note heading
  note:    { w: 400, size: 21, track: -0.035 },   // side-note body
  foot:    { w: 400, size: 21, track: -0.03 },    // light blue footer
  small:   { w: 400, size: 15, track: -0.02 },    // red caption under a heading
  skel:    { w: 700, size: 30, track: -0.035 },   // skeleton box title
};

function setFont(ctx, role) {
  const r = ROLE[role];
  ctx.font = `${r.w} ${r.size}px ${FAM}`;
  ctx.letterSpacing = `${r.track * r.size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}
// "→" is drawn, not set: the Gotham stand-in's arrow glyph is small and high.
const ARROW_EM = 1.0;
function twPlain(ctx, role, s) {
  setFont(ctx, role);
  const r = ROLE[role];
  return s ? ctx.measureText(s).width - r.track * r.size : 0;
}
/** Width of a string in a role (tracking adds after the last glyph; trim it). */
function tw(ctx, role, s) {
  const parts = s.split('→');
  return parts.reduce((a, p) => a + twPlain(ctx, role, p), 0) + (parts.length - 1) * ARROW_EM * ROLE[role].size;
}
function text(ctx, s, x, y, role, color, align = 'left') {
  const w = tw(ctx, role, s);
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const size = ROLE[role].size;
  let px = left;
  s.split('→').forEach((p, k) => {
    if (k) {
      const ay = y - size * 0.34, x0 = px + size * 0.14, x1 = px + size * 0.86;
      line(ctx, x0, ay, x1 - size * 0.2, ay, color, Math.max(1.5, size * 0.085));
      head(ctx, x1, ay, 0, size * 0.28, size * 0.15, color);
      px += ARROW_EM * size;
    }
    setFont(ctx, role);
    ctx.fillStyle = color;
    if (p) ctx.fillText(p, px, y);
    px += twPlain(ctx, role, p);
  });
  return { left, w };
}
function wrap(ctx, role, s, maxW) {
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && tw(ctx, role, next) > maxW) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

// ── Motion ───────────────────────────────────────────────────────────────────

const fadeIn = (e) => (e <= 0 ? 0 : fade(e, 'soft'));
const fadeQuick = (e) => (e <= 0 ? 0 : fade(e, 'quick'));
const move = (e) => (e <= 0 ? 0 : clamp01(sp(e, 'soft')));

function alpha(ctx, a, fn) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  fn();
  ctx.restore();
}
/** Reveal left to right (the GIF's outline wipe). */
function wipe(ctx, p, x, y, w, h, fn) {
  if (p <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8, y - 8, (w + 16) * p, h + 16);
  ctx.clip();
  fn();
  ctx.restore();
}

// ── Strokes ──────────────────────────────────────────────────────────────────

function rectStroke(ctx, x, y, w, h, color = C.line, lw = 4, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  if (dash) ctx.setLineDash(dash);
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  ctx.restore();
}
function line(ctx, x0, y0, x1, y1, color = C.line, lw = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
}
function head(ctx, x, y, ang, len, half, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-len, -half); ctx.lineTo(-len, half); ctx.closePath();
  ctx.fill();
  ctx.restore();
}
/** The part 1 arrow: a short shaft and a filled head, 40 px tall. */
function thickArrow(ctx, x, y0, y1, color = C.line) {
  const dir = Math.sign(y1 - y0);
  line(ctx, x, y0, x, y1 - dir * 10, color, 3);
  head(ctx, x, y1, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 12, 8.5, color);
}
/** The part 5 arrow: a 2 px line with a small head, drawn on to p. */
function thinArrow(ctx, x0, y0, x1, y1, p = 1, both = false, color = C.line) {
  if (p <= 0) return;
  const xe = x0 + (x1 - x0) * p, ye = y0 + (y1 - y0) * p;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  line(ctx, x0 + Math.cos(ang) * (both ? 8 : 0), y0 + Math.sin(ang) * (both ? 8 : 0), xe - Math.cos(ang) * 7, ye - Math.sin(ang) * 7, color, 2);
  head(ctx, xe, ye, ang, 9, 4.5, color);
  if (both) head(ctx, x0, y0, ang + Math.PI, 9, 4.5, color);
}

// ── Elements: each one draws itself e seconds after it starts ─────────────────

/** Text lines that fade in one after another. */
function lines(ctx, e, rows, step = 0.1) {
  rows.forEach((r, k) => alpha(ctx, fadeIn(e - k * step), () => text(ctx, r.s, r.x, r.y, r.role, r.color ?? C.ink, r.align)));
}

/** A bulleted list (hanging indent when an item wraps); each item fades in. */
function bulletList(ctx, e, items, x, y, o = {}) {
  const role = o.role ?? 'bullet', pitch = o.pitch ?? 22, color = o.color ?? C.ink;
  const big = role === 'bulletL';
  const indent = big ? 20 : 16, r = big ? 3.5 : 2.5, lift = big ? 6.5 : 5;
  let yy = y;
  items.forEach((s, k) => {
    const rows = o.maxW ? wrap(ctx, role, s, o.maxW - indent) : [s];
    const y0 = yy;
    alpha(ctx, fadeIn(e - k * (o.step ?? 0.1)), () => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y0 - lift, r, 0, Math.PI * 2); ctx.fill();
      rows.forEach((row, j) => text(ctx, row, x + indent, y0 + j * pitch, role, color));
    });
    yy += rows.length * pitch;
  });
  return yy;
}

/**
 * A box: the outline wipes in, then the title, caption and bullets fade in.
 * Content is laid out from the top: title baselines, a caption, then bullets.
 */
function box(ctx, e, b) {
  const color = b.color ?? C.line;
  wipe(ctx, move(e / 0.9), b.x, b.y, b.w, b.h, () => rectStroke(ctx, b.x, b.y, b.w, b.h, color, 4, b.dash ?? null));
  boxContent(ctx, e - 0.35, b);
}
/** Title at eTitle; caption, bullets, lines and chips follow from eBody. */
function boxContent(ctx, eTitle, b, eBody = eTitle) {
  const cx = b.x + b.w / 2;
  const ink = b.ink ?? C.ink;
  let y = b.y + (b.top ?? 54);
  (b.title ?? []).forEach((s, k) => {
    const yy = y;
    alpha(ctx, fadeIn(eTitle), () => text(ctx, s, cx, yy, b.titleRole ?? 'box', ink, 'center'));
    if (k < b.title.length - 1) y += b.titlePitch ?? 41;
  });
  if (b.cap) {
    const caps = Array.isArray(b.cap) ? b.cap : [b.cap];
    caps.forEach((c, k) => {
      y += k ? 20 : (b.capGap ?? 27);
      const yy = y;
      const s = typeof c === 'string' ? c : c.s;
      alpha(ctx, fadeIn(eBody - 0.15 - k * 0.1), () => text(ctx, s, cx, yy, 'cap', c.color ?? ink, 'center'));
    });
  }
  if (b.bullets) {
    const bx = b.bx != null ? b.x + b.bx : bulletLeft(ctx, b);
    bulletList(ctx, eBody - 0.3, b.bullets, bx, y + (b.bulletGap ?? (b.cap ? 31 : 42)), { color: ink, maxW: b.x + b.w - bx - 14, step: 0.1 });
  }
  if (b.text) {
    b.text.forEach((s, k) => alpha(ctx, fadeIn(eBody - 0.3 - k * 0.1), () => text(ctx, s, cx, y + 30 + k * 21, 'cap', ink, 'center')));
  }
  if (b.chips) chips(ctx, eBody - 0.3, b, y + 20);
}
/** Centre a bullet block in its box. */
function bulletLeft(ctx, b) {
  const w = Math.max(...b.bullets.map((s) => tw(ctx, 'bullet', s))) + 16;
  return Math.round(b.x + (b.w - Math.min(w, b.w - 40)) / 2 + 2);
}

/** Gameplay State as separate stores: a grid of small outlined chips. */
function chips(ctx, e, b, top) {
  const cols = 2, gap = 10, ch = 30, pad = 22;
  const cw = (b.w - 2 * pad - gap) / cols;
  b.chips.forEach((s, k) => {
    const x = b.x + pad + (k % cols) * (cw + gap), y = top + Math.floor(k / cols) * (ch + 8);
    alpha(ctx, fadeIn(e - k * 0.08), () => {
      rectStroke(ctx, x, y, cw, ch, C.line, 2);
      text(ctx, s, x + cw / 2, y + 20, 'cap', C.ink, 'center');
    });
  });
}

/**
 * An annotation: a thin arrow leaves the text's start, bends down (over `bend` px, the
 * GIF's 71 by default) and drops straight onto its target; the text fades in.
 */
function annotation(ctx, e, a) {
  const [x0, y0] = a.from, [x1, y1] = a.to;
  const yb = y0 + Math.min(a.bend ?? 71, y1 - y0);
  const p = move(e / 0.6);
  if (p > 0) {
    const path = [];
    for (let k = 0; k <= 24; k++) {
      const u = k / 24, v = 1 - u;
      path.push([v * v * x0 + 2 * v * u * x1 + u * u * x1, v * v * y0 + 2 * v * u * y0 + u * u * yb]);
    }
    const tail = Math.round((y1 - yb) / 4);
    for (let k = 1; k <= tail; k++) path.push([x1, yb + (y1 - yb) * k / tail]);
    const pts = path.slice(0, Math.floor((path.length - 1) * p) + 1);
    ctx.save();
    ctx.strokeStyle = a.color ?? C.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    if (p >= 0.999) {
      ctx.save();
      ctx.strokeStyle = a.color ?? C.blue;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x1 - 4, y1 - 6); ctx.lineTo(x1, y1); ctx.lineTo(x1 + 4, y1 - 6); ctx.stroke();
      ctx.restore();
    }
  }
  alpha(ctx, fadeIn(e - 0.1), () => (a.lines ?? [a.text]).forEach((s, k) => text(ctx, s, a.x, a.y + k * 26, 'ann', a.color ?? C.blue)));
}

/** Purple underlined heading over a light note, paragraphs fading in one by one. */
function sideNote(ctx, e, n) {
  alpha(ctx, fadeIn(e), () => {
    const { left, w } = text(ctx, n.head, n.x, n.y, 'noteH', C.purple);
    line(ctx, left, n.y + 4, left + w, n.y + 4, C.purple, 2);
  });
  let y = n.y + 63;
  n.paras.forEach((p, k) => {
    const rows = wrap(ctx, 'note', p, n.maxW ?? 178);
    const y0 = y;
    alpha(ctx, fadeIn(e - 0.25 - k * 0.2), () => rows.forEach((s, j) => text(ctx, s, n.x, y0 + j * 25, 'note', C.note)));
    y += rows.length * 25 + 25;
  });
}

/** Words that appear one at a time (the GIF's typed line). */
function typed(ctx, e, s, x, y, role, color, align = 'left', step = 0.07) {
  const words = s.split(' ');
  const w = tw(ctx, role, s);
  let left = align === 'center' ? x - w / 2 : x;
  words.forEach((word, k) => {
    const a = fadeQuick(e - k * step);
    const ww = tw(ctx, role, word + ' ');
    if (a > 0) alpha(ctx, a, () => text(ctx, word, left, y, role, color));
    left += ww;
  });
}

/** Blue L corners around part 3's frame. */
function corners(ctx, a, x0, y0, x1, y1) {
  alpha(ctx, a, () => {
    const L = 33, V = 40, c = C.blue;
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.lineCap = 'butt';
    const k = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
    k([[x0 + 2, y0 + V], [x0 + 2, y0 + 2], [x0 + L, y0 + 2]]);
    k([[x1 - L, y0 + 2], [x1 - 2, y0 + 2], [x1 - 2, y0 + V]]);
    k([[x0 + 2, y1 - V], [x0 + 2, y1 - 2], [x0 + L, y1 - 2]]);
    k([[x1 - L, y1 - 2], [x1 - 2, y1 - 2], [x1 - 2, y1 - V]]);
    ctx.restore();
  });
}

/** Small tick corners around a label (part 5's bracket style). */
function bracket(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = C.line; ctx.lineWidth = 4; ctx.lineCap = 'butt';
  const a = 12, v = 8;
  const k = (pts) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke(); };
  k([[x + 2, y + v], [x + 2, y + 2], [x + a, y + 2]]);
  k([[x + w - a, y + 2], [x + w - 2, y + 2], [x + w - 2, y + v]]);
  k([[x + 2, y + h - v], [x + 2, y + h - 2], [x + a, y + h - 2]]);
  k([[x + w - a, y + h - 2], [x + w - 2, y + h - 2], [x + w - 2, y + h - v]]);
  ctx.restore();
}

// Digits for part 3's circles: the red heading digits, re-inked charcoal.
const TINT = new Map();
function tinted(n, color) {
  const key = `${n}|${color}`;
  if (!TINT.has(key)) {
    const img = getImage(IMG.digit(n));
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, cv.width, cv.height);
    TINT.set(key, cv);
  }
  return TINT.get(key);
}

/** Part 3's step: a circle drawn on, its digit rising in, a big title, bullets. */
function step(ctx, e, s) {
  const cy = s.cy ?? 667;
  const p = move(e / 0.7);
  if (p > 0) {
    ctx.save();
    ctx.strokeStyle = C.line; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(s.cx, cy, 33.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
    ctx.restore();
  }
  const d = move(e - 0.25);
  if (d > 0) {
    const img = tinted(s.n, C.line);
    ctx.save();
    ctx.beginPath(); ctx.arc(s.cx, cy, 31, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, s.cx - img.width / 2, cy - img.height / 2 + (1 - d) * 46);
    ctx.restore();
  }
  s.title.forEach((t, k) => alpha(ctx, fadeIn(e - 0.4), () => text(ctx, t, s.cx, s.ty + k * 58, 'step', C.ink, 'center')));
  const wMax = s.colW - 40;
  const widths = s.bullets.map((b) => Math.min(wMax, tw(ctx, 'bulletL', b)));
  const left = Math.round(s.cx - (Math.max(...widths) + 20) / 2 + 4);
  bulletList(ctx, e - 0.7, s.bullets, left, s.by, { role: 'bulletL', pitch: 27, maxW: wMax + 20, step: 0.12 });
}

/** A padlock, closed (animated: read-only) or open (ragdolled: physics writes the bones). */
function padlock(ctx, cx, top, open) {
  ctx.save();
  ctx.fillStyle = C.ink;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 6;
  const bw = 41, bh = 31, by = top + 24;
  // Shackle: a U whose legs enter the body; open, it lifts and swings clear on the right.
  ctx.beginPath();
  const lift = open ? 12 : 0;
  ctx.moveTo(cx - 12, by + 2 - (open ? 0 : 0));
  ctx.lineTo(cx - 12, top + 13 - lift);
  ctx.arc(cx, top + 13 - lift, 12, Math.PI, 0);
  ctx.lineTo(cx + 12, open ? top + 13 - lift + 6 : by + 2);
  ctx.stroke();
  // Body with a keyhole.
  ctx.beginPath();
  ctx.roundRect(cx - bw / 2, by, bw, bh, 4);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.beginPath(); ctx.arc(cx, by + 12, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 1.6, by + 13, 3.2, 9);
  ctx.restore();
}
function lockMode(ctx, e, l) {
  alpha(ctx, fadeIn(e), () => padlock(ctx, l.cx, l.y, l.open));
  alpha(ctx, fadeIn(e - 0.2), () => text(ctx, l.label, l.cx, l.y + 90, 'label', C.ink, 'center'));
  l.red.forEach((s, k) => alpha(ctx, fadeIn(e - 0.35 - k * 0.1), () => text(ctx, s, l.cx, l.y + 113 + k * 22, 'cap', C.red, 'center')));
}

/** Underlined title (part 4's column heads) over a bullet list. */
function underTitle(ctx, e, u) {
  u.title.forEach((s, k) => alpha(ctx, fadeIn(e), () => {
    const y = u.y + k * 38;
    const r = text(ctx, s, u.x, y, 'box', C.ink, u.align ?? 'left');
    line(ctx, r.left, y + 5, r.left + r.w, y + 5, C.ink, 2.5);
  }));
  bulletList(ctx, e - 0.3, u.bullets, u.bx, u.y + (u.title.length - 1) * 38 + 33, { step: 0.1 });
}

// ── The title and the part headings ──────────────────────────────────────────

const TITLE = crops.title;
const TCX = TITLE.x + TITLE.w / 2, TCY = TITLE.y + TITLE.h / 2;   // final centre (960, 290)
const INTRO = { scale: 0.8956, cy: 518 };                          // the GIF's opening pose

function drawTitle(ctx, t) {
  t = Math.min(t, 60);   // settled; springs are not evaluated at infinity
  const img = getImage(IMG.title);
  const u = move(t - T.lift);
  const s = INTRO.scale + (1 - INTRO.scale) * u;
  const cy = INTRO.cy + (TCY - INTRO.cy) * u;
  ctx.save();
  ctx.translate(TCX, cy);
  ctx.scale(s, s);
  ctx.translate(-TITLE.w / 2, -TITLE.h / 2);
  TITLE.words.forEach(([a, b], k) => {
    const p = move(t - T.word - k * T.wordStep);
    if (p <= 0) return;
    const x = a - 6, w = b - a + 12;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, 0, w, TITLE.h); ctx.clip();
    ctx.drawImage(img, x, 0, w, TITLE.h, x, (1 - p) * TITLE.h * 0.8, w, TITLE.h);
    ctx.restore();
  });
  ctx.restore();
}

/** Red part heading: the boxed digit and the two-line name, at their GIF place (shifted by dx). */
function drawHeading(ctx, n, o) {
  ctx.save();
  ctx.translate(o.dx ?? 0, 0);
  alpha(ctx, o.text ?? 1, () => ctx.drawImage(getImage(IMG.head(n)), crops.heading.x, crops.heading.y));
  alpha(ctx, o.box ?? 1, () => rectStroke(ctx, 226, 442, 70, 70, C.red, 4));
  const d = o.digit ?? 1;
  if (d > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(230, 446, 62, 62); ctx.clip();
    ctx.drawImage(getImage(IMG.digit(n)), crops.digit.x, crops.digit.y + (1 - d) * 46);
    ctx.restore();
  }
  ctx.restore();
}

// ── Timing (seconds) ─────────────────────────────────────────────────────────

// Part starts sit on beats (120 BPM): the push to part 2 and each cross-fade cut on a beat.
const PART_BEATS = [0, 48, 80, 112, 144];
const END_BEAT = 176;
const PUSH = 0.8, XFADE = 0.5;
const T = {
  word: 0.3, wordStep: 0.14,        // title words rise
  lift: 2.0,                        // title lifts and grows
  head: 3.0,                        // part 1 heading fades in at the centre
  slide: 4.5,                       // ...and slides left
  build: 5.0,                       // part 1's row starts
};

// ── Part 1 · Game Loop ───────────────────────────────────────────────────────

const ROW1 = {
  x: 320, y: 585, h: 230,
  cells: [
    { w: 321, title: ['Match / Mode', 'Controller'], cap: '(full_game, kick_to_kick)', bullets: ['Phases, stoppages', 'Rules & free kicks', 'Control switching'], bx: 54 },
    { w: 321, title: ['Player Controller'], cap: '(CharacterBody3D)', bullets: ['Movement', 'Actions', 'Contest resolution'], bx: 54 },
    { w: 321, title: ['Brain'], cap: '(Human / AI / Command)', bullets: ['Human: input, steering', 'AI: decisions, positioning', 'Command: team command', 'One interface → intent'], bx: 54 },
    { w: 321, title: ['Gameplay State'], chips: ['GameState', 'MatchState', 'ControlMode', 'Ball', 'Registry', 'Career'] },
  ],
};
const ARROWS1 = [
  { x: 481, y0: 881, y1: 842 },   // rules → match / mode controller
  { x: 802, y0: 881, y1: 842 },   // the controller acts on intent
  { x: 1123, y0: 842, y1: 881 },  // the brain produces intent
];
const RULES = { x: 320, y: 906, w: 321, h: 112, top: 47, title: ['Rules / Officiating'], text: ['Reads Player Controller signals', '→ free kick · 50 m · ball dead'] };
const ACTIONS = { x: 662, y: 906, w: 942, h: 112, top: 47, title: ['Actions/Intent'] };
const ACTION_LIST = 'e.g. move, sprint, jump, kick, handball, bounce, mark, ruck, bump, tackle, smother, spoil';

function part1(ctx, t) {
  // Heading: fades in centred under the title, then slides left into place.
  const dx = 520 * (1 - move(t - T.slide));
  drawHeading(ctx, 1, { dx, text: fadeIn(t - T.head), box: fadeIn(t - T.head - 0.35), digit: move(t - T.head - 0.6) });
  const e = t - T.build;
  if (e <= -0.01) return;
  // The row: joined cells in one outline. Titles land left to right, then each cell's body.
  const r = ROW1;
  const w = r.cells.reduce((a, c) => a + c.w, 0);
  wipe(ctx, move(e / 1.1), r.x, r.y, w, r.h, () => {
    rectStroke(ctx, r.x, r.y, w, r.h, C.line, 4);
    let x = r.x;
    r.cells.slice(0, -1).forEach((c) => { x += c.w; line(ctx, x, r.y + 2, x, r.y + r.h - 2, C.line, 3); });
  });
  let x = r.x;
  r.cells.forEach((c, k) => {
    boxContent(ctx, e - 0.8 - k * 0.2, { ...c, x, y: r.y, h: r.h, top: 63 }, e - 1.7 - k * 0.45);
    x += c.w;
  });
  // Rules and Actions/Intent under the row.
  box(ctx, e - 4.0, RULES);
  box(ctx, e - 4.3, { ...ACTIONS });
  typed(ctx, e - 5.1, ACTION_LIST, ACTIONS.x + ACTIONS.w / 2, ACTIONS.y + 84, 'cap', C.ink, 'center', 0.08);
  // Arrows, one at a time.
  ARROWS1.forEach((a, k) => {
    const ae = e - 6.4 - k * 0.3;
    const drop = (1 - move(ae)) * 8 * Math.sign(a.y1 - a.y0);
    alpha(ctx, fadeIn(ae), () => thickArrow(ctx, a.x, a.y0 - drop, a.y1 - drop));
  });
  // Annotations onto the middle of Player Controller (contests) and Brain (AI), then the side note.
  const mid = (k) => r.x + r.cells.slice(0, k).reduce((a, c) => a + c.w, 0) + r.cells[k].w / 2;
  annotation(ctx, e - 7.6, { x: mid(1) + 43, y: 466, from: [mid(1) + 38, 459], to: [mid(1), 578], text: 'ML models feed contests and cues: TackleBalance (LR/GA), MarkCueModel' });
  annotation(ctx, e - 8.3, { x: mid(2) + 43, y: 514, from: [mid(2) + 38, 507], to: [mid(2), 578], text: 'AI thinks every physics tick; human-like reaction delays' });
  sideNote(ctx, e - 9.0, { x: 1648, y: 607, head: 'State', paras: ['One owner per piece of state.', 'No single store.'] });
}

// ── Part 2 · Player + Ball Physics ───────────────────────────────────────────

const P2 = {
  body: { x: 300, y: 591, w: 320, h: 206, title: ['Player Body'], cap: '(kinematic capsule)', bullets: ['Velocity set by movement', 'Gravity, applied by hand', 'move_and_slide()', 'Collision'], bx: 66 },
  ragdoll: { x: 800, y: 560, w: 320, h: 228, title: ['Player Ragdoll'], cap: '(PhysicalBone3D, Jolt)', bullets: ['Joints built at rest pose', 'Anatomical limits (Jolt ~75°)', 'Motors + balance (1 − b)', 'Get-ups', 'Wrap servo, never a joint'], bx: 50 },
  ball: { x: 1205, y: 596, w: 320, h: 269, title: ['Ball Physics', 'Body'], cap: '(RigidBody3D)', bullets: ['Mass, gravity, impulses', 'Prolate spheroid hull', 'v² air drag', 'Magnus force from spin', 'Locks when held, stoppages'], bx: 56 },
  collision: { x: 755, y: 846, w: 410, h: 200, title: ['Collision System'], cap: '(Jolt)', bullets: ['Collision layers', 'Tackle partners: temporary exception', 'Contact checks in code: gather, tackle, bump, smother'], bx: 62 },
};

function part2(ctx, t) {
  drawHeading(ctx, 2, {});
  alpha(ctx, fadeIn(t - 1.0), () => text(ctx, 'Physics & Movement (Physical World)', 1156, 486, 'ann', C.blue));
  box(ctx, t - 1.4, P2.body);
  // Hand-off between the two physics modes of one player.
  const ae = t - 2.9;
  thinArrow(ctx, 638, 690, 782, 690, move(ae / 0.5), true);
  lines(ctx, ae - 0.3, [
    { s: 'hand-off on', x: 710, y: 656, role: 'cap', align: 'center' },
    { s: 'tackle / bump', x: 710, y: 676, role: 'cap', align: 'center' },
    { s: 'get-up returns', x: 710, y: 716, role: 'cap', align: 'center' },
  ]);
  lines(ctx, ae - 0.8, [
    { s: 'AI players', x: 710, y: 760, role: 'cap', color: C.red, align: 'center' },
    { s: 'never ragdoll', x: 710, y: 781, role: 'cap', color: C.red, align: 'center' },
  ]);
  box(ctx, t - 3.4, P2.ragdoll);
  box(ctx, t - 5.0, P2.ball);
  box(ctx, t - 6.5, P2.collision);
  sideNote(ctx, t - 8.0, { x: 1594, y: 636, head: 'Physics', paras: ['Physics decides outcomes.', 'Players are kinematic until a contest hands them to the ragdoll.'] });
}

// ── Part 3 · Movement + Collision (frame timing) ─────────────────────────────

const FRAME = { x0: 327, y0: 590, x1: 1614, y1: 1009 };
const STEPS = [
  { title: ['Intent', '(Brain)'], bullets: ['Brain thinks', 'Timers', 'Action updates'] },
  { title: ['Move'], bullets: ['Gravity', 'Locomotion', 'move_and_slide()'] },
  { title: ['Contact &', 'Contest'], bullets: ['Gather, tackle, bump, smother, mark', 'Resolve contest: deterministic, no dice'] },
  { title: ['Results'], bullets: ['Possession', 'Ragdoll hand-off', 'Signals to rules'] },
  { title: ['Drive', 'Animation'], bullets: ['Real ground speed', 'Current action'] },
];

function part3(ctx, t) {
  drawHeading(ctx, 3, {});
  const cx0 = (FRAME.x0 + FRAME.x1) / 2;
  alpha(ctx, fadeIn(t - 1.0), () => text(ctx, 'Frame Timing', cx0, 568, 'ann', C.deep, 'center'));
  corners(ctx, fadeIn(t - 1.3), FRAME.x0, FRAME.y0, FRAME.x1, FRAME.y1);
  const colW = (FRAME.x1 - FRAME.x0) / STEPS.length;
  const cxs = STEPS.map((_, k) => FRAME.x0 + colW * (k + 0.5));
  STEPS.forEach((s, k) => {
    const se = t - 1.8 - k * 1.1;
    if (k > 0) thinArrow(ctx, cxs[k - 1] + 46, 664, cxs[k] - 46, 664, move((se + 0.3) / 0.5));
    step(ctx, se, { ...s, n: k + 1, cx: cxs[k], cy: 664, colW, ty: 760, by: 868 });
  });
  typed(ctx, t - 7.6, 'tackle lands → TackleBalance b → p(break) = 1 − b vs threshold → hold or break → ragdoll', cx0, 990, 'ann', C.blue, 'center', 0.06);
  alpha(ctx, fadeIn(t - 8.6), () => text(ctx, 'Resolved before next physics step · ragdoll / wrap stepped in the same tick', cx0, 1054, 'foot', C.bright, 'center'));
}

// ── Part 4 · Animation (Visual State) ────────────────────────────────────────

function part4(ctx, t) {
  drawHeading(ctx, 4, {});
  lines(ctx, t - 1.0, [
    { s: 'Visual representation', x: 1376, y: 472, role: 'ann', color: C.blue, align: 'center' },
    { s: 'of gameplay state', x: 1376, y: 501, role: 'ann', color: C.blue, align: 'center' },
  ]);
  underTitle(ctx, t - 1.4, { x: 330, y: 630, title: ['Gameplay Inputs', 'to Animation'], bx: 348, bullets: ['Velocity (body space)', 'Ground speed', 'Action + elapsed time', 'Ragdoll flag'] });
  lockMode(ctx, t - 2.6, { cx: 800, y: 600, open: false, label: 'Animated', red: ['read-only:', 'physics → animation'] });
  underTitle(ctx, t - 3.4, { x: 940, y: 630, title: ['Animation Tree'], bx: 958, bullets: ['Locomotion BlendSpace2D', 'Action state machine', 'Carry Blend2 (arms only)', 'Mark variants (10)', 'Advanced in play_action'] });
  thinArrow(ctx, 1186, 700, 1238, 700, move((t - 4.5) / 0.4));
  box(ctx, t - 4.7, { x: 1250, y: 596, w: 300, h: 190, title: ['Post-tree Layers'], cap: '(in _process)', bullets: ['Lean / bank', 'Foot clamp', 'BallHold'], bx: 92 });
  // Assets feed the tree.
  const ae = t - 5.9;
  alpha(ctx, fadeIn(ae), () => { bracket(ctx, 330, 878, 146, 62); text(ctx, 'Blender', 403, 917, 'label', C.ink, 'center'); });
  thinArrow(ctx, 486, 909, 524, 909, move((ae - 0.2) / 0.3));
  alpha(ctx, fadeIn(ae - 0.4), () => { bracket(ctx, 534, 878, 186, 62); text(ctx, '6thbuild.glb', 627, 917, 'label', C.ink, 'center'); });
  lines(ctx, ae - 0.6, [{ s: '26 clips · 18 deform bones', x: 525, y: 968, role: 'cap', align: 'center' }]);
  thinArrow(ctx, 680, 872, 946, 772, move((ae - 0.9) / 0.6));   // clips → the tree
  // Two modes for the skeleton, and where its pose comes from.
  lockMode(ctx, t - 7.1, { cx: 846, y: 852, open: true, label: 'Ragdolled', red: ['physics owns the skeleton', '(PhysicalBone3D, motors, wrap IK)', 'tree muted'] });
  const ge = t - 7.9;
  wipe(ctx, move(ge / 0.9), 1000, 880, 480, 140, () => rectStroke(ctx, 1000, 880, 480, 140, C.bright, 4, [13, 8]));
  alpha(ctx, fadeIn(ge - 0.35), () => text(ctx, 'Skeleton (Bone Poses)', 1240, 927, 'skel', C.bright, 'center'));
  bulletList(ctx, ge - 0.6, ['final pose for the frame used in global transforms', 'from tree + layers, or from the ragdoll'], 1046, 962, { color: C.bright });
  thinArrow(ctx, 1400, 794, 1400, 872, move((ge - 1.0) / 0.4));
  thinArrow(ctx, 926, 936, 994, 936, move((ge - 1.2) / 0.3));
  sideNote(ctx, t - 9.4, { x: 1594, y: 636, head: 'Animation', paras: ['Maps gameplay state to visual motion.', 'Can be deferred from physics.', 'No root motion.'] });
}

// ── Part 5 · Rendering (Visual Output) ───────────────────────────────────────

const SPAN = { x: 226, w: 1474 };
const INPUTS = [
  { w: 210, title: ['Camera'], cap: ['(BroadcastCamera)', 'chase · full side'] },
  { w: 260, title: ['Lights'], cap: ['(sun + shadows)', '120 m shadow distance'] },
  { w: 340, title: ['Meshes & Materials'], cap: ['(textures inside, kit colours)', 'players · turf · fences · umpires'] },
  { w: 270, title: ['Environment'], cap: ['(broadcast_environment)', 'sky · ACES · glow · fog'] },
  { w: 240, title: ['MultiMesh'], cap: ['(OvalEnvironment)', 'trees + field props'] },
];
const PASSES = [
  { s: 'Shadow maps', cap: ['blended splits'] },
  { s: 'Depth pre-pass', cap: [] },
  { s: 'Opaque', cap: ['materials + lights', '+ shadows'] },
  { s: 'Sky', cap: ['procedural'] },
  { s: 'Transparent', cap: [] },
  { s: 'Post', cap: ['ACES · glow · fog'] },
  { s: 'UI', cap: ['CanvasLayers'] },
  { s: 'Frame buffer', cap: ['MSAA 2×'], last: true },
];

function part5(ctx, t) {
  drawHeading(ctx, 5, {});
  alpha(ctx, fadeIn(t - 1.0), () => text(ctx, 'Rendering pipeline Godot 4.6 · Forward+', 468, 566, 'small', C.red, 'center'));
  lines(ctx, t - 1.2, [
    { s: 'What the player', x: 1352, y: 472, role: 'ann', color: C.blue, align: 'center' },
    { s: 'sees on screen', x: 1352, y: 501, role: 'ann', color: C.blue, align: 'center' },
  ]);
  // Scene inputs: one row of boxes.
  const gap = (SPAN.w - INPUTS.reduce((a, b) => a + b.w, 0)) / (INPUTS.length - 1);
  let x = SPAN.x;
  const cxs = [];
  INPUTS.forEach((b, k) => {
    box(ctx, t - 1.6 - k * 0.45, { ...b, x, y: 606, h: 118, top: 52, capGap: 25 });
    cxs.push(x + b.w / 2);
    x += b.w + gap;
  });
  // Every input joins one line, and that line feeds the passes.
  const de = t - 4.0, mid = cxs[2], bus = 756;
  alpha(ctx, fadeIn(de), () => {
    cxs.forEach((cx) => line(ctx, cx, 724, cx, bus + 1, C.line, 2));
    line(ctx, cxs[0], bus, cxs[cxs.length - 1], bus, C.line, 2);
  });
  alpha(ctx, fadeIn(de - 0.2), () => thickArrow(ctx, mid, bus - (1 - move(de - 0.2)) * 8, 820 - (1 - move(de - 0.2)) * 8));
  // Forward+ passes: bracket labels joined by thin arrows, ending on the frame buffer.
  const pad = 17, arrowW = 30, sp6 = 6;
  const widths = PASSES.map((p) => Math.max(96, tw(ctx, 'label', p.s) + 2 * pad));
  const total = widths.reduce((a, b) => a + b, 0) + (PASSES.length - 1) * (arrowW + 2 * sp6);
  let px = SPAN.x + (SPAN.w - total) / 2;
  const y = 836, h = 62;
  PASSES.forEach((p, k) => {
    const pe = t - 4.4 - k * 0.32, w = widths[k], cx = px + w / 2;
    if (p.last) {
      wipe(ctx, move(pe / 0.7), px, y + 3, w, h - 6, () => rectStroke(ctx, px, y + 3, w, h - 6, C.line, 4, [13, 7]));
      alpha(ctx, fadeIn(pe - 0.3), () => text(ctx, p.s, cx, y + 39, 'label', C.ink, 'center'));
    } else {
      alpha(ctx, fadeIn(pe), () => {
        bracket(ctx, px, y, w, h);
        text(ctx, p.s, cx, y + 39, 'label', C.ink, 'center');
      });
    }
    p.cap.forEach((c, j) => {
      const s = typeof c === 'string' ? c : c.s;
      alpha(ctx, fadeIn(pe - 0.3), () => text(ctx, s, cx, y + 92 + j * 20, 'cap', c.color ?? C.ink, 'center'));
    });
    px += w + sp6;
    if (!p.last) thinArrow(ctx, px, y + h / 2, px + arrowW, y + h / 2, move((pe - 0.2) / 0.3));
    px += arrowW + sp6;
  });
}

// ── Scene ────────────────────────────────────────────────────────────────────

const PARTS = [
  (ctx, t) => { drawTitle(ctx, t); part1(ctx, t); },
  (ctx, t) => { drawTitle(ctx, 60); part2(ctx, t); },
  (ctx, t) => { drawTitle(ctx, 60); part3(ctx, t); },
  (ctx, t) => { drawTitle(ctx, 60); part4(ctx, t); },
  (ctx, t) => { drawTitle(ctx, 60); part5(ctx, t); },
];

function page(ctx, k, t) {
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, W, H);
  PARTS[k](ctx, t);
}

register({
  type: 'sketch.tech_arch', pack: 'sketch', kind: 'scene', category: 'Scenes',
  label: 'Technical Architecture Study',
  description: 'The five-part architecture diagram (game loop, physics, frame timing, animation, rendering) in the sketchbook GIF\'s style: rising title, red part headings, boxes that wipe in, a push to part 2 and cross-fades after.',
  duration: END_BEAT / 2,
  schema: {},
  render(ctx, clip, lt, env) {
    const F = env.frame;
    const at = (n) => onBeat(clip.start, n, env.beat) - clip.start;
    const starts = PART_BEATS.map(at);
    const s = Math.min(F.w / W, F.h / H);
    ctx.save();
    ctx.fillStyle = C.white;
    ctx.fillRect(0, 0, F.w, F.h);
    ctx.translate((F.w - W * s) / 2, (F.h - H * s) / 2);
    ctx.scale(s, s);
    let k = 0;
    while (k + 1 < starts.length && lt >= starts[k + 1]) k++;
    const local = lt - starts[k];
    if (k === 1 && local < PUSH + 0.6) {
      // Page push: part 1 slides out left as part 2 comes in from the right.
      const u = move(local / PUSH);
      ctx.save(); ctx.translate(-W * u, 0); page(ctx, 0, lt); ctx.restore();
      ctx.save(); ctx.translate(W * (1 - u), 0); page(ctx, 1, local); ctx.restore();
    } else if (k >= 2 && local < XFADE + 0.4) {
      page(ctx, k - 1, lt - starts[k - 1]);
      alpha(ctx, fadeIn(local), () => page(ctx, k, local));
    } else {
      page(ctx, k, local);
    }
    ctx.restore();
    env.box({ kind: 'box', name: 'page', x: 0, y: 0, w: F.w, h: F.h, gridBreak: true, settled: false });
    env.animating();
  },
  events(clip, env) {
    const at = (n) => onBeat(clip.start, n, env.beat);
    const hit = (n, sound, gain_db = -10, pitch) => ({ kind: 'hit', t: at(n), sound, gain_db, ...(pitch != null ? { pitch } : {}) });
    const motion = (role, t0) => ({ kind: 'motion', role, start: t0, peak: t0 + peak('soft'), settle: t0 + settle('soft'), preset: 'soft' });
    const out = [
      hit(1, 'sketch.tick', -12),
      hit(4, 'sketch.scratch', -12),
      hit(6, 'sketch.tick', -12, 1),
      hit(9, 'sketch.scratch', -12, 2),
      hit(10, 'sketch.rule', -10),
      hit(18, 'sketch.rule', -12),
      motion('title_lift', at(4)),
      motion('heading_slide', at(9)),
      motion('push', at(PART_BEATS[1])),
      hit(PART_BEATS[1], 'sketch.swipe', -6),
    ];
    PART_BEATS.slice(2).forEach((n, k) => {
      out.push(hit(n, 'sketch.tick', -10, k + 2));
      out.push(motion(`fade${k + 3}`, at(n)));
    });
    PART_BEATS.slice(1).forEach((n, k) => out.push(hit(n + 3, 'sketch.scratch', -14, k)));
    return out;
  },
});
