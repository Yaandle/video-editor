// scene.screencast + scene.mono-title — a minimalist product tour of a web app.
// Captured screens (or one captured video, clip.src) sit in a hairline browser
// window on a plain ground; the camera glides between keys, a cursor moves,
// clicks and can drag a file card in, and small two-line captions name each
// part. Keys are clip-local seconds; x/y are CSS px of the captured viewport
// (viewport_w × viewport_h), so cursor targets come straight from the page's
// getBoundingClientRect. Consecutive clips hand over seamlessly when the last
// camera key of one equals the first of the next.

import { register } from '../registry.js';
import { color } from '../tokens.js';
import { sp, fade, clamp01, lerp } from '../motion.js';
import { setFont } from '../kit.js';
import { exitP } from './helpers.js';

const TB = 40;                        // title bar height, content px
const MONO = '"JetBrains Mono"';

/** Smootherstep: zero velocity and acceleration at both ends (camera and cursor glides). */
const smooth = (p) => { p = clamp01(p); return p * p * p * (p * (p * 6 - 15) + 10); };
const byAt = (list) => [...(list ?? [])].filter((k) => k && Number.isFinite(+k.at)).sort((a, b) => a.at - b.at);

/** Where lt falls in a key list: [from, to, eased progress]. Holds before the first and after the last key.
 *  A key with linear: true is reached at constant speed (e.g. a cursor dragging a slider). */
function between(keys, lt) {
  if (lt <= keys[0].at) return [keys[0], keys[0], 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    const p = clamp01((lt - a.at) / Math.max(1e-6, b.at - a.at));
    if (lt < b.at) return [a, b, b.linear ? p : smooth(p)];
  }
  const last = keys[keys.length - 1];
  return [last, last, 0];
}

function cameraAt(keys, lt, VW, VH) {
  const fit = { x: VW / 2, y: (VH - TB) / 2, z: 1 };
  if (!keys.length) return fit;
  const [a, b, p] = between(keys, lt);
  const za = a.z ?? 1, zb = b.z ?? 1;
  return { x: lerp(a.x ?? fit.x, b.x ?? fit.x, p), y: lerp(a.y ?? fit.y, b.y ?? fit.y, p), z: Math.exp(lerp(Math.log(za), Math.log(zb), p)) };
}

/** Cursor position on a slight arc between keys, and its opacity (keys with hidden: true are 0). */
function cursorAt(keys, lt) {
  if (!keys.length) return null;
  const [a, b, p] = between(keys, lt);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const arc = Math.sin(Math.PI * p) * Math.min(60, len * 0.08);
  const nx = len ? -dy / len : 0, ny = len ? dx / len : 0;
  return {
    x: lerp(a.x, b.x, p) + nx * arc,
    y: lerp(a.y, b.y, p) + ny * arc,
    alpha: lerp(a.hidden ? 0 : 1, b.hidden ? 0 : 1, p),
  };
}

function arrowPath(ctx, x, y, s) {
  const pts = [[0, 0], [0, 17.5], [4.3, 13.4], [7.2, 20], [10.1, 18.7], [7.3, 12.3], [13, 12.3]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s)));
  ctx.closePath();
}

function fileCard(ctx, x, y, f, pal) {
  const name = String(f.name ?? 'session.csv'), meta = String(f.meta ?? '');
  ctx.font = `500 13px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const w = Math.max(240, ctx.measureText(name).width + 84), h = 66;
  ctx.save();
  ctx.shadowColor = 'rgba(17,17,17,0.16)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = pal.paper;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // document glyph with a folded corner
  const gx = x + 16, gy = y + 11, gw = 34, gh = 44, fold = 10;
  ctx.beginPath();
  ctx.moveTo(gx, gy); ctx.lineTo(gx + gw - fold, gy); ctx.lineTo(gx + gw, gy + fold); ctx.lineTo(gx + gw, gy + gh); ctx.lineTo(gx, gy + gh); ctx.closePath();
  ctx.fillStyle = pal.paper; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx + gw - fold, gy); ctx.lineTo(gx + gw - fold, gy + fold); ctx.lineTo(gx + gw, gy + fold); ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.font = `700 9px ${MONO}`;
  ctx.fillText('CSV', gx + 6, gy + gh - 8);
  ctx.fillStyle = pal.ink;
  ctx.font = `500 13px ${MONO}`;
  ctx.fillText(name, x + 66, y + 29);
  ctx.fillStyle = pal.mute;
  ctx.font = `400 11px ${MONO}`;
  ctx.fillText(meta, x + 66, y + 48);
  return { w, h };
}

/** Tracked uppercase mono line; returns its drawn width (without the trailing letter space). */
function monoLine(ctx, text, x, y, size, weight, tracking, fill, align = 'left') {
  setFont(ctx, { font: `${weight} ${size}px ${MONO}`, size, tracking });
  const w = ctx.measureText(text).width - tracking * size;
  ctx.fillStyle = fill;
  ctx.fillText(text, align === 'center' ? x - w / 2 : x, y);
  return w;
}

const palette = (p) => ({ ground: color(p.background), paper: color(p.paper), ink: color(p.ink), mute: color(p.mute), accent: color(p.accent) });
const paletteSchema = {
  background: { type: 'color', default: '#E9E7E1', label: 'Ground' },
  paper: { type: 'color', default: '#F4F3EF', label: 'Paper' },
  ink: { type: 'color', default: '#111111', label: 'Ink' },
  mute: { type: 'color', default: '#74726B', label: 'Muted text' },
  accent: { type: 'color', default: '#B5522B', label: 'Accent' },
};

register({
  type: 'scene.screencast',
  kind: 'scene',
  label: 'Screencast',
  category: 'Scenes',
  description: 'Minimal app tour: captured screens or a captured video in a hairline browser window, eased camera keys, a cursor that clicks and drags a file in, and two-line captions.',
  media: 'video',                     // optional clip.src: a captured screen recording, decoded per frame
  duration: 6,
  schema: {
    ...paletteSchema,
    url: { type: 'text', default: 'localhost', label: 'Address bar', maxLength: 120 },
    viewport_w: { type: 'number', min: 320, max: 3840, step: 1, default: 1600, label: 'Viewport width (CSS px)' },
    viewport_h: { type: 'number', min: 240, max: 2160, step: 1, default: 900, label: 'Viewport height (CSS px)' },
    screens: { type: 'list', of: 'object', default: [], label: 'Screens [{at, src, fade}]' },
    camera: { type: 'list', of: 'object', default: [], label: 'Camera keys [{at, x, y, z}]' },
    cursor: { type: 'list', of: 'object', default: [], label: 'Cursor keys [{at, x, y, click, hidden}]' },
    file: { type: 'object', default: {}, label: 'Dragged file {name, meta, show, drop}' },
    captions: { type: 'list', of: 'object', default: [], label: 'Captions [{at, until, kicker, text}]' },
    window_in: { type: 'bool', default: false, label: 'Window rises in' },
    window_out: { type: 'bool', default: false, label: 'Window settles out' },
  },
  assets: (clip, props) => byAt(props?.screens).map((s) => s.src).filter(Boolean),
  render(ctx, clip, lt, env) {
    const p = env.props, F = env.frame, u = env.u;
    const pal = palette(p);
    const VW = p.viewport_w, VH = p.viewport_h;
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, F.w, F.h);

    const cam = cameraAt(byAt(p.camera), lt, VW, VH);
    const s0 = Math.min((F.w * 0.86) / VW, (F.h * 0.87) / (VH + TB));
    const S = s0 * cam.z;
    let alpha = 1, rise = 0, settleK = 1;
    if (p.window_in) { alpha = clamp01(fade(lt, 'soft')); rise = (1 - sp(lt, 'soft')) * 56 * u; }
    if (p.window_out) { const e = exitP(env, clip, 0.6); alpha *= 1 - e; settleK = 1 - 0.035 * e; }
    const toScreen = (x, y) => [F.w / 2 + (x - cam.x) * S * settleK, F.h / 2 + (y - cam.y) * S * settleK + rise];
    const camera = () => { ctx.translate(F.w / 2, F.h / 2 + rise); ctx.scale(S * settleK, S * settleK); ctx.translate(-cam.x, -cam.y); };

    // Window: soft shadow, paper, then the captured content clipped to it.
    const [wx0, wy0] = toScreen(0, -TB), [wx1, wy1] = toScreen(VW, VH);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.save();
    ctx.shadowColor = 'rgba(17,17,17,0.10)';
    ctx.shadowBlur = 60 * u;
    ctx.shadowOffsetY = 22 * u;
    ctx.fillStyle = pal.paper;
    ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    ctx.clip();
    camera();
    // title bar
    ctx.strokeStyle = pal.mute;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(20 + i * 17, -TB / 2, 4.5, 0, Math.PI * 2); ctx.stroke(); }
    monoLine(ctx, String(p.url ?? ''), VW / 2, -TB / 2 + 4, 11, 400, 0.04, pal.mute, 'center');
    ctx.fillStyle = pal.ink;
    ctx.fillRect(0, -1, VW, 1);
    // content
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const screens = byAt(p.screens);
    const vid = clip.src ? env.videoFrame(clip.src, (clip.source_start ?? 0) + Math.max(0, lt) * (clip.speed ?? 1)) : null;
    if (vid) {
      ctx.drawImage(vid, 0, 0, VW, VH);
    } else if (screens.length) {
      let i = 0;
      while (i < screens.length - 1 && screens[i + 1].at <= lt) i++;
      const cur = screens[i], prev = screens[i - 1];
      const k = cur.fade > 0 && prev ? smooth((lt - cur.at) / cur.fade) : 1;
      const a = prev && k < 1 ? env.image(prev.src) : null, b = env.image(cur.src);
      if (a) ctx.drawImage(a, 0, 0, VW, VH);
      if (b) { ctx.globalAlpha *= k; ctx.drawImage(b, 0, 0, VW, VH); }
    }
    ctx.restore();
    // hairline frame, same weight as the page's own 1px rules
    ctx.save();
    camera();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -TB, VW, VH + TB);
    ctx.restore();
    env.box({ kind: 'image', role: 'window', name: 'window', x: wx0, y: wy0, w: wx1 - wx0, h: wy1 - wy0, bleed: wx0 < 0 || wy0 < 0 || wx1 > F.w || wy1 > F.h });

    // Dragged file and cursor live in content space so they track the camera.
    const keys = byAt(p.cursor);
    const cur = cursorAt(keys, lt);
    const f = p.file ?? {};
    if (cur && f.name && lt >= (f.show ?? 0)) {
      const drop = f.drop ?? Infinity;
      const d = clamp01((lt - drop) / 0.35), k = smooth(d);
      const show = lt < drop + 0.35 ? cur.alpha * (1 - k) : 0;
      if (show > 0) {
        ctx.save();
        camera();
        ctx.globalAlpha *= show;
        ctx.translate(cur.x, cur.y);
        ctx.scale(1 - 0.45 * k, 1 - 0.45 * k);
        fileCard(ctx, -30, -34, f, pal);
        ctx.restore();
      }
    }
    if (cur && cur.alpha > 0) {
      const clicks = keys.filter((c) => c.click).map((c) => c.at);
      ctx.save();
      camera();
      const ga = ctx.globalAlpha;
      for (const tc of clicks) {
        const e = (lt - tc) / 0.5;
        if (e < 0 || e > 1) continue;
        ctx.strokeStyle = pal.accent;
        ctx.globalAlpha = ga * cur.alpha * (1 - smooth(e)) * 0.8;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 5 + 24 * smooth(e), 0, Math.PI * 2);
        ctx.stroke();
      }
      const press = clicks.reduce((m, tc) => Math.max(m, Math.sin(Math.PI * clamp01((lt - tc + 0.06) / 0.2))), 0);
      ctx.globalAlpha = ga * cur.alpha;
      arrowPath(ctx, cur.x, cur.y, 1.05 * (1 - 0.14 * press));
      ctx.fillStyle = pal.ink;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Captions: screen space, bottom left, a paper card with a hairline border.
    for (const c of byAt(p.captions)) {
      const until = c.until ?? Infinity;
      if (lt < c.at || lt > until) continue;
      const kin = sp(lt - c.at, 'soft'), kout = smooth((lt - (until - 0.35)) / 0.35);
      const a = clamp01(fade(lt - c.at, 'soft')) * (1 - kout);
      if (a <= 0) continue;
      const pad = 18 * u, x = 44 * u, ks = 15 * u, ts = 25 * u;
      setFont(ctx, { font: `500 ${ks}px ${MONO}`, size: ks, tracking: 0.16 });
      const kw = ctx.measureText(String(c.kicker ?? '').toUpperCase()).width;
      setFont(ctx, { font: `500 ${ts}px ${MONO}`, size: ts, tracking: -0.01 });
      const tw = ctx.measureText(String(c.text ?? '')).width;
      const w = Math.max(kw, tw) + pad * 2, h = pad * 2 + ks + 14 * u + ts;
      const y = F.h - 44 * u - h + (1 - kin) * 14 * u;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = pal.paper;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeRect(x, y, w, h);
      const [num, ...rest] = String(c.kicker ?? '').toUpperCase().split(' / ');
      let kx = x + pad;
      if (rest.length) {
        kx += monoLine(ctx, num, kx, y + pad + ks * 0.8, ks, 600, 0.16, pal.ink) + ks * 0.16;
        monoLine(ctx, ' / ' + rest.join(' / '), kx, y + pad + ks * 0.8, ks, 500, 0.16, pal.mute);
      } else {
        monoLine(ctx, num ?? '', kx, y + pad + ks * 0.8, ks, 500, 0.16, pal.mute);
      }
      monoLine(ctx, String(c.text ?? ''), x + pad, y + h - pad - ts * 0.22, ts, 500, -0.01, pal.ink);
      ctx.restore();
      env.box({ kind: 'text', role: 'caption', name: `caption@${c.at}`, text: c.text, x, y, w, h, fg: pal.ink, bg: pal.paper, size: ts });
    }
    env.animating();
  },
});

register({
  type: 'scene.mono-title',
  kind: 'scene',
  label: 'Mono title',
  category: 'Scenes',
  description: 'Minimal centred title card: a tracked mono kicker, title and meta line with a hairline rule drawing out between them.',
  duration: 3,
  schema: {
    ...paletteSchema,
    kicker: { type: 'text', default: '', label: 'Kicker', maxLength: 60 },
    title: { type: 'text', default: 'Title', label: 'Title', maxLength: 40 },
    meta: { type: 'text', default: '', label: 'Meta line', maxLength: 90 },
    size: { type: 'number', min: 24, max: 160, step: 1, default: 76, label: 'Title size (px at 1080p)' },
  },
  render(ctx, clip, lt, env) {
    const p = env.props, F = env.frame, u = env.u;
    const pal = palette(p);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, F.w, F.h);
    const out = 1 - exitP(env, clip, 0.5);
    const cx = F.w / 2, cy = F.h / 2;
    const ts = p.size * u, ks = 17 * u;
    const base = ctx.globalAlpha;
    const part = (delay) => ({ a: clamp01(fade(lt - delay, 'soft')) * out, dy: (1 - sp(lt - delay, 'soft')) * 18 * u });
    ctx.save();
    const k = part(0.1);
    if (p.kicker && k.a > 0) {
      ctx.globalAlpha = base * k.a;
      monoLine(ctx, p.kicker.toUpperCase(), cx, cy - ts * 0.95 + k.dy, ks, 500, 0.16, pal.mute, 'center');
    }
    const t = part(0.25);
    let tw = 0;
    if (t.a > 0) {
      ctx.globalAlpha = base * t.a;
      tw = monoLine(ctx, p.title.toUpperCase(), cx, cy + ts * 0.3 + t.dy, ts, 600, 0.18, pal.ink, 'center');
      env.box({ kind: 'text', role: 'title', name: 'title', text: p.title, x: cx - tw / 2, y: cy - ts * 0.5, w: tw, h: ts, fg: pal.ink, bg: pal.ground, size: ts });
    }
    const r = smooth((lt - 0.45) / 0.9) * out;
    if (r > 0) {
      ctx.globalAlpha = base;
      ctx.fillStyle = pal.ink;
      const rw = Math.max(tw, 420 * u) * r;
      ctx.fillRect(cx - rw / 2, cy + ts * 0.62, rw, Math.max(1, u));
    }
    const m = part(0.7);
    if (p.meta && m.a > 0) {
      ctx.globalAlpha = base * m.a;
      monoLine(ctx, p.meta.toUpperCase(), cx, cy + ts * 0.62 + 46 * u + m.dy, ks, 500, 0.16, pal.mute, 'center');
    }
    ctx.restore();
    env.animating();
  },
});
