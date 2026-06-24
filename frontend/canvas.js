// canvas.js — HTML5 Canvas port of CanvasWidget
import { THEMES, TRACK_COLOURS } from './app.js';

const CANVAS_ASPECT  = 9 / 16;
const HANDLE_SIZE    = 8;        // px, half-size of corner handle hit area
const MIN_SCALE      = 0.05;
const MAX_SCALE      = 4.0;

const SNAP_POSITIONS = [
  [0.5,  0.12, 'top centre'],
  [0.5,  0.50, 'mid centre'],
  [0.5,  0.85, 'bottom centre'],
  [0.25, 0.12, 'top left'],
  [0.75, 0.12, 'top right'],
];
const SNAP_THRESHOLD = 0.04;

export class CanvasWidget {
  constructor(canvasEl, project) {
    this._el      = canvasEl;
    this._ctx     = canvasEl.getContext('2d');
    this.project  = project;
    this.playhead = 0.0;
    this._selectedId  = null;
    this._dragClip    = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._snapTarget  = null;
    this._mediaCache  = new Map();

    // Resize state
    this._resizeHandle  = null;   // 'tl'|'tr'|'bl'|'br' | null
    this._resizeOrigin  = null;   // { mouseX, mouseY, scale, rectW, rectH, canvasRectH }
    this._drawnRects    = new Map(); // clipId → {x,y,w,h}

    this._bindEvents();
    this.resize();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  setProject(p)     { this.project = p; this.redraw(); }
  setPlayhead(t)    { this.playhead = t; this.redraw(); }
  setSelectedId(id) { this._selectedId = id; this.redraw(); }
  redraw()          { this._paint(); }

  resize() {
    const frame = this._el.parentElement;
    this._el.width  = frame.clientWidth;
    this._el.height = frame.clientHeight;
    this.redraw();
  }

  // ── Geometry ────────────────────────────────────────────────────────────────
  _canvasRect() {
    const w  = this._el.width;
    const h  = this._el.height;
    const cw = Math.min(w, h * CANVAS_ASPECT) | 0;
    const ch = (cw / CANVAS_ASPECT) | 0;
    const x  = ((w - cw) / 2) | 0;
    const y  = ((h - ch) / 2) | 0;
    return { x, y, w: cw, h: ch };
  }

  _normToPx(nx, ny) {
    const r = this._canvasRect();
    return { x: r.x + nx * r.w | 0, y: r.y + ny * r.h | 0 };
  }

  _pxToNorm(px, py) {
    const r  = this._canvasRect();
    const nx = (px - r.x) / r.w;
    const ny = (py - r.y) / r.h;
    return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
  }

  _activeClips() {
    return this.project.clips.filter(c => c.start <= this.playhead && this.playhead < c.end());
  }

  _clipRect(clip, r) {
    const pt   = this._normToPx(clip.x, clip.y);
    const maxW = (r.w * 0.88) | 0;
    return { x: pt.x - (maxW >> 1), y: pt.y - 14, w: maxW, h: 28 };
  }

  // ── Corner handle positions for a drawn rect ────────────────────────────────
  _handlePositions(rect) {
    return {
      tl: { x: rect.x,            y: rect.y },
      tr: { x: rect.x + rect.w,   y: rect.y },
      bl: { x: rect.x,            y: rect.y + rect.h },
      br: { x: rect.x + rect.w,   y: rect.y + rect.h },
    };
  }

  _hitHandle(px, py, rect) {
    const handles = this._handlePositions(rect);
    for (const [name, pt] of Object.entries(handles)) {
      if (Math.abs(px - pt.x) <= HANDLE_SIZE && Math.abs(py - pt.y) <= HANDLE_SIZE) {
        return name;
      }
    }
    return null;
  }

  // ── Painting ────────────────────────────────────────────────────────────────
  _paint() {
    this._drawnRects.clear();
    const ctx   = this._ctx;
    const el    = this._el;
    const r     = this._canvasRect();
    const theme = THEMES.dark;

    ctx.clearRect(0, 0, el.width, el.height);

    // Canvas background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#505050';
    ctx.lineWidth   = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);

    // Snap guides
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59,130,246,0.24)';
    ctx.lineWidth   = 1;
    const cx = r.x + (r.w >> 1);
    ctx.beginPath(); ctx.moveTo(cx, r.y); ctx.lineTo(cx, r.y + r.h); ctx.stroke();
    for (const frac of [1/3, 2/3]) {
      const gy = r.y + (r.h * frac) | 0;
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Active snap highlight
    if (this._snapTarget) {
      const [sx, sy] = this._snapTarget;
      const pt = this._normToPx(sx, sy);
      ctx.strokeStyle = 'rgba(59,130,246,0.7)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(r.x, pt.y); ctx.lineTo(r.x + r.w, pt.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pt.x, r.y); ctx.lineTo(pt.x, r.y + r.h); ctx.stroke();
    }

    // Draw clips
    for (const clip of this._activeClips()) {
      this._drawClip(ctx, clip, r);
    }

    // Selection overlay
    if (this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip) {
        if (clip.clip_type === 'image' || clip.clip_type === 'video') {
          const drawn = this._drawnRects.get(clip.id);
          if (drawn) this._drawResizeOverlay(ctx, drawn);
        } else if (clip.track === 'text' || clip.track === 'visual') {
          const cr = this._clipRect(clip, r);
          ctx.strokeStyle = 'rgba(59,130,246,0.9)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(cr.x - 3, cr.y - 3, cr.w + 6, cr.h + 6);
          ctx.setLineDash([]);
        }
      }
    }
  }

  _drawResizeOverlay(ctx, rect) {
    // Dashed selection border
    ctx.strokeStyle = 'rgba(59,130,246,0.9)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
    ctx.setLineDash([]);

    // Corner handles
    const handles = this._handlePositions(rect);
    for (const pt of Object.values(handles)) {
      ctx.fillStyle   = '#ffffff';
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.rect(pt.x - HANDLE_SIZE / 2, pt.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawClip(ctx, clip, r) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    if (clip.track === 'audio') return;

    const pt   = this._normToPx(clip.x, clip.y);
    const maxW = (r.w * 0.88) | 0;

    if (clip.clip_type === 'narration') {
      const fontSize = Math.max(7, (r.w / 18) | 0);
      ctx.font         = `${fontSize}px Consolas, monospace`;
      ctx.fillStyle    = theme.text;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      this._drawWrappedText(ctx, clip.content, pt.x, pt.y, maxW, fontSize * 1.4);
    }
    else if (clip.clip_type === 'code') {
      const blockH = Math.min((r.h * 0.40) | 0, 160);
      const blockW = (r.w * 0.92) | 0;
      const bx     = r.x + ((r.w - blockW) >> 1);
      const by     = pt.y - (blockH >> 1);
      ctx.fillStyle   = theme.bg;
      ctx.fillRect(bx, by, blockW, blockH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);
      const fontSize  = Math.max(6, (r.w / 24) | 0);
      ctx.font        = `${fontSize}px Consolas, monospace`;
      ctx.fillStyle   = theme.text;
      ctx.textAlign   = 'left';
      ctx.textBaseline = 'top';
      const lh    = Math.max(10, (r.w / 20) | 0);
      const lines = clip.content.split('\n').slice(0, 10);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].slice(0, 60), bx + 8, by + 12 + i * lh);
      }
    }
    else if (clip.clip_type === 'graph') {
      const blockH = (r.h * 0.35) | 0;
      const blockW = (r.w * 0.88) | 0;
      const bx     = r.x + ((r.w - blockW) >> 1);
      const by     = pt.y - (blockH >> 1);
      ctx.fillStyle   = theme.bg;
      ctx.fillRect(bx, by, blockW, blockH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, blockW, blockH);
      this._drawGraphPreview(ctx, clip, bx, by, blockW, blockH, theme, r);
    }
    else if (clip.clip_type === 'image') {
      this._drawMedia(ctx, clip, r, pt);
    }
    else if (clip.clip_type === 'video') {
      this._drawMedia(ctx, clip, r, pt);
    }
  }

  _drawMedia(ctx, clip, r, pt) {
    const theme = THEMES[clip.theme] ?? THEMES.dark;
    const url   = clip.code_file;

    if (!url) {
      this._drawPlaceholder(ctx, '[no media]', pt, r, theme);
      return;
    }

    const entry = this._loadMedia(url);

    if (!entry.loaded) {
      this._drawPlaceholder(ctx, '[loading…]', pt, r, theme);
      const maxW = (r.w * 0.88) | 0;
      const maxH = (r.h * 0.50) | 0;
      this._drawnRects.set(clip.id, {
        x: pt.x - (maxW >> 1),
        y: pt.y - (maxH >> 1),
        w: maxW,
        h: maxH,
      });
      return;
    }

    const el   = entry.el;
    const natW = el.naturalWidth  || el.videoWidth  || 1;
    const natH = el.naturalHeight || el.videoHeight || 1;

    if (clip.clip_type === 'video') {
      const target = Math.max(0, this.playhead - clip.start);
      if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
    }

    const scale    = clip.scale ?? 1.0;
    const maxW     = (r.w * 0.88) | 0;
    const maxH     = (r.h * 0.80) | 0;
    const fitScale = Math.min(maxW / natW, maxH / natH, 1);
    const dw       = (natW * fitScale * scale) | 0;
    const dh       = (natH * fitScale * scale) | 0;
    const dx       = pt.x - (dw >> 1);
    const dy       = pt.y - (dh >> 1);

    ctx.drawImage(el, dx, dy, dw, dh);

    // Always update — this is what the handles and hit-test read
    this._drawnRects.set(clip.id, { x: dx, y: dy, w: dw, h: dh });
  }

  _drawPlaceholder(ctx, text, pt, r, theme) {
    ctx.fillStyle    = theme.comment ?? '#888';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `${Math.max(6, r.w / 28 | 0)}px Consolas, monospace`;
    ctx.fillText(text, pt.x, pt.y);
  }

  _drawWrappedText(ctx, text, cx, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let curY = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, curY);
        line = word;
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, curY);
  }

  _drawGraphPreview(ctx, clip, bx, by, bw, bh, theme, r) {
    const pairs = [];
    for (const token of clip.graph_data.split(',')) {
      const t     = token.trim();
      const colon = t.indexOf(':');
      if (colon >= 0) {
        const label = t.slice(0, colon).trim();
        const val   = parseFloat(t.slice(colon + 1).trim());
        if (!isNaN(val)) pairs.push([label, val]);
      }
    }
    if (!pairs.length) return;

    const maxVal    = Math.max(...pairs.map(p => p[1])) || 1;
    const n         = pairs.length;
    const pad       = 12;
    const barAreaW  = bw - pad * 2;
    const barW      = Math.max(4, (barAreaW / n) - 4 | 0);
    const barAreaH  = bh - pad * 3;
    const barColor  = theme.function ?? '#2563EB';
    const labelColor = theme.comment ?? '#6B7280';
    const fontSize  = Math.max(5, (bw / 28) | 0);
    ctx.font = `${fontSize}px Consolas, monospace`;

    for (let i = 0; i < pairs.length; i++) {
      const [label, val] = pairs[i];
      const barH = ((val / maxVal) * barAreaH) | 0;
      const bxi  = bx + pad + i * (barW + 4);
      const byi  = by + bh - pad - barH;
      ctx.fillStyle    = barColor;
      ctx.fillRect(bxi, byi, barW, barH);
      ctx.fillStyle    = labelColor;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label.slice(0, 4), bxi, by + bh - 2);
    }
  }

  // ── Mouse interaction ────────────────────────────────────────────────────────
  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown',  e => this._onMouseDown(e));
    el.addEventListener('mousemove',  e => this._onMouseMove(e));
    el.addEventListener('mouseup',    e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _clipAt(px, py) {
    const r     = this._canvasRect();
    const clips = this._activeClips();

    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      if (clip.track === 'audio') continue;

      if (clip.clip_type === 'image' || clip.clip_type === 'video') {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          if (px >= drawn.x && px <= drawn.x + drawn.w &&
              py >= drawn.y && py <= drawn.y + drawn.h) return clip;
          continue;
        }
        const pt = this._normToPx(clip.x, clip.y);
        const fallbackR = 60;
        if (Math.abs(px - pt.x) < fallbackR && Math.abs(py - pt.y) < fallbackR) return clip;
        continue;
      }

      const cr = this._clipRect(clip, r);
      if (px >= cr.x - 6 && px <= cr.x + cr.w + 6 &&
          py >= cr.y - 6 && py <= cr.y + cr.h + 6) return clip;
    }
    return null;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos = this._getPos(e);

    // Check for resize handle on selected image/video first
    if (this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) {
            this._resizeHandle = handle;
            this._resizeOrigin = {
              mouseX:   pos.x,
              mouseY:   pos.y,
              scale:    clip.scale ?? 1.0,
              rectW:    drawn.w,
              rectH:    drawn.h,
              canvasH:  this._canvasRect().h,
            };
            this._el.style.cursor = this._resizeCursor(handle);
            return;
          }
        }
      }
    }

    // Normal clip select / drag
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedId  = clip.id;
      this._dragClip    = clip;
      const pt          = this._normToPx(clip.x, clip.y);
      this._dragOffsetX = pos.x - pt.x;
      this._dragOffsetY = pos.y - pt.y;
      this._el.style.cursor = 'move';
      this._el.dispatchEvent(new CustomEvent('canvas:select', { bubbles: true, detail: { id: clip.id } }));
    } else {
      this._selectedId = null;
      this._dragClip   = null;
      this._el.dispatchEvent(new CustomEvent('canvas:deselect', { bubbles: true }));
    }
    this.redraw();
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);

    // ── Resize drag ────────────────────────────────────────────────────────────
    if (this._resizeHandle && (e.buttons & 1)) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip) {
        const o    = this._resizeOrigin;
        const dx   = pos.x - o.mouseX;
        const dy   = pos.y - o.mouseY;

        // Use whichever axis moved more, sign depends on corner
        const sign = (this._resizeHandle === 'br' || this._resizeHandle === 'tr') ? 1 : -1;
        const delta = Math.abs(dx) > Math.abs(dy) ? dx * sign : dy * sign;

        // Convert pixel delta → scale delta relative to the fit-size rect
        const refDim   = Math.max(o.rectW, o.rectH);
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
          o.scale + (delta / refDim) * o.scale
        ));

        clip.scale = parseFloat(newScale.toFixed(3));
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale: clip.scale }
        }));
        this.redraw();
      }
      return;
    }

    // ── Move drag ──────────────────────────────────────────────────────────────
    if (this._dragClip && (e.buttons & 1)) {
      const rawX  = pos.x - this._dragOffsetX;
      const rawY  = pos.y - this._dragOffsetY;
      let { nx, ny } = this._pxToNorm(rawX, rawY);

      this._snapTarget = null;
      for (const [sx, sy, label] of SNAP_POSITIONS) {
        if (Math.abs(nx - sx) < SNAP_THRESHOLD && Math.abs(ny - sy) < SNAP_THRESHOLD) {
          nx = sx; ny = sy;
          this._snapTarget = [sx, sy, label];
          break;
        }
      }
      this._dragClip.x = nx;
      this._dragClip.y = ny;
      this._el.dispatchEvent(new CustomEvent('canvas:clipmoved', {
        bubbles: true, detail: { id: this._dragClip.id, nx, ny }
      }));
      this.redraw();
      return;
    }

    // ── Cursor feedback ────────────────────────────────────────────────────────
    if (this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip && (clip.clip_type === 'image' || clip.clip_type === 'video')) {
        const drawn = this._drawnRects.get(clip.id);
        if (drawn) {
          const handle = this._hitHandle(pos.x, pos.y, drawn);
          if (handle) {
            this._el.style.cursor = this._resizeCursor(handle);
            return;
          }
        }
      }
    }
    const clip = this._clipAt(pos.x, pos.y);
    this._el.style.cursor = clip ? 'move' : 'default';
  }

  _onMouseUp(_e) {
    // Commit resize to backend if scale changed
    if (this._resizeHandle && this._selectedId) {
      const clip = this.project.clips.find(c => c.id === this._selectedId);
      if (clip) {
        this._el.dispatchEvent(new CustomEvent('canvas:clipresized', {
          bubbles: true, detail: { id: clip.id, scale: clip.scale }
        }));
      }
    }
    this._resizeHandle  = null;
    this._resizeOrigin  = null;
    this._dragClip      = null;
    this._snapTarget    = null;
    this._el.style.cursor = 'default';
    this.redraw();
  }

  _resizeCursor(handle) {
    return { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize' }[handle] ?? 'default';
  }

  _loadMedia(url) {
    if (this._mediaCache.has(url)) return this._mediaCache.get(url);

    const ext     = url.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (isVideo) {
      const vid   = document.createElement('video');
      vid.muted   = true;
      vid.preload = 'auto';
      const entry = { el: vid, loaded: false };
      this._mediaCache.set(url, entry);
      vid.addEventListener('loadeddata', () => { entry.loaded = true; this.redraw(); });
      vid.src = url;
      return entry;
    }

    const img   = new Image();
    const entry = { el: img, loaded: false };
    this._mediaCache.set(url, entry);
    img.onload = () => { entry.loaded = true; this.redraw(); };
    img.src = url;
    return entry;
  }
}