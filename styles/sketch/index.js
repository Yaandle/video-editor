// Sketch notebook — a hand-drawn explainer page, like a lab-book sheet: warm
// paper with a spiral binding, ink rules splitting the page into numbered
// panels, and a few coloured inks for what matters. Type is formal (a display
// serif for headings, a geometric sans for kickers and body, a maths serif for
// equations) and fades in softly; only the drawings and their annotations are
// in the hand, drawn on with a pen. Strokes wobble by a seeded offset along
// their length, so a line is the same line on every frame (no boil).
//
// The scene ends with a swipe to a fresh white page and a minimal, centred
// summary: big serif titles, red tracked caps, lines that blur in one by one,
// and a split where the first column slides left for the second.

import { register } from '#renderer/registry.js';
import { clamp01, sp, fade, peak, settle } from '#renderer/motion.js';
import { family } from '#renderer/tokens.js';
import { url } from '#renderer/assets.js';
import { onBeat } from '#renderer/kit.js';
import { noise1, rand } from '#renderer/prng.js';
import { parseTex, measure, drawNode, withFamily } from '#renderer/components/math.js';
import tokens from './tokens.json' with { type: 'json' };
import { IMAGES as ARCH_IMAGES } from './arch.js';

const ID = 'sketch';
const P = tokens.palette;
const T = tokens.type;
const W = 1920, H = 1080;                 // design space; scaled uniformly to the frame
const TEXT_SPEED = tokens.pen.text;       // px/s the pen travels while writing
const LINE_SPEED = tokens.pen.line;       // px/s along a stroke

const FAM = {
  display: `"${T.display.family}", ${T.display.fallback}`,
  sub: `"${T.sub.family}", ${T.sub.fallback}`,
  body: `"${T.body.family}", ${T.body.fallback}`,
  hand: `"${T.hand.family}", ${T.hand.fallback}`,
  math: T.math.stack,
};
// Type roles (px at 1080, tracking in em).
const ROLE = {
  title:   { fam: 'display', weight: 700, size: 60, track: T.display.tracking },
  heading: { fam: 'display', weight: 700, size: 34, track: T.display.tracking },
  hero:    { fam: 'display', weight: 700, size: 84, track: T.display.tracking },
  big:     { fam: 'display', weight: 700, size: 44, track: T.display.tracking },
  kicker:  { fam: 'sub', weight: 700, size: 16, track: 0.14, caps: true },
  caps:    { fam: 'sub', weight: 700, size: 20, track: 0.08, caps: true },
  stat:    { fam: 'sub', weight: 700, size: 21, track: 0 },
  body:    { fam: 'body', weight: 400, size: 20, track: 0 },
  small:   { fam: 'body', weight: 400, size: 17, track: 0 },
  th:      { fam: 'sub', weight: 700, size: 13, track: 0.14, caps: true },
  cell:    { fam: 'body', weight: 400, size: 22, track: 0 },
  note:    { fam: 'hand', weight: 400, size: 19, track: 0 },
};

function setType(ctx, role) {
  const r = ROLE[role];
  ctx.font = `${r.weight} ${r.size}px ${FAM[r.fam]}`;
  ctx.letterSpacing = `${r.track * r.size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}
const label = (role, s) => (ROLE[role].caps ? s.toUpperCase() : s);

/** Width of a string in a role (letter spacing adds after the last glyph; trim it). */
function widthOf(ctx, role, s) {
  setType(ctx, role);
  return ctx.measureText(label(role, s)).width - ROLE[role].track * ROLE[role].size;
}

/** Soft arrival: opacity, a short rise and a blur that clears (the look of the summary gif). */
function soft(ctx, e, draw, rise = 10) {
  if (e <= 0) return;
  const a = fade(e, 'soft');
  const y = (1 - clamp01(sp(e, 'soft'))) * rise;
  ctx.save();
  ctx.globalAlpha *= a;
  if (a < 0.99) ctx.filter = `blur(${((1 - a) * 6).toFixed(2)}px)`;
  ctx.translate(0, y);
  draw();
  ctx.restore();
}

// ── Pen: a cursor in time. Every call draws its element at its own progress and
// moves the cursor on, so a panel reads as one hand writing it in order. ──────

class Pen {
  constructor(ctx, now, t0, seed) { this.ctx = ctx; this.now = now; this.c = t0; this.seed = seed; this.n = 0; }
  at(t) { this.c = t; return this; }
  wait(s) { this.c += s; return this; }
  /** Progress of an element lasting d seconds that starts at the cursor; the cursor moves past it. */
  take(d, overlap = 0) {
    const p = clamp01((this.now - this.c) / d);
    this.c += d * (1 - overlap);
    return p;
  }
  /** Time since an element that takes `step` seconds of the cursor started. */
  since(step) { const e = this.now - this.c; this.c += step; return e; }

  /** Set type that fades in; align left / center / right on x. */
  type(str, x, y, role, color = P.ink, o = {}) {
    const ctx = this.ctx;
    const w = widthOf(ctx, role, str);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const e = this.since(o.step ?? 0.12);
    soft(ctx, e, () => { setType(ctx, role); ctx.fillStyle = color; ctx.fillText(label(role, str), left, y); });
    return w;
  }

  /** Handwritten annotation, written on left to right. */
  hand(str, x, y, size, color = P.ink, o = {}) {
    const ctx = this.ctx;
    ctx.font = `400 ${size}px ${FAM.hand}`;
    ctx.letterSpacing = '0px';
    const w = ctx.measureText(str).width;
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const p = this.take(Math.max(0.12, w / TEXT_SPEED), o.overlap ?? 0.2);
    if (p <= 0) return w;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 4, y - size * 1.1, (w + 8) * p, size * 1.6);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(str, left, y);
    ctx.restore();
    return w;
  }

  /** TeX-like equation (components/math.js syntax) in the maths serif; fades in. */
  eq(tex, x, y, size, color = P.ink, o = {}) {
    const ctx = this.ctx;
    const row = texRow(tex);
    ctx.letterSpacing = '0px';
    const m = withFamily(FAM.math, () => measure(ctx, row, size));
    const left = o.align === 'right' ? x - m.w : x;
    const e = this.since(o.step ?? 0.18);
    soft(ctx, e, () => { ctx.letterSpacing = '0px'; withFamily(FAM.math, () => drawNode(ctx, row, left, y, size, color, P.highlight)); }, 6);
    return m;
  }

  /** A hand stroke along points: wobbled, drawn on along its length. */
  stroke(pts, color = P.ink, width = 2.2, o = {}) {
    const path = wobble(pts, this.seed + this.n++, o.wobble ?? 1.1);
    const L = path.at(-1).s;
    const p = o.instant ? 1 : this.take(Math.max(o.min ?? 0.1, L / (o.speed ?? LINE_SPEED)), o.overlap ?? 0.3);
    if (p > 0) drawPartial(this.ctx, path, L * p, color, width, o.dash);
    return p;
  }
}

const texRow = (tex) => parseTex(tex).terms.reduce((a, t) => ({ k: 'row', items: [...a.items, ...t.items] }), { k: 'row', items: [] });

// ── Strokes ──────────────────────────────────────────────────────────────────

/** Densify a polyline and push each point off it by smooth seeded noise (∝ arc length). */
function wobble(pts, seed, amp) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 9));
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const u = k / n;
      const ss = s + len * u;
      const off = amp * noise1(seed, 0, ss / 70);
      out.push({ x: x0 + (x1 - x0) * u + nx * off, y: y0 + (y1 - y0) * u + ny * off, s: ss });
    }
    s += len;
  }
  return out;
}

function drawPartial(ctx, path, upTo, color, width, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (b.s <= upTo) { ctx.lineTo(b.x, b.y); continue; }
    const u = (upTo - a.s) / (b.s - a.s || 1);
    ctx.lineTo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    break;
  }
  ctx.stroke();
  ctx.restore();
}

const seg = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];
/** Hand circle: a little more than one turn, radius breathing, so the ends overlap. */
function ring(cx, cy, r, seed, ry = r) {
  const pts = [];
  const a0 = rand(seed, 'a') * Math.PI * 2;
  for (let k = 0; k <= 40; k++) {
    const a = a0 + (k / 40) * Math.PI * 2.12;
    const rr = 1 + 0.06 * noise1(seed, 1, k / 8);
    pts.push([cx + Math.cos(a) * r * rr, cy + Math.sin(a) * ry * rr]);
  }
  return pts;
}
function arrowHead(x, y, ang, s = 11) {
  return [[x - Math.cos(ang - 0.45) * s, y - Math.sin(ang - 0.45) * s], [x, y], [x - Math.cos(ang + 0.45) * s, y - Math.sin(ang + 0.45) * s]];
}

// ── The page ─────────────────────────────────────────────────────────────────

function paper(ctx, seed) {
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, W, H);
  // Fibre: faint seeded flecks, the same on every frame.
  ctx.fillStyle = P.fleck;
  for (let i = 0; i < 900; i++) {
    const x = rand(seed, 'fx', i) * W, y = rand(seed, 'fy', i) * H;
    ctx.globalAlpha = 0.03 + 0.05 * rand(seed, 'fa', i);
    ctx.fillRect(x, y, 1 + rand(seed, 'fw', i) * 2, 1);
  }
  ctx.globalAlpha = 1;
}

/** Spiral binding down the left edge: punched holes with wire loops through them. */
function binding(ctx) {
  ctx.fillStyle = P.margin;
  ctx.fillRect(0, 0, 78, H);
  for (let y = 30; y < H - 20; y += 36) {
    ctx.fillStyle = P.hole;
    ctx.beginPath(); ctx.ellipse(54, y, 6.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = P.wire;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, y + 9); ctx.quadraticCurveTo(26, y - 12, 52, y - 1); ctx.stroke();
    ctx.strokeStyle = P.wireLight;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(2, y + 4); ctx.quadraticCurveTo(26, y - 11, 46, y - 4); ctx.stroke();
  }
}

// Grid: left margin after the binding, three columns, two rows under the header.
const ML = 132, MR = 1840;
const HEAD_RULE = 214, FOOT = 1012;
const COLS = [ML, ML + (MR - ML) / 3, ML + (2 * (MR - ML)) / 3, MR];
const ROWS = [HEAD_RULE, (HEAD_RULE + FOOT) / 2, FOOT];
const PAD = 40;
/** Panel i: its box and its content box (the first column sits on the margin, like the title). */
function panelAt(i) {
  const c = i % 3, r = Math.floor(i / 3);
  const x = COLS[c], y = ROWS[r], w = COLS[c + 1] - x, h = ROWS[r + 1] - y;
  const x0 = c === 0 ? x : x + PAD;
  return { x, y, w, h, x0, x1: x + w - PAD, cy: y + 158 };
}

function panelHead(pen, i, title, desc) {
  const b = panelAt(i);
  pen.type(`0${i + 1}`, b.x0, b.y + 50, 'kicker', P.red, { step: 0.08 });
  pen.type(title, b.x0, b.y + 92, 'heading', P.ink, { step: 0.14 });
  pen.type(desc, b.x0, b.y + 126, 'body', P.faint, { step: 0.2 });
  return b;
}

// ── Stage 3 content (the MLP marking cue) ───────────────────────────────────

const FEATURES = [['h', 'ball height', P.red], ['d', 'ball distance', P.green], ['v', 'player speed', P.orange], ['\\tau', 'time to arrival', P.blue], ['\\cos \\phi', 'approach angle', P.ink]];

function header(pen, p) {
  pen.type(p.title, ML, 120, 'title', P.ink, { step: 0.3 });
  pen.type(p.kicker, ML, 170, 'caps', P.red, { step: 0.3 });
  p.intro.split('\n').forEach((l, k) => pen.type(l, MR, 124 + k * 30, 'body', P.faint, { align: 'right', step: 0.1 }));
}

function rules(pen) {
  pen.stroke(seg(ML - 8, HEAD_RULE, MR + 8, HEAD_RULE), P.rule, 1.6, { speed: 5200 });
  pen.stroke(seg(ML - 8, ROWS[1], MR + 8, ROWS[1]), P.rule, 1.6, { speed: 5200, overlap: 0.9 });
  pen.stroke(seg(COLS[1], HEAD_RULE + 18, COLS[1], FOOT - 18), P.rule, 1.6, { speed: 4200, overlap: 0.5 });
  pen.stroke(seg(COLS[2], HEAD_RULE + 18, COLS[2], FOOT - 18), P.rule, 1.6, { speed: 4200, overlap: 0.9 });
  pen.stroke(seg(ML - 8, FOOT, MR + 8, FOOT), P.rule, 1.6, { speed: 5200, overlap: 0.6 });
}

function footer(pen, p) {
  pen.type(p.footer_left, ML, 1050, 'kicker', P.faint, { step: 0.1 });
  pen.type(p.footer_right, MR, 1050, 'kicker', P.faint, { align: 'right' });
}

// 01 · the cue: the kick's flight, a time axis, the catch window and three presses.
const FLIGHT = 1.45, WIN = [0.9, 1.2], BEST = 1.05;
function cueGeom(b) {
  const axisY = b.cy + 150;
  const tx = (t) => b.x0 + 8 + (t / 1.6) * (b.x1 - b.x0 - 28);
  const arcY = (t) => axisY - 30 - 4 * 112 * (t / FLIGHT) * (1 - t / FLIGHT) - 6 * (t / FLIGHT);
  return { axisY, tx, arcY };
}

function panelCue(pen, hold) {
  const b = panelHead(pen, 0, 'The cue', 'A 22 m kick hangs for 1.45 s. Press in the window.');
  const { axisY, tx, arcY } = cueGeom(b);
  pen.stroke(seg(b.x0, axisY, b.x1, axisY), P.ink, 2);
  pen.stroke(arrowHead(b.x1, axisY, 0), P.ink, 2, { min: 0.05 });
  [[0, '0'], [0.5, '0.5'], [1.0, '1.0'], [FLIGHT, '1.45 s']].forEach(([t, l]) => {
    pen.stroke(seg(tx(t), axisY - 5, tx(t), axisY + 5), P.ink, 1.8, { min: 0.03 });
    pen.hand(l, tx(t), axisY + 27, 18, P.faint, { align: 'center', overlap: 0.6 });
  });
  const arc = [];
  for (let k = 0; k <= 30; k++) { const t = (k / 30) * FLIGHT; arc.push([tx(t), arcY(t)]); }
  pen.stroke(arc, P.ink, 1.8, { dash: [8, 8], speed: 1500 });
  // Catch window: hatched in orange on the axis.
  const wx0 = tx(WIN[0]), wx1 = tx(WIN[1]);
  pen.stroke([[wx0, axisY], [wx0, axisY - 16], [wx1, axisY - 16], [wx1, axisY]], P.orange, 2);
  for (let x = wx0 + 7; x < wx1 - 2; x += 8) pen.stroke(seg(x, axisY - 1, Math.min(x + 7, wx1), axisY - 15), P.orange, 1.2, { min: 0.02, overlap: 0.7, wobble: 0.3 });
  pen.hand('catch window ≈ 0.3 s', (wx0 + wx1) / 2, axisY - 28, 19, P.orange, { align: 'center' });
  // Presses: early ✗ (blue), good ✓ (green), late ✗ (red), on one baseline.
  const my = axisY + 62;
  const cross = (x, c) => { pen.stroke(seg(x - 6, my - 12, x + 6, my), c, 2.4, { min: 0.05 }); pen.stroke(seg(x + 6, my - 12, x - 6, my), c, 2.4, { min: 0.05 }); };
  cross(tx(0.6), P.blue); pen.hand('early', tx(0.6) + 13, my, 19, P.blue);
  pen.stroke([[tx(BEST) - 8, my - 5], [tx(BEST) - 2, my + 1], [tx(BEST) + 9, my - 13]], P.green, 2.6, { min: 0.06 });
  pen.hand('good', tx(BEST) + 14, my, 19, P.green);
  cross(tx(1.35), P.red); pen.hand('late', tx(1.35) + 13, my, 19, P.red);
  const e = pen.since(0);
  if (!hold) ball(pen.ctx, tx(FLIGHT), arcY(FLIGHT), clamp01(e / 0.2));
  // Hold: the ball flies the arc every bar; the good press rings as it passes 1.05 s.
  if (hold) {
    const u = hold.t % hold.loop;
    const t = Math.min(u, FLIGHT);
    ball(pen.ctx, tx(t), arcY(t), 1, u < FLIGHT);
    const since = u - BEST;
    if (since > 0 && since < 0.5) {
      const ctx = pen.ctx;
      ctx.save();
      ctx.globalAlpha = 1 - since / 0.5;
      drawPartial(ctx, wobble(ring(tx(BEST) + 16, my - 6, 24 + since * 26, 77), 77, 0.8), 1e9, P.green, 2);
      ctx.restore();
    }
  }
}

function ball(ctx, x, y, a, moving = false) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(x, y);
  ctx.rotate(moving ? -0.5 : 0.35);
  ctx.fillStyle = P.paper;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 14, 8.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
  for (let k = -4; k <= 4; k += 4) { ctx.moveTo(k, -3); ctx.lineTo(k, 3); }
  ctx.stroke();
  ctx.restore();
}

// 02 · inputs: the feature vector and its scaling.
function panelInputs(pen) {
  const b = panelHead(pen, 1, 'The inputs', 'Five numbers a frame, scaled to mean 0, spread 1.');
  const step = 36, top = b.cy + 34;
  pen.eq('x =', b.x0, top + 2 * step, 30);
  const bx = b.x0 + 62, br = bx + 96;
  const bTop = top - 26, bBot = top + 4 * step + 12;
  pen.stroke([[bx + 9, bTop], [bx, bTop], [bx, bBot], [bx + 9, bBot]], P.ink, 2);
  FEATURES.forEach(([sym, lab, c], k) => {
    pen.eq(sym, bx + 18, top + k * step, 26, c, { step: 0.06 });
    pen.type(lab, br + 34, top + k * step - 2, 'small', P.faint, { step: 0.06 });
  });
  pen.stroke([[br - 9, bTop], [br, bTop], [br, bBot], [br - 9, bBot]], P.ink, 2);
  pen.eq('T', br + 6, bTop + 10, 20);
  pen.wait(0.1);
  pen.eq('x_j \\leftarrow \\frac{x_j - \\mu_j}{\\sigma_j}', b.x1, top + 1.6 * step, 30, P.ink, { align: 'right' });
  pen.hand('μ, σ from training', b.x1, top + 3.3 * step, 18, P.faint, { align: 'right' });
}

// 03 · the network: 5 → 8 → 8 → 1 with tanh hidden layers.
const LAYERS = [5, 8, 8, 1];
function netGeom(b) {
  const x = (l) => b.x0 + 14 + l * ((b.x1 - b.x0 - 74) / 3);
  const cy = b.cy + 102;
  return (l, k) => [x(l), cy + (k - (LAYERS[l] - 1) / 2) * (LAYERS[l] === 5 ? 32 : 22)];
}

function network(pen, node, o = {}) {
  const c0 = pen.c;
  for (let l = 0; l < LAYERS.length; l++) {
    pen.at(c0 + l * 0.2);
    for (let k = 0; k < LAYERS[l]; k++) { const [x, y] = node(l, k); pen.stroke(ring(x, y, o.r ?? 8, 31 * l + k), P.ink, 1.8, { min: 0.12, overlap: 0.85, wobble: 0.25 }); }
    if (l === 0) continue;
    pen.at(c0 + l * 0.2 - 0.1);
    for (let a = 0; a < LAYERS[l - 1]; a++) for (let k = 0; k < LAYERS[l]; k++) {
      const [x0, y0] = node(l - 1, a), [x1, y1] = node(l, k);
      const r = (o.r ?? 8) + 1;
      pen.stroke(seg(x0 + r, y0, x1 - r, y1), P.edge, 0.9, { min: 0.18, overlap: 0.97, wobble: 0.4 });
    }
  }
  pen.at(c0 + LAYERS.length * 0.2);
}

function pulses(ctx, node, hold) {
  // A pulse crosses one layer gap per beat, input → output.
  const n = Math.floor(hold.t / hold.beat), g = n % 3, u = (hold.t % hold.beat) / hold.beat;
  ctx.fillStyle = P.orange;
  for (let j = 0; j < 5; j++) {
    const a = Math.floor(rand(hold.seed, 'pa', n, j) * LAYERS[g]), k = Math.floor(rand(hold.seed, 'pk', n, j) * LAYERS[g + 1]);
    const [x0, y0] = node(g, a), [x1, y1] = node(g + 1, k);
    const e = clamp01(sp(u * hold.beat, 'soft'));
    ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function panelNetwork(pen, hold) {
  const b = panelHead(pen, 2, 'The network', 'One output: seconds until the best press.');
  const node = netGeom(b);
  for (let l = 1; l < 3; l++) pen.hand('tanh', node(l, 0)[0], node(l, 0)[1] - 18, 18, P.blue, { align: 'center', overlap: 0.5 });
  network(pen, node);
  const [ox, oy] = node(3, 0);
  pen.eq('\\hat{y}', ox + 18, oy + 8, 26, P.green);
  pen.eq('(5 \\cdot 8 + 8) + (8 \\cdot 8 + 8) + (8 + 1) = 129', b.x0, b.cy + 222, 20, P.faint);
  pen.type('weights', b.x1, b.cy + 222, 'small', P.faint, { align: 'right' });
  if (hold) pulses(pen.ctx, node, hold);
}

// 04 · forward pass.
function panelForward(pen) {
  const b = panelHead(pen, 3, 'Forward pass', 'Each layer weighs, adds a bias, then squashes.');
  const x = b.x0, y = b.cy + 34, gap = 50, nx = b.x1;
  pen.eq('h_1 = \\tanh(W_1 x + b_1)', x, y, 29);
  pen.type('8 × 5 weights', nx, y, 'small', P.faint, { align: 'right' });
  pen.eq('h_2 = \\tanh(W_2 h_1 + b_2)', x, y + gap, 29);
  pen.type('8 × 8 weights', nx, y + gap, 'small', P.faint, { align: 'right' });
  pen.eq('\\hat{y} = w_3 \\cdot h_2 + b_3', x, y + 2 * gap, 29);
  pen.type('in seconds', nx, y + 2 * gap, 'small', P.faint, { align: 'right' });
  pen.wait(0.15);
  pen.type('Press when', x, y + 3 * gap + 22, 'stat', P.green);
  pen.eq('\\hat{y} \\leq \\frac{1}{60} \\text{s}', x + widthOf(pen.ctx, 'stat', 'Press when') + 14, y + 3 * gap + 22, 29, P.green);
  pen.type('one frame', nx, y + 3 * gap + 22, 'small', P.faint, { align: 'right' });
}

// 05 · training.
function panelTraining(pen) {
  const b = panelHead(pen, 4, 'Training', '464 real attempts; y is the time to the press that caught it.');
  const x = b.x0, nx = b.x1;
  pen.eq('L = \\frac{1}{N} \\sum_{i=1}^{N} (\\hat{y}_i - y_i)^2', x, b.cy + 44, 29);
  pen.eq('N = 464', nx, b.cy + 44, 20, P.faint, { align: 'right' });
  pen.eq('\\theta \\leftarrow \\theta - \\eta \\frac{\\partial L}{\\partial \\theta}', x, b.cy + 116, 29);
  pen.eq('\\tanh\'(z) = 1 - \\tanh^2(z)', nx, b.cy + 116, 19, P.faint, { align: 'right' });
  // Code box, dark like the reference sheets.
  const cx = x, cy = b.cy + 142, cw = b.x1 - x, ch = 76;
  const ctx = pen.ctx;
  soft(ctx, pen.since(0.15), () => { ctx.fillStyle = P.code; roundRect(ctx, cx, cy, cw, ch, 8); ctx.fill(); }, 4);
  const mono = `"${family('code')}", monospace`;
  const lines = [['# fit 129 weights to 464 attempts', P.codeComment], ['loss = ((pred - y) ** 2).mean()', P.codeInk], ['loss.backward(); opt.step()', P.codeInk]];
  lines.forEach(([s, c], k) => soft(ctx, pen.since(0.1), () => {
    ctx.font = `400 15px ${mono}`; ctx.letterSpacing = '0px'; ctx.fillStyle = c; ctx.fillText(s, cx + 20, cy + 26 + k * 21);
  }, 4));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 06 · results.
const RESULTS = [['Old cue', '23 / 27', '0.067 s'], ['Gated cue', '24 / 27', '0.063 s'], ['MLP cue', '25 / 27', '0.060 s']];
function resultsGeom(b) {
  const cols = [b.x0, b.x0 + 210, b.x1];
  return { cols, top: b.cy + 14, rh: 44 };
}

function panelResults(pen, swash) {
  const b = panelHead(pen, 5, 'Results', 'Caught, and error = mean |ŷ − y|, on 27 test kicks.');
  const { cols, top, rh } = resultsGeom(b);
  // The marker swash sits under the MLP row's ink.
  if (swash > 0) {
    const ctx = pen.ctx;
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawPartial(ctx, wobble(seg(b.x0 - 10, top + 14 + 2 * rh + 22, b.x1 + 8, top + 14 + 2 * rh + 20), 11, 1.5), (b.x1 - b.x0 + 14) * swash, P.highlight, 30);
    ctx.restore();
  }
  pen.type('Cue', cols[0], top, 'th', P.faint, { step: 0.05 });
  pen.type('Caught', cols[1], top, 'th', P.faint, { step: 0.05 });
  pen.type('Error', cols[2], top, 'th', P.faint, { align: 'right' });
  for (let r = 0; r <= 3; r++) pen.stroke(seg(b.x0, top + 14 + r * rh, b.x1, top + 14 + r * rh), r === 0 ? P.rule : P.edge, r === 0 ? 1.6 : 1, { overlap: 0.6, wobble: 0.5 });
  RESULTS.forEach(([cue, caught, err], r) => {
    const y = top + 14 + r * rh + 30, c = r === 2 ? P.green : P.ink;
    pen.type(cue, cols[0], y, 'cell', c, { step: 0.05 });
    pen.type(caught, cols[1], y, 'cell', c, { step: 0.05 });
    pen.type(err, cols[2], y, 'cell', c, { align: 'right' });
  });
  pen.wait(0.1);
  pen.type('0.060 s × 60 fps ≈ 3.6 frames of error', b.x0, b.cy + 216, 'small', P.faint);
}

// ── Ending: a fresh page and a two-column summary ───────────────────────────

/** A column like the summary gif: title, red caps, stat lines beside a sketch, a flow line. */
function column(ctx, now, t0, cx, titleY, c, seed) {
  const pen = new Pen(ctx, now, t0, seed);
  const tw = widthOf(ctx, 'hero', c.title);
  // The first column's title lands centred, then rises into place; the second lands in place.
  const rise = c.rise ? 1 - clamp01(sp(now - (t0 + c.rise), 'soft')) : 0;
  soft(ctx, pen.since(c.rise ? c.rise + 0.4 : 0.4), () => { setType(ctx, 'hero'); ctx.fillStyle = P.ink; ctx.fillText(c.title, cx - tw / 2, titleY + rise * (H / 2 + 28 - titleY)); }, 12);
  pen.type(c.caps, cx, titleY + 62, 'caps', P.red, { align: 'center', step: 0.35 });
  const top = titleY + 124, bx = cx - 250;
  c.stats.forEach((s, k) => pen.type(s, bx, top + k * 32, 'stat', P.red, { step: 0.35 }));
  // Sketch wipes in beside the stats.
  const e = pen.since(0.8);
  if (e > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 20, top - 60, 300 * clamp01(sp(e, 'soft')), 150); ctx.clip();
    c.sketch(new Pen(ctx, now, now - 10, seed + 7), cx + 10, top - 34);
    ctx.restore();
  }
  pen.type(c.flow, cx, top + 150, 'body', P.ink, { align: 'center' });
}

function oldCueSketch(pen, x, y) {
  const ax = y + 70;
  pen.stroke(seg(x, ax, x + 240, ax), P.ink, 1.8, { instant: true });
  pen.stroke(arrowHead(x + 240, ax, 0, 9), P.ink, 1.8, { instant: true });
  const ctx = pen.ctx;
  ctx.fillStyle = P.faint;
  ctx.beginPath(); ctx.arc(x + 36, ax, 6, 0, Math.PI * 2); ctx.fill();
  pen.stroke([[x + 120, ax], [x + 120, ax - 12], [x + 170, ax - 12], [x + 170, ax]], P.orange, 1.8, { instant: true });
  pen.stroke(seg(x + 36, ax - 12, x + 36, ax - 34), P.faint, 1.4, { instant: true });
  pen.hand('fires > 6 m out', x + 6, ax - 42, 18, P.faint);
  pen.hand('window', x + 145, ax + 24, 17, P.orange, { align: 'center' });
}

function mlpSketch(pen, x, y) {
  const node = (l, k) => [x + 12 + l * 62, y + 62 + (k - (LAYERS[l] - 1) / 2) * (LAYERS[l] === 5 ? 18 : 13)];
  network(pen, node, { r: 4.5 });
  pen.hand('ŷ', node(3, 0)[0] + 12, node(3, 0)[1] + 6, 20, P.green);
}

const OLD_COL = {
  title: 'Old cue', caps: 'The baseline', rise: 1.0,
  stats: ['23 / 27 caught', '0.067 s cue error', '1 distance trigger'],
  sketch: oldCueSketch, flow: 'ball > 6 m out → press → expires after 0.12 s',
};
const MLP_COL = {
  title: 'MLP cue', caps: 'The result',
  stats: ['25 / 27 caught', '0.060 s cue error', '129 weights'],
  sketch: mlpSketch, flow: 'x → tanh → tanh → ŷ ≤ 1/60 s',
};

function ending(ctx, now, B, seed) {
  // Beats from the fresh page: column A 0–5, split at 6, column B 7–12, close 13.
  ctx.fillStyle = P.white;
  ctx.fillRect(0, 0, W, H);
  if (now < 0) return;
  const split = clamp01(sp(now - 6 * B, 'soft'));
  const titleY = 330;
  column(ctx, now, 0, 960 - 440 * split, titleY, OLD_COL, seed);
  if (now > 6 * B) column(ctx, now, 7 * B, 1400, titleY, MLP_COL, seed + 1);
  const pen = new Pen(ctx, now, 13 * B, seed + 2);
  pen.type('+2 marks, 7 ms sharper.', 960, 760, 'big', P.ink, { align: 'center', step: 3 * B });
  pen.type('Next · Stage 4 · Deep Q-learning', 960, 812, 'kicker', P.faint, { align: 'center' });
}

/** The swipe: a fresh white sheet slides over the page from the right, soft shadow on its edge. */
function swipe(ctx, p) {
  const x = W * (1 - p);
  const g = ctx.createLinearGradient(x - 40, 0, x, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 40, 0, 40, H);
  ctx.fillStyle = P.white;
  ctx.fillRect(x, 0, W - x, H);
}

// ── Scene ────────────────────────────────────────────────────────────────────

// Beat each part starts on, from the clip start.
const SCHEDULE = { title: 1, rules: 3, panels: [4, 8, 12, 16, 20, 24], mark: 28, swipe: 33, ending: 34 };
const ZOOM = 1.9;       // camera scale on a panel while it is drawn
const CAM_LEAD = 0.4;   // a move starts this long before its beat, so it lands as the panel starts

/** Camera framings in order: whole page for the header, each panel, whole page again at the mark. */
function shots(at) {
  const page = { x: W / 2, y: H / 2, z: 1 };
  const list = [{ t: -1, ...page }];
  SCHEDULE.panels.forEach((n, i) => {
    const b = panelAt(i);
    list.push({ t: at(n) - CAM_LEAD, x: b.x + b.w / 2, y: b.y + b.h / 2, z: ZOOM });
  });
  list.push({ t: at(SCHEDULE.mark) - CAM_LEAD, ...page });
  return list;
}

/** Camera at time t: spring from the previous framing to the current one, kept inside the page. */
function camera(list, t) {
  let k = 0;
  while (k + 1 < list.length && list[k + 1].t <= t) k++;
  const a = list[Math.max(0, k - 1)], b = list[k];
  const u = k === 0 ? 1 : clamp01(sp(t - b.t, 'soft'));
  const z = a.z + (b.z - a.z) * u;
  const hw = W / (2 * z), hh = H / (2 * z);
  const x = Math.min(W - hw, Math.max(hw, a.x + (b.x - a.x) * u));
  const y = Math.min(H - hh, Math.max(hh, a.y + (b.y - a.y) * u));
  return { x, y, z };
}

register({
  type: 'sketch.mlp_cue', pack: ID, kind: 'scene', category: 'Scenes',
  label: 'Sketch page: MLP marking cue',
  description: 'A notebook explainer page drawn on panel by panel (cue, inputs, network, forward pass, training, results), then a swipe to a fresh page with a two-column summary.',
  duration: 26,
  schema: {
    title: { type: 'text', default: 'When to jump for the mark', label: 'Title', maxLength: 50 },
    kicker: { type: 'text', default: 'Stage 3 · Multi-layer perceptron', label: 'Kicker (red caps)', maxLength: 50 },
    intro: { type: 'text', default: 'A small network learns when to press mark,\nso the player leaves the ground on time.', label: 'Intro (two lines)', maxLength: 110 },
    footer_left: { type: 'text', default: 'Footy-ML · Stage 3 of 4', label: 'Footer left', maxLength: 50 },
    footer_right: { type: 'text', default: 'The model times the cue. Physics decides the catch.', label: 'Footer right', maxLength: 70 },
  },
  render(ctx, clip, lt, env) {
    const p = env.props;
    const F = env.frame;
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    const at = (n) => onBeat(clip.start, n, env.beat) - clip.start;
    const s = Math.min(F.w / W, F.h / H);
    ctx.save();
    ctx.fillStyle = P.white;
    ctx.fillRect(0, 0, F.w, F.h);
    ctx.translate((F.w - W * s) / 2, (F.h - H * s) / 2);
    ctx.scale(s, s);
    const sw = clamp01(sp(lt - at(SCHEDULE.swipe), 'soft'));
    if (sw < 0.999) {
      const cam = camera(shots(at), lt);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.z, cam.z);
      ctx.translate(-cam.x, -cam.y);
      paper(ctx, env.seed);
      binding(ctx);
      const pen = (n) => new Pen(ctx, lt, at(n), env.seed * 131 + n);
      header(pen(SCHEDULE.title), p);
      rules(pen(SCHEDULE.rules));
      footer(pen(SCHEDULE.rules + 1), p);
      const holdT = lt - at(SCHEDULE.mark);
      const hold = holdT > 0 ? { t: holdT, beat: B, loop: 4 * B, seed: env.seed } : null;
      // Highlighter swipe on the press rule, under the ink (drawn before panel 4).
      const hp = clamp01((lt - at(SCHEDULE.mark)) / 0.35);
      if (hp > 0) {
        const b = panelAt(3), y = b.cy + 34 + 150 + 22 - 9;
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawPartial(ctx, wobble(seg(b.x0 - 8, y + 2, b.x0 + 300, y), 5, 1.5), 308 * hp, P.highlight, 32);
        ctx.restore();
      }
      const [p1, p2, p3, p4, p5, p6] = SCHEDULE.panels.map(pen);
      panelCue(p1, hold);
      panelInputs(p2);
      panelNetwork(p3, hold);
      panelForward(p4);
      panelTraining(p5);
      panelResults(p6, clamp01((lt - at(SCHEDULE.mark) - 0.3) / 0.4));
      ctx.restore();
    }
    if (sw > 0) {
      if (sw < 0.999) swipe(ctx, sw);
      else ending(ctx, lt - at(SCHEDULE.ending), B, env.seed);
    }
    ctx.restore();
    env.box({ kind: 'box', name: 'page', x: 0, y: 0, w: F.w, h: F.h, gridBreak: true, settled: false });
    env.animating();
  },
  events(clip, env) {
    const at = (n) => onBeat(clip.start, n, env.beat);
    const B = env.beat?.valid ? env.beat.beat : 0.5;
    const E = at(SCHEDULE.ending);
    const out = [
      { kind: 'hit', t: at(SCHEDULE.title), sound: 'sketch.tick', gain_db: -10 },
      { kind: 'hit', t: at(SCHEDULE.rules), sound: 'sketch.rule', gain_db: -10 },
      { kind: 'hit', t: at(SCHEDULE.mark), sound: 'sketch.marker', gain_db: -6 },
      { kind: 'hit', t: at(SCHEDULE.swipe), sound: 'sketch.swipe', gain_db: -6 },
    ];
    SCHEDULE.panels.forEach((n, k) => out.push({ kind: 'hit', t: at(n), sound: 'sketch.scratch', gain_db: -10, pitch: k }));
    const rel = (n) => at(n) - clip.start;
    shots(rel).slice(1).forEach((c, k) => {
      const t0 = clip.start + c.t;
      out.push({ kind: 'motion', role: k < SCHEDULE.panels.length ? `camera${k + 1}` : 'camera_out', start: t0, peak: t0 + peak('soft'), settle: t0 + settle('soft'), preset: 'soft' });
    });
    const sw = at(SCHEDULE.swipe);
    out.push({ kind: 'motion', role: 'swipe', start: sw, peak: sw + peak('soft'), settle: sw + settle('soft'), preset: 'soft' });
    out.push({ kind: 'motion', role: 'split', start: E + 6 * B, peak: E + 6 * B + peak('soft'), settle: E + 6 * B + settle('soft'), preset: 'soft' });
    [0, 2, 6, 7, 9, 13, 16].forEach((n, k) => out.push({ kind: 'hit', t: E + n * B, sound: 'sketch.tick', gain_db: -12, pitch: k }));
    return out;
  },
});

export default {
  id: ID,
  label: tokens.label,
  description: 'A hand-drawn notebook page: warm paper, spiral binding, ruled panels, formal serif and sans type, a few coloured inks, drawings drawn on with a pen.',
  tokens,
  schema: {},
  overrides: {},
  async load(api) {
    // One source per role (tokens.json "type"): a stand-in until the licensed
    // face is copied into styles/sketch/fonts/ and named as the source.
    await Promise.all(['display', 'sub', 'body', 'hand', 'gotham'].map(async (k) => {
      const r = T[k];
      const src = r.source.startsWith('local(') ? r.source : `url("${url(r.source)}")`;
      const f = new FontFace(r.family, src, r.desc ?? {});
      await f.load();
      document.fonts.add(f);
    }));
    // The architecture study's exact type, cut from the sketchbook GIF.
    if (api) await Promise.all(ARCH_IMAGES.map((p) => api.image(p)));
  },
};
