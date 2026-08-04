// canvas.js — HTML5 Canvas port of CanvasWidget
import { THEMES, TRACK_COLOURS } from './app.js';

const PY_KEYWORDS = new Set([
  'False','None','True','and','as','assert','async','await','break','class',
  'continue','def','del','elif','else','except','finally','for','from','global',
  'if','import','in','is','lambda','nonlocal','not','or','pass','raise','return',
  'try','while','with','yield'
]);

function tokenizeCode(code, theme) {
  const rules = [
    { re: /#[^\n]*/g,                                    color: theme.comment  ?? '#6B7280' },
    { re: /"""(?:[^"\\]|\\.|\n)*?"""/g,                  color: theme.string   ?? '#16A34A' },
    { re: /'''(?:[^'\\]|\\.|\n)*?'''/g,                  color: theme.string   ?? '#16A34A' },
    { re: /"(?:[^"\\]|\\.)*?"/g,                         color: theme.string   ?? '#16A34A' },
    { re: /'(?:[^'\\]|\\.)*?'/g,                         color: theme.string   ?? '#16A34A' },
    { re: /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.\d+|\d+)\b/g, color: theme.number ?? '#DB2777' },
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b(?=\s*\()/g,        color: theme.function ?? '#2563EB', bold: true, guard: 'keyword' },
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g,                 color: theme.variable ?? '#7C3AED', guard: 'keyword' },
    { re: /[=+\-*/%<>!&|^~@]+/g,                         color: theme.operator ?? '#374151' },
  ];

  const spans = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code))) {
      const text = m[0];
      if (rule.guard === 'keyword' && PY_KEYWORDS.has(text)) {
        spans.push({ start: m.index, end: m.index + text.length, color: theme.keyword ?? '#D97706', bold: true });
      } else {
        spans.push({ start: m.index, end: m.index + text.length, color: rule.color, bold: !!rule.bold });
      }
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const tokens = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    if (s.start > cursor) tokens.push({ text: code.slice(cursor, s.start), color: theme.text ?? '#1F2937', bold: false });
    tokens.push({ text: code.slice(s.start, s.end), color: s.color, bold: s.bold });
    cursor = s.end;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor), color: theme.text ?? '#1F2937', bold: false });
  return tokens;
}

function tokensToLines(tokens) {
  const lines = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i].length) lines[lines.length - 1].push({ text: parts[i], color: tok.color, bold: tok.bold });
    }
  }
  return lines;
}

const Easing = {
  linear: t => t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeOutBack: (t, overshoot = 1.7) => {
    const c1 = overshoot, c3 = c1 + 1, x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }
};

// Animate Position/Zoom — piecewise-linear interpolation across any number
// of {t, x, y, scale} keyframes (t normalized 0-1 of the clip's own
// duration). Two keyframes reproduce the original straight-line move;
// three or more let a clip pan through several stops (e.g. zoom into a
// feature, pan to another, zoom back out). `scale` is optional per
// keyframe — when omitted it falls back to the clip's own static scale,
// so older 2-point position-only paths render exactly as before.
function resolvePos(clip, playhead) {
  const kf = clip.motion_keyframes;
  const baseScale = clip.scale_x ?? clip.scale ?? 1.0;

  if (!Array.isArray(kf) || kf.length < 2) {
    return { x: clip.x, y: clip.y, scale: null };
  }

  const sorted = [...kf].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  let localT = clip.duration > 0 ? (playhead - clip.start) / clip.duration : 0;
  localT = Math.max(0, Math.min(1, localT));

  let a = sorted[0], b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (localT >= (sorted[i].t ?? 0) && localT <= (sorted[i + 1].t ?? 1)) {
      a = sorted[i]; b = sorted[i + 1];
      break;
    }
  }
  const span = ((b.t ?? 1) - (a.t ?? 0)) || 1;
  const p = Math.max(0, Math.min(1, (localT - (a.t ?? 0)) / span));
  const scaleA = a.scale ?? baseScale, scaleB = b.scale ?? baseScale;

  return {
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
    scale: scaleA + (scaleB - scaleA) * p,
  };
}


// aspect derived from project at paint time — see _canvasRect()
const MIN_SCALE = 0.05;
const MAX_SCALE = 4.0;
const HANDLE_SIZE = 10;
const HANDLE_HIT_SIZE = 16; 
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4.0;

const SNAP_X = [0, 0.25, 0.5, 0.75, 1];  // left edge / left third / centre / right third / right edge
const SNAP_Y = [0, 0.12, 0.5, 0.85, 1];  // top edge / top / centre / bottom / bottom edge
const SNAP_THRESHOLD = 0.04;
const SNAP_PX = 10; // #61 — constant on-screen px catch radius for object/edge snapping (zoom-corrected at use)

export class CanvasWidget {
  
  constructor(canvasEl, project, selectedIds) {
    this._el = canvasEl;
    this._ctx = canvasEl.getContext('2d');
    this.project = project;
    this.playhead = 0.0;
    this._selectedIds = selectedIds || new Set();
    this._selectionPrimaryId = null;
    this._dragClip = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._snapTarget = null;
    this._marginGuides = []; // #61 — equal-spacing guides shown while dragging
    this._pendingZoom = 1.0; // Animate Position/Zoom — level for the next placed stop
    this._mediaCache = new Map();
    this._groupDragOrigins = null;
    this._marqueeActive = false;
    this._marqueeStart = null;
    this._marqueeCurrent = null;
    this._marqueeShift = false;
    this._panY = 0;
    this._zoom = 1.0;
    this._panX = 0;

    this._tool = 'select'; // 'select' | 'move'

    this._isPanning = false;
    this._panDragOrigin = null; // { mouseX, mouseY, panX, panY }

    this._resizeHandle = null;   // 'tl'|'tr'|'bl'|'br' | null
    this._resizeOrigin = null;   // { mouseX, mouseY, scale, rectW, rectH, canvasRectH }
    this._drawnRects = new Map(); // clipId → {x,y,w,h}
    this._dragBeforeSnapshot = null;

    this._bindEvents();
    this.resize();
  }

  setTool(tool) {
    this._tool = tool;
    this._el.style.cursor =
      tool === 'move' ? 'grab' :
      tool === 'motion' ? 'crosshair' : '';

    const badge = document.getElementById('motion-mode-badge');
    if (tool === 'motion') {
      if (this._pendingZoom == null) this._pendingZoom = 1.0;
      this._updateMotionBadge();
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // Animate Position/Zoom — the badge doubles as a live readout of the
  // pending zoom level (adjust with the scroll wheel before clicking) and
  // how many stops the path has so far.
  _updateMotionBadge() {
    const badge = document.getElementById('motion-mode-badge');
    if (!badge) return;
    const clip = this.project.clips.find(c => c.id === this._selectionPrimaryId);
    const n = clip && Array.isArray(clip.motion_keyframes) ? clip.motion_keyframes.length : 0;
    badge.textContent =
      `ZOOM ${this._pendingZoom.toFixed(2)}× — scroll to adjust, click to add point ${n ? `(${n} set)` : ''} · Esc to finish`;
  }
  setProject(p) {
    this.project = p;
    // Drop per-clip caches so a new project with reused clip ids can't hit
    // stale rects, and abandon any in-flight drag/resize on the old project.
    this._drawnRects.clear();
    this._dragClip = null;
    this._resizeHandle = null;
    this._resizeOrigin = null;
    this._groupDragOrigins = null;
    this._snapTarget = null;
    this._marginGuides = [];
    this.redraw();
  }
  setPlayhead(t) { this.playhead = t; this.redraw(); }
  setSelectedIds(selectedIds, primaryId = null) {
  this._selectedIds = selectedIds;
  this._selectionPrimaryId = primaryId ?? (
    this._selectedIds.size === 1 
      ? this._selectedIds.values().next().value 
      : null
  );
  this.redraw();
}

  resize() {
    const frame = this._el.parentElement;
    this._el.width = frame.clientWidth;
    this._el.height = frame.clientHeight;
    this.redraw();
  }

  _canvasRect() {
    const w = this._el.width, h = this._el.height;
    const aspect = (this.project.canvas_w ?? 1080) / (this.project.canvas_h ?? 1920);
    const cw = Math.min(w, h * aspect) | 0;
    const ch = (cw / aspect) | 0;
    const x = ((w - cw) / 2) | 0;
    const y = ((h - ch) / 2) | 0;
    return { x, y, w: cw, h: ch };
  }

  _normToPx(nx, ny) {
    const r = this._canvasRect();
    return { x: r.x + nx * r.w | 0, y: r.y + ny * r.h | 0 };
  }

  _pxToNorm(px, py) {
    const r = this._canvasRect();
    const nx = (px - r.x) / r.w, ny = (py - r.y) / r.h;
    return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
  }

  _toLogical(screenX, screenY) {
    return { x: (screenX - this._panX) / this._zoom, y: (screenY - this._panY) / this._zoom };
  }

  _activeClips() {
    return this.project.clips
      .filter(c => c.start <= this.playhead && this.playhead < c.end())
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
  }

  _clipRect(clip, r) {
    const { x, y } = resolvePos(clip, this.playhead);
    const pt = this._normToPx(x, y);
    const maxW = (r.w * 0.88) | 0;
    return { x: pt.x - (maxW >> 1), y: pt.y - 14, w: maxW, h: 28 };
  }

  _handlePositions(rect) {
    return {
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      bl: { x: rect.x, y: rect.y + rect.h },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
    };
  }

  _hitHandle(px, py, rect) {
    const handles = this._handlePositions(rect);
    for (const [name, pt] of Object.entries(handles)) {
      if (Math.abs(px - pt.x) <= HANDLE_HIT_SIZE && Math.abs(py - pt.y) <= HANDLE_HIT_SIZE) {
        return name;
      }
    }
    return null;
  }

  _paint() {
    this._drawnRects.clear();
    const ctx = this._ctx, el = this._el, r = this._canvasRect(), theme = THEMES.dark;
    ctx.clearRect(0, 0, el.width, el.height);

    ctx.save();
    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);

    ctx.fillStyle = this.project.background_color ?? theme.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#505050';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59,130,246,0.24)';
    ctx.lineWidth = 1;
    const cx = r.x + (r.w >> 1);
    ctx.beginPath(); ctx.moveTo(cx, r.y); ctx.lineTo(cx, r.y + r.h); ctx.stroke();
    for (const frac of [1/3, 2/3]) {
      const gy = r.y + (r.h * frac) | 0;
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
    }
    ctx.setLineDash([]);

    if (this._snapTarget) {
      const { x: sx, y: sy } = this._snapTarget;
      if (sx != null) {
        const px = this._normToPx(sx, 0).x;
        ctx.strokeStyle = 'rgba(59,130,246,0.7)';
        ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
      }
      if (sy != null) {
        const py = this._normToPx(0, sy).y;
        ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
      }
    }

    // #61 — equal-margin guides: two matching gap segments plus the shared
    // px distance, shown while a drag lands on an equal-spacing position.
    if (this._marginGuides && this._marginGuides.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(245,158,11,0.9)';
      ctx.fillStyle = 'rgba(245,158,11,0.95)';
      ctx.lineWidth = 1.5;
      ctx.font = '10px Consolas, monospace';
      for (const g of this._marginGuides) {
        if (g.axis === 'x') {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          for (const seg of [g.seg1, g.seg2]) {
            ctx.beginPath(); ctx.moveTo(seg.x1, seg.y); ctx.lineTo(seg.x2, seg.y); ctx.stroke();
            ctx.fillText(`${Math.round(g.gap)}`, (seg.x1 + seg.x2) / 2, seg.y - 4);
          }
        } else {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          for (const seg of [g.seg1, g.seg2]) {
            ctx.beginPath(); ctx.moveTo(seg.x, seg.y1); ctx.lineTo(seg.x, seg.y2); ctx.stroke();
            ctx.fillText(`${Math.round(g.gap)}`, seg.x + 4, (seg.y1 + seg.y2) / 2);
          }
        }
      }
      ctx.restore();
    }

    for (const clip of this._activeClips()) this._drawClipWithTransition(ctx, clip, r);

    if (this._selectedIds && this._selectedIds.size > 0) {
      if (this._selectedIds.size === 1) {
        const selId = this._selectedIds.values().next().value;
        const clip = this.project.clips.find(c => c.id === selId);
        if (clip) {
          if (['image','video','code','narration','shape'].includes(clip.clip_type)) {
            const drawn = this._drawnRects.get(clip.id);
            if (drawn) this._drawResizeOverlay(ctx, drawn);
          } else if (clip.track === 'text' || clip.track === 'visual') {
            const cr = this._clipRect(clip, r);
            ctx.strokeStyle = 'rgba(59,130,246,0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(cr.x - 3, cr.y - 3, cr.w + 6, cr.h + 6);
            ctx.setLineDash([]);
          }
        }
      } else {
        let bx = Infinity, by = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const id of this._selectedIds) {
          const d = this._drawnRects.get(id);
          if (!d) continue;
          bx = Math.min(bx, d.x); by = Math.min(by, d.y);
          bx2 = Math.max(bx2, d.x + d.w); by2 = Math.max(by2, d.y + d.h);
        }
        if (bx !== Infinity) {
          ctx.strokeStyle = 'rgba(59,130,246,0.9)';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(bx - 6, by - 6, (bx2 - bx) + 12, (by2 - by) + 12);
          ctx.setLineDash([]);
        }
      }
    }

    ctx.restore();

    if (this._marqueeActive && this._marqueeStart && this._marqueeCurrent) {
      const mx = Math.min(this._marqueeStart.x, this._marqueeCurrent.x);
      const my = Math.min(this._marqueeStart.y, this._marqueeCurrent.y);
      const mw = Math.abs(this._marqueeStart.x - this._marqueeCurrent.x);
      const mh = Math.abs(this._marqueeStart.y - this._marqueeCurrent.y);
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.12)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx + 0.5, my + 0.5, mw, mh);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  redraw() {
    this._paint();
  }

  _drawResizeOverlay(ctx, rect) {
    ctx.strokeStyle = 'rgba(59,130,246,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    ctx.setLineDash([]);

    const handles = this._handlePositions(rect);
    for (const pt of Object.values(handles)) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - HANDLE_SIZE / 2, pt.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill(); ctx.stroke();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    if (r <= 0) { ctx.fillRect(x, y, w, h); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // ── Transitions (#63) ──────────────────────────────────────────────────
  // Canva-style in/out transitions for ANY clip type (narration, image,
  // video, shape, code, graph). Returns null when no transition is active
  // at the current playhead, else { alpha, dx, dy, scale } in canvas px.
  _transitionState(clip, r) {
    const tIn = clip.transition_in, tOut = clip.transition_out;
    if (!tIn && !tOut) return null;

    const local = this.playhead - clip.start;                 // sec since clip start
    const remain = clip.start + clip.duration - this.playhead; // sec until clip end
    const inDur = Math.max(0.01, (clip.transition_in_ms ?? 500) / 1000);
    const outDur = Math.max(0.01, (clip.transition_out_ms ?? 500) / 1000);

    let alpha = 1, dx = 0, dy = 0, scale = 1, active = false;

    const applyKind = (kind, p) => {
      // p: 1 → fully off/hidden, 0 → settled in place
      const slide = 1.1 * p; // slide from just outside the frame
      switch (kind) {
        case 'fade':        alpha *= (1 - p); break;
        case 'slide_up':    dy += r.h * slide;  alpha *= Math.min(1, (1 - p) * 1.6); break;
        case 'slide_down':  dy -= r.h * slide;  alpha *= Math.min(1, (1 - p) * 1.6); break;
        case 'slide_left':  dx += r.w * slide;  alpha *= Math.min(1, (1 - p) * 1.6); break;
        case 'slide_right': dx -= r.w * slide;  alpha *= Math.min(1, (1 - p) * 1.6); break;
        case 'scale_pop':   scale *= Math.max(0.001, 1 - 0.6 * p); alpha *= (1 - p); break;
      }
    };

    if (tIn && local < inDur) {
      const t = Math.max(0, Math.min(1, local / inDur));
      applyKind(tIn, 1 - Easing.easeOutCubic(t));
      active = true;
    }
    if (tOut && remain < outDur) {
      const t = Math.max(0, Math.min(1, remain / outDur));
      applyKind(tOut, 1 - Easing.easeOutCubic(t));
      active = true;
    }
    return active ? { alpha, dx, dy, scale } : null;
  }

  _drawClipWithTransition(ctx, clip, r) {
    const trans = this._transitionState(clip, r);
    if (!trans) { this._drawClip(ctx, clip, r); return; }

    const { x, y } = resolvePos(clip, this.playhead);
    const pt = this._normToPx(x, y);

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, trans.alpha));
    ctx.translate(trans.dx, trans.dy);
    if (trans.scale !== 1) {
      ctx.translate(pt.x, pt.y);
      ctx.scale(trans.scale, trans.scale);
      ctx.translate(-pt.x, -pt.y);
    }
    this._drawClip(ctx, clip, r);
    ctx.restore();
  }

  _drawClip(ctx, clip, r) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    if (clip.track === 'audio') return;

    const { x, y, scale: animScale } = resolvePos(clip, this.playhead);

    const pt = this._normToPx(x, y);

    if (clip.clip_type === 'narration') {
        const sx = animScale ?? clip.scale_x ?? clip.scale ?? 1.0;

        const fontSize = clip.font_size ?? Math.max(7, (r.w / 18) | 0);
        const fontStyle = clip.font_italic ? 'italic ' : '';
        const fontWeight = clip.font_bold ? 'bold ' : '';
        const fontFamily = clip.text_font_family || 'Consolas, monospace';
        ctx.font = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
        const textColor = clip.font_color ?? theme.text;
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = clip.text_align ?? 'center';

        const lineHeight = fontSize * (clip.text_line_height ?? 1.4);
        const baseMaxW = (r.w * 0.88) | 0;
        const maxW = (baseMaxW * sx) | 0;

        const displayContent = clip.text_uppercase
          ? clip.content.toUpperCase()
          : clip.content;

        const layout = this._layoutNarrationText(ctx, displayContent, maxW, lineHeight);
        // #66: honour the Advanced Text modal's delay — animation clock starts
        // after text_delay_ms. While the delay is pending the text stays hidden.
        const delayMs = clip.text_delay_ms ?? 0;
        const rawElapsedMs = Math.max(0, this.playhead - clip.start) * 1000;
        const elapsedMs = rawElapsedMs - delayMs;
        const animActive = clip.text_anim_style && clip.text_anim_style !== 'static';
        if (animActive && elapsedMs < 0) {
          this._drawnRects.set(clip.id, {
            x: pt.x - (maxW >> 1), y: pt.y, w: maxW,
            h: layout.lines.length * lineHeight,
          });
          return;
        }

        ctx.save();
        ctx.globalAlpha *= clip.text_opacity ?? 1.0; // *= so transition fades compose (#63)

        if (clip.text_plate) {
          const p = clip.text_plate;
          const h = layout.lines.length * lineHeight + p.padding * 2;
          ctx.fillStyle = p.color;
          this._roundRect(ctx, pt.x - (maxW >> 1) - p.padding, pt.y - p.padding, maxW + p.padding * 2, h, p.radius ?? 0);
          ctx.fill();
        }

        if (clip.text_glow) {
          const g = clip.text_glow;
          ctx.shadowColor = g.color;
          ctx.shadowBlur = g.blur;
          ctx.globalAlpha *= (g.opacity ?? 1.0);
        } else if (clip.text_shadow) {
          const s = clip.text_shadow;
          ctx.shadowOffsetX = s.x;
          ctx.shadowOffsetY = s.y;
          ctx.shadowBlur = s.blur;
          ctx.shadowColor = s.color;
        }

        if (clip.text_anim_style && clip.text_anim_style !== 'static') {
          this._renderNarrationAnimated(ctx, layout, pt.x, pt.y, elapsedMs, clip);
        } else {
          this._renderNarrationStatic(ctx, layout, pt.x, pt.y, clip);
        }

        if (clip.text_stroke && clip.text_stroke.width > 0) {
          ctx.strokeStyle = clip.text_stroke.color;
          ctx.lineWidth = clip.text_stroke.width;
          ctx.shadowBlur = 0;
          layout.lines.forEach((line, i) => {
            ctx.strokeText(line, pt.x, pt.y + i * lineHeight);
          });
        }

        if (clip.text_underline || clip.text_strike) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = Math.max(1, fontSize * 0.05);
          layout.lines.forEach((line, i) => {
            const w = ctx.measureText(line).width;
            const lx = ctx.textAlign === 'center' ? pt.x - w / 2 : ctx.textAlign === 'right' ? pt.x - w : pt.x;
            const ly = clip.text_underline
              ? pt.y + i * lineHeight + fontSize * 1.05
              : pt.y + i * lineHeight + fontSize * 0.55;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + w, ly);
            ctx.stroke();
          });
        }

        ctx.restore();

        const bx = pt.x - (maxW >> 1), by = pt.y;
        const height = layout.lines.length * lineHeight;
        this._drawnRects.set(clip.id, { x: bx, y: by, w: maxW, h: height });
      }


    else if (clip.clip_type === 'code') {
      this._drawCodeTerminal(ctx, clip, r, pt, theme);
    }
    else if (clip.clip_type === 'graph') {
      const blockH = (r.h * 0.35) | 0;
      const blockW = (r.w * 0.88) | 0;
      const bx = r.x + ((r.w - blockW) >> 1);
      const by = pt.y - (blockH >> 1);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(bx, by, blockW, blockH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);
      this._drawGraphPreview(ctx, clip, bx, by, blockW, blockH, theme, r);
    }
    else if (clip.clip_type === 'image' || clip.clip_type === 'video') {
      this._drawMedia(ctx, clip, r, pt, animScale);
    }
    else if (clip.clip_type === 'shape') {
      this._drawShape(ctx, clip, r, pt, theme, animScale);
    }
  }

  _drawCodeTerminal(ctx, clip, r, pt, theme) {
    const blockW = Math.floor(r.w * 0.92);
    const maxBlockH = Math.min(Math.floor(r.h * 0.60), 360);
    const titleH = 30;
    const promptH = clip.terminal_prompt ? 26 : 0;
    const padX = 14, padY = 12;
    const bx = r.x + ((r.w - blockW) >> 1);
    const fontSize = Math.max(10, Math.floor(r.w / 46));
    const lineH = Math.round(fontSize * 1.55);
    const gutterW = Math.max(34, fontSize * 2.5);

    const lines = tokensToLines(tokenizeCode(clip.content ?? "", theme));
    const contentHeight = lines.length * lineH + padY * 2;
    const blockH = Math.min(maxBlockH, titleH + promptH + contentHeight);
    const by = pt.y - (blockH >> 1);

    this._drawnRects.set(clip.id, { x: bx, y: by, w: blockW, h: blockH });

    // Window
    ctx.fillStyle = theme.bg || "#1e1e1e";
    ctx.fillRect(bx, by, blockW, blockH);
    ctx.strokeStyle = theme.border || "#3c3c3c";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + .5, by + .5, blockW, blockH);

    // Titlebar
    ctx.fillStyle = theme.titlebar || this._shade(theme.bg, 1.12);
    ctx.fillRect(bx, by, blockW, titleH);

    const iconColor = theme.comment ?? "#9ca3af";
    const iconSize = 9, iconGap = 18, rightPad = 16;
    const iconCY = by + titleH / 2;
    const closeCX = bx + blockW - rightPad - iconSize / 2;
    const maxCX = closeCX - iconGap;
    const minCX = maxCX - iconGap;

    ctx.strokeStyle = iconColor;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    ctx.beginPath(); ctx.moveTo(minCX - iconSize / 2, iconCY); ctx.lineTo(minCX + iconSize / 2, iconCY); ctx.stroke();
    ctx.strokeRect(maxCX - iconSize / 2, iconCY - iconSize / 2, iconSize, iconSize);
    ctx.beginPath();
    ctx.moveTo(closeCX - iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX + iconSize / 2, iconCY + iconSize / 2);
    ctx.moveTo(closeCX + iconSize / 2, iconCY - iconSize / 2);
    ctx.lineTo(closeCX - iconSize / 2, iconCY + iconSize / 2);
    ctx.stroke();

    if (clip.terminal_title) {
      ctx.fillStyle = theme.comment || "#9ca3af";
      ctx.font = `600 ${fontSize}px Consolas`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(clip.terminal_title, bx + blockW / 2, iconCY);
    }

    // Prompt
    let contentTop = by + titleH;
    if (clip.terminal_prompt) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(bx, contentTop, blockW, promptH);
      ctx.font = `${fontSize}px Consolas`;
      ctx.fillStyle = theme.function || "#4ec9b0";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(clip.terminal_prompt, bx + padX, contentTop + promptH / 2);
      contentTop += promptH;
    }

    // Gutter + divider
    ctx.fillStyle = this._withAlpha(theme.titlebar ?? "#252526", 0.65);
    ctx.fillRect(bx, contentTop, gutterW + 4, blockH - titleH - promptH);
    ctx.strokeStyle = theme.gutterBorder ?? this._withAlpha(theme.text ?? "#e6edf3", 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + gutterW + 4.5, contentTop);
    ctx.lineTo(bx + gutterW + 4.5, by + blockH);
    ctx.stroke();

    // Code (clipped, with typewriter)
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, contentTop, blockW, blockH - titleH - promptH);
    ctx.clip();
    ctx.font = `${fontSize}px Consolas`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const codeY = contentTop + padY;
    const anim = clip.anim_mode ?? clip.animation;
    let typedChars = Infinity;
    if (anim === "typewriter") {
      const elapsed = Math.max(0, this.playhead - clip.start);
      typedChars = elapsed * (clip.type_speed ?? 40);
    }

    let charsUsed = 0;
    let cursorX = bx + gutterW + padX, cursorY = codeY;

    for (let i = 0; i < lines.length; i++) {
      const y = codeY + i * lineH;
      ctx.fillStyle = theme.comment || "#6b7280";
      ctx.textAlign = "right";
      ctx.fillText(i + 1, bx + gutterW - 10, y);
      ctx.textAlign = "left";

      let x = bx + gutterW + padX;
      for (const tok of lines[i]) {
        let text = tok.text;
        if (charsUsed >= typedChars) break;
        const remain = typedChars - charsUsed;
        if (text.length > remain) text = text.slice(0, remain);

        ctx.font = `${tok.bold ? "bold " : ""}${fontSize}px Consolas`;
        ctx.fillStyle = tok.color;
        ctx.fillText(text, x, y);

        const textWidth = ctx.measureText(text).width;
        x += textWidth;
        charsUsed += text.length;
        cursorX = x; cursorY = y;
        if (text.length < tok.text.length) break;
      }
      if (charsUsed >= typedChars) break;
    }

    if (clip.show_cursor !== false) {
      const blink = Math.floor(this.playhead * 2) % 2 === 0;
      if (blink) {
        ctx.fillStyle = theme.cursor ?? "#ffffff";
        ctx.fillRect(cursorX, cursorY + 1, Math.max(2, fontSize * 0.15), lineH - 2);
      }
    }
    ctx.restore();
  }

  _withAlpha(hex, alpha) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _layoutNarrationText(ctx, text, maxWidth, lineHeight) {
    const paragraphs = text.split('\n');
    const spaceWidth = ctx.measureText(' ').width;
    const lines = [];
    let gWord = 0, gChar = 0;

    for (const para of paragraphs) {
      const rawWords = para.split(' ');
      let currentLine = [], currentWidth = 0;

      for (const word of rawWords) {
        const width = ctx.measureText(word).width;
        if (currentLine.length && currentWidth + spaceWidth + width > maxWidth) {
          lines.push(currentLine);
          currentLine = [];
          currentWidth = 0;
        }

        const chars = [];
        let cx = 0;
        for (const ch of word) {
          const cw = ctx.measureText(ch).width;
          chars.push({ char: ch, x: cx, width: cw, globalIndex: gChar++ });
          cx += cw;
        }

        currentLine.push({ text: word, width, chars, globalIndex: gWord++ });
        currentWidth += (currentLine.length > 1 ? spaceWidth : 0) + width;
      }
      if (currentLine.length) lines.push(currentLine);
    }

    const outLines = lines.map((line, li) => {
      let x = 0;
      const words = line.map((word, wi) => {
        if (wi > 0) x += spaceWidth;
        const result = { ...word, x };
        x += word.width;
        return result;
      });
      return { words, y: li * lineHeight, lineWidth: x };
    });

    return {
      lines: outLines,
      totalWords: outLines.reduce((sum, line) => sum + line.words.length, 0),
      totalChars: gChar,
      lineHeight,
    };
  }

  _renderNarrationStatic(ctx, layout, ox, oy, clip) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        this._drawNarrationText(ctx, word.text, lineOx + word.x, oy + line.y, clip);
      }
    }

    ctx.restore();
  }

  _renderNarrationAnimated(ctx, layout, ox, oy, elapsedMs, clip) {
    const style = clip.text_anim_style === 'wordblurin' ? 'wordblur' : clip.text_anim_style;
    if (style === 'typewriter') {
      this._renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'wordblur') {
      this._renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'linescan') {
      this._renderNarrationLineScan(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'fade') {
      this._renderNarrationFadeIn(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'slideup') {
      this._renderNarrationSlideUp(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'scalepop') {
      this._renderNarrationScalePop(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'charstagger') {
      this._renderNarrationCharStagger(ctx, layout, ox, oy, elapsedMs, clip);
    } else if (style === 'glitch') {
      this._renderNarrationGlitch(ctx, layout, ox, oy, elapsedMs, clip);
    } else {
      this._renderNarrationStatic(ctx, layout, ox, oy, clip);
    }
  }

  _renderNarrationTypewriter(ctx, layout, ox, oy, elapsedMs, clip) {
    const msPerChar = 1000 / (clip.text_chars_per_second ?? 26);
    const popMs = clip.text_pop_duration_ms ?? 90;
    let lastX = ox, lastY = oy;
    const lastH = layout.lineHeight * 0.78;
    let allDone = true;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        for (const ch of word.chars) {
          const revealAt = ch.globalIndex * msPerChar;
          const localT = elapsedMs - revealAt;
          if (localT < 0) {
            allDone = false;
            continue;
          }

          const popT = Math.min(1, localT / popMs);
          const scale = 0.4 + 0.6 * Math.max(0, Easing.easeOutBack(popT, 1.2));
          const alpha = Math.min(1, localT / (popMs * 0.6));
          const cx = lineOx + word.x + ch.x + ch.width / 2;
          const cy = oy + line.y;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(scale, scale);
          this._drawNarrationText(ctx, ch.char, -ch.width / 2, 0, clip, alpha);
          ctx.restore();

          lastX = lineOx + word.x + ch.x + ch.width;
          lastY = oy + line.y;
        }
      }
    }

    if (!allDone) {
      const blinkOn = Math.floor(this.playhead * 2) % 2 === 0;
      if (blinkOn) {
        const theme = THEMES[clip.theme] ?? THEMES.dark;
        ctx.fillStyle = clip.font_color ?? theme.text;
        ctx.fillRect(lastX + 2, lastY, 3, lastH);
      }
    }

    ctx.restore();
  }

  _renderNarrationWordBlurIn(ctx, layout, ox, oy, elapsedMs, clip) {
    const stagger = clip.text_stagger_ms ?? 60;
    const dur = clip.text_duration_ms ?? 550;
    const maxBlur = clip.text_max_blur ?? 14;
    const rise = clip.text_rise_distance ?? 22;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        const startTime = word.globalIndex * stagger;
        const localT = elapsedMs - startTime;
        if (localT < 0) continue;

        const t = Math.max(0, Math.min(1, localT / dur));
        const clearT = Easing.easeOutCubic(Math.min(1, t * 1.6));
        const springT = Easing.easeOutBack(t, 1.4);
        const blur = maxBlur * (1 - clearT);
        const alpha = Math.min(1, t * 2.2);
        const yOffset = rise * (1 - springT);
        const scale = 0.85 + 0.15 * springT;

        ctx.save();
        ctx.filter = blur > 0.3 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';

        const wx = lineOx + word.x + word.width / 2;
        const wy = oy + line.y + yOffset;

        ctx.translate(wx, wy);
        ctx.scale(scale, scale);
        this._drawNarrationText(ctx, word.text, -word.width / 2, 0, clip, alpha);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _renderNarrationLineScan(ctx, layout, ox, oy, elapsedMs, clip) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    const color = clip.font_color ?? theme.text;

    const dur = clip.text_duration_ms ?? 550;
    const stagger = clip.text_line_stagger_ms ?? 140;
    const slideDist = clip.text_slide_distance ?? 90;
    const sweepWidth = clip.text_sweep_width ?? 140;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let li = 0; li < layout.lines.length; li++) {
      const line = layout.lines[li];
      const startTime = li * stagger;
      const localT = elapsedMs - startTime;
      if (localT < 0) continue;

      const t = Math.max(0, Math.min(1, localT / dur));
      const eased = Easing.easeOutExpo(t);
      const xOffset = -slideDist * (1 - eased);
      const alpha = Math.min(1, t * 3);
      const lineX = ox - line.lineWidth / 2 + xOffset;
      const lineText = line.words.map(w => w.text).join(' ');

      this._drawNarrationText(ctx, lineText, lineX, oy + line.y, clip, alpha);

      if (t < 0.9) {
        const sweepT = Easing.easeOutCubic(Math.min(1, t / 0.75));
        const sweepX = -sweepWidth + sweepT * (line.lineWidth + sweepWidth * 2);

        const off = document.createElement('canvas');
        off.width = Math.ceil(line.lineWidth + 20);
        off.height = Math.ceil(layout.lineHeight);

        const octx = off.getContext('2d');
        octx.font = ctx.font;
        octx.textBaseline = ctx.textBaseline;
        octx.fillStyle = color;
        octx.fillText(lineText, 0, off.height * 0.7);

        octx.globalCompositeOperation = 'source-atop';

        const grad = octx.createLinearGradient(
          sweepX - sweepWidth / 2,
          0,
          sweepX + sweepWidth / 2,
          0
        );
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, color ?? '#ffffff');
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        octx.fillStyle = grad;
        octx.fillRect(0, 0, off.width, off.height);

        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.drawImage(off, lineX, oy + line.y - off.height * 0.7);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _renderNarrationFadeIn(ctx, layout, ox, oy, elapsedMs, clip) {
    const dur = clip.text_duration_ms ?? 550;
    const t = Math.max(0, Math.min(1, elapsedMs / dur));
    ctx.save();
    ctx.globalAlpha *= Easing.easeOutCubic(t);
    this._renderNarrationStatic(ctx, layout, ox, oy, clip);
    ctx.restore();
  }

  _renderNarrationSlideUp(ctx, layout, ox, oy, elapsedMs, clip) {
    const dur = clip.text_duration_ms ?? 550;
    const rise = clip.text_rise_distance ?? 36;
    const t = Math.max(0, Math.min(1, elapsedMs / dur));
    const eased = Easing.easeOutCubic(t);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, t * 1.6);
    this._renderNarrationStatic(ctx, layout, ox, oy - rise * (1 - eased), clip);
    ctx.restore();
  }

  _renderNarrationScalePop(ctx, layout, ox, oy, elapsedMs, clip) {
    const dur = clip.text_duration_ms ?? 550;
    const t = Math.max(0, Math.min(1, elapsedMs / dur));
    const scale = 0.6 + 0.4 * Math.max(0, Easing.easeOutBack(t, 1.7));
    ctx.save();
    ctx.globalAlpha *= Math.min(1, t * 2);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.translate(-ox, -oy);
    this._renderNarrationStatic(ctx, layout, ox, oy, clip);
    ctx.restore();
  }

  _renderNarrationCharStagger(ctx, layout, ox, oy, elapsedMs, clip) {
    const stagger = clip.text_stagger_ms ?? 25;
    const dur = clip.text_duration_ms ?? 300;
    const rise = clip.text_rise_distance ?? 14;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const line of layout.lines) {
      const lineOx = ox - line.lineWidth / 2;
      for (const word of line.words) {
        for (const ch of word.chars) {
          const localT = elapsedMs - ch.globalIndex * stagger;
          if (localT <= 0) continue;
          const t = Math.max(0, Math.min(1, localT / dur));
          const yOffset = rise * (1 - Easing.easeOutBack(t, 1.5));
          const cx = lineOx + word.x + ch.x;
          const cy = oy + line.y + yOffset;
          this._drawNarrationText(ctx, ch.char, cx, cy, clip, Math.min(1, t * 2.2));
        }
      }
    }
    ctx.restore();
  }

  _renderNarrationGlitch(ctx, layout, ox, oy, elapsedMs, clip) {
    const dur = clip.text_duration_ms ?? 500;
    const t = Math.max(0, Math.min(1, elapsedMs / dur));
    if (t >= 1) { this._renderNarrationStatic(ctx, layout, ox, oy, clip); return; }
    const decay = 1 - Easing.easeOutCubic(t);
    const seed = Math.floor(elapsedMs / 60);
    const jitter = n => {
      const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    };
    const maxOffset = 6 * decay;
    const flicker = jitter(9) > 0.6 ? 0.3 : 1;
    ctx.save();
    ctx.globalAlpha *= flicker;
    this._renderNarrationStatic(ctx, layout, ox + maxOffset * jitter(1), oy + maxOffset * jitter(2) * 0.4, clip);
    ctx.restore();
  }

  _shade(hex, factor) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * factor) | 0;
    const g = Math.min(255, ((n >> 8) & 255) * factor) | 0;
    const b = Math.min(255, (n & 255) * factor) | 0;
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  _drawMedia(ctx, clip, r, pt, animScale = null) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    const url = clip.code_file;

    if (!url) {
      this._drawPlaceholder(ctx, '[no media]', pt, r, theme);
      return;
    }

    const entry = this._loadMedia(url);
    if (!entry.loaded) {
      this._drawPlaceholder(ctx, '[loading…]', pt, r, theme);
      const maxW = (r.w * 0.88) | 0, maxH = (r.h * 0.50) | 0;
      this._drawnRects.set(clip.id, { x: pt.x - (maxW >> 1), y: pt.y - (maxH >> 1), w: maxW, h: maxH });
      return;
    }

    const el = entry.el;
    const natW = el.naturalWidth || el.videoWidth || 1;
    const natH = el.naturalHeight || el.videoHeight || 1;

    if (clip.clip_type === 'video') {
      const speed = clip.speed ?? 1.0;
      const target = Math.max(0, this.playhead - clip.start) * speed;
      if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
    }

    // A live Animate Position/Zoom path drives the render scale for the
    // duration of the clip, overriding the static scale_x/scale_y — same
    // relationship position keyframes already have with clip.x/clip.y.
    const scaleX = animScale ?? clip.scale_x ?? clip.scale ?? 1.0;
    const scaleY = animScale ?? clip.scale_y ?? clip.scale ?? 1.0;
    const maxW = (r.w * 0.88) | 0, maxH = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / natW, maxH / natH, 1);
    const dw = (natW * fitScale * scaleX) | 0, dh = (natH * fitScale * scaleY) | 0;
    const dx = pt.x - (dw >> 1), dy = pt.y - (dh >> 1);

    // Honour clip.rotation for media, mirroring the shape branch and the
    // backend's PIL rotate. Hit-test/handles keep the unrotated rect.
    const rotation = clip.rotation ?? 0;
    if (rotation) {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-pt.x, -pt.y);
      ctx.drawImage(el, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(el, dx, dy, dw, dh);
    }
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawShape(ctx, clip, r, pt, theme, animScale = null) {
    const BASE_W = 200, BASE_H = 200;
    const maxW = (r.w * 0.88) | 0;
    const maxH = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / BASE_W, maxH / BASE_H, 1);

    const sx = animScale ?? clip.scale_x ?? clip.scale ?? 1.0;
    const sy = animScale ?? clip.scale_y ?? clip.scale ?? 1.0;
    const dw = BASE_W * fitScale * sx;
    const dh = BASE_H * fitScale * sy;

    const dx = pt.x - dw / 2;
    const dy = pt.y - dh / 2;
    const cx = pt.x, cy = pt.y;

    ctx.save();
    ctx.globalAlpha *= clip.opacity ?? 1.0; // *= so transition fades compose (#63)
    ctx.translate(cx, cy);
    ctx.rotate((clip.rotation ?? 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    ctx.fillStyle = clip.fill;
    ctx.strokeStyle = clip.stroke_color;
    ctx.lineWidth = clip.stroke_width ?? 0;

    const x0 = dx, y0 = dy, x1 = dx + dw, y1 = dy + dh;
    const strokeIfNeeded = () => { if ((clip.stroke_width ?? 0) > 0) ctx.stroke(); };

    switch (clip.shape_kind) {
      case 'rectangle': {
        ctx.beginPath();
        const rr = Math.min(clip.corner_radius ?? 0, dw / 2, dh / 2);
        if (rr > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x0, y0, dw, dh, rr);
        } else if (rr > 0) {
          ctx.moveTo(x0 + rr, y0);
          ctx.lineTo(x1 - rr, y0);
          ctx.arcTo(x1, y0, x1, y0 + rr, rr);
          ctx.lineTo(x1, y1 - rr);
          ctx.arcTo(x1, y1, x1 - rr, y1, rr);
          ctx.lineTo(x0 + rr, y1);
          ctx.arcTo(x0, y1, x0, y1 - rr, rr);
          ctx.lineTo(x0, y0 + rr);
          ctx.arcTo(x0, y0, x0 + rr, y0, rr);
          ctx.closePath();
        } else {
          ctx.rect(x0, y0, dw, dh);
        }
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'circle': {
        ctx.beginPath();
        ctx.ellipse(cx, cy, dw / 2, dh / 2, 0, 0, Math.PI * 2);
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'triangle': {
        ctx.beginPath();
        ctx.moveTo(cx, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1);
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'polygon': {
        const sides = Math.max(3, clip.sides ?? 5);
        const rad = Math.min(dw, dh) / 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const ang = -Math.PI / 2 + i * (2 * Math.PI / sides);
          const px = cx + rad * Math.cos(ang), py = cy + rad * Math.sin(ang);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'star': {
        const points = Math.max(2, clip.points ?? 5);
        const outerR = Math.min(dw, dh) / 2;
        const innerR = outerR * (clip.inner_radius_ratio ?? 0.5);
        ctx.beginPath();
        const total = points * 2;
        for (let i = 0; i < total; i++) {
          const rad = i % 2 === 0 ? outerR : innerR;
          const ang = -Math.PI / 2 + i * (Math.PI / points);
          const px = cx + rad * Math.cos(ang), py = cy + rad * Math.sin(ang);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(x0, cy); ctx.lineTo(x1, cy);
        ctx.lineWidth = Math.max(clip.stroke_width ?? 0, 2);
        ctx.strokeStyle = clip.stroke_color || clip.fill;
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const shaftW = dh * 0.25, headW = dh * 0.6, headLen = dw * 0.35;
        ctx.beginPath();
        ctx.moveTo(x0, cy - shaftW / 2);
        ctx.lineTo(x1 - headLen, cy - shaftW / 2);
        ctx.lineTo(x1 - headLen, cy - headW / 2);
        ctx.lineTo(x1, cy);
        ctx.lineTo(x1 - headLen, cy + headW / 2);
        ctx.lineTo(x1 - headLen, cy + shaftW / 2);
        ctx.lineTo(x0, cy + shaftW / 2);
        ctx.closePath();
        ctx.fill(); strokeIfNeeded();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.rect(x0, y0, dw, dh);
        ctx.fill(); strokeIfNeeded();
      }
    }

    ctx.restore();
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawPlaceholder(ctx, text, pt, r, theme) {
    ctx.fillStyle = theme.comment ?? '#888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(6, r.w / 28 | 0)}px Consolas, monospace`;
    ctx.fillText(text, pt.x, pt.y);
  }

  _drawNarrationText(ctx, text, x, y, clip, alpha = 1) {
    if (!text) return;
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    const color = clip.font_color ?? theme.text;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;

    if (clip.text_shadow_color) {
      ctx.shadowColor = clip.text_shadow_color;
      ctx.shadowBlur = clip.text_shadow_blur ?? 0;
      ctx.shadowOffsetX = clip.text_shadow_offset_x ?? 0;
      ctx.shadowOffsetY = clip.text_shadow_offset_y ?? 0;
    }

    if (clip.text_stroke_color && (clip.text_stroke_width ?? 0) > 0) {
      ctx.lineWidth = clip.text_stroke_width;
      ctx.strokeStyle = clip.text_stroke_color;
      ctx.strokeText(text, x, y);
    }

    ctx.fillText(text, x, y);
    ctx.restore();
  }

  _drawGraphPreview(ctx, clip, bx, by, bw, bh, theme, r) {
    const pairs = [];
    for (const token of clip.graph_data.split(',')) {
      const t = token.trim();
      const colon = t.indexOf(':');
      if (colon >= 0) {
        const label = t.slice(0, colon).trim();
        const val = parseFloat(t.slice(colon + 1).trim());
        if (!isNaN(val)) pairs.push([label, val]);
      }
    }
    if (!pairs.length) return;

    const maxVal = Math.max(...pairs.map(p => p[1])) || 1;
    const n = pairs.length, pad = 12;
    const barAreaW = bw - pad * 2;
    const barW = Math.max(4, (barAreaW / n) - 4 | 0);
    const barAreaH = bh - pad * 3;
    const barColor = theme.function ?? '#2563EB';
    const labelColor = theme.comment ?? '#6B7280';
    const fontSize = Math.max(5, (bw / 28) | 0);
    ctx.font = `${fontSize}px Consolas, monospace`;

    for (let i = 0; i < pairs.length; i++) {
      const [label, val] = pairs[i];
      const barH = ((val / maxVal) * barAreaH) | 0;
      const bxi = bx + pad + i * (barW + 4);
      const byi = by + bh - pad - barH;
      ctx.fillStyle = barColor;
      ctx.fillRect(bxi, byi, barW, barH);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label.slice(0, 4), bxi, by + bh - 2);
    }
  }

  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown', e => this._onMouseDown(e));
    el.addEventListener('mousemove', e => this._onMouseMove(e));
    el.addEventListener('mouseup', e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _clipAt(px, py) {
    const r = this._canvasRect();
    const clips = this._activeClips();

    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      if (clip.track === 'audio') continue;

      if (['image','video','shape','code','narration'].includes(clip.clip_type)) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          if (px >= drawn.x && px <= drawn.x + drawn.w && py >= drawn.y && py <= drawn.y + drawn.h) return clip;
          continue;
        }
        const { x, y } = resolvePos(clip, this.playhead);
        const pt = this._normToPx(x, y);
        const fallbackR = 60;
        if (Math.abs(px - pt.x) < fallbackR && Math.abs(py - pt.y) < fallbackR) return clip;
        continue;
      }

      const cr = this._clipRect(clip, r);
      if (px >= cr.x - 6 && px <= cr.x + cr.w + 6 && py >= cr.y - 6 && py <= cr.y + cr.h + 6) return clip;
    }
    return null;
  }

  _onWheel(e) {
    e.preventDefault();

    // While placing an Animate Position/Zoom stop, the wheel sets the zoom
    // level for the *next* click instead of zooming the editor viewport.
    if (this._tool === 'motion') {
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      this._pendingZoom = Math.max(0.2, Math.min(4.0, (this._pendingZoom ?? 1.0) * factor));
      this._updateMotionBadge();
      this.redraw();
      return;
    }

    const raw = this._getPos(e);
    const oldZoom = this._zoom;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;

    const logicalX = (raw.x - this._panX) / oldZoom;
    const logicalY = (raw.y - this._panY) / oldZoom;
    this._panX = raw.x - logicalX * newZoom;
    this._panY = raw.y - logicalY * newZoom;
    this._zoom = newZoom;
    this.redraw();
  }

  _onMouseDown(e) {
    
    if (e.button !== 0) return;
    const raw = this._getPos(e);
    const pos = this._toLogical(raw.x, raw.y);

    if (this._tool === 'motion') {
      const clip = this.project.clips.find(c => c.id === this._selectionPrimaryId);
      if (clip) {
        let { nx, ny } = this._pxToNorm(pos.x, pos.y);
        // Snap the new stop to the alignment axes (hold Ctrl to place freely).
        if (!e.ctrlKey) {
          for (const sx of SNAP_X) { if (Math.abs(nx - sx) < SNAP_THRESHOLD) { nx = sx; break; } }
          for (const sy of SNAP_Y) { if (Math.abs(ny - sy) < SNAP_THRESHOLD) { ny = sy; break; } }
        }

        if (!Array.isArray(clip.motion_keyframes)) clip.motion_keyframes = [];

        // Each stop lands wherever the playhead currently sits within the
        // clip — scrub, click, scrub further, click again — so a path can
        // have any number of stops (zoom in, pan, zoom back out, …), not
        // just a fixed start/end.
        let t = clip.duration > 0 ? (this.playhead - clip.start) / clip.duration : 0;
        t = Math.round(Math.max(0, Math.min(1, t)) * 1000) / 1000;
        const scale = this._pendingZoom ?? (clip.scale_x ?? clip.scale ?? 1.0);

        const before = JSON.stringify(this.project.toDict());

        const existing = clip.motion_keyframes.find(k => Math.abs((k.t ?? 0) - t) < 0.005);
        if (existing) {
          existing.x = nx; existing.y = ny; existing.scale = scale;
        } else {
          clip.motion_keyframes.push({ t, x: nx, y: ny, scale });
          clip.motion_keyframes.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
        }

        this._el.dispatchEvent(new CustomEvent('canvas:motioncaptured', {
          bubbles: true,
          detail: { id: clip.id, t, nx, ny, scale, count: clip.motion_keyframes.length }
        }));

        this._el.dispatchEvent(new CustomEvent('canvas:committed', {
          bubbles: true,
          detail: { before }
        }));

        this._updateMotionBadge();
        this.redraw();
      }

      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey) || this._tool === 'move') {
      this._isPanning = true;
      this._panDragOrigin = { mouseX: raw.x, mouseY: raw.y, panX: this._panX, panY: this._panY };
      this._el.style.cursor = 'grabbing';
      return;
    }

    for (const selectedId of this._selectedIds) {
      const clip = this.project.clips.find(c => c.id === selectedId);
      if (!clip) continue;
      if (!['image', 'video', 'code', 'narration', 'shape'].includes(clip.clip_type)) continue;
      const drawn = this._drawnRects.get(clip.id);
      if (!drawn) continue;
      const handle = this._hitHandle(pos.x, pos.y, drawn);
      if (!handle) continue;

      const handles  = this._handlePositions(drawn);
      const opposite = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' }[handle];
      const anchor   = handles[opposite];
      const grabbed  = handles[handle];          // the actual corner you clicked near
      const scaleX0 = clip.scale_x ?? 1.0;
      const scaleY0 = clip.scale_y ?? 1.0;

      this._resizeHandle = handle;
      this._dragClip = clip;
      this._resizeOrigin = {
        anchorX: anchor.x,
        anchorY: anchor.y,
        grabOffsetX: pos.x - grabbed.x,
        grabOffsetY: pos.y - grabbed.y,
        baseW:   drawn.w / scaleX0,
        baseH:   drawn.h / scaleY0,
      };
      this._dragBeforeSnapshot = JSON.stringify(this.project.toDict());
      this._el.style.cursor = this._resizeCursor(handle);
      return;
    }

    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      const isSelected = this._selectedIds.has(clip.id);
      if (e.shiftKey) {
        isSelected ? this._selectedIds.delete(clip.id) : this._selectedIds.add(clip.id);
      } else if (!isSelected) {
        this._selectedIds.clear();
        this._selectedIds.add(clip.id);
      }
      this._selectionPrimaryId = clip.id;
      this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
        bubbles: true, detail: { selectedIds: [...this._selectedIds], primaryId: clip.id }
      }));
      this._dragClip = clip;
      this._groupDragOrigins = new Map(
        [...this._selectedIds].map(id => {
          const c = this.project.clips.find(c => c.id === id);
          return [id, c ? { x: c.x, y: c.y } : { x: 0, y: 0 }];
        })
      );
      const { x, y } = resolvePos(clip, this.playhead);
      const pt = this._normToPx(x, y);
      this._dragOffsetX = pos.x - pt.x;
      this._dragOffsetY = pos.y - pt.y;
      this._dragBeforeSnapshot = JSON.stringify(this.project.toDict());
      this._el.style.cursor = 'move';
    } else {
      this._dragClip = null;

      if (!e.shiftKey) {
        this._selectedIds.clear();
        this._selectionPrimaryId = null;
        this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
          bubbles: true, detail: { selectedIds: [], primaryId: null }
        }));
      }

      this._marqueeActive = true;
      this._marqueeStart = { x: raw.x, y: raw.y };
      this._marqueeCurrent = { x: raw.x, y: raw.y };
      this._marqueeShift = e.shiftKey;
      this._el.style.cursor = 'crosshair';
    }
  }

  _onMouseMove(e) {
    const raw = this._getPos(e);
    const pos = this._toLogical(raw.x, raw.y);

    if (this._tool === 'motion') {
      this._el.style.cursor = 'crosshair';
      return;
    }

    if (this._marqueeActive && (e.buttons & 1)) {
      this._marqueeCurrent = { x: raw.x, y: raw.y };
      this.redraw();
      return;
    }

    if (this._resizeHandle && (e.buttons & 1)) {
      const clip = this._dragClip;
      if (clip) {
        const o = this._resizeOrigin;
        let cornerX = pos.x - o.grabOffsetX;
        let cornerY = pos.y - o.grabOffsetY;

        // #61 follow-up — snap the dragged corner to the canvas edges/centre
        // so a clip can be resized flush to the frame (e.g. full-bleed
        // video). Hold Ctrl to resize freely without snapping.
        this._snapTarget = null;
        if (!e.ctrlKey) {
          const r = this._canvasRect();
          const edgeThreshold = SNAP_PX / this._zoom;
          const xCandidates = [r.x, r.x + r.w / 2, r.x + r.w];
          const yCandidates = [r.y, r.y + r.h / 2, r.y + r.h];
          let snappedX = false, snappedY = false;
          for (const cx of xCandidates) {
            if (Math.abs(cornerX - cx) < edgeThreshold) { cornerX = cx; snappedX = true; break; }
          }
          for (const cy of yCandidates) {
            if (Math.abs(cornerY - cy) < edgeThreshold) { cornerY = cy; snappedY = true; break; }
          }
          if (snappedX || snappedY) {
            const n = this._pxToNorm(cornerX, cornerY);
            this._snapTarget = { x: snappedX ? n.nx : null, y: snappedY ? n.ny : null };
          }
        }

        let newW = Math.abs(cornerX - o.anchorX);
        let newH = Math.abs(cornerY - o.anchorY);

        if (e.shiftKey) {
          const aspect = o.baseW / o.baseH;
          if (newW / newH > aspect) newW = newH * aspect;
          else newH = newW / aspect;
        }

        const scaleX = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newW / o.baseW));
        const scaleY = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newH / o.baseH));

        const dw = o.baseW * scaleX;
        const dh = o.baseH * scaleY;
        const signX = (this._resizeHandle === 'br' || this._resizeHandle === 'tr') ? 1 : -1;
        const signY = (this._resizeHandle === 'br' || this._resizeHandle === 'bl') ? 1 : -1;
        const newCx = o.anchorX + signX * dw / 2;
        const newCy = o.anchorY + signY * dh / 2;

        const { nx, ny } = this._pxToNorm(newCx, newCy);
        clip.scale_x = parseFloat(scaleX.toFixed(3));
        clip.scale_y = parseFloat(scaleY.toFixed(3));
        clip.x = nx;
        clip.y = ny;

        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale_x: clip.scale_x, scale_y: clip.scale_y, x: clip.x, y: clip.y }
        }));
        this.redraw();
      }
      return;
    }

    if (this._isPanning && (e.buttons & 1)) {
      const rawPos = this._getPos(e);
      const o = this._panDragOrigin;
      this._panX = o.panX + (rawPos.x - o.mouseX);
      this._panY = o.panY + (rawPos.y - o.mouseY);
      this.redraw();
      return;
    }

    if (this._dragClip && (e.buttons & 1)) {
      const rawX = pos.x - this._dragOffsetX, rawY = pos.y - this._dragOffsetY;

      // #61 — snap against the clip's true rendered centre (not its stored
      // x/y anchor, which for top-anchored narration text sits at the top
      // of the bounding box rather than its middle), against canvas
      // edges/thirds, against every other visible clip's centre, and
      // against "equal margin" positions between two flanking neighbours.
      const r = this._canvasRect();
      const draggedRect = this._drawnRects.get(this._dragClip.id);
      const anchorPt = this._normToPx(this._dragClip.x, this._dragClip.y);
      const centreOffX = draggedRect ? anchorPt.x - (draggedRect.x + draggedRect.w / 2) : 0;
      const centreOffY = draggedRect ? anchorPt.y - (draggedRect.y + draggedRect.h / 2) : 0;
      const w = draggedRect ? draggedRect.w : 0;
      const h = draggedRect ? draggedRect.h : 0;

      let centreX = rawX + centreOffX;
      let centreY = rawY + centreOffY;

      this._snapTarget = null;
      this._marginGuides = [];

      if (!e.ctrlKey) {
        const threshold = SNAP_PX / this._zoom;
        const excluded = new Set([this._dragClip.id, ...this._selectedIds]);
        const others = [];
        for (const otherClip of this._activeClips()) {
          if (excluded.has(otherClip.id)) continue;
          const rect = this._drawnRects.get(otherClip.id);
          if (rect) others.push(rect);
        }

        const xLines = [...SNAP_X.map(f => r.x + f * r.w), ...others.map(o => o.x + o.w / 2)];
        const yLines = [...SNAP_Y.map(f => r.y + f * r.h), ...others.map(o => o.y + o.h / 2)];

        let snappedX = false, snappedY = false;
        for (const lx of xLines) { if (Math.abs(centreX - lx) < threshold) { centreX = lx; snappedX = true; break; } }
        for (const ly of yLines) { if (Math.abs(centreY - ly) < threshold) { centreY = ly; snappedY = true; break; } }

        // Equal-margin snapping: if the clip sits between two neighbours
        // (roughly the same row/column), snap so the gap on both sides
        // matches — and show the matching margins as guides.
        if (w > 0) {
          const rowMates = others.filter(o => Math.abs((o.y + o.h / 2) - centreY) < (o.h / 2 + h / 2));
          const leftMates = rowMates
            .filter(o => o.x + o.w <= centreX - w / 2 + threshold * 2)
            .sort((a, b) => (b.x + b.w) - (a.x + a.w));
          const rightMates = rowMates
            .filter(o => o.x >= centreX + w / 2 - threshold * 2)
            .sort((a, b) => a.x - b.x);
          if (leftMates.length && rightMates.length) {
            const L = leftMates[0], R = rightMates[0];
            const span = R.x - (L.x + L.w);
            const gap = (span - w) / 2;
            const idealCentreX = L.x + L.w + gap + w / 2;
            if (gap > 0 && Math.abs(centreX - idealCentreX) < threshold * 1.5) {
              centreX = idealCentreX;
              snappedX = true;
              const rowY = (L.y + L.h / 2 + R.y + R.h / 2) / 2;
              this._marginGuides.push({
                axis: 'x', gap,
                seg1: { x1: L.x + L.w, x2: centreX - w / 2, y: rowY },
                seg2: { x1: centreX + w / 2, x2: R.x, y: rowY },
              });
            }
          }
        }
        if (h > 0) {
          const colMates = others.filter(o => Math.abs((o.x + o.w / 2) - centreX) < (o.w / 2 + w / 2));
          const aboveMates = colMates
            .filter(o => o.y + o.h <= centreY - h / 2 + threshold * 2)
            .sort((a, b) => (b.y + b.h) - (a.y + a.h));
          const belowMates = colMates
            .filter(o => o.y >= centreY + h / 2 - threshold * 2)
            .sort((a, b) => a.y - b.y);
          if (aboveMates.length && belowMates.length) {
            const A = aboveMates[0], B = belowMates[0];
            const span = B.y - (A.y + A.h);
            const gap = (span - h) / 2;
            const idealCentreY = A.y + A.h + gap + h / 2;
            if (gap > 0 && Math.abs(centreY - idealCentreY) < threshold * 1.5) {
              centreY = idealCentreY;
              snappedY = true;
              const colX = (A.x + A.w / 2 + B.x + B.w / 2) / 2;
              this._marginGuides.push({
                axis: 'y', gap,
                seg1: { y1: A.y + A.h, y2: centreY - h / 2, x: colX },
                seg2: { y1: centreY + h / 2, y2: B.y, x: colX },
              });
            }
          }
        }

        if (snappedX || snappedY) {
          this._snapTarget = {
            x: snappedX ? (centreX - r.x) / r.w : null,
            y: snappedY ? (centreY - r.y) / r.h : null,
          };
        }
      }

      const { nx, ny } = this._pxToNorm(centreX - centreOffX, centreY - centreOffY);

      if (this._groupDragOrigins && this._selectedIds.has(this._dragClip.id)) {
        const origin = this._groupDragOrigins.get(this._dragClip.id);
        const deltaX = nx - origin.x, deltaY = ny - origin.y;
        for (const [id, clipOrigin] of this._groupDragOrigins.entries()) {
          const clip = this.project.clips.find(c => c.id === id);
          if (!clip) continue;
          clip.x = Math.max(0, Math.min(1, clipOrigin.x + deltaX));
          clip.y = Math.max(0, Math.min(1, clipOrigin.y + deltaY));
        }
      } else {
        this._dragClip.x = nx;
        this._dragClip.y = ny;
      }

      this._el.dispatchEvent(new CustomEvent('canvas:clipmoved', {
        bubbles: true, detail: { id: this._dragClip.id, nx, ny, selected: Array.from(this._selectedIds) }
      }));
      this.redraw();
      return;
    }

    const selectedId = this._selectedIds.values().next().value;
    if (selectedId) {
      const clip = this.project.clips.find(c => c.id === selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) { this._el.style.cursor = this._resizeCursor(handle); return; }
        }
      }
    }
    const clip = this._clipAt(pos.x, pos.y);
    this._el.style.cursor = clip ? 'move' : 'grab';
  }

  _onMouseUp(_e) {
    if (this._resizeHandle) {
      const clip = this._dragClip;
      if (clip) {
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale_x: clip.scale_x, scale_y: clip.scale_y }
        }));
      }
    }

    if (this._marqueeActive) {
      this._marqueeActive = false;
      const start = this._marqueeStart, end = this._marqueeCurrent;
      if (start && end) {
        const rect = {
          x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
          w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y)
        };
        const selected = new Set(this._selectedIds);
        for (const clip of this.project.clips) {
          const { x, y } = resolvePos(clip, this.playhead);
          const pt = this._normToPx(x, y);
          const isInside = pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
          if (!isInside) continue;
          if (this._marqueeShift) {
            selected.has(clip.id) ? selected.delete(clip.id) : selected.add(clip.id);
          } else {
            selected.add(clip.id);
          }
        }
        if (!this._marqueeShift) {
          for (const id of Array.from(selected)) {
            if (!this.project.clips.some(c => c.id === id)) selected.delete(id);
          }
        }
        this._selectedIds = selected;
        this._el.dispatchEvent(new CustomEvent('canvas:selectionchanged', {
          bubbles: true,
          detail: { selectedIds: Array.from(this._selectedIds), primaryId: this._selectedIds.values().next().value }
        }));
      }
      this._marqueeStart = null;
      this._marqueeCurrent = null;
      this._marqueeShift = false;
    }

    if (this._dragBeforeSnapshot) {
      this._el.dispatchEvent(new CustomEvent('canvas:committed', {
        bubbles: true, detail: { before: this._dragBeforeSnapshot }
      }));
    }
    this._dragBeforeSnapshot = null;
    this._resizeHandle = null;
    this._resizeOrigin = null;
    this._dragClip = null;
    this._groupDragOrigins = null;
    this._snapTarget = null;
    this._marginGuides = [];
    this._isPanning = false;
    this._panDragOrigin = null;
    this._el.style.cursor = 'default';
    this.redraw();
  }

  _resizeCursor(handle) {
    return { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize' }[handle] ?? 'default';
  }

  _loadMedia(url) {
    if (this._mediaCache.has(url)) return this._mediaCache.get(url);

    const ext = url.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (isVideo) {
      const vid = document.createElement('video');
      vid.muted = true;
      vid.preload = 'auto';
      const entry = { el: vid, loaded: false };
      this._mediaCache.set(url, entry);
      vid.addEventListener('loadeddata', () => { entry.loaded = true; this.redraw(); });
      vid.src = url;
      return entry;
    }

    const img = new Image();
    const entry = { el: img, loaded: false };
    this._mediaCache.set(url, entry);
    img.onload = () => { entry.loaded = true; this.redraw(); };
    img.src = url;
    return entry;
  }

  // ── Dimensions (#67c) ──────────────────────────────────────────────────
  // Report / set a clip's on-screen size in PROJECT pixels (canvas_w space).
  // Uses the last drawn rect, so it works for image, video, shape, code and
  // narration clips that are visible at the current playhead.
  getClipProjectSize(clip) {
    const drawn = this._drawnRects.get(clip.id);
    const r = this._canvasRect();
    if (!drawn || !r.w || drawn.w <= 0 || drawn.h <= 0) return null;
    const k = (this.project.canvas_w ?? 1080) / r.w;
    return { w: drawn.w * k, h: drawn.h * k };
  }

  setClipProjectSize(clip, w, h) {
    const cur = this.getClipProjectSize(clip);
    if (!cur) return false;
    if (w != null && w > 0) {
      clip.scale_x = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        (clip.scale_x ?? clip.scale ?? 1.0) * (w / cur.w)));
    }
    if (h != null && h > 0) {
      clip.scale_y = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        (clip.scale_y ?? clip.scale ?? 1.0) * (h / cur.h)));
    }
    this.redraw();
    return true;
  }

  // ── Keyboard nudging (#67d) ────────────────────────────────────────────
  // Move every selected canvas object by a normalized step. Returns true if
  // anything moved (used by app.js to decide preventDefault / commit).
  nudgeSelected(dxNorm, dyNorm) {
    if (!this._selectedIds || this._selectedIds.size === 0) return false;
    let moved = false;
    for (const id of this._selectedIds) {
      const clip = this.project.clips.find(c => c.id === id);
      if (!clip || clip.track === 'audio') continue;
      clip.x = Math.max(0, Math.min(1, (clip.x ?? 0.5) + dxNorm));
      clip.y = Math.max(0, Math.min(1, (clip.y ?? 0.5) + dyNorm));
      moved = true;
    }
    if (moved) this.redraw();
    return moved;
  }
}