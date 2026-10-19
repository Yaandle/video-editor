// image + video — media clips. Ported from vidkit's _drawMedia (fit, crop,
// scale_x/scale_y) and extended with cover framing, brutal border/shadow and a
// closed-form slow zoom. Video pixels come from ffmpeg-decoded frames in export
// (exact) and a <video> element during editor playback (live).

import { register } from '../registry.js';
import { color, border, shadow as shadowTok } from '../tokens.js';
import { box, frame as frameRect } from '../draw.js';

const schema = (kind) => ({
  fit: { type: 'enum', options: ['contain', 'cover'], default: kind === 'image' ? 'contain' : 'contain', label: 'Fit' },
  box_w: { type: 'number', min: 0.05, max: 1.5, step: 0.01, default: 0.5, label: 'Cover width (frame)' },
  box_h: { type: 'number', min: 0.05, max: 1.5, step: 0.01, default: 0.6, label: 'Cover height (frame)' },
  focus_x: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Focus X' },
  focus_y: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Focus Y' },
  drift: { type: 'number', min: -0.2, max: 0.2, step: 0.005, default: 0, label: 'Zoom drift /s' },
  frame: { type: 'enum', options: ['none', 'border', 'border-shadow'], default: 'none', label: 'Frame' },
  ...(kind === 'video' ? { gain_db: { type: 'number', min: -60, max: 12, step: 0.5, default: 0, label: 'Audio gain dB' } } : {}),
});

function drawMedia(ctx, clip, lt, env, el) {
  const p = env.props;
  const W = env.frame.w, H = env.frame.h;
  const natW = el ? (el.naturalWidth || el.videoWidth || el.width) : 16;
  const natH = el ? (el.naturalHeight || el.videoHeight || el.height) : 9;
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = crop.x * natW, sy = crop.y * natH;
  const sw = Math.max(1, crop.w * natW), sh = Math.max(1, crop.h * natH);
  const zoom = 1 + (p.drift ?? 0) * Math.max(0, lt);
  let dw, dh;
  if (p.fit === 'cover') {
    dw = p.box_w * W * env.xf.sx;
    dh = p.box_h * H * env.xf.sy;
  } else {
    const fit = Math.min((W * 0.88) / sw, (H * 0.8) / sh, Infinity);
    dw = sw * fit * env.xf.sx;
    dh = sh * fit * env.xf.sy;
  }
  const dx = env.anchor.x - dw / 2, dy = env.anchor.y - dh / 2;
  const bw = border(env.frame);
  if (p.frame === 'border-shadow') box(ctx, dx, dy, dw, dh, { shadow: shadowTok(env.frame) });
  if (el) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    if (p.fit === 'cover') {
      const s = Math.max(dw / sw, dh / sh) * zoom;
      const vw = dw / s, vh = dh / s;
      const fx = sx + Math.max(0, Math.min(sw - vw, p.focus_x * sw - vw / 2));
      const fy = sy + Math.max(0, Math.min(sh - vh, p.focus_y * sh - vh / 2));
      ctx.drawImage(el, fx, fy, vw, vh, dx, dy, dw, dh);
    } else {
      const zw = dw * zoom, zh = dh * zoom;
      ctx.drawImage(el, sx, sy, sw, sh, env.anchor.x - zw / 2, env.anchor.y - zh / 2, zw, zh);
    }
    ctx.restore();
  } else {
    // Media not decoded yet (editor only — export fails earlier on missing assets).
    ctx.fillStyle = color('paper-deep');
    ctx.fillRect(dx, dy, dw, dh);
  }
  if (p.frame !== 'none') frameRect(ctx, dx, dy, dw, dh, bw, color('ink'));
  env.box({ kind: 'image', x: dx, y: dy, w: dw, h: dh, bleed: dx < 0 || dy < 0 || dx + dw > W || dy + dh > H });
  if (p.drift) env.animating();
}

register({
  type: 'image',
  kind: 'component',
  label: 'Image',
  category: 'Media',
  description: 'A still image (photo, screenshot, texture) with contain/cover framing, crop and slow zoom.',
  media: 'image',
  duration: 4,
  schema: schema('image'),
  assets: (clip) => (clip.src ? [clip.src] : []),
  label: (clip) => `image · ${String(clip.src ?? '').split('/').pop()}`,
  render(ctx, clip, lt, env) {
    drawMedia(ctx, clip, lt, env, clip.src ? env.image(clip.src) : null);
  },
});

register({
  type: 'video',
  kind: 'component',
  label: 'Video',
  category: 'Media',
  description: 'A video clip; frames are decoded per project frame so export is exact.',
  media: 'video',
  duration: 5,
  schema: schema('video'),
  label: (clip) => `video · ${String(clip.src ?? '').split('/').pop()}`,
  render(ctx, clip, lt, env) {
    const st = (clip.source_start ?? 0) + Math.max(0, lt) * (clip.speed ?? 1);
    const el = clip.src ? env.videoFrame(clip.src, st) : null;
    const ready = el && (el.naturalWidth || el.videoWidth);
    drawMedia(ctx, clip, lt, env, ready ? el : null);
  },
});
