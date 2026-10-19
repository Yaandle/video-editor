// timeline.js — canvas timeline. Kept from vidkit: global layers (#71) with eye
// toggles, marquee multi-select (#67a), razor, drag/resize with snapping, media
// drops, viewport culling. New: the beat grid (bars/beats/steps), snapping to
// it, an in/out range, and neo-brutal clip blocks coloured by clip kind.

import { lines as gridLines, grid as beatGrid, snap as beatSnap } from './renderer/beat.js';

const HEADER_H = 30;
const LABEL_W = 92;
const MIN_CLIP_PX = 8;
const RESIZE_ZONE = 9;
const MIN_DUR_SEC = 0.1;
const ROW_H = 40;
const MAX_TIMELINE_H = 320;
const EYE_SIZE = 14;

// Viewport culling — only clips whose [start, end) overlaps the range.
export function clipsInRange(clips, rangeStart, rangeEnd) {
  return clips.filter((c) => c.start < rangeEnd && c.end() > rangeStart);
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export class TimelineWidget {
  constructor(canvasEl, project) {
    this._el = canvasEl;
    this._ctx = canvasEl.getContext('2d');
    this.project = project;
    this.playhead = 0;
    this._zoom = 1;
    this._panOffsetPx = 0;
    this._selectedIds = new Set();
    this._selectionPrimaryId = null;
    this._dragClip = null;
    this._dragMode = '';
    this.tool = 'select';
    this.beatSnap = true;
    this.range = null;               // { t0, t1 } in/out
    this._marquee = null;
    this._scrollY = 0;
    this._contentH = 0;
    this._insertedTopLayer = false;
    this._bindEvents();
    this.resize();
  }

  setProject(p) { this.project = p; this.redraw(); this.resize(); }
  setPlayhead(t) { this.playhead = t; this.redraw(); }
  setSelectedIds(ids, primary = null) { this._selectedIds = ids instanceof Set ? new Set(ids) : new Set(ids); this._selectionPrimaryId = primary; this.redraw(); }
  setTool(name) { this.tool = name; this._updateCursor(null); }
  setRange(r) { this.range = r; this.redraw(); }
  redraw() { this._paint(); }
  zoomOut() { this._zoom = Math.max(this._zoom / 1.25, 1); this._clampPan(); this.redraw(); }
  zoomIn() { this._zoom = Math.min(this._zoom * 1.25, 48); this._clampPan(); this.redraw(); }

  _dur() { return Math.max(this.project.settings.duration, 1); }
  _maxPan() { return Math.max(0, this._pxPerSec() * this._dur() - (this._el.width - LABEL_W)); }
  _clampPan() { this._panOffsetPx = Math.max(0, Math.min(this._maxPan(), this._panOffsetPx)); }

  resize(manualH = null) {
    const wrap = this._el.parentElement;
    const container = wrap.parentElement;
    this._contentH = HEADER_H + this._layerCount() * ROW_H + 6;
    if (manualH != null) this._manualH = manualH;
    const h = Math.max(HEADER_H + ROW_H * 2, Math.min(this._manualH ?? this._contentH, MAX_TIMELINE_H));
    container.style.height = (h + 38) + 'px';
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    this._W = wrap.clientWidth; this._H = h;
    this._el.width = Math.round(this._W * dpr); this._el.height = Math.round(h * dpr);
    this._el.style.height = h + 'px';
    this._clampScrollY();
    this.redraw();
  }

  get _cw() { return this._W ?? this._el.width; }
  _maxScrollY() { return Math.max(0, this._contentH - this._H); }
  _clampScrollY() { this._scrollY = Math.max(0, Math.min(this._maxScrollY(), this._scrollY)); }
  _toContentY(py) { return py + this._scrollY; }
  _pxPerSec() { return ((this._cw - LABEL_W) * this._zoom) / this._dur(); }
  _secToPx(t) { return LABEL_W + t * this._pxPerSec() - this._panOffsetPx; }
  _pxToSec(px) { return Math.max(0, (px - LABEL_W + this._panOffsetPx) / this._pxPerSec()); }
  _visibleRange() { return [this._pxToSec(LABEL_W), this._pxToSec(this._cw)]; }
  _layerCount() { let m = 0; for (const c of this.project.clips) m = Math.max(m, (c.layer ?? 0) + 1); return Math.max(2, m); }
  _rowY(layer) { return HEADER_H + layer * ROW_H; }
  _hidden(layer) { return this.project.isLayerHidden?.(layer); }
  _eyeRect(layer) { const y = this._rowY(layer); return { x: 8, y: y + (ROW_H - EYE_SIZE) / 2, w: EYE_SIZE, h: EYE_SIZE }; }

  // Keep explicit layers; slide a clip down only if its row is already taken at that time.
  _reflowLayers() {
    const clips = [...this.project.clips].sort((a, b) => a.start - b.start);
    const ends = [];
    for (const c of clips) {
      const want = c.layer ?? 0;
      let layer = want;
      while ((ends[layer] ?? -1) > c.start + 1e-6) layer++;
      c.layer = layer;
      ends[layer] = Math.max(ends[layer] ?? -1, c.end());
    }
  }

  _clipRect(clip) {
    return { x: this._secToPx(clip.start), w: Math.max(MIN_CLIP_PX, clip.duration * this._pxPerSec()), y: this._rowY(clip.layer ?? 0) + 4, h: ROW_H - 8 };
  }

  _colors() {
    return {
      ink: css('--ink') || '#121212', paper: css('--paper') || '#F3EFE4', deep: css('--paper-deep') || '#E2DCCB',
      lime: css('--lime') || '#CDF545', orange: css('--orange') || '#FF4F1F', cobalt: css('--cobalt') || '#2342F5',
      white: css('--white') || '#FFFFFF', soft: css('--ink-soft') || '#4E4B45',
    };
  }

  _kindFill(clip, c) {
    const kind = clip.kind;
    if (kind === 'scene') return c.orange;
    if (clip.type === 'audio') return c.cobalt;
    if (clip.type === 'text' || clip.type === 'code') return c.white;
    if (['nav-bar', 'footer-bar', 'ticker', 'index-counter'].includes(clip.type)) return c.deep;
    return c.lime;
  }

  _paint() {
    const ctx = this._ctx, W = this._cw, H = this._H ?? this._el.height;
    const c = (this._c = this._colors());
    ctx.setTransform(this._dpr ?? 1, 0, 0, this._dpr ?? 1, 0, 0);
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, W, H);

    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, H); ctx.clip();
    this._drawGrid(ctx, W, H);
    ctx.restore();

    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, HEADER_H); ctx.clip();
    this._drawRuler(ctx, W);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(0, HEADER_H, W, H - HEADER_H); ctx.clip();
    ctx.translate(0, -this._scrollY);
    this._drawLayerLabels(ctx, W);
    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, this._contentH + 400); ctx.clip();
    this._drawClips(ctx);
    ctx.restore();
    ctx.restore();

    this._drawPlayhead(ctx, H);
    if (this._dropT != null) {
      const x = this._secToPx(this._dropT);
      ctx.fillStyle = c.cobalt;
      ctx.fillRect(x - 2, HEADER_H, 4, H - HEADER_H);
    }
    if (this._marquee) {
      const m = this._marquee;
      ctx.fillStyle = 'rgba(35,66,245,0.12)';
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeStyle = c.cobalt; ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    // gutter divider
    ctx.fillStyle = c.ink;
    ctx.fillRect(LABEL_W - 3, 0, 3, H);
    ctx.fillRect(0, HEADER_H - 3, W, 3);
  }

  _drawGrid(ctx, W, H) {
    const c = this._c, s = this.project.settings;
    const [v0, v1] = this._visibleRange();
    const g = beatGrid(s);
    if (!g) return;
    const pxBeat = g.beat * this._pxPerSec();
    const mode = pxBeat < 7 ? 'bar' : 'beat';
    for (const l of gridLines(v0, v1 + g.beat, s, mode)) {
      const x = Math.round(this._secToPx(l.t));
      ctx.fillStyle = l.onBar ? 'rgba(18,18,18,0.30)' : 'rgba(18,18,18,0.10)';
      ctx.fillRect(x, HEADER_H, l.onBar ? 2 : 1, H - HEADER_H);
    }
    if (this.range) {
      const x0 = this._secToPx(this.range.t0), x1 = this._secToPx(this.range.t1);
      ctx.fillStyle = 'rgba(205,245,69,0.28)';
      ctx.fillRect(x0, HEADER_H, x1 - x0, H - HEADER_H);
    }
  }

  _drawRuler(ctx, W) {
    const c = this._c, s = this.project.settings;
    ctx.fillStyle = c.white; ctx.fillRect(LABEL_W, 0, W - LABEL_W, HEADER_H);
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    const g = beatGrid(s);
    const [v0, v1] = this._visibleRange();
    if (g) {
      const pxBar = g.bar * this._pxPerSec();
      const every = pxBar < 34 ? 4 : pxBar < 70 ? 2 : 1;
      for (const l of gridLines(v0, v1 + g.bar, s, 'bar')) {
        const bar = Math.round((l.t - g.offset) / g.bar);
        const x = Math.round(this._secToPx(l.t));
        ctx.fillStyle = c.ink;
        ctx.fillRect(x, 0, 2, HEADER_H);
        if (bar % every === 0) ctx.fillText(String(bar + 1), x + 5, 10);
        ctx.fillStyle = c.soft;
        if (bar % every === 0) ctx.fillText(fmt(l.t), x + 5, 22);
      }
    } else {
      let iv = 1;
      for (const v of [0.5, 1, 2, 5, 10, 15, 30, 60]) { iv = v; if (this._pxPerSec() * v >= 50) break; }
      for (let t = Math.floor(v0 / iv) * iv; t <= v1 + iv; t += iv) {
        const x = Math.round(this._secToPx(t));
        ctx.fillStyle = c.ink; ctx.fillRect(x, HEADER_H - 10, 2, 10);
        ctx.fillText(fmt(t), x + 4, 12);
      }
    }
    if (this.range) {
      const x0 = this._secToPx(this.range.t0), x1 = this._secToPx(this.range.t1);
      ctx.fillStyle = c.lime; ctx.fillRect(x0, HEADER_H - 9, x1 - x0, 6);
      ctx.fillStyle = c.ink; ctx.fillRect(x0 - 1, HEADER_H - 12, 3, 12); ctx.fillRect(x1 - 1, HEADER_H - 12, 3, 12);
    }
  }

  _drawLayerLabels(ctx, W) {
    const c = this._c;
    const n = this._layerCount();
    for (let layer = 0; layer < n; layer++) {
      const y = this._rowY(layer);
      ctx.fillStyle = layer % 2 ? c.paper : c.white;
      ctx.fillRect(0, y, LABEL_W, ROW_H);
      ctx.fillStyle = 'rgba(18,18,18,0.18)';
      ctx.fillRect(0, y + ROW_H - 1, W, 1);
      const hidden = this._hidden(layer);
      const eye = this._eyeRect(layer);
      this._drawEye(ctx, eye.x + eye.w / 2, eye.y + eye.h / 2, !hidden);
      const t = this.project.tracks?.find((tr) => tr.index === layer);
      ctx.fillStyle = hidden ? c.soft : c.ink;
      ctx.font = '700 10px "Space Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText((t?.name ?? `L${layer + 1}`).slice(0, 8).toUpperCase(), eye.x + eye.w + 8, y + ROW_H / 2);
    }
  }

  _drawEye(ctx, cx, cy, visible) {
    const c = this._c;
    ctx.save();
    ctx.strokeStyle = c.ink; ctx.fillStyle = c.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, 6.5, 4, 0, 0, Math.PI * 2); ctx.stroke();
    if (visible) { ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(cx - 7, cy + 5); ctx.lineTo(cx + 7, cy - 5); ctx.stroke(); }
    ctx.restore();
  }

  _drawClips(ctx) {
    const c = this._c;
    const [v0, v1] = this._visibleRange();
    ctx.font = '700 11px "Archivo", sans-serif';
    for (const clip of clipsInRange(this.project.clips, v0, v1)) {
      const r = this._clipRect(clip);
      const sel = this._selectedIds.has(clip.id);
      ctx.save();
      if (this._hidden(clip.layer ?? 0)) ctx.globalAlpha = 0.35;
      if (sel) { ctx.fillStyle = c.ink; ctx.fillRect(r.x + 4, r.y + 4, r.w, r.h); }
      const fill = this._kindFill(clip, c);
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = sel ? c.cobalt : c.ink;
      const bw = sel ? 3 : 2;
      ctx.fillRect(r.x, r.y, r.w, bw); ctx.fillRect(r.x, r.y + r.h - bw, r.w, bw);
      ctx.fillRect(r.x, r.y, bw, r.h); ctx.fillRect(r.x + r.w - bw, r.y, bw, r.h);
      if (clip._peaks) this._drawWave(ctx, clip, r, fill === c.cobalt ? c.paper : c.ink);
      ctx.beginPath(); ctx.rect(r.x + 6, r.y, Math.max(0, r.w - 12), r.h); ctx.clip();
      ctx.fillStyle = fill === c.cobalt ? c.paper : c.ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(clip.label(), r.x + 8, r.y + r.h / 2 + 1);
      ctx.restore();
    }
  }

  _drawWave(ctx, clip, r, color) {
    const p = clip._peaks;
    const total = p.duration || clip.duration;
    const n = p.mins.length;
    const b0 = Math.floor(((clip.source_start ?? 0) / total) * n);
    const b1 = Math.min(n, Math.ceil((((clip.source_start ?? 0) + clip.duration) / total) * n));
    const vis = Math.max(1, b1 - b0), mid = r.y + r.h / 2, amp = r.h / 2 - 4;
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.35;
    for (let px = 0; px < r.w; px += 2) {
      const b = Math.min(n - 1, b0 + Math.floor((px / r.w) * vis));
      ctx.fillRect(r.x + px, mid + p.mins[b] * amp, 1.5, (p.maxes[b] - p.mins[b]) * amp);
    }
  }

  _drawPlayhead(ctx, H) {
    const c = this._c;
    const x = this._secToPx(this.playhead);
    if (x < LABEL_W - 2) return;
    ctx.fillStyle = c.orange;
    ctx.fillRect(x - 1.5, 0, 3, H);
    ctx.fillStyle = c.ink;
    ctx.beginPath(); ctx.moveTo(x - 8, 0); ctx.lineTo(x + 8, 0); ctx.lineTo(x, 12); ctx.closePath(); ctx.fill();
  }

  _updateCursor(pos) {
    if (this.tool === 'razor') { this._el.style.cursor = 'crosshair'; return; }
    if (!pos) { this._el.style.cursor = 'default'; return; }
    if (pos.y <= HEADER_H) { this._el.style.cursor = 'ew-resize'; return; }
    const clip = this._clipAt(pos.x, pos.y);
    if (!clip) { this._el.style.cursor = 'default'; return; }
    const r = this._clipRect(clip);
    this._el.style.cursor = pos.x >= r.x + r.w - RESIZE_ZONE || pos.x <= r.x + RESIZE_ZONE ? 'ew-resize' : 'grab';
  }

  _clipAt(px, py) {
    const cy = this._toContentY(py);
    const [v0, v1] = this._visibleRange();
    const vis = clipsInRange(this.project.clips, v0, v1);
    for (let i = vis.length - 1; i >= 0; i--) {
      const r = this._clipRect(vis[i]);
      if (px >= r.x && px <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return vis[i];
    }
    return null;
  }

  _emit(name, detail) { this._el.dispatchEvent(new CustomEvent(`timeline:${name}`, { bubbles: true, detail })); }
  _getPos(e) { const b = this._el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  _seek(t) { this.playhead = t; this.redraw(); this._emit('playheadmoved', { t }); }
  _selChanged() { this._emit('selectionchanged', { selectedIds: [...this._selectedIds], primaryId: this._selectionPrimaryId }); }

  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown', (e) => this._onDown(e));
    window.addEventListener('mousemove', (e) => this._onMove(e));
    window.addEventListener('mouseup', (e) => this._onUp(e));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => this._onContext(e));
    el.addEventListener('dblclick', (e) => { const p = this._getPos(e); const clip = this._clipAt(p.x, p.y); if (clip) this._emit('open', { clip }); });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('application/vidkit-item')) return;
      e.preventDefault();
      const p = this._getPos(e);
      this._dropT = this._snapPoint(this._pxToSec(p.x));
      this._dropLayer = Math.max(0, Math.floor((this._toContentY(p.y) - HEADER_H) / ROW_H));
      this.redraw();
    });
    el.addEventListener('dragleave', () => { this._dropT = null; this.redraw(); });
    el.addEventListener('drop', (e) => {
      const data = e.dataTransfer?.getData('application/vidkit-item');
      const t = this._dropT, layer = this._dropLayer;
      this._dropT = null;
      if (!data) { this.redraw(); return; }
      e.preventDefault();
      this._emit('itemdropped', { item: JSON.parse(data), time: t, layer });
      this.redraw();
    });
  }

  _onDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const pos = this._getPos(e);
    if (e.button === 1 || e.altKey) { this._panning = { x: e.clientX, off: this._panOffsetPx }; return; }
    if (pos.x < LABEL_W && pos.y >= HEADER_H) {
      const cy = this._toContentY(pos.y);
      const layer = Math.floor((cy - HEADER_H) / ROW_H);
      const eye = this._eyeRect(layer);
      if (pos.x <= eye.x + eye.w + 6) this._emit('layervisibility', { layer });
      return;
    }
    if (pos.y < HEADER_H) { this._scrub = true; this._seek(this._clampT(this._pxToSec(pos.x))); return; }
    if (this.tool === 'razor') { const clip = this._clipAt(pos.x, pos.y); if (clip) this._emit('slice', { clip, t: this._snapPoint(this._pxToSec(pos.x)) }); return; }
    const clip = this._clipAt(pos.x, pos.y);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (clip) {
      if (additive) this._selectedIds.has(clip.id) ? this._selectedIds.delete(clip.id) : this._selectedIds.add(clip.id);
      else if (!this._selectedIds.has(clip.id)) { this._selectedIds.clear(); this._selectedIds.add(clip.id); }
      this._selectionPrimaryId = this._selectedIds.has(clip.id) ? clip.id : ([...this._selectedIds][0] ?? null);
      if (!additive || this._selectedIds.has(clip.id)) {
        const r = this._clipRect(clip);
        this._dragClip = clip;
        this._dragX = pos.x;
        this._dragStart = clip.start;
        this._dragDur = clip.duration;
        this._dragMode = pos.x >= r.x + r.w - RESIZE_ZONE ? 'resize-right' : pos.x <= r.x + RESIZE_ZONE ? 'resize-left' : 'move';
        this._before = JSON.stringify(this.project.toDict());
        this._group = this._selectedIds.size > 1 ? new Map([...this._selectedIds].map((id) => {
          const c = this.project.clips.find((x) => x.id === id);
          return [id, { start: c.start, layer: c.layer ?? 0 }];
        })) : null;
      }
      this._selChanged();
    } else {
      if (!additive) { this._selectedIds.clear(); this._selectionPrimaryId = null; this._emit('deselect'); }
      this._marquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, additive };
    }
    this.redraw();
  }

  _clampT(t) { return Math.max(0, Math.min(t, this.project.settings.duration)); }

  _onMove(e) {
    const pos = this._getPos(e);
    if (this._panning && e.buttons) { this._panOffsetPx = this._panning.off - (e.clientX - this._panning.x); this._clampPan(); this.redraw(); return; }
    if (this._scrub && e.buttons & 1) {
      let t = this._clampT(this._pxToSec(pos.x));
      if (this.beatSnap && e.shiftKey) t = beatSnap(t, this.project.settings);
      this._seek(t); return;
    }
    if (this._marquee && e.buttons & 1) { this._marquee.x1 = pos.x; this._marquee.y1 = pos.y; this.redraw(); return; }
    if (!(e.buttons & 1)) {
      if (pos.x >= 0 && pos.x <= this._cw && pos.y >= 0 && pos.y <= this._H) this._updateCursor(pos);
      return;
    }
    if (!this._dragClip) return;
    const dt = (pos.x - this._dragX) / this._pxPerSec();
    const round = (v) => Math.round(v * 1e6) / 1e6;
    if (this._dragMode === 'move') {
      const ns = round(this._snapPoint(Math.max(0, this._dragStart + dt), e.altKey));
      const off = ns - this._dragStart;
      const rawLayer = Math.floor((this._toContentY(pos.y) - HEADER_H) / ROW_H);
      const newLayer = Math.max(0, Math.min(this._layerCount(), rawLayer));
      const dl = newLayer - (this._dragClip.layer ?? 0);
      if (this._group) {
        for (const [id, o] of this._group) {
          const c = this.project.clips.find((x) => x.id === id);
          if (!c) continue;
          c.start = round(Math.max(0, o.start + off));
          c.layer = Math.max(0, o.layer + (newLayer - this._group.get(this._dragClip.id).layer));
        }
      } else {
        this._dragClip.start = ns;
        if (dl) this._dragClip.layer = newLayer;
      }
      this._el.style.cursor = 'grabbing';
    } else if (this._dragMode === 'resize-right') {
      const end = this._snapPoint(this._dragStart + this._dragDur + dt, e.altKey);
      this._dragClip.duration = round(Math.max(MIN_DUR_SEC, end - this._dragStart));
    } else {
      const ns = this._snapPoint(Math.max(0, this._dragStart + dt), e.altKey);
      const nd = this._dragStart + this._dragDur - ns;
      if (nd >= MIN_DUR_SEC) { this._dragClip.start = round(ns); this._dragClip.duration = round(nd); }
    }
    this.redraw();
    this._emit('clipchanged');
  }

  /** Snap to the beat grid (when on), the playhead, and clip edges. Alt bypasses. */
  _snapPoint(t, bypass = false) {
    if (bypass) return t;
    const thresh = 9 / this._pxPerSec();
    let best = t, bd = thresh;
    const cands = [0, this.playhead];
    if (this.beatSnap) {
      const g = beatGrid(this.project.settings);
      if (g) cands.push(beatSnap(t, this.project.settings));
    }
    const [v0, v1] = this._visibleRange();
    for (const c of clipsInRange(this.project.clips, v0 - thresh, v1 + thresh)) {
      if (c === this._dragClip || this._group?.has(c.id)) continue;
      cands.push(c.start, c.end());
    }
    for (const x of cands) { const d = Math.abs(t - x); if (d < bd) { bd = d; best = x; } }
    if (this.beatSnap && beatGrid(this.project.settings) && bd === thresh) {
      // Strong snap: when beat snap is on, moves always land on the grid.
      return beatSnap(t, this.project.settings);
    }
    return best;
  }

  _onUp() {
    if (this._panning) { this._panning = null; return; }
    if (this._scrub) { this._scrub = false; return; }
    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
      const y0 = this._toContentY(Math.min(m.y0, m.y1)), y1 = this._toContentY(Math.max(m.y0, m.y1));
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        for (const clip of this.project.clips) {
          const r = this._clipRect(clip);
          if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) {
            if (m.additive && this._selectedIds.has(clip.id)) this._selectedIds.delete(clip.id);
            else this._selectedIds.add(clip.id);
          }
        }
        this._selectionPrimaryId = [...this._selectedIds][0] ?? null;
        this._selChanged();
      }
      this.redraw();
      return;
    }
    if (this._dragClip) {
      this._reflowLayers();
      if (this._before) this._emit('committed', { before: this._before });
      this._before = null; this._group = null; this._dragClip = null; this._dragMode = '';
      this._el.style.cursor = 'default';
      this.resize();
      this._emit('clipchanged');
    }
  }

  _onContext(e) {
    e.preventDefault();
    const p = this._getPos(e), clip = this._clipAt(p.x, p.y);
    if (!clip) return;
    if (!this._selectedIds.has(clip.id)) { this._selectedIds = new Set([clip.id]); this._selectionPrimaryId = clip.id; this.redraw(); }
    this._selChanged();
    this._emit('contextmenu', { clip, x: e.clientX, y: e.clientY });
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.shiftKey) {
      const p = this._getPos(e), t = this._pxToSec(p.x);
      this._zoom = e.deltaY < 0 ? Math.min(this._zoom * 1.2, 48) : Math.max(this._zoom / 1.2, 1);
      this._panOffsetPx = this._pxPerSec() * t - (p.x - LABEL_W);
      this._clampPan();
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this._panOffsetPx += e.deltaX; this._clampPan();
    } else {
      this._scrollY += e.deltaY; this._clampScrollY();
    }
    this.redraw();
  }
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(0).padStart(2, '0')}` : `${s.toFixed(s % 1 ? 1 : 0)}s`;
}
