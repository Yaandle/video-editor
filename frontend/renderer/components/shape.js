// shape — rectangles, circles, polygons, stars, lines and arrows (ported from
// vidkit's _drawShape), now with token colours, inner borders and hard shadows.

import { register } from '../registry.js';
import { color, border, shadow as shadowTok, unit } from '../tokens.js';

const KINDS = ['rectangle', 'circle', 'triangle', 'polygon', 'star', 'line', 'arrow'];

function path(ctx, kind, x0, y0, w, h, p) {
  const cx = x0 + w / 2, cy = y0 + h / 2, x1 = x0 + w, y1 = y0 + h;
  ctx.beginPath();
  switch (kind) {
    case 'circle': ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(cx, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath(); break;
    case 'polygon': {
      const n = Math.max(3, p.sides), r = Math.min(w, h) / 2;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
      break;
    }
    case 'star': {
      const n = Math.max(2, p.points), ro = Math.min(w, h) / 2, ri = ro * p.inner_ratio;
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / n;
        i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
      break;
    }
    case 'arrow': {
      const shaft = h * 0.25, head = h * 0.6, len = w * 0.35;
      ctx.moveTo(x0, cy - shaft / 2); ctx.lineTo(x1 - len, cy - shaft / 2); ctx.lineTo(x1 - len, cy - head / 2);
      ctx.lineTo(x1, cy); ctx.lineTo(x1 - len, cy + head / 2); ctx.lineTo(x1 - len, cy + shaft / 2); ctx.lineTo(x0, cy + shaft / 2);
      ctx.closePath();
      break;
    }
    default: ctx.rect(x0, y0, w, h);
  }
}

register({
  type: 'shape',
  kind: 'component',
  label: 'Shape',
  category: 'Shapes',
  description: 'Flat geometric shape with an ink border and optional hard shadow.',
  duration: 4,
  schema: {
    kind: { type: 'enum', options: KINDS, default: 'rectangle', label: 'Shape' },
    size: { type: 'number', min: 4, max: 4000, step: 1, default: 240, label: 'Base size px' },
    fill: { type: 'color', default: 'lime', label: 'Fill' },
    stroke: { type: 'color', default: 'ink', label: 'Border' },
    stroke_width: { type: 'number', min: 0, max: 60, step: 0.5, default: 6, label: 'Border px' },
    shadow: { type: 'bool', default: true, label: 'Hard shadow' },
    sides: { type: 'number', min: 3, max: 16, step: 1, default: 6, label: 'Polygon sides' },
    points: { type: 'number', min: 2, max: 24, step: 1, default: 5, label: 'Star points' },
    inner_ratio: { type: 'number', min: 0.1, max: 0.95, step: 0.01, default: 0.5, label: 'Star inner ratio' },
  },
  label: (clip) => `shape · ${clip.props?.kind ?? 'rectangle'}`,
  render(ctx, clip, lt, env) {
    const p = env.props;
    const u = unit(env.frame);
    const w = p.size * u * env.xf.sx, h = p.size * u * env.xf.sy;
    const x0 = env.anchor.x - w / 2, y0 = env.anchor.y - h / 2;
    const sw = p.stroke_width * u;
    if (p.kind === 'line') {
      ctx.fillStyle = color(p.stroke);
      ctx.fillRect(x0, env.anchor.y - Math.max(sw, 2) / 2, w, Math.max(sw, 2));
      env.box({ kind: 'box', x: x0, y: env.anchor.y - sw / 2, w, h: sw });
      return;
    }
    if (p.shadow) {
      const s = shadowTok(env.frame);
      ctx.save();
      ctx.translate(s.x, s.y);
      path(ctx, p.kind, x0, y0, w, h, p);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
    }
    path(ctx, p.kind, x0, y0, w, h, p);
    ctx.fillStyle = color(p.fill);
    ctx.fill();
    if (sw > 0) {
      ctx.save();
      ctx.clip();
      ctx.lineWidth = sw * 2;          // half is clipped away → an inner border
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = color(p.stroke);
      ctx.stroke();
      ctx.restore();
    }
    env.box({ kind: 'box', x: x0, y: y0, w, h });
  },
});
