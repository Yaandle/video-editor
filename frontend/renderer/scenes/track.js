// scene.track-guide — a circuit explainer: kicker, headline and deck down the
// left with up to four fact tiles under them, and the circuit map on the right
// in a bordered panel. The map draws on, highlights the segments in `focus`
// (and `focus2`), can zoom in on the focus on the beat, labels corners at their
// apex and runs a car marker from `car_from` to `car_to` at the pace of a
// simple grip/accel/brake model. Geometry: data/mount_panorama.js (OSM, ODbL).

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, type as typeRole, onColor } from '../tokens.js';
import { box } from '../draw.js';
import { sp, clamp01, lerp, arrival } from '../motion.js';
import { textBlock, gridLines, setFont } from '../kit.js';
import { clock, exitP, landingEvents } from './helpers.js';
import { POINTS, SEGMENTS, PACE, LENGTH_M } from '../data/mount_panorama.js';

const N = POINTS.length / 2;
const PX = (k) => POINTS[2 * (((k % N) + N) % N)];
const PY = (k) => POINTS[2 * (((k % N) + N) % N) + 1];
const XR = Math.max(...POINTS.filter((_, i) => i % 2 === 0));
const YR = Math.max(...POINTS.filter((_, i) => i % 2 === 1));
let NORM_LEN = 0;
for (let k = 0; k < N; k++) NORM_LEN += Math.hypot(PX(k + 1) - PX(k), PY(k + 1) - PY(k));
const M_PER_UNIT = LENGTH_M / NORM_LEN;

/** Point at lap fraction f (any real; wraps), linear between samples. */
function at(f) {
  const s = f * N, k = Math.floor(s), r = s - k;
  return [lerp(PX(k), PX(k + 1), r), lerp(PY(k), PY(k + 1), r)];
}
/** Cumulative model lap time at fraction f (f may exceed 1: whole laps add 1). */
function paceAt(f) {
  const laps = Math.floor(f), s = (f - laps) * N, k = Math.floor(s);
  return laps + lerp(PACE[k], PACE[Math.min(N, k + 1)], s - k);
}
/** Inverse of paceAt. */
function fracAtPace(tau) {
  const laps = Math.floor(tau), r = tau - laps;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; PACE[m] <= r ? (lo = m) : (hi = m); }
  const span = PACE[hi] - PACE[lo] || 1;
  return laps + (lo + (r - PACE[lo]) / span) / N;
}
const names = (s) => String(s ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const segsNamed = (list) => SEGMENTS.filter((s) => list.includes(s.name));

function pathRange(ctx, X, Y, f0, f1) {
  const steps = Math.max(2, Math.ceil((f1 - f0) * N * 2));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(f0 + ((f1 - f0) * i) / steps);
    i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y));
  }
}

register({
  type: 'scene.track-guide',
  kind: 'scene',
  label: 'Track guide',
  category: 'Scenes',
  description: 'Circuit explainer: headline, deck and fact tiles on the left; the Mount Panorama map on the right with a highlighted section, optional zoom, corner labels and a car marker running the line.',
  duration: 6,
  schema: {
    kicker: { type: 'text', default: 'Mount Panorama', label: 'Kicker', maxLength: 40 },
    headline: { type: 'text', default: 'Hell Corner.\n{{Exit is everything.}}', label: 'Headline', multiline: true, maxLength: 80 },
    deck: { type: 'text', default: '', label: 'Deck', multiline: true, maxLength: 240 },
    size: { type: 'enum', options: ['display', 'h1', 'h2'], default: 'h1', label: 'Headline size' },
    background: { type: 'color', default: 'paper', label: 'Background' },
    tiles: { type: 'list', of: 'text', default: [], label: 'Fact tiles (value | label)', maxItems: 4 },
    tiles_layout: { type: 'enum', options: ['row', 'stack'], default: 'row', label: 'Tiles layout' },
    tiles_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 4, label: 'Tiles land from beat #' },
    focus: { type: 'text', default: '', label: 'Highlight segments (names, comma-separated)', maxLength: 200 },
    focus2: { type: 'text', default: '', label: 'Second highlight (names)', maxLength: 200 },
    focus_color: { type: 'color', default: 'orange', label: 'Highlight colour' },
    focus2_color: { type: 'color', default: 'cobalt', label: 'Second colour' },
    focus_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 1, label: 'Highlight from beat #' },
    labels: { type: 'text', default: '', label: 'Label corners (names)', maxLength: 300 },
    zoom: { type: 'bool', default: false, label: 'Zoom to the highlight' },
    zoom_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 2, label: 'Zoom on beat #' },
    draw_on: { type: 'bool', default: false, label: 'Draw the circuit on' },
    car: { type: 'bool', default: true, label: 'Car marker' },
    car_from: { type: 'number', min: 0, max: 2, step: 0.001, default: 0, label: 'Car from (lap fraction)' },
    car_to: { type: 'number', min: 0, max: 3, step: 0.001, default: 1, label: 'Car to (lap fraction)' },
    car_beat: { type: 'number', min: 0, max: 64, step: 0.5, default: 2, label: 'Car starts on beat #' },
    car_beats: { type: 'number', min: 0.5, max: 64, step: 0.5, default: 8, label: 'Car runs for beats' },
    note: { type: 'text', default: '', label: 'Map footnote', maxLength: 80 },
  },
  clipLabel: (clip) => `track · ${String(clip.props?.headline ?? '').split('\n')[0]}`,
  render(ctx, clip, lt, env) {
    const p = env.props, u = env.u, F = env.frame, g = env.grid;
    const c = clock(clip, env);
    const bw = border(F);
    ctx.fillStyle = color(p.background);
    ctx.fillRect(0, 0, F.w, F.h);
    gridLines(ctx, env, p.background);
    const ink = onColor(p.background);
    const ex = exitP(env, clip, 0.4);

    // ── Left column: kicker, headline, deck, tiles ──────────────────────────
    const colW = g.span(0, 6).w;
    const l1 = c.land(1, 'slam');
    textBlock(ctx, env, { name: 'kicker', text: p.kicker, role: 'label', case: 'upper', x: g.margin, y: 196 * u, color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'char', from: 'rise', preset: 'snappy' }, exit: { to: 'fade', length: 0.3 } });
    const r = textBlock(ctx, env, {
      name: 'headline', text: p.headline, role: p.size, x: g.margin, y: 252 * u, maxWidth: colW, color: ink, highlight: 'lime', accent: 'orange',
      bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'mask', preset: 'slam', stagger: c.beat, delay: l1.start - clip.start }, exit: { to: 'mask', length: 0.32 },
    });
    let y = 252 * u + r.box.h + 48 * u;
    if (p.deck) {
      const d = textBlock(ctx, env, {
        name: 'deck', text: p.deck, role: 'body', x: g.margin, y, maxWidth: colW * 0.94,
        color: ink, bg: p.background, lt, duration: clip.duration, enter: { unit: 'line', from: 'rise', preset: 'soft', delay: c.B(2.5) - clip.start }, exit: { to: 'fade', length: 0.3 },
      });
      y += d.box.h + 52 * u;
    }
    const tiles = (p.tiles ?? []).map((s) => String(s).split('|').map((v) => v.trim()));
    if (tiles.length) {
      const stack = p.tiles_layout === 'stack';
      const gap = 24 * u;
      const tw = stack ? colW : (colW - gap * (tiles.length - 1)) / tiles.length;
      const th = stack ? 112 * u : 128 * u;
      const big = typeRole('h2', F), lab = typeRole('label', F), body = typeRole('body', F);
      tiles.forEach(([val, label = ''], i) => {
        const L = c.land(p.tiles_beat + i, 'slam');
        const e = env.t - L.start;
        if (e <= 0) return;
        const s = Math.max(0, sp(e, 'slam', 'position'));
        const tx = g.margin + (stack ? 0 : i * (tw + gap));
        const ty = y + (stack ? i * (th + gap) : 0) + (1 - s) * 60 * u + ex * F.h * 0.9;
        box(ctx, tx, ty, tw, th, { fill: color(i === 0 ? 'lime' : 'white'), stroke: color('ink'), strokeW: bw, shadow: shadowTok(F) });
        ctx.fillStyle = color('ink');
        if (stack) {
          setFont(ctx, big);
          ctx.fillText(val, tx + 28 * u, ty + th / 2 + big.size * 0.36);
          const vw = ctx.measureText(val).width;
          const lines = label.split('\n');
          const lx = tx + 28 * u + vw + 32 * u;
          // caption shrinks to fit the tile rather than spilling past its border
          setFont(ctx, body);
          const widest = Math.max(...lines.map((ln) => ctx.measureText(ln).width));
          const fit = typeRole('body', F, { size: (body.size / u) * Math.min(1, (tx + tw - 24 * u - lx) / (widest || 1)) });
          setFont(ctx, fit);
          const lh = fit.size * 1.25;
          lines.forEach((ln, j) => ctx.fillText(ln, lx, ty + th / 2 - ((lines.length - 1) * lh) / 2 + j * lh + fit.size * 0.35));
        } else {
          setFont(ctx, lab);
          ctx.fillText(label.toUpperCase(), tx + 22 * u, ty + 22 * u + lab.size * 0.8);
          setFont(ctx, big);
          ctx.fillText(val, tx + 22 * u, ty + th - 26 * u);
        }
        env.box({ kind: 'box', x: tx, y: ty, w: tw, h: th, settled: s > 0.98 && !ex });
      });
    }

    // ── Right: the map panel ───────────────────────────────────────────────
    const px0 = F.w * 0.555, px1 = F.w - g.margin, py0 = 150 * u, py1 = F.h - 150 * u;
    const drop = ex * F.h * 0.9;
    ctx.save();
    ctx.translate(0, drop);
    const ent = sp(env.t - (clip.start - 0.05), 'snappy', 'position');
    ctx.translate((1 - Math.min(1, Math.max(0, ent))) * 120 * u, 0);
    box(ctx, px0, py0, px1 - px0, py1 - py0, { fill: color('white'), stroke: color('ink'), strokeW: bw, shadow: shadowTok(F) });
    const pad = 56 * u;
    const ix0 = px0 + pad, ix1 = px1 - pad, iy0 = py0 + pad, iy1 = py1 - pad;
    // full-lap view
    const s0 = Math.min((ix1 - ix0) / XR, (iy1 - iy0) / YR);
    const c0 = [XR / 2, YR / 2];
    // zoom view: fit the focus segments
    let s1 = s0, c1 = c0;
    const fseg = segsNamed(names(p.focus));
    if (p.zoom && fseg.length) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const sg of fseg) for (let f = sg.from; f <= sg.to; f += 0.5 / N) {
        const [x, yy] = at(f); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, yy); by1 = Math.max(by1, yy);
      }
      const m = 0.07;
      s1 = Math.min(s0 * 2.6, (ix1 - ix0) / (bx1 - bx0 + 2 * m), (iy1 - iy0) / (by1 - by0 + 2 * m));
      c1 = [(bx0 + bx1) / 2, (by0 + by1) / 2];
    }
    const zk = arrival('soft', 'position');
    const z = p.zoom ? clamp01(sp(env.t - (c.B(p.zoom_beat) - zk), 'soft', 'position')) : 0;
    const S = lerp(s0, s1, z), C = [lerp(c0[0], c1[0], z), lerp(c0[1], c1[1], z)];
    const mx = (ix0 + ix1) / 2, my = (iy0 + iy1) / 2;
    const X = (v) => mx + (v - C[0]) * S, Y = (v) => my + (v - C[1]) * S;
    ctx.save();
    ctx.beginPath(); ctx.rect(px0 + bw / 2, py0 + bw / 2, px1 - px0 - bw, py1 - py0 - bw); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // base track: ink casing + paper core
    const drawP = p.draw_on ? clamp01(sp((env.t - c.B(0.5)) * (arrival('soft', 'position') / (c.beat * 4)), 'soft', 'position')) : 1;
    if (drawP > 0) {
      pathRange(ctx, X, Y, 0, drawP);
      ctx.strokeStyle = color('ink'); ctx.lineWidth = bw * 3.2; ctx.stroke();
      ctx.strokeStyle = color('paper-deep'); ctx.lineWidth = bw * 1.4; ctx.stroke();
    }
    // highlights draw on along the race direction
    const hiP = clamp01(sp((env.t - c.B(p.focus_beat)) * (arrival('soft', 'position') / (c.beat * 2)), 'soft', 'position'));
    for (const [list, col] of [[names(p.focus2), p.focus2_color], [names(p.focus), p.focus_color]]) {
      for (const sg of segsNamed(list)) {
        if (hiP <= 0) continue;
        pathRange(ctx, X, Y, sg.from, lerp(sg.from, sg.to, hiP));
        ctx.strokeStyle = color(col); ctx.lineWidth = bw * 2.2; ctx.stroke();
      }
    }
    // car marker with a short trail
    if (p.car) {
      const cs = c.B(p.car_beat), ce = c.B(p.car_beat + p.car_beats);
      const k = clamp01((env.t - cs) / (ce - cs || 1));
      const f = fracAtPace(lerp(paceAt(p.car_from), paceAt(p.car_to), k));
      const appear = clamp01(sp(env.t - (cs - 0.4), 'snappy', 'scale'));
      if (appear > 0) {
        const tail = Math.max(p.car_from, f - 0.025);
        if (f > p.car_from + 1e-4) {
          pathRange(ctx, X, Y, tail, f);
          ctx.strokeStyle = color('lime'); ctx.lineWidth = bw * 1.6; ctx.stroke();
        }
        const [cx, cy] = at(f), [nx, ny] = at(f + 0.002);
        const ang = Math.atan2(Y(ny) - Y(cy), X(nx) - X(cx));
        const R = 17 * u * appear;
        ctx.save();
        ctx.translate(X(cx), Y(cy)); ctx.rotate(ang);
        box(ctx, -R * 1.3, -R * 0.8, R * 2.6, R * 1.6, { fill: color('lime'), stroke: color('ink'), strokeW: bw * 0.7 });
        ctx.restore();
      }
    }
    // corner labels at the apex, pushed away from the circuit's centre; a label
    // that would overlap one already placed (or the north arrow / scale bar)
    // steps up or down until it is clear
    const lab = typeRole('label', F);
    setFont(ctx, lab);
    const taken = [[px0, py0, 110 * u, 120 * u], [px0, py1 - 80 * u, 360 * u, 80 * u]];
    const hit = (a) => taken.some((b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]);
    names(p.labels).forEach((nm, i) => {
      const sg = SEGMENTS.find((s) => s.name === nm);
      if (!sg) return;
      const [ax, ay] = at(sg.apex);
      const vx = X(ax) - X(c0[0] * (1 - z) + C[0] * z), vy = Y(ay) - Y(c0[1] * (1 - z) + C[1] * z);
      const vl = Math.hypot(vx, vy) || 1;
      const off = 70 * u;
      setFont(ctx, lab);
      const txt = nm.toUpperCase();
      const tw = ctx.measureText(txt).width + 26 * u, th = lab.size + 22 * u;
      const lx = Math.min(px1 - bw - 12 * u - tw, Math.max(px0 + bw + 12 * u, vx >= 0 ? X(ax) + (vx / vl) * off : X(ax) + (vx / vl) * off - tw));
      const ly0 = Y(ay) + (vy / vl) * off - th / 2;
      const clampY = (v) => Math.min(py1 - bw - 12 * u - th, Math.max(py0 + bw + 12 * u, v));
      let ly = clampY(ly0);
      for (let k = 1; k <= 12 && hit([lx, ly, tw, th]); k++) ly = clampY(ly0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (th + 10 * u));
      taken.push([lx, ly, tw, th]);
      const L = c.land(p.focus_beat + 0.5 + i * 0.5, 'snappy');
      const e = env.t - L.start;
      if (e <= 0) return;
      const s = clamp01(sp(e, 'snappy', 'scale'));
      ctx.globalAlpha = s;
      ctx.strokeStyle = color('ink'); ctx.lineWidth = bw * 0.5;
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(lx + (vx >= 0 ? 0 : tw), ly + th / 2); ctx.stroke();
      box(ctx, X(ax) - 6 * u, Y(ay) - 6 * u, 12 * u, 12 * u, { fill: color('ink') });
      box(ctx, lx, ly, tw, th, { fill: color('ink') });
      ctx.fillStyle = color('paper');
      ctx.fillText(txt, lx + 13 * u, ly + th / 2 + lab.size * 0.36);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    // north arrow + scale bar (500 m) in the panel corner
    setFont(ctx, lab);
    ctx.fillStyle = color('ink');
    const bar = (500 / M_PER_UNIT) * S;
    const bx = px0 + 32 * u, by = py1 - 34 * u;
    ctx.fillRect(bx, by - bw * 0.6, bar, bw * 1.2);
    ctx.fillRect(bx, by - 12 * u, bw * 0.6, 24 * u); ctx.fillRect(bx + bar - bw * 0.6, by - 12 * u, bw * 0.6, 24 * u);
    ctx.fillText('500 M', bx + bar + 14 * u, by + lab.size * 0.36);
    ctx.textAlign = 'center';
    ctx.fillText('N', px0 + 52 * u, py0 + 54 * u);
    ctx.beginPath(); ctx.moveTo(px0 + 52 * u, py0 + 66 * u); ctx.lineTo(px0 + 42 * u, py0 + 96 * u); ctx.lineTo(px0 + 62 * u, py0 + 96 * u); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'right';
    if (p.note) { ctx.fillStyle = color('ink-soft'); ctx.fillText(p.note.toUpperCase(), px1, py1 + 52 * u); }
    ctx.textAlign = 'left';
    ctx.restore();
    env.box({ kind: 'box', x: px0, y: py0 + drop, w: px1 - px0, h: py1 - py0, settled: !ex && z >= 0.99 });
    env.animating();
  },
  events(clip, env) {
    const c = clock(clip, env), p = env.props;
    const n = String(p.headline).split('\n').length;
    const land = Array.from({ length: n }, (_, i) => ({ ...c.land(1 + i, 'slam'), role: 'headline', sound: i ? 'pop' : 'impact', gain_db: -6 }));
    (p.tiles ?? []).forEach((_, i) => land.push({ ...c.land(p.tiles_beat + i, 'slam'), role: 'tile', sound: 'pop', gain_db: -9 }));
    const out = landingEvents(land);
    if (p.car) out.push({ kind: 'cue', t: c.B(p.car_beat), sound: 'whoosh', gain_db: -12 });
    return out;
  },
});
