// timeline.js — HTML5 Canvas timeline with resize, scrub, razor, zoom
import { TRACK_COLOURS } from './app.js';

const TRACKS      = ['audio', 'text', 'visual'];
const TRACK_H     = 38;
const HEADER_H    = 24;
const LABEL_W     = 60;
const MIN_CLIP_PX = 8;
const RESIZE_ZONE = 10;   // px from right edge that counts as resize handle
const MIN_DUR_SEC = 0.1;  // minimum clip duration after resize

export class TimelineWidget {
  constructor(canvasEl, project) {
    this._el      = canvasEl;
    this._ctx     = canvasEl.getContext('2d');
    this.project  = project;
    this.playhead = 0.0;
    this._zoom    = 1.0;   // 1 = fit-to-width, >1 = zoomed in

    this._selectedId      = null;
    this._dragClip        = null;
    this._dragMode        = '';       // 'move' | 'resize-right' | 'resize-left'
    this._dragOriginX     = 0;
    this._dragOriginStart = 0.0;
    this._dragOriginDur   = 0.0;

    this._scrubbing       = false;    // dragging playhead
    this._scrubPlayhead   = false;    // mousedown on the playhead triangle

    this.tool = 'select';             // 'select' | 'razor'

    this._bindEvents();
    this.resize();
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  setProject(p)     { this.project = p; this.redraw(); }
  setPlayhead(t)    { this.playhead = t; this.redraw(); }
  setSelectedId(id) { this._selectedId = id; this.redraw(); }
  setTool(name)     { this.tool = name; this._updateCursor(null); }
  redraw()          { this._paint(); }

  zoomIn()  { this._zoom = Math.min(this._zoom * 1.25, 32); this.redraw(); }
  zoomOut() { this._zoom = Math.max(this._zoom / 1.25, 1);  this.redraw(); }
  zoomReset(){ this._zoom = 1; this.redraw(); }

  resize() {
    const container = this._el.parentElement;
    const totalH = HEADER_H + TRACKS.length * TRACK_H + 4;
    container.style.height = totalH + 'px';
    this._el.width  = container.clientWidth;
    this._el.height = totalH;
    this._el.style.height = totalH + 'px';
    this.redraw();
  }

  // ── Geometry ────────────────────────────────────────────────────────────────
  _pxPerSec() {
    const usable = (this._el.width - LABEL_W) * this._zoom;
    return usable / Math.max(this.project.duration, 1.0);
  }

  _secToPx(t) {
    return LABEL_W + (t * this._pxPerSec()) | 0;
  }

  _pxToSec(px) {
    return Math.max(0, (px - LABEL_W) / this._pxPerSec());
  }

  _trackY(track) {
    return HEADER_H + TRACKS.indexOf(track) * TRACK_H;
  }

  _clipRect(clip) {
    const x = this._secToPx(clip.start);
    const w = Math.max(MIN_CLIP_PX, (clip.duration * this._pxPerSec()) | 0);
    const y = this._trackY(clip.track);
    return { x, y, w, h: TRACK_H - 2 };
  }

  // ── Painting ────────────────────────────────────────────────────────────────
  _paint() {
    const ctx = this._ctx;
    const W   = this._el.width;
    const H   = this._el.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, W, H);

    this._drawRuler(ctx, W);
    this._drawTrackLabels(ctx, W);
    this._drawClips(ctx);
    this._drawPlayhead(ctx, H);
  }

  _drawRuler(ctx, W) {
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(LABEL_W, 0, W - LABEL_W, HEADER_H);
    ctx.strokeStyle = '#505050';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_W, HEADER_H - 0.5);
    ctx.lineTo(W, HEADER_H - 0.5);
    ctx.stroke();

    ctx.font = '8px Consolas, monospace';
    const pps = this._pxPerSec();
    let interval = 1;
    for (const iv of [0.5, 1, 2, 5, 10, 15, 30, 60]) {
      interval = iv;
      if (pps * iv >= 40) break;
    }

    let t = 0;
    while (t <= this.project.duration + interval) {
      const x = this._secToPx(t);
      if (x > W) break;
      ctx.strokeStyle = '#464646';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, HEADER_H - 8); ctx.lineTo(x + 0.5, HEADER_H); ctx.stroke();
      ctx.fillStyle    = '#787878';
      const mins  = Math.floor(t / 60);
      const secs  = Math.floor(t % 60);
      const label = mins ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x + 2, HEADER_H - 2);
      t = Math.round((t + interval) * 1000) / 1000;
    }
  }

  _drawTrackLabels(ctx, W) {
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    for (const track of TRACKS) {
      const y = this._trackY(track);
      ctx.fillStyle = '#161616';
      ctx.fillRect(0, y, LABEL_W, TRACK_H);

      ctx.strokeStyle = '#373737';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_H - 0.5); ctx.lineTo(W, y + TRACK_H - 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(LABEL_W + 0.5, y); ctx.lineTo(LABEL_W + 0.5, y + TRACK_H); ctx.stroke();

      const col = TRACK_COLOURS[track] ?? {};
      ctx.fillStyle    = col.text ?? '#b4b4b4';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(track.toUpperCase(), LABEL_W / 2, y + TRACK_H / 2);
    }
  }

  _drawClips(ctx) {
    ctx.font = '8px Consolas, monospace';
    for (const clip of this.project.clips) {
      const cr  = this._clipRect(clip);
      const col = TRACK_COLOURS[clip.track] ?? {};
      const isSelected = clip.id === this._selectedId;

      // Body
      ctx.fillStyle = col.bg ?? '#282828';
      ctx.fillRect(cr.x, cr.y, cr.w, cr.h);

      // Border — brighter when selected
      ctx.strokeStyle = isSelected ? (col.border ?? '#888') : (col.border ? col.border + '99' : '#505050');
      ctx.lineWidth   = isSelected ? 1.5 : 0.5;
      ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w - 1, cr.h - 1);

      // Left resize handle
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(cr.x, cr.y, RESIZE_ZONE, cr.h);

      // Right resize handle
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(cr.x + cr.w - RESIZE_ZONE, cr.y, RESIZE_ZONE, cr.h);

      // Label (clipped)
      ctx.fillStyle    = col.text ?? '#c8c8c8';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.beginPath();
      ctx.rect(cr.x + RESIZE_ZONE, cr.y + 1, Math.max(0, cr.w - RESIZE_ZONE * 2), cr.h - 2);
      ctx.clip();
      ctx.fillText(clip.label(), cr.x + RESIZE_ZONE + 2, cr.y + cr.h / 2);
      ctx.restore();
    }
  }

  _drawPlayhead(ctx, H) {
    const x = this._secToPx(this.playhead);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();

    // Draggable triangle
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x + 6, 0);
    ctx.lineTo(x, 10);
    ctx.closePath();
    ctx.fill();
  }

  // ── Cursor ──────────────────────────────────────────────────────────────────
  _updateCursor(pos) {
    if (this.tool === 'razor') {
      this._el.style.cursor = 'crosshair';
      return;
    }
    if (!pos) { this._el.style.cursor = 'default'; return; }

    // On playhead triangle?
    const phX = this._secToPx(this.playhead);
    if (pos.y <= HEADER_H && Math.abs(pos.x - phX) <= 8) {
      this._el.style.cursor = 'ew-resize';
      return;
    }

    const clip = this._clipAt(pos.x, pos.y);
    if (!clip) { this._el.style.cursor = 'default'; return; }

    const cr = this._clipRect(clip);
    if (pos.x >= cr.x + cr.w - RESIZE_ZONE) {
      this._el.style.cursor = 'ew-resize';
    } else if (pos.x <= cr.x + RESIZE_ZONE) {
      this._el.style.cursor = 'ew-resize';
    } else {
      this._el.style.cursor = 'grab';
    }
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────
  _clipAt(px, py) {
    // Top-most (last in array) clip wins
    for (let i = this.project.clips.length - 1; i >= 0; i--) {
      const clip = this.project.clips[i];
      const cr = this._clipRect(clip);
      if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) {
        return clip;
      }
    }
    return null;
  }

  _hitResizeRight(clip, px) {
    const cr = this._clipRect(clip);
    return px >= cr.x + cr.w - RESIZE_ZONE && px <= cr.x + cr.w;
  }

  _hitResizeLeft(clip, px) {
    const cr = this._clipRect(clip);
    return px >= cr.x && px <= cr.x + RESIZE_ZONE;
  }

  _hitPlayheadTriangle(px, py) {
    const phX = this._secToPx(this.playhead);
    return py <= HEADER_H + 10 && Math.abs(px - phX) <= 8;
  }

  // ── Mouse events ────────────────────────────────────────────────────────────
  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown',  e => this._onMouseDown(e));
    el.addEventListener('mousemove',  e => this._onMouseMove(e));
    el.addEventListener('mouseup',    e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseUp(e));
    el.addEventListener('dblclick',   e => this._onDblClick(e));
    // Zoom via scroll wheel
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: (e.clientX - rect.left) | 0, y: (e.clientY - rect.top) | 0 };
  }

  _emitSeek(t) {
    this.playhead = t;
    this.redraw();
    this._el.dispatchEvent(new CustomEvent('timeline:playheadmoved', { bubbles: true, detail: { t } }));
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos = this._getPos(e);

    // ── Razor tool ──────────────────────────────────────────────────────────
    if (this.tool === 'razor') {
      const clip = this._clipAt(pos.x, pos.y);
      if (clip) this._sliceClip(clip, pos.x);
      return;
    }

    // ── Playhead drag (triangle or ruler) ───────────────────────────────────
    if (pos.y < HEADER_H || this._hitPlayheadTriangle(pos.x, pos.y)) {
      this._scrubPlayhead = true;
      const t = Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration));
      this._emitSeek(t);
      return;
    }

    // ── Clip interaction ────────────────────────────────────────────────────
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedId      = clip.id;
      this._dragClip        = clip;
      this._dragOriginX     = pos.x;
      this._dragOriginStart = clip.start;
      this._dragOriginDur   = clip.duration;

      if (this._hitResizeRight(clip, pos.x)) {
        this._dragMode = 'resize-right';
      } else if (this._hitResizeLeft(clip, pos.x)) {
        this._dragMode = 'resize-left';
      } else {
        this._dragMode = 'move';
      }

      this._el.dispatchEvent(new CustomEvent('timeline:select', { bubbles: true, detail: { id: clip.id } }));
    } else {
      this._selectedId = null;
      this._dragClip   = null;
      this._el.dispatchEvent(new CustomEvent('timeline:deselect', { bubbles: true }));
    }
    this.redraw();
  }

  _onMouseMove(e) {
    const pos = this._getPos(e);

    // Playhead scrub
    if (this._scrubPlayhead && (e.buttons & 1)) {
      const t = Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration));
      this._emitSeek(t);
      return;
    }

    // Cursor hint when idle
    if (!(e.buttons & 1)) {
      this._updateCursor(pos);
      return;
    }

    // Clip drag / resize
    if (!this._dragClip) return;

    const dxSec = (pos.x - this._dragOriginX) / this._pxPerSec();

    if (this._dragMode === 'move') {
      this._dragClip.start = Math.round(
        Math.max(0, this._dragOriginStart + dxSec) * 1000
      ) / 1000;
      this._el.style.cursor = 'grabbing';

    } else if (this._dragMode === 'resize-right') {
      // Drag right edge → changes duration
      this._dragClip.duration = Math.round(
        Math.max(MIN_DUR_SEC, this._dragOriginDur + dxSec) * 1000
      ) / 1000;
      this._el.style.cursor = 'ew-resize';

    } else if (this._dragMode === 'resize-left') {
      // Drag left edge → moves start, adjusts duration to keep end fixed
      const newStart = Math.max(0, this._dragOriginStart + dxSec);
      const origEnd  = this._dragOriginStart + this._dragOriginDur;
      const newDur   = origEnd - newStart;
      if (newDur >= MIN_DUR_SEC) {
        this._dragClip.start    = Math.round(newStart * 1000) / 1000;
        this._dragClip.duration = Math.round(newDur  * 1000) / 1000;
      }
      this._el.style.cursor = 'ew-resize';
    }

    this.redraw();
    this._el.dispatchEvent(new CustomEvent('timeline:clipchanged', { bubbles: true }));
  }

  _onMouseUp(_e) {
    if (this._scrubPlayhead) { this._scrubPlayhead = false; return; }
    if (this._dragClip) {
      this._dragClip = null;
      this._dragMode = '';
      this._el.style.cursor = 'default';
      this._el.dispatchEvent(new CustomEvent('timeline:clipchanged', { bubbles: true }));
    }
  }

  _onDblClick(e) {
    const pos  = this._getPos(e);
    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedId = clip.id;
      this.redraw();
      this._el.dispatchEvent(new CustomEvent('timeline:select', { bubbles: true, detail: { id: clip.id } }));
    }
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.deltaY < 0) this.zoomIn();
    else              this.zoomOut();
  }

  // ── Razor / slice ────────────────────────────────────────────────────────────
  _sliceClip(clip, px) {
    const sliceT = this._pxToSec(px);

    // Must be inside the clip with room on both sides
    if (sliceT <= clip.start + MIN_DUR_SEC) return;
    if (sliceT >= clip.start + clip.duration - MIN_DUR_SEC) return;

    // Build the right half first (reuses same clip object as left half)
    const rightDur   = clip.start + clip.duration - sliceT;
    const origDur    = clip.duration;

    // Mutate the existing clip to become the left half
    clip.duration = Math.round((sliceT - clip.start) * 1000) / 1000;

    // Import genId from the event dispatch side — we raise an event instead
    // and let App create the new clip to keep models in one place
    this._el.dispatchEvent(new CustomEvent('timeline:slice', {
      bubbles: true,
      detail: {
        sourceId:  clip.id,
        sliceAt:   sliceT,
        rightStart: sliceT,
        rightDur:   Math.round(rightDur * 1000) / 1000,
        track:     clip.track,
        clip_type: clip.clip_type,
      }
    }));

    this.redraw();
  }
}