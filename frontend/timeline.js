import { TRACK_COLOURS } from './app.js';

// #71 — consolidated timeline: rows ("layers") are global and hold any mix
// of clip types (audio/text/visual all free to share or swap rows). A row
// is just `clip.layer`; there's no more fixed audio/text/visual partition.
// `clip.track` still exists on the model (see app.js CLIP_TYPE_TRACK) but
// is now used only as a "kind" tag for colour-coding and default placement,
// never for vertical layout.
const HEADER_H = 24;
const LABEL_W = 60;
const MIN_CLIP_PX = 8;
const RESIZE_ZONE = 10;
const MIN_DUR_SEC = 0.1;
const MIN_TRACK_H = 38;
const MAX_TIMELINE_H = 260;
const EYE_SIZE = 13; // eye-icon hit target in the layer gutter



export class TimelineWidget {
  constructor(canvasEl, project) {
    this._el = canvasEl;
    this._ctx = canvasEl.getContext('2d');
    this.project = project;
    this.playhead = 0.0;
    this._zoom = 1.0;
    this._panOffsetPx = 0;
    this._selectedIds = new Set();
    this._selectionPrimaryId = null;
    this._dragClip = null;
    this._dragMode = '';
    this._dragOriginX = 0;
    this._dragOriginStart = 0.0;
    this._dragOriginDur = 0.0;
    this._dragBeforeSnapshot = null;
    this._scrubbing = false;
    this._scrubPlayhead = false;
    this.tool = 'select';
    this._panning = false;
    this._panOriginX = 0;
    this._panOriginOff = 0;
    this._marquee = null; // {x0,y0,x1,y1,additive} — drag-select on empty area (#67a)
    this._bindEvents();
    this.resize();
    this._insertedTopLayer = false;
    this._scrollY = 0;
    this._contentH = 0;

  }

  setProject(p) { this.project = p; this._reflowLayers(); this.redraw(); }
  setPlayhead(t) { this.playhead = t; this.redraw(); }
  setSelectedIds(ids) { this._selectedIds = ids instanceof Set ? ids : new Set(ids); this.redraw(); }
  setTool(name) { this.tool = name; this._updateCursor(null); }
  redraw() { this._paint(); }

  zoomOut() { this._zoom = Math.max(this._zoom / 1.25, 1); this._clampPan(); this.redraw(); }
  zoomIn() { this._zoom = Math.min(this._zoom * 1.25, 32); this._clampPan(); this.redraw(); }
  zoomReset() { this._zoom = 1; this._clampPan(); this.redraw(); }

  _maxPan() { return Math.max(0, this._pxPerSec() * this.project.duration - (this._el.width - LABEL_W)); }
  _clampPan() { this._panOffsetPx = Math.max(0, Math.min(this._maxPan(), this._panOffsetPx)); }

  resize(manualH = null) {
    const container = this._el.parentElement;
    const layerTotal = this._layerCount();
    this._contentH = HEADER_H + layerTotal * MIN_TRACK_H + 4;
    const desired = manualH != null ? manualH : (this._manualH ?? this._contentH);
    if (manualH != null) this._manualH = manualH;
    const totalH = Math.min(desired, MAX_TIMELINE_H);
    container.style.height = totalH + 'px';
    this._el.width = container.clientWidth;
    this._el.height = totalH;
    this._el.style.height = totalH + 'px';
    this._clampScrollY();
    this.redraw();
  }

  // scroll helpers
  _maxScrollY() { return Math.max(0, this._contentH - this._el.height); }
  _clampScrollY() { this._scrollY = Math.max(0, Math.min(this._maxScrollY(), this._scrollY)); }
  _toContentY(py) { return py + this._scrollY; }

  _pxPerSec() { return ((this._el.width - LABEL_W) * this._zoom) / Math.max(this.project.duration, 1.0); }
  _secToPx(t) { return LABEL_W + (t * this._pxPerSec()) - this._panOffsetPx | 0; }
  _pxToSec(px) { return Math.max(0, (px - LABEL_W + this._panOffsetPx) / this._pxPerSec()); }

  // #71 — layer count/rows are global now: every clip, regardless of type,
  // occupies a row (`clip.layer`) in one shared stack.
  _layerCount() {
    let max = 0;
    for (const c of this.project.clips) max = Math.max(max, (c.layer ?? 0) + 1);
    return Math.max(1, max);
  }

  _subLayerH() { return MIN_TRACK_H; }

  _layerRowY(layer) { return HEADER_H + layer * this._subLayerH(); }

  _isLayerHidden(layer) { return !!this.project.hidden_layers?.has?.(layer); }

  _eyeIconRect(layer) {
    const y = this._layerRowY(layer), subH = this._subLayerH();
    return { x: 5, y: y + (subH - EYE_SIZE) / 2, w: EYE_SIZE, h: EYE_SIZE };
  }

  // Global bin-packing: clips are laid out earliest-start-first, each
  // keeping its explicit `layer` unless that row is already occupied at
  // this point in time, in which case it slides to the first free row.
  // No more per-track grouping — any clip type can land in any row.
  _reflowLayers() {
    const clips = [...this.project.clips].sort((a, b) => a.start - b.start);
    const laneEnds = [];
    for (const c of clips) {
      if (Number.isInteger(c.layer) && laneEnds[c.layer] === undefined) {
        laneEnds[c.layer] = c.end();
        continue;
      }
      let layer = 0;
      while (layer < laneEnds.length && laneEnds[layer] > c.start + 1e-6) layer++;
      c.layer = layer;
      laneEnds[layer] = c.end();
    }
  }

  _clipRect(clip) {
    const subH = this._subLayerH();
    return {
      x: this._secToPx(clip.start),
      w: Math.max(MIN_CLIP_PX, (clip.duration * this._pxPerSec()) | 0),
      y: this._layerRowY(clip.layer ?? 0),
      h: subH - 2
    };
  }

  _themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    return {
      bg: v('--timeline-bg'),
      rulerBg: v('--timeline-ruler-bg'),
      tick: v('--timeline-tick'),
      border: v('--timeline-border'),
      labelBg: v('--timeline-label-bg'),
      labelBorder: v('--timeline-label-border'),
      divider: v('--timeline-divider'),
      text: v('--timeline-text'),
      clipBg: v('--timeline-clip-bg'),
      clipBorder: v('--timeline-clip-border'),
      clipText: v('--timeline-clip-text'),
      overlay: v('--timeline-overlay'),
      overlayStrong: v('--timeline-overlay-strong'),
      waveform: v('--timeline-waveform'),
      playhead: v('--accent-red-dot'),
      clipMode: v('--timeline-clip-mode'), 
    };
  }

  _paint() {
    const ctx = this._ctx, W = this._el.width, H = this._el.height;
    this._colors = this._themeColors();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this._colors.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, HEADER_H); ctx.clip();
    this._drawRuler(ctx, W);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(0, HEADER_H, W, H - HEADER_H); ctx.clip(); // viewport, screen space
    ctx.translate(0, -this._scrollY);
    this._drawLayerLabels(ctx, W);
    ctx.save();
    ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, this._contentH); ctx.clip();
    this._drawClips(ctx);
    ctx.restore();
    ctx.restore();

    this._drawPlayhead(ctx, H);

    if (this._dropIndicatorT != null) {
      const x = this._secToPx(this._dropIndicatorT);
      if (x >= LABEL_W) {
        ctx.save();
        if (this._dropIndicatorLayer != null) {
          // #71 — highlight the exact row a media-bin drag would land on.
          const y = this._layerRowY(this._dropIndicatorLayer) - this._scrollY;
          ctx.fillStyle = 'rgba(59,130,246,0.10)';
          ctx.fillRect(LABEL_W, Math.max(HEADER_H, y), W - LABEL_W, this._subLayerH());
        }
        ctx.strokeStyle = 'rgba(59,130,246,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(x + 0.5, HEADER_H); ctx.lineTo(x + 0.5, H); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    if (this._marquee) {
      const m = this._marquee;
      const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  _drawRuler(ctx, W) {
    const c = this._colors;
    ctx.fillStyle = c.rulerBg; ctx.fillRect(LABEL_W, 0, W - LABEL_W, HEADER_H);
    ctx.strokeStyle = c.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(LABEL_W, HEADER_H - 0.5); ctx.lineTo(W, HEADER_H - 0.5); ctx.stroke();
    ctx.font = '8px Consolas, monospace';
    const pps = this._pxPerSec();
    let interval = 1;
    for (const iv of [0.5, 1, 2, 5, 10, 15, 30, 60]) { interval = iv; if (pps * iv >= 40) break; }
    let t = 0;
    while (t <= this.project.duration + interval) {
      const x = this._secToPx(t);
      if (x > W) break;
      ctx.strokeStyle = c.tick; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, HEADER_H - 8); ctx.lineTo(x + 0.5, HEADER_H); ctx.stroke();
      ctx.fillStyle = c.text;
      const mins = Math.floor(t / 60), secs = Math.floor(t % 60);
      const label = mins ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, x + 2, HEADER_H - 2);
      t = Math.round((t + interval) * 1000) / 1000;
    }
  }

  // #71 — one row per layer, any clip type. Each row gets a compact "L1"
  // label plus an eye icon (click to hide/show — mutes playback & render).
  _drawLayerLabels(ctx, W) {
    const c = this._colors;
    const count = this._layerCount();
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    for (let layer = 0; layer < count; layer++) {
      const y = this._layerRowY(layer), subH = this._subLayerH();
      const hidden = this._isLayerHidden(layer);
      ctx.fillStyle = c.labelBg; ctx.fillRect(0, y, LABEL_W, subH);
      ctx.strokeStyle = c.labelBorder; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + subH - 0.5); ctx.lineTo(W, y + subH - 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(LABEL_W + 0.5, y); ctx.lineTo(LABEL_W + 0.5, y + subH); ctx.stroke();

      const eye = this._eyeIconRect(layer);
      this._drawEyeIcon(ctx, eye.x + eye.w / 2, eye.y + eye.h / 2, !hidden);

      ctx.save();
      ctx.globalAlpha = hidden ? 0.45 : 1;
      ctx.fillStyle = c.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`L${layer + 1}`, eye.x + eye.w + 5, y + subH / 2);
      ctx.restore();
    }
  }

  _drawEyeIcon(ctx, cx, cy, visible) {
    const c = this._colors;
    ctx.save();
    ctx.lineWidth = 1;
    if (visible) {
      ctx.strokeStyle = c.text; ctx.fillStyle = c.text;
      ctx.beginPath(); ctx.ellipse(cx, cy, 5, 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 1.3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = c.text;
      ctx.beginPath(); ctx.ellipse(cx, cy, 5, 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 5.5, cy + 3.5); ctx.lineTo(cx + 5.5, cy - 3.5); ctx.stroke();
    }
    ctx.restore();
  }

  _drawClips(ctx) {
    const c = this._colors;
    ctx.font = '8px Consolas, monospace';
    for (const clip of this.project.clips) {
      const cr = this._clipRect(clip), col = TRACK_COLOURS(clip.track), isSelected = this._selectedIds.has(clip.id);
      const glowColor = col.border ?? c.clipBorder;
      const hidden = this._isLayerHidden(clip.layer ?? 0);

      ctx.save();
      if (hidden) ctx.globalAlpha *= 0.35; // #71 — muted layer reads as muted on the timeline too

      if (c.clipMode === 'glow') {
        // light mode: no fill, glowing stroke only
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = isSelected ? 10 : 6;
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w - 1, cr.h - 1);
        ctx.restore();
        // faint fill so waveform/text stay legible, not fully transparent
        ctx.fillStyle = glowColor + '14'; // ~8% alpha hex suffix
        ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
      } else {
        // dark mode: existing solid fill, unchanged
        ctx.fillStyle = col.bg ?? c.clipBg; ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
        ctx.strokeStyle = isSelected ? (col.border ?? c.text) : (col.border ? col.border + '99' : c.clipBorder);
        ctx.lineWidth = isSelected ? 1.5 : 0.5;
        ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w - 1, cr.h - 1);
      }

      if (clip.clip_type === 'audio') this._drawWaveform(ctx, clip, cr);
      ctx.fillStyle = c.overlay; ctx.fillRect(cr.x, cr.y, RESIZE_ZONE, cr.h);
      ctx.fillStyle = c.overlayStrong; ctx.fillRect(cr.x + cr.w - RESIZE_ZONE, cr.y, RESIZE_ZONE, cr.h);
      ctx.fillStyle = col.text ?? c.clipText; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.beginPath(); ctx.rect(cr.x + RESIZE_ZONE, cr.y + 1, Math.max(0, cr.w - RESIZE_ZONE * 2), cr.h - 2); ctx.clip();
      ctx.fillText(clip.label(), cr.x + RESIZE_ZONE + 2, cr.y + cr.h / 2); ctx.restore();
      ctx.restore();
    }
  }

  _drawWaveform(ctx, clip, cr) {
    const peaks = clip._peaks;
    if (!peaks) return;
    const srcStart = clip.source_start ?? 0;
    const srcEnd = srcStart + clip.duration;
    const totalDur = peaks.duration || srcEnd;
    const bucketCount = peaks.mins.length;
    const startBucket = Math.max(0, Math.floor((srcStart / totalDur) * bucketCount));
    const endBucket = Math.min(bucketCount, Math.ceil((srcEnd / totalDur) * bucketCount));
    const visibleBuckets = Math.max(1, endBucket - startBucket);
    const midY = cr.y + cr.h / 2;
    const ampScale = (cr.h / 2) - 3;
    ctx.strokeStyle = this._colors.waveform;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < cr.w; px++) {
      const bucketIdx = startBucket + Math.floor((px / cr.w) * visibleBuckets);
      const b = Math.min(bucketCount - 1, Math.max(0, bucketIdx));
      const min = peaks.mins[b], max = peaks.maxes[b];
      const x = cr.x + px;
      ctx.moveTo(x + 0.5, midY + min * ampScale);
      ctx.lineTo(x + 0.5, midY + max * ampScale);
    }
    ctx.stroke();
  }

  _drawPlayhead(ctx, H) {
    const x = this._secToPx(this.playhead);
    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, this._el.width - LABEL_W, H); ctx.clip();
    ctx.strokeStyle = this._colors.playhead; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); ctx.restore();
    if (x >= LABEL_W) {
      ctx.fillStyle = this._colors.playhead;
      ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 10); ctx.closePath(); ctx.fill();
    }
  }

  _updateCursor(pos) {
    if (this.tool === 'razor') { this._el.style.cursor = 'crosshair'; return; }
    if (!pos) { this._el.style.cursor = 'default'; return; }
    if (pos.y <= HEADER_H && Math.abs(pos.x - this._secToPx(this.playhead)) <= 8) { this._el.style.cursor = 'ew-resize'; return; }
    const clip = this._clipAt(pos.x, pos.y);
    if (!clip) { this._el.style.cursor = 'default'; return; }
    const cr = this._clipRect(clip);
    if (pos.x >= cr.x + cr.w - RESIZE_ZONE || pos.x <= cr.x + RESIZE_ZONE) this._el.style.cursor = 'ew-resize';
    else this._el.style.cursor = 'grab';
  }

  _clipAt(px, py) {
    const cy = this._toContentY(py);
    for (let i = this.project.clips.length - 1; i >= 0; i--) {
      const clip = this.project.clips[i], cr = this._clipRect(clip);
      if (px >= cr.x && px <= cr.x + cr.w && cy >= cr.y && cy <= cr.y + cr.h) return clip;
    }
    return null;
  }

  _hitResizeRight(clip, px) { const cr = this._clipRect(clip); return px >= cr.x + cr.w - RESIZE_ZONE && px <= cr.x + cr.w; }
  _hitResizeLeft(clip, px) { const cr = this._clipRect(clip); return px >= cr.x && px <= cr.x + RESIZE_ZONE; }
  _hitPlayheadTriangle(px, py) { return py <= HEADER_H + 10 && Math.abs(px - this._secToPx(this.playhead)) <= 8; }

  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown', e => this._onMouseDown(e));
    // mousemove/mouseup live on window, not the canvas: panning, clip drags,
    // resizes, and marquee-select all continue correctly once the cursor
    // crosses the canvas edge (which happens constantly — that's the whole
    // point of dragging to pan). Binding them to `el` instead used to cancel
    // the gesture via 'mouseleave' the moment the pointer left the element.
    window.addEventListener('mousemove', e => this._onMouseMove(e));
    window.addEventListener('mouseup', e => this._onMouseUp(e));
    el.addEventListener('dblclick', e => this._onDblClick(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });

    // #67b follow-up — accept drags from the media bin and add the clip at
    // the dropped time. mediaBin.js sets 'application/vidkit-media' on
    // dragstart; a snapped drop indicator previews the insert point.
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer?.types?.includes('application/vidkit-media')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const pos = this._getPos(e);
      this._dropIndicatorT = this._snapPoint(this._pxToSec(pos.x));
      // #71 — unified timeline: track which row the drag is hovering so the
      // dropped clip can land exactly there instead of always picking track 0.
      const contentY = this._toContentY(pos.y);
      this._dropIndicatorLayer = Math.max(0, Math.floor((contentY - HEADER_H) / this._subLayerH()));
      this.redraw();
    });
    el.addEventListener('dragleave', () => {
      if (this._dropIndicatorT == null) return;
      this._dropIndicatorT = null;
      this._dropIndicatorLayer = null;
      this.redraw();
    });
    el.addEventListener('drop', e => {
      this._dropIndicatorT = null;
      const layer = this._dropIndicatorLayer;
      this._dropIndicatorLayer = null;
      const data = e.dataTransfer?.getData('application/vidkit-media');
      if (!data) { this.redraw(); return; }
      e.preventDefault();
      let item;
      try { item = JSON.parse(data); } catch { this.redraw(); return; }
      const t = this._snapPoint(this._pxToSec(this._getPos(e).x));
      this._el.dispatchEvent(new CustomEvent('timeline:mediadropped', {
        bubbles: true, detail: { item, time: Math.round(t * 1000) / 1000, layer }
      }));
      this.redraw();
    });
  }

  _getPos(e) { const rect = this._el.getBoundingClientRect(); return { x: (e.clientX - rect.left) | 0, y: (e.clientY - rect.top) | 0 }; }
  _emitSeek(t) { this.playhead = t; this.redraw(); this._el.dispatchEvent(new CustomEvent('timeline:playheadmoved', { bubbles: true, detail: { t } })); }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos = this._getPos(e);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this._panning = true; this._panOriginX = e.clientX; this._panOriginOff = this._panOffsetPx; this._el.style.cursor = 'grabbing'; return;
    }
    if (this.tool === 'razor') {
      const clip = this._clipAt(pos.x, pos.y); if (clip) this._sliceClip(clip, pos.x); return;
    }

    // #71 — eye icon in the layer gutter: click toggles that row's visibility.
    if (pos.x < LABEL_W && pos.y >= HEADER_H) {
      const contentY = this._toContentY(pos.y);
      const layer = Math.floor((contentY - HEADER_H) / this._subLayerH());
      if (layer >= 0 && layer < this._layerCount()) {
        const eye = this._eyeIconRect(layer);
        if (pos.x >= eye.x - 3 && pos.x <= eye.x + eye.w + 3 && contentY >= eye.y - 3 && contentY <= eye.y + eye.h + 3) {
          this._el.dispatchEvent(new CustomEvent('timeline:layervisibility', { bubbles: true, detail: { layer } }));
          return;
        }
      }
    }

    if (pos.y < HEADER_H || this._hitPlayheadTriangle(pos.x, pos.y)) {
      this._scrubPlayhead = true; this._emitSeek(Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration))); return;
    }
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey; // #67a: ctrl/cmd-click also toggles
      if (additive) {
        this._selectedIds.has(clip.id) ? this._selectedIds.delete(clip.id) : this._selectedIds.add(clip.id);
      } else if (!this._selectedIds.has(clip.id)) {
        this._selectedIds.clear();
        this._selectedIds.add(clip.id);
      }
      this._selectionPrimaryId = this._selectedIds.has(clip.id)
        ? clip.id
        : (this._selectedIds.values().next().value ?? null);
      // Don't start a drag from a toggle-off click
      if (additive && !this._selectedIds.has(clip.id)) {
        this._dragClip = null;
      } else {
        this._dragClip = clip;
        this._dragOriginX = pos.x;
        this._dragOriginStart = clip.start;
        this._dragOriginDur = clip.duration;
        this._dragMode = this._hitResizeRight(clip, pos.x) ? 'resize-right' : this._hitResizeLeft(clip, pos.x) ? 'resize-left' : 'move';
        this._dragBeforeSnapshot = JSON.stringify(this.project.toDict());
        this._groupDragOrigins = new Map();
        if (this._selectedIds.size > 1 && this._selectedIds.has(clip.id)) {
          for (const id of this._selectedIds) {
            const c = this.project.clips.find(item => item.id === id);
            if (c) this._groupDragOrigins.set(id, { start: c.start, layer: c.layer ?? 0 });
          }
        }
      }
      this._el.dispatchEvent(new CustomEvent('timeline:selectionchanged', {
        bubbles: true, detail: { selectedIds: Array.from(this._selectedIds), primaryId: this._selectionPrimaryId }
      }));
    } else {
      // #67a: drag on empty track area = marquee multi-select.
      // Panning stays available via Alt+drag / middle mouse / wheel / slider.
      this._dragClip = null;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) {
        this._selectedIds.clear();
        this._selectionPrimaryId = null;
        this._el.dispatchEvent(new CustomEvent('timeline:deselect', { bubbles: true }));
      }
      this._marquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, additive };
      this._el.style.cursor = 'crosshair';
    }
    this.redraw();
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);
    if (this._panning && (e.buttons & (1 | 4))) {
      const dx = e.clientX - this._panOriginX;
      this._panOffsetPx = Math.max(0, Math.min(this._maxPan(), this._panOriginOff - dx));
      this.redraw();
      return;
    }
    if (this._scrubPlayhead && (e.buttons & 1)) { this._emitSeek(Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration))); return; }
    if (this._marquee && (e.buttons & 1)) {
      this._marquee.x1 = pos.x;
      this._marquee.y1 = pos.y;
      this.redraw();
      return;
    }
    if (!(e.buttons & 1)) {
      // mousemove is window-wide now, so only bother computing hover state
      // (cursor, clip-under-pointer) while the pointer is actually over the
      // canvas; elsewhere there's nothing to hover.
      if (pos.x >= 0 && pos.x <= this._el.width && pos.y >= 0 && pos.y <= this._el.height) this._updateCursor(pos);
      else this._el.style.cursor = 'default';
      return;
    }
    if (!this._dragClip) return;

    const dxSec = (pos.x - this._dragOriginX) / this._pxPerSec();
    if (this._dragMode === 'move') {
      let newStart = Math.max(0, this._dragOriginStart + dxSec);
      newStart = this._snapPoint(newStart);
      const roundedStart = Math.round(newStart * 1000) / 1000;
      const offset = roundedStart - this._dragOriginStart;

      const subH = this._subLayerH();
      const contentY = this._toContentY(pos.y);
      const rawLayer = Math.floor((contentY - HEADER_H) / subH);

      // #71 — one shared stack of rows now, so dragging above row 0 (or back
      // down) shifts every other clip, not just ones of the same kind.
      const draggedIds = (this._groupDragOrigins && this._groupDragOrigins.size > 1)
        ? new Set(this._groupDragOrigins.keys())
        : new Set([this._dragClip.id]);

      if (rawLayer < 0) {
        if (!this._insertedTopLayer) {
          for (const c of this.project.clips) {
            if (!draggedIds.has(c.id)) c.layer = (c.layer ?? 0) + 1;
          }
          this._insertedTopLayer = true;
        }
      } else if (this._insertedTopLayer) {
        for (const c of this.project.clips) {
          if (!draggedIds.has(c.id)) c.layer = Math.max(0, (c.layer ?? 0) - 1);
        }
        this._insertedTopLayer = false;
      }

      const maxLayer = this._layerCount(); // recompute — shift changed it
      const newLayer = Math.max(0, Math.min(maxLayer, rawLayer));
      const layerDelta = newLayer - (this._dragClip.layer ?? 0);

      if (this._groupDragOrigins && this._groupDragOrigins.size > 1) {
        for (const [id, origin] of this._groupDragOrigins.entries()) {
          const clip = this.project.clips.find(c => c.id === id);
          if (!clip) continue;
          clip.start = Math.max(0, Math.round((origin.start + offset) * 1000) / 1000);
          // #71 — any clip type can share any row now, so the whole
          // multi-selection shifts layers together, not just same-kind clips.
          clip.layer = Math.max(0, Math.min(this._layerCount(), (origin.layer ?? 0) + layerDelta));
        }
      } else {
        this._dragClip.start = roundedStart;
        this._dragClip.layer = newLayer;
      }
      this._el.style.cursor = 'grabbing';
    } else if (this._dragMode === 'resize-right') {
      let newEnd = this._dragOriginStart + this._dragOriginDur + dxSec;
      newEnd = this._snapPoint(newEnd);
      this._dragClip.duration = Math.round(Math.max(MIN_DUR_SEC, newEnd - this._dragOriginStart) * 1000) / 1000;
      this._el.style.cursor = 'ew-resize';
    } else if (this._dragMode === 'resize-left') {
      let newStart = Math.max(0, this._dragOriginStart + dxSec);
      newStart = this._snapPoint(newStart);
      const newDur = (this._dragOriginStart + this._dragOriginDur) - newStart;
      if (newDur >= MIN_DUR_SEC) { this._dragClip.start = Math.round(newStart * 1000) / 1000; this._dragClip.duration = Math.round(newDur * 1000) / 1000; }
      this._el.style.cursor = 'ew-resize';
    }
    this.redraw();
    this._el.dispatchEvent(new CustomEvent('timeline:clipchanged', { bubbles: true }));
  }

  _snapPoint(t) {
    const THRESH_PX = 8;
    const threshSec = THRESH_PX / this._pxPerSec();
    let best = t, bestDist = threshSec;
    const candidates = [0, this.playhead];
    for (const c of this.project.clips) {
      if (c === this._dragClip) continue;
      candidates.push(c.start, c.end());
    }
    for (const cand of candidates) {
      const d = Math.abs(t - cand);
      if (d < bestDist) { bestDist = d; best = cand; }
    }
    return best;
  }

  _onMouseUp(_e) {
    if (this._panning) { this._panning = false; this._el.style.cursor = 'default'; return; }
    if (this._scrubPlayhead) { this._scrubPlayhead = false; return; }
    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      this._el.style.cursor = 'default';
      const mx0 = Math.min(m.x0, m.x1), mx1 = Math.max(m.x0, m.x1);
      const my0 = this._toContentY(Math.min(m.y0, m.y1)), my1 = this._toContentY(Math.max(m.y0, m.y1));
      if (mx1 - mx0 > 3 || my1 - my0 > 3) {
        for (const clip of this.project.clips) {
          const cr = this._clipRect(clip);
          const hit = cr.x < mx1 && cr.x + cr.w > mx0 && cr.y < my1 && cr.y + cr.h > my0;
          if (!hit) continue;
          if (m.additive && this._selectedIds.has(clip.id)) this._selectedIds.delete(clip.id);
          else this._selectedIds.add(clip.id);
        }
        this._selectionPrimaryId = this._selectedIds.values().next().value ?? null;
        this._el.dispatchEvent(new CustomEvent('timeline:selectionchanged', {
          bubbles: true,
          detail: { selectedIds: Array.from(this._selectedIds), primaryId: this._selectionPrimaryId }
        }));
      }
      this.redraw();
      return;
    }
    if (this._dragClip) {
      this._reflowLayers();
      if (this._dragBeforeSnapshot) {
        this._el.dispatchEvent(new CustomEvent('timeline:committed', { bubbles: true, detail: { before: this._dragBeforeSnapshot } }));
      }
      this._dragBeforeSnapshot = null;
      this._groupDragOrigins = null;
      this._insertedTopLayer = false;

      this._dragClip = null; this._dragMode = ''; this._el.style.cursor = 'default';
      this.resize();
      this._el.dispatchEvent(new CustomEvent('timeline:clipchanged', { bubbles: true }));
    }
  }

  _onDblClick(e) {
    const pos = this._getPos(e), clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedIds.clear();
      this._selectedIds.add(clip.id);
      this._selectionPrimaryId = clip.id;
      this.redraw();
      this._el.dispatchEvent(new CustomEvent('timeline:selectionchanged', {
        bubbles: true, detail: { selectedIds: Array.from(this._selectedIds), primaryId: clip.id }
      }));
    }
  }

  _onWheel(e) {
    e.preventDefault();
    if (!e.shiftKey) {
      this._scrollY += e.deltaY;
      this._clampScrollY();
      this.redraw();
      return;
    }
    const pos = this._getPos(e), tAtCursor = this._pxToSec(pos.x);
    this._zoom = e.deltaY < 0 ? Math.min(this._zoom * 1.25, 32) : Math.max(this._zoom / 1.25, 1);
    this._panOffsetPx = this._pxPerSec() * tAtCursor - (pos.x - LABEL_W);
    this._clampPan();
    this.redraw();
  }

  _sliceClip(clip, px) {
    const sliceT = this._pxToSec(px);
    if (sliceT <= clip.start + MIN_DUR_SEC || sliceT >= clip.start + clip.duration - MIN_DUR_SEC) return;
    const rightDur = clip.start + clip.duration - sliceT;
    const rightSourceStart = (clip.source_start ?? 0) + (sliceT - clip.start);
    clip.duration = Math.round((sliceT - clip.start) * 1000) / 1000;
    this._el.dispatchEvent(new CustomEvent('timeline:slice', {
      bubbles: true,
      detail: {
        sourceId: clip.id, sliceAt: sliceT, rightStart: sliceT,
        rightDur: Math.round(rightDur * 1000) / 1000,
        rightSourceStart: Math.round(rightSourceStart * 1000) / 1000,
        track: clip.track, clip_type: clip.clip_type
      }
    }));
    this.redraw();
  }
}