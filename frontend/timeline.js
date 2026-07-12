import { TRACK_COLOURS } from './app.js';

const TRACKS = ['audio', 'text', 'visual'];
const HEADER_H = 24;
const LABEL_W = 60;
const MIN_CLIP_PX = 8;
const RESIZE_ZONE = 10;
const MIN_DUR_SEC = 0.1;
const MIN_TRACK_H = 38;

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
    this._selectedId = null;
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
    this._bindEvents();
    this.resize();
  }

  setProject(p) { this.project = p; this._reflowLayers(); this.redraw(); }
  setPlayhead(t) { this.playhead = t; this.redraw(); }
  setSelectedId(id) { this.setSelectedIds(id ? [id] : []); }
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
    const layerTotal = TRACKS.reduce((s, t) => s + this._trackLayerCount(t), 0);
    const minH = HEADER_H + layerTotal * MIN_TRACK_H + 4;
    const totalH = manualH != null ? Math.max(minH, manualH) : (this._manualH ?? minH);
    if (manualH != null) this._manualH = totalH;
    container.style.height = totalH + 'px';
    this._el.width = container.clientWidth;
    this._el.height = totalH;
    this._el.style.height = totalH + 'px';
    this.redraw();
  }

  _pxPerSec() { return ((this._el.width - LABEL_W) * this._zoom) / Math.max(this.project.duration, 1.0); }
  _secToPx(t) { return LABEL_W + (t * this._pxPerSec()) - this._panOffsetPx | 0; }
  _pxToSec(px) { return Math.max(0, (px - LABEL_W + this._panOffsetPx) / this._pxPerSec()); }
  _trackLayerCount(track) {
    let max = 0;
    for (const c of this.project.clips) if (c.track === track) max = Math.max(max, (c.layer ?? 0) + 1);
    return Math.max(1, max);
  }

  _subLayerH() {
    const totalLayers = TRACKS.reduce((s, t) => s + this._trackLayerCount(t), 0);
    return Math.max(MIN_TRACK_H, (this._el.height - HEADER_H - 4) / totalLayers);
  }

  _trackHeightPx(track) { return this._trackLayerCount(track) * this._subLayerH(); }

  _trackY(track) {
    let y = HEADER_H;
    for (const t of TRACKS) { if (t === track) return y; y += this._trackHeightPx(t); }
    return y;
  }

  _reflowLayers() {
    for (const track of TRACKS) {
      const clips = this.project.clips.filter(c => c.track === track).sort((a, b) => a.start - b.start);
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
  }

  _clipRect(clip) {
    const subH = this._subLayerH();
    return {
      x: this._secToPx(clip.start),
      w: Math.max(MIN_CLIP_PX, (clip.duration * this._pxPerSec()) | 0),
      y: this._trackY(clip.track) + (clip.layer ?? 0) * subH,
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
    };
  }

  _paint() {
    const ctx = this._ctx, W = this._el.width, H = this._el.height;
    this._colors = this._themeColors();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this._colors.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, 0, W - LABEL_W, H); ctx.clip(); this._drawRuler(ctx, W); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, HEADER_H, W - LABEL_W, H - HEADER_H); ctx.clip();
    this._drawClips(ctx);
    this._drawLayerDividers(ctx);
    ctx.restore();
    this._drawTrackLabels(ctx, W);
    this._drawPlayhead(ctx, H);
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

  _drawTrackLabels(ctx, W) {
    const c = this._colors;
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    for (const track of TRACKS) {
      const y = this._trackY(track);
      const trackH = this._trackHeightPx(track);
      ctx.fillStyle = c.labelBg; ctx.fillRect(0, y, LABEL_W, trackH);
      ctx.strokeStyle = c.labelBorder; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + trackH - 0.5); ctx.lineTo(W, y + trackH - 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(LABEL_W + 0.5, y); ctx.lineTo(LABEL_W + 0.5, y + trackH); ctx.stroke();
      const col = TRACK_COLOURS[track] ?? {};
      ctx.fillStyle = col.text ?? c.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(track.toUpperCase(), LABEL_W / 2, y + trackH / 2);
    }
  }

  _drawClips(ctx) {
    const c = this._colors;
    ctx.font = '8px Consolas, monospace';
    for (const clip of this.project.clips) {
      const cr = this._clipRect(clip), col = TRACK_COLOURS[clip.track] ?? {}, isSelected = this._selectedIds.has(clip.id);
      ctx.fillStyle = col.bg ?? c.clipBg; ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
      ctx.strokeStyle = isSelected ? (col.border ?? c.text) : (col.border ? col.border + '99' : c.clipBorder);
      ctx.lineWidth = isSelected ? 1.5 : 0.5;
      ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w - 1, cr.h - 1);
      if (clip.clip_type === 'audio') this._drawWaveform(ctx, clip, cr);
      ctx.fillStyle = c.overlay; ctx.fillRect(cr.x, cr.y, RESIZE_ZONE, cr.h);
      ctx.fillStyle = c.overlayStrong; ctx.fillRect(cr.x + cr.w - RESIZE_ZONE, cr.y, RESIZE_ZONE, cr.h);
      ctx.fillStyle = col.text ?? c.clipText; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.beginPath(); ctx.rect(cr.x + RESIZE_ZONE, cr.y + 1, Math.max(0, cr.w - RESIZE_ZONE * 2), cr.h - 2); ctx.clip();
      ctx.fillText(clip.label(), cr.x + RESIZE_ZONE + 2, cr.y + cr.h / 2); ctx.restore();
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

  _drawLayerDividers(ctx) {
    ctx.strokeStyle = this._colors.divider; ctx.lineWidth = 0.5;
    for (const track of TRACKS) {
      const count = this._trackLayerCount(track);
      if (count <= 1) continue;
      const top = this._trackY(track), subH = this._subLayerH();
      for (let i = 1; i < count; i++) {
        const y = top + i * subH;
        ctx.beginPath(); ctx.moveTo(LABEL_W, y - 0.5); ctx.lineTo(this._el.width, y - 0.5); ctx.stroke();
      }
    }
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
    for (let i = this.project.clips.length - 1; i >= 0; i--) {
      const clip = this.project.clips[i], cr = this._clipRect(clip);
      if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) return clip;
    }
    return null;
  }

  _hitResizeRight(clip, px) { const cr = this._clipRect(clip); return px >= cr.x + cr.w - RESIZE_ZONE && px <= cr.x + cr.w; }
  _hitResizeLeft(clip, px) { const cr = this._clipRect(clip); return px >= cr.x && px <= cr.x + RESIZE_ZONE; }
  _hitPlayheadTriangle(px, py) { return py <= HEADER_H + 10 && Math.abs(px - this._secToPx(this.playhead)) <= 8; }

  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown', e => this._onMouseDown(e));
    el.addEventListener('mousemove', e => this._onMouseMove(e));
    el.addEventListener('mouseup', e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
    el.addEventListener('dblclick', e => this._onDblClick(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });
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
    if (pos.y < HEADER_H || this._hitPlayheadTriangle(pos.x, pos.y)) {
      this._scrubPlayhead = true; this._emitSeek(Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration))); return;
    }
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      if (e.shiftKey) {
        this._selectedIds.has(clip.id) ? this._selectedIds.delete(clip.id) : this._selectedIds.add(clip.id);
      } else if (!this._selectedIds.has(clip.id)) {
        this._selectedIds.clear();
        this._selectedIds.add(clip.id);
      }
      this._selectionPrimaryId = clip.id;
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
          if (c) this._groupDragOrigins.set(id, { start: c.start, layer: c.layer });
        }
      }
      this._el.dispatchEvent(new CustomEvent('timeline:selectionchanged', {
        bubbles: true, detail: { selectedIds: Array.from(this._selectedIds), primaryId: clip.id }
      }));
    } else {
      this._selectedIds.clear();
      this._selectionPrimaryId = null;
      this._selectedId = null; this._dragClip = null; this._panning = true; this._panOriginX = e.clientX; this._panOriginOff = this._panOffsetPx;
      this._el.style.cursor = 'grabbing'; this._el.dispatchEvent(new CustomEvent('timeline:deselect', { bubbles: true }));
    }
    this.redraw();
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);
    if (this._panning && (e.buttons & (1 | 4))) {
      const dx = e.clientX - this._panOriginX;
      this._panOffsetPx = Math.max(0, Math.min(this._maxPan(), this._panOriginOff - dx));
      this.redraw();
      this._el.dispatchEvent(new CustomEvent('timeline:panchanged', { bubbles: true, detail: this.getPanRange() }));
      return;
    }
    if (this._scrubPlayhead && (e.buttons & 1)) { this._emitSeek(Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration))); return; }
    if (!(e.buttons & 1)) { this._updateCursor(pos); return; }
    if (!this._dragClip) return;

    const dxSec = (pos.x - this._dragOriginX) / this._pxPerSec();
    if (this._dragMode === 'move') {
      let newStart = Math.max(0, this._dragOriginStart + dxSec);
      newStart = this._snapPoint(newStart);
      const roundedStart = Math.round(newStart * 1000) / 1000;
      const offset = roundedStart - this._dragOriginStart;

      const subH = this._subLayerH();
      const trackTop = this._trackY(this._dragClip.track);
      const rawLayer = Math.floor((pos.y - trackTop) / subH);
      const maxLayer = this._trackLayerCount(this._dragClip.track);
      const newLayer = Math.max(0, Math.min(maxLayer, rawLayer));
      const layerDelta = newLayer - this._dragClip.layer;

      if (this._groupDragOrigins && this._groupDragOrigins.size > 1) {
        for (const [id, origin] of this._groupDragOrigins.entries()) {
          const clip = this.project.clips.find(c => c.id === id);
          if (!clip) continue;
          clip.start = Math.max(0, Math.round((origin.start + offset) * 1000) / 1000);
          clip.layer = Math.max(0, Math.min(this._trackLayerCount(clip.track), origin.layer + layerDelta));
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
    if (this._dragClip) {
      this._reflowLayers();
      if (this._dragBeforeSnapshot) {
        this._el.dispatchEvent(new CustomEvent('timeline:committed', { bubbles: true, detail: { before: this._dragBeforeSnapshot } }));
      }
      this._dragBeforeSnapshot = null;
      this._groupDragOrigins = null;
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
    const pos = this._getPos(e), tAtCursor = this._pxToSec(pos.x);
    this._zoom = e.deltaY < 0 ? Math.min(this._zoom * 1.25, 32) : Math.max(this._zoom / 1.25, 1);
    this._panOffsetPx = this._pxPerSec() * tAtCursor - (pos.x - LABEL_W);
    this._clampPan();
    this.redraw();
  }

  setPanOffset(px) { this._panOffsetPx = Math.max(0, Math.min(this._maxPan(), px)); this.redraw(); }
  getPanRange() { return { offset: this._panOffsetPx, max: this._maxPan() }; }

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