// scene.footy-breakdown — a coach reviewing one moment of match footage:
// the clip plays to the moment, freezes on the exact frame, the background
// dims, the frame is drawn on (rings, spotlights, arrows, spacing lines,
// zones, labels), a short caption explains the point, then the play runs out
// (optionally slow) and a closing line names the outcome.
//
// Timing is in whole frames (breakdown/timing.js): source frames of the clip's
// constant-frame-rate proxy, decoded at the proxy's own rate (mediaFrames), so
// a freeze is exactly freeze_f. Positions are video px of the proxy; tracks are
// keyed by source frame (breakdown/keys.js), ready for dense tracker output.
// The footage camera (breakdown/camera.js) crops for tall frames and fits the
// window to the annotations at the freeze, so the marked area stays on screen.

import { register } from '../registry.js';
import { color, type as typeRole, border, shadow } from '../tokens.js';
import { sp, clamp01, lerp } from '../motion.js';
import { setFont, textBlock, gridLines, reportBox } from '../kit.js';
import { layoutText } from '../text.js';
import { box, hatch } from '../draw.js';
import { plan as makePlan, sourceAt, timecode, DEFAULTS } from '../breakdown/timing.js';
import { prepareTracks, resolvePoint, annotationBounds, sample, smoother } from '../breakdown/keys.js';
import { followWindow, fitWindow, blendWindow, moveProgress, mapping } from '../breakdown/camera.js';

const DIM = 0.52;            // ink over the footage while frozen
const PUSH_S = 0.5;          // camera move into / out of the freeze framing
const CATEGORY = { positioning: 'Positioning', spacing: 'Spacing', contest: 'Contest', decision: 'Decision', technique: 'Technique' };

// ── plan memo (keyed by the resolved props object and fps: its full inputs) ──
const MEMO = new WeakMap();
function built(props, fps) {
  let byFps = MEMO.get(props);
  if (!byFps) MEMO.set(props, (byFps = new Map()));
  if (!byFps.has(fps)) {
    const moments = props.moments ?? [];
    const p = makePlan({ clip: props.clip, moments, fps, options: props.timing ?? {} });
    byFps.set(fps, { p, tracks: moments.map((m) => prepareTracks(m.tracks)) });
  }
  return byFps.get(fps);
}

/** Output frame and source position at clip-local time lt. */
function state(props, lt, fps) {
  const B = built(props, fps);
  const n = Math.max(0, Math.round(lt * fps));
  const s = sourceAt(B.p, n);
  const mi = s.seg ? s.seg.moment : 0;
  return { B, n, s, mi, rec: B.p.moments[mi], m: (props.moments ?? [])[mi], tracks: B.tracks[mi] ?? {} };
}

// ── layout ───────────────────────────────────────────────────────────────────
function layout(frame, u) {
  const W = frame.w, H = frame.h;
  const nav = 88 * u, foot = 64 * u;
  if (H > W * 1.15) {
    const m = 64 * u;
    const panel = { x: m, y: nav + 286 * u, w: W - 2 * m, h: 840 * u };
    return {
      portrait: true, m,
      kicker: { x: m, y: nav + 52 * u, w: W - 2 * m },
      title: { x: m, y: nav + 100 * u, w: W - 2 * m, size: 72 },
      panel,
      credit: { x: m, y: panel.y + panel.h + 36 * u, w: W - 2 * m },
      card: { x: m, y: panel.y + panel.h + 84 * u, w: W - 2 * m, h: 340 * u },
      text: { size: 44, min: 36, chip: 26 },
    };
  }
  const m = 96 * u;
  const pw = Math.round((W - 2 * m) * 0.64);
  const panel = { x: m, y: nav + 64 * u, w: pw, h: Math.round(pw * 9 / 16) };
  const cx = m + pw + 56 * u, cw = W - m - cx;
  return {
    portrait: false, m,
    kicker: { x: cx, y: panel.y, w: cw },
    title: { x: cx, y: panel.y + 48 * u, w: cw, size: 58 },
    panel,
    credit: { x: m, y: panel.y + panel.h + 40 * u, w: pw },
    card: { x: cx, y: panel.y + 260 * u, w: cw, h: panel.y + panel.h - (panel.y + 260 * u) },
    text: { size: 36, min: 28, chip: 22 },
    foot,
  };
}

// ── camera ───────────────────────────────────────────────────────────────────
function cameraAt(props, st, panel) {
  const { m, rec, tracks, n, s, B } = st;
  const clip = props.clip, src = { w: clip.width, h: clip.height };
  const aspect = panel.w / panel.h;
  const cam = m?.camera ?? {};
  const fps = B.p.fps;
  const focusAt = (pos) => (cam.focus && tracks[cam.focus] ? sample(tracks[cam.focus], pos) : cam.at ?? null);
  const play = followWindow(focusAt(s.pos), src, aspect, cam.zoom ?? 1);
  if (!rec || cam.freeze === 'hold') return play;
  const box0 = annotationBounds(m.annotations, tracks, rec.freeze_f);
  const fit = fitWindow(box0, src, aspect, { margin: cam.margin ?? 0.2, maxZoom: cam.max_zoom ?? 1.35, minZoom: cam.min_zoom ?? 1 });
  const len = Math.round(PUSH_S * fps);
  let w = 0;
  if (n >= rec.freeze0 && n < rec.resume0) w = moveProgress(n, rec.freeze0, len);
  else if (n >= rec.resume0) w = 1 - moveProgress(n, rec.resume0, len);
  if (w <= 0) return play;
  // the play framing at the freeze is where the push starts / the pull-back ends
  const anchor = followWindow(focusAt(n < rec.resume0 ? rec.freeze_f : s.pos), src, aspect, cam.zoom ?? 1);
  return blendWindow(anchor, fit, w);
}

// ── drawing helpers ──────────────────────────────────────────────────────────
function inkStroke(ctx, path, fill, w, u) {
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color('ink');
  ctx.lineWidth = w + 6 * u;
  ctx.stroke(path);
  ctx.strokeStyle = color(fill);
  ctx.lineWidth = w;
  ctx.stroke(path);
}

function chip(ctx, text, x, y, o) {
  const { u, size, fill = 'lime', align = 'left', frame } = o;
  const r = typeRole('label', frame, { font: 'mono-bold', size: size / u, weight: 700, tracking: 0.04 });
  setFont(ctx, r);
  const t = String(text).toUpperCase();
  const pad = 12 * u;
  const w = ctx.measureText(t).width + pad * 2, h = r.size + pad * 1.4;
  const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  box(ctx, bx, y, w, h, { fill: color(fill), stroke: color('ink'), strokeW: Math.max(2, 3 * u), shadow: { x: 6 * u, y: 6 * u, color: color('ink') } });
  ctx.fillStyle = color(fill === 'ink' || fill === 'cobalt' ? 'paper' : 'ink');
  ctx.fillText(t, bx + pad, y + h / 2 + r.size * 0.36);
  return { x: bx, y, w, h, size: r.size, text: t };
}

/** Polyline through panel points, cut at fraction p of its length. Returns { path, tip, dir }. */
function partialPath(pts, p) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(l);
    total += l;
  }
  const want = total * clamp01(p);
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  let acc = 0, tip = pts[0], dir = { x: 1, y: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = segs[i - 1];
    if (l > 0) dir = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    if (acc + l >= want) {
      const k = l > 0 ? (want - acc) / l : 0;
      tip = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
      path.lineTo(tip.x, tip.y);
      return { path, tip, dir, total };
    }
    acc += l;
    path.lineTo(b.x, b.y);
    tip = b;
  }
  return { path, tip, dir, total };
}

/** Quadratic curve from a through control c to b, as points. */
function curvePts(a, c, b, n = 28) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = 1 - t;
    out.push({ x: k * k * a.x + 2 * k * t * c.x + t * t * b.x, y: k * k * a.y + 2 * k * t * c.y + t * t * b.y });
  }
  return out;
}

function arrowHead(ctx, tip, dir, size, fill, u) {
  const nx = -dir.y, ny = dir.x;
  const path = new Path2D();
  path.moveTo(tip.x + dir.x * size * 0.35, tip.y + dir.y * size * 0.35);
  path.lineTo(tip.x - dir.x * size + nx * size * 0.62, tip.y - dir.y * size + ny * size * 0.62);
  path.lineTo(tip.x - dir.x * size - nx * size * 0.62, tip.y - dir.y * size - ny * size * 0.62);
  path.closePath();
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = color('ink');
  ctx.lineWidth = 6 * u;
  ctx.stroke(path);
  ctx.fillStyle = color(fill);
  ctx.fill(path);
}

/** When annotation i is on screen and how far it has drawn on. */
function annotationPhase(a, i, st, fps, timing) {
  const { rec, n } = st;
  const when = a.when ?? 'freeze';
  const stagger = Math.round((timing.per_annotation_s ?? DEFAULTS.per_annotation_s) * fps);
  const start = when === 'play' || when === 'all' ? rec.out0 : rec.annotate0 + i * stagger;
  const end = when === 'follow' || when === 'all' ? rec.resume1 : rec.resume0;
  const fadeOut = Math.round(0.25 * fps);
  if (n < start || n >= end + fadeOut) return null;
  const draw = when === 'play' || when === 'all' ? 1 : clamp01(sp((n - start) / fps, 'quick', 'position') * 1.04);
  const pop = when === 'play' || when === 'all' ? 1 : Math.max(0, sp((n - start) / fps, 'snappy', 'scale'));
  const alpha = n < end ? 1 : 1 - smoother((n - end) / fadeOut);
  return { draw, pop, alpha, animating: draw < 1 || n >= end };
}

function drawAnnotation(ctx, a, ph, st, M, u, L, env) {
  const f = st.s.frame;
  const P = (ref) => {
    const v = resolvePoint(ref, st.tracks, f);
    return v ? { ...M.toPanel(v.x, v.y), inRange: v.inRange } : null;
  };
  const fill = a.color ?? ({ ring: 'lime', spotlight: 'paper', arrow: 'orange', line: 'paper', zone: 'orange', label: 'lime' }[a.kind] ?? 'lime');
  const lw = (a.width ?? 7) * u;
  const labels = [];
  ctx.save();
  ctx.globalAlpha *= ph.alpha;
  switch (a.kind) {
    case 'ring':
    case 'spotlight': {
      const c = P(a.at ?? { track: a.track });
      if (!c) break;
      if ((a.when === 'follow' || a.when === 'all') && !c.inRange && st.n >= st.rec.resume0) break;
      const rx = (a.r ?? 60) * M.s * (0.6 + 0.4 * ph.pop);
      const ry = rx * (a.squash ?? (a.kind === 'ring' ? 0.42 : 1.3));
      const cy = a.kind === 'ring' ? c.y : c.y - ry * 0.7;
      const path = new Path2D();
      path.ellipse(c.x, cy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ph.draw);
      inkStroke(ctx, path, fill, a.kind === 'ring' ? lw : lw * 0.6, u);
      if (a.label) labels.push({ text: a.label, x: c.x, y: cy - ry - 18 * u, anchor: { x: c.x, y: cy - ry }, fill: a.label_color ?? fill });
      break;
    }
    case 'arrow':
    case 'line': {
      const a0 = P(a.from), b0 = P(a.to);
      if (!a0 || !b0) break;
      const via = a.via ? P(a.via) : null;
      const pts = via ? curvePts(a0, via, b0) : [a0, b0];
      if (a.kind === 'line' && a.dash) ctx.setLineDash([18 * u, 12 * u]);
      const { path, tip, dir } = partialPath(pts, ph.draw);
      inkStroke(ctx, path, fill, lw, u);
      ctx.setLineDash([]);
      if (a.kind === 'arrow' && ph.draw > 0.05) arrowHead(ctx, tip, dir, 30 * u, fill, u);
      if (a.kind === 'line') {
        // end ticks mark the two ends of a gap
        for (const [q, d] of [[a0, dir], [ph.draw >= 1 ? b0 : null, dir]]) {
          if (!q) continue;
          const tk = new Path2D();
          tk.moveTo(q.x - d.y * 18 * u, q.y + d.x * 18 * u);
          tk.lineTo(q.x + d.y * 18 * u, q.y - d.x * 18 * u);
          inkStroke(ctx, tk, fill, lw * 0.8, u);
        }
      }
      if (a.label && ph.draw >= 0.6) {
        const mid = a.kind === 'line' ? { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 } : b0;
        labels.push({ text: a.label, x: mid.x, y: mid.y - 64 * u, anchor: mid, fill: a.label_color ?? (a.kind === 'arrow' ? 'orange' : 'lime') });
      }
      break;
    }
    case 'zone': {
      const pts = (a.points ?? []).map(P).filter(Boolean);
      if (pts.length < 3) break;
      const path = new Path2D();
      pts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
      path.closePath();
      ctx.save();
      ctx.globalAlpha *= 0.85 * ph.draw;
      ctx.clip(path);
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      hatch(ctx, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), { color: color(fill), gap: 22 * u, width: 5 * u });
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= ph.draw;
      inkStroke(ctx, path, fill, 4 * u, u);
      ctx.restore();
      if (a.label) {
        const cx = xs.reduce((s, v) => s + v, 0) / xs.length, cy = ys.reduce((s, v) => s + v, 0) / ys.length;
        labels.push({ text: a.label, x: cx, y: cy - 24 * u, anchor: null, fill: a.label_color ?? fill });
      }
      break;
    }
    case 'label': {
      const c = P(a.at);
      if (!c) break;
      labels.push({ text: a.text ?? a.label ?? '', x: c.x + (a.dx ?? 0) * u, y: c.y + (a.dy ?? -90) * u, anchor: c, fill });
      break;
    }
    default:
      env.warn(`unknown annotation kind "${a.kind}"`);
  }
  // labels: chips with a leader to their anchor, kept inside the panel
  for (const lb of labels) {
    if (!lb.text) continue;
    ctx.save();
    ctx.globalAlpha *= clamp01(ph.pop);
    const size = L.text.chip * u;
    setFont(ctx, typeRole('label', env.frame, { font: 'mono-bold', size: size / u, weight: 700 }));
    const tw = ctx.measureText(String(lb.text).toUpperCase()).width + 24 * u;
    const th = size + 17 * u;
    const pn = L.panel;
    const x = Math.min(pn.x + pn.w - tw - 16 * u, Math.max(pn.x + 16 * u, lb.x - tw / 2));
    const y = Math.min(pn.y + pn.h - th - 16 * u, Math.max(pn.y + 16 * u, lb.y - th));
    if (lb.anchor) {
      const lead = new Path2D();
      lead.moveTo(x + tw / 2, y + th);
      lead.lineTo(lb.anchor.x, lb.anchor.y);
      ctx.strokeStyle = color('ink');
      ctx.lineWidth = 4 * u;
      ctx.stroke(lead);
    }
    const c = chip(ctx, lb.text, x, y, { u, size, fill: lb.fill, frame: env.frame });
    env.box({ kind: 'text', role: 'label', name: 'annotation-label', x: c.x, y: c.y, w: c.w, h: c.h, fg: color('ink'), bg: color(lb.fill), size: c.size, text: c.text, settled: ph.pop > 0.98 });
    ctx.restore();
  }
  ctx.restore();
}

function drawFootage(ctx, img, clip, win, P) {
  const M = mapping(win, P);
  ctx.save();
  ctx.beginPath();
  ctx.rect(P.x, P.y, P.w, P.h);
  ctx.clip();
  ctx.fillStyle = color('ink');
  ctx.fillRect(P.x, P.y, P.w, P.h);
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const kx = iw / clip.width, ky = ih / clip.height;
    const v = M.view;
    const x0 = Math.max(0, v.x), y0 = Math.max(0, v.y);
    const x1 = Math.min(clip.width, v.x + v.w), y1 = Math.min(clip.height, v.y + v.h);
    if (x1 > x0 && y1 > y0) {
      const d0 = M.toPanel(x0, y0), d1 = M.toPanel(x1, y1);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
    }
  }
  ctx.restore();
  return M;
}

/** Ink over the panel with see-through spotlights. */
function drawDim(ctx, P, amount, holes) {
  if (amount <= 0) return;
  ctx.save();
  // Each clip keeps the panel minus one hole; clips intersect, so the dim covers the panel
  // minus the union of the holes (overlapping holes stay clear, unlike one even-odd path).
  for (const h of holes) {
    const path = new Path2D();
    path.rect(P.x, P.y, P.w, P.h);
    path.moveTo(h.x + h.rx, h.y);          // start a fresh subpath: no stray edge from the rect
    path.ellipse(h.x, h.y, h.rx, h.ry, 0, 0, Math.PI * 2);
    ctx.clip(path, 'evenodd');
  }
  ctx.globalAlpha *= amount;
  ctx.fillStyle = color('ink');
  ctx.fillRect(P.x, P.y, P.w, P.h);
  ctx.restore();
}

/** Caption card: a chip, then short sentences that arrive one by one. */
function drawCard(ctx, env, L, u, content, since, fps) {
  const C = L.card;
  const bw = border(env.frame);
  box(ctx, C.x, C.y, C.w, C.h, { fill: color('paper'), stroke: color('ink'), strokeW: bw, shadow: shadow(env.frame) });
  reportBox(env, { x: C.x, y: C.y, w: C.w, h: C.h, name: 'caption-card' });
  if (!content) return false;
  const pad = 32 * u;
  const k = since / fps;
  const c = chip(ctx, content.chip, C.x + pad, C.y + pad, { u, size: L.text.chip * u, fill: content.fill ?? 'lime', frame: env.frame });
  env.box({ kind: 'text', role: 'label', name: 'caption-chip', x: c.x, y: c.y, w: c.w, h: c.h, fg: color('ink'), bg: color(content.fill ?? 'lime'), size: c.size, text: c.text });
  let y = c.y + c.h + 28 * u;
  // the largest caption size (down to a readable floor) at which every line fits the card
  const maxW = C.w - pad * 2, room = C.y + C.h - pad * 0.75 - y;
  const spec = (px) => typeRole('h2', env.frame, { font: 'body', size: px / u, weight: 650, leading: 1.18, tracking: -0.005 });
  const height = (px) => content.lines.reduce((h, line) => {
    const r = spec(px);
    return h + layoutText(ctx, { text: line, font: r.font, size: r.size, leading: r.leading, tracking: r.tracking, maxWidth: maxW, align: 'left' }).height + 18 * u;
  }, 0);
  let size = L.text.size * u;
  while (size > L.text.min * u && height(size) > room) size -= 2 * u;
  if (height(size) > room) env.warn(`caption overflows its card ("${content.lines.join(' ').slice(0, 40)}")`);
  let animating = false;
  content.lines.forEach((line, j) => {
    const e = k - j * 0.35;
    if (e <= 0) { animating = true; return; }
    const p = sp(e, 'snappy', 'position');
    const a = clamp01(sp(e, 'snappy', 'opacity'));
    if (p < 0.995 || a < 0.995) animating = true;
    ctx.save();
    ctx.globalAlpha *= a;
    const r = textBlock(ctx, env, {
      text: line, role: 'h2', font: 'body', sizePx: size, weight: 650, leading: 1.18, tracking: -0.005,
      x: C.x + pad, y: y + (1 - p) * 14 * u, maxWidth: C.w - pad * 2, color: 'ink', bg: 'paper', name: 'caption',
    });
    ctx.restore();
    y += r.box.h + 18 * u;
  });
  return animating;
}

register({
  type: 'scene.footy-breakdown',
  kind: 'scene',
  label: 'Footy breakdown',
  category: 'Footage',
  description: 'Coach-style review of match footage: play to the moment, freeze on the exact frame, dim, annotate (rings, spotlights, arrows, spacing lines, zones, labels), explain, then play it out with a closing line. Built by `python -m studio.footy build` from an approved moments file.',
  duration: 12,
  schema: {
    clip: { type: 'object', default: { fps: 25, frames: 1, width: 1280, height: 720, placeholder: false }, label: 'Clip (fps, frames, width, height, placeholder)' },
    moments: { type: 'list', of: 'object', default: [], label: 'Moments (from the approved moments file)' },
    index: { type: 'number', min: 1, max: 99, step: 1, default: 1, label: 'Breakdown number' },
    series: { type: 'text', default: 'Breakdown', label: 'Kicker', maxLength: 40 },
    credit: { type: 'text', default: '', label: 'Footage credit', maxLength: 140 },
    timing: { type: 'object', default: {}, label: 'Timing overrides (see breakdown/timing.js DEFAULTS)' },
  },
  clipLabel: (clip) => `breakdown · ${(clip.props?.moments ?? []).map((m) => m.id).join(', ')}`,

  /** The one source frame this clip shows at lt, decoded at the proxy's own rate. */
  mediaFrames(clip, lt, props, fps) {
    if (!clip.src || !(props.moments ?? []).length) return [];
    const st = state(props, lt, fps);
    return [{ src: clip.src, time: st.s.frame / props.clip.fps, fps: props.clip.fps }];
  },

  render(ctx, clip, lt, env) {
    const props = env.props, u = env.u, fps = env.settings.fps;
    if (!(props.moments ?? []).length) { env.warn('no moments'); return; }
    const st = state(props, lt, fps);
    const { n, s, rec, m } = st;
    const L = layout(env.frame, u);
    const W = env.frame.w, H = env.frame.h;
    const timing = { ...DEFAULTS, ...(props.timing ?? {}) };
    let animating = false;

    // ground: paper with the page's column hairlines
    ctx.fillStyle = color('paper');
    ctx.fillRect(0, 0, W, H);
    gridLines(ctx, env, 'paper', { top: 88 * u, bottom: H - 64 * u });

    // kicker + title
    const cat = CATEGORY[m.category] ?? m.category ?? '';
    const kick = `${props.series} ${String(props.index).padStart(2, '0')}${cat ? ` — ${cat}` : ''}`;
    textBlock(ctx, env, { text: kick.toUpperCase(), role: 'label', sizePx: (L.portrait ? 26 : 24) * u, x: L.kicker.x, y: L.kicker.y, maxWidth: L.kicker.w, color: 'ink', bg: 'paper', name: 'kicker' });
    const tb = textBlock(ctx, env, { text: m.title ?? '', role: 'h1', sizePx: L.title.size * u, x: L.title.x, y: L.title.y, maxWidth: L.title.w, color: 'ink', bg: 'paper', highlight: 'lime', accent: 'orange', name: 'title' });
    if (!L.portrait) {
      const top = tb.box.y + tb.box.h + 48 * u;
      L.card = { ...L.card, y: top, h: L.panel.y + L.panel.h - top };
    }

    // footage panel: hard shadow, then the camera window, then the frame border
    const P = L.panel;
    const sh = shadow(env.frame);
    ctx.fillStyle = sh.color;
    ctx.fillRect(P.x + sh.x, P.y + sh.y, P.w, P.h);
    const win = cameraAt(props, st, P);
    const img = clip.src ? env.videoFrame(clip.src, s.frame / props.clip.fps, props.clip.fps) : null;
    if (!img && env.settings && clip.src) env.warn(`frame ${s.frame} not decoded`);
    const M = drawFootage(ctx, img, props.clip, win, P);
    reportBox(env, { x: P.x, y: P.y, w: P.w, h: P.h, name: 'footage', kind: 'image' });
    // which source frame this output frame shows (read back by the frame-exactness check)
    env.box({ kind: 'meta', role: 'source-frame', name: 'source-frame', text: String(s.frame), x: P.x, y: P.y, w: 0, h: 0, segment: s.seg?.kind ?? null, moment: m.id });

    const frozen = n >= rec.freeze0 && n < rec.resume0;
    // dim in at the freeze, out on the resume
    const dimIn = Math.round(0.3 * fps), dimOut = Math.round(0.35 * fps);
    let dim = 0;
    if (frozen) dim = DIM * smoother((n - rec.freeze0) / dimIn);
    else if (n >= rec.resume0 && n < rec.resume0 + dimOut) dim = DIM * (1 - smoother((n - rec.resume0) / dimOut));
    // spotlights, and rings unless spot: false, see through the dim (the marked players stay bright)
    const holes = [];
    (m.annotations ?? []).forEach((a, i) => {
      const spot = a.kind === 'spotlight' || (a.kind === 'ring' && a.spot !== false);
      if (!spot) return;
      const ph = annotationPhase(a, i, st, fps, timing);
      const v = ph && resolvePoint(a.at ?? { track: a.track }, st.tracks, s.frame);
      if (!v) return;
      const c = M.toPanel(v.x, v.y);
      const k = 0.6 + 0.4 * clamp01(ph.pop);
      const rx = (a.r ?? 60) * M.s * (a.kind === 'ring' ? 0.9 : 1.08) * k;
      const ry = rx * (a.kind === 'ring' ? 1.45 : a.squash ?? 1.3);
      holes.push({ x: c.x, y: c.y - ry * 0.7, rx, ry });
    });
    drawDim(ctx, P, dim, holes);
    if (frozen && n - rec.freeze0 < dimIn) animating = true;

    // a soft flash marks the freeze landing
    if (n >= rec.freeze0 && n < rec.freeze0 + 4) {
      ctx.save();
      ctx.globalAlpha *= 0.22 * (1 - (n - rec.freeze0) / 4);
      ctx.fillStyle = color('paper');
      ctx.fillRect(P.x, P.y, P.w, P.h);
      ctx.restore();
      animating = true;
    }

    // annotations, clipped to the panel
    ctx.save();
    ctx.beginPath();
    ctx.rect(P.x, P.y, P.w, P.h);
    ctx.clip();
    (m.annotations ?? []).forEach((a, i) => {
      const ph = annotationPhase(a, i, st, fps, timing);
      if (!ph) return;
      if (ph.animating) animating = true;
      drawAnnotation(ctx, a, ph, st, M, u, L, env);
    });
    ctx.restore();

    // panel border on top of everything inside it
    box(ctx, P.x, P.y, P.w, P.h, { stroke: color('ink'), strokeW: border(env.frame) });

    // state chip: play / freeze / slow, with the source timecode
    const tc = timecode(s.frame, props.clip.fps);
    const seg = s.seg?.kind;
    const rate = s.seg?.rate ?? 1;
    const chipSize = L.text.chip * u;
    const label = frozen ? `Freeze ${tc}` : seg === 'resume' && rate < 1 ? `Slow ${rate}x ${tc}` : seg === 'end' ? `End ${tc}` : `Play ${tc}`;
    const sc = chip(ctx, label, P.x + 20 * u, P.y + 20 * u, { u, size: chipSize, fill: frozen ? 'lime' : 'paper', frame: env.frame });
    env.box({ kind: 'text', role: 'label', name: 'state-chip', x: sc.x, y: sc.y, w: sc.w, h: sc.h, fg: color('ink'), bg: color(frozen ? 'lime' : 'paper'), size: sc.size, text: sc.text });
    if (props.clip.placeholder) {
      const pc = chip(ctx, 'Placeholder clip', P.x + P.w - 20 * u, P.y + 20 * u, { u, size: chipSize, fill: 'orange', align: 'right', frame: env.frame });
      env.box({ kind: 'text', role: 'label', name: 'placeholder-chip', x: pc.x, y: pc.y, w: pc.w, h: pc.h, fg: color('ink'), bg: color('orange'), size: pc.size, text: pc.text });
    }

    // credit line under the panel
    if (props.credit) {
      textBlock(ctx, env, { text: props.credit.toUpperCase(), role: 'micro', sizePx: (L.portrait ? 20 : 18) * u, x: L.credit.x, y: L.credit.y, maxWidth: L.credit.w, color: 'ink-soft', bg: 'paper', name: 'credit' });
    }

    // caption card: watch → coach's point → outcome
    const cap = m.captions ?? {};
    let content = null, since = 0;
    if (rec.outcome0 !== null && n >= rec.outcome0 && cap.outcome) {
      content = { chip: 'Outcome', fill: 'orange', lines: [cap.outcome] }; since = n - rec.outcome0;
    } else if (n >= rec.caption0 && (cap.freeze ?? []).length) {
      content = { chip: cat || 'Coach', fill: 'lime', lines: cap.freeze }; since = n - rec.caption0;
    } else if (cap.watch) {
      content = { chip: 'Watch', fill: 'paper', lines: [cap.watch] }; since = n - rec.out0;
    }
    if (drawCard(ctx, env, L, u, content, since, fps)) animating = true;
    if (animating) env.animating();
  },
});
