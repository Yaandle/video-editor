// timeline.js — HTML5 Canvas port of TimelineWidget
import { TRACK_COLOURS } from './app.js';

const TRACKS   = ['audio', 'text', 'visual'];
const TRACK_H  = 38;
const HEADER_H = 24;
const LABEL_W  = 60;
const MIN_CLIP_PX = 8;
const RESIZE_ZONE = 8;

export class TimelineWidget {
  constructor(canvasEl, project) {
    this._el      = canvasEl;
    this._ctx     = canvasEl.getContext('2d');
    this.project  = project;
    this.playhead = 0.0;
    this._selectedId    = null;
    this._dragClip      = null;
    this._dragMode      = '';      // 'move' | 'resize'
    this._dragOriginX   = 0;
    this._dragOriginStart = 0.0;
    this._dragOriginDur   = 0.0;
    this._scrubbing     = false;

    this._bindEvents();
    this.resize();
  }

  // ── Public API ──
  setProject(p)     { this.project = p; this.redraw(); }
  setPlayhead(t)    { this.playhead = t; this.redraw(); }
  setSelectedId(id) { this._selectedId = id; this.redraw(); }
  redraw()          { this._paint(); }

  resize() {
    const container = this._el.parentElement;
    const totalH = HEADER_H + TRACKS.length * TRACK_H + 4;
    container.style.height = totalH + 'px';
    this._el.width  = container.clientWidth;
    this._el.height = totalH;
    this._el.style.height = totalH + 'px';
    this.redraw();
  }

  // ── Geometry ──
  _pxPerSec() {
    const usable = this._el.width - LABEL_W;
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

  // ── Painting ──
  _paint() {
    const ctx = this._ctx;
    const W   = this._el.width;
    const H   = this._el.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, W, H);

    this._drawRuler(ctx, W);
    this._drawTrackLabels(ctx, W);
    this._drawClips(ctx, W);
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

    ctx.font      = '8px Consolas, monospace';
    const pps = this._pxPerSec();
    let interval = 1;
    for (const iv of [1, 2, 5, 10, 15, 30, 60]) {
      interval = iv;
      if (pps * iv >= 40) break;
    }

    let t = 0;
    while (t <= this.project.duration + interval) {
      const x = this._secToPx(t);
      ctx.strokeStyle = '#464646';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, HEADER_H - 8); ctx.lineTo(x + 0.5, HEADER_H); ctx.stroke();
      ctx.fillStyle = '#787878';
      const mins  = Math.floor(t / 60);
      const secs  = Math.floor(t % 60);
      const label = mins ? `${mins}:${String(secs).padStart(2,'0')}` : `${secs}s`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x + 2, HEADER_H - 2);
      t += interval;
    }
  }

  _drawTrackLabels(ctx, W) {
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    for (const track of TRACKS) {
      const y = this._trackY(track);
      ctx.fillStyle = '#161616';
      ctx.fillRect(0, y, LABEL_W, TRACK_H);

      // Track separator
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
      const bg  = col.bg     ?? '#282828';
      const brd = col.border ?? '#505050';
      const txt = col.text   ?? '#c8c8c8';

      ctx.fillStyle = bg;
      ctx.fillRect(cr.x, cr.y, cr.w, cr.h);

      ctx.strokeStyle = brd;
      ctx.lineWidth   = clip.id === this._selectedId ? 1.5 : 0.5;
      ctx.strokeRect(cr.x + 0.5, cr.y + 0.5, cr.w, cr.h);

      // Resize handle zone
      const handleX = cr.x + cr.w - RESIZE_ZONE;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(handleX, cr.y, RESIZE_ZONE, cr.h);

      // Label
      ctx.fillStyle    = txt;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.rect(cr.x + 4, cr.y, cr.w - 16, cr.h);
      ctx.clip();
      ctx.fillText(clip.label(), cr.x + 4, cr.y + cr.h / 2);
      ctx.restore();
    }
  }

  _drawPlayhead(ctx, H) {
    const x = this._secToPx(this.playhead);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();

    // Triangle head
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  // ── Mouse ──
  _bindEvents() {
    const el = this._el;
    el.addEventListener('mousedown',  (e) => this._onMouseDown(e));
    el.addEventListener('mousemove',  (e) => this._onMouseMove(e));
    el.addEventListener('mouseup',    (e) => this._onMouseUp(e));
    el.addEventListener('mouseleave', (e) => this._onMouseUp(e));
    el.addEventListener('dblclick',   (e) => this._onDblClick(e));
  }

  _getPos(e) {
    const rect = this._el.getBoundingClientRect();
    return { x: e.clientX - rect.left | 0, y: e.clientY - rect.top | 0 };
  }

  _clipAt(px, py) {
    for (let i = this.project.clips.length - 1; i >= 0; i--) {
      const clip = this.project.clips[i];
      const cr = this._clipRect(clip);
      if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) {
        return clip;
      }
    }
    return null;
  }

  _inResizeZone(clip, px) {
    const cr = this._clipRect(clip);
    return px >= cr.x + cr.w - RESIZE_ZONE;
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos = this._getPos(e);

    // Ruler click → scrub
    if (pos.y < HEADER_H) {
      this._scrubbing = true;
      const t = Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration));
      this.playhead = t;
      this.redraw();
      this._el.dispatchEvent(new CustomEvent('timeline:playheadmoved', { bubbles: true, detail: { t } }));
      return;
    }

    const clip = this._clipAt(pos.x, pos.y);
    if (clip) {
      this._selectedId      = clip.id;
      this._dragClip        = clip;
      this._dragOriginX     = pos.x;
      this._dragOriginStart = clip.start;
      this._dragOriginDur   = clip.duration;
      this._dragMode        = this._inResizeZone(clip, pos.x) ? 'resize' : 'move';
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

    // Scrubbing playhead
    if (this._scrubbing && (e.buttons & 1)) {
      const t = Math.max(0, Math.min(this._pxToSec(pos.x), this.project.duration));
      this.playhead = t;
      this.redraw();
      this._el.dispatchEvent(new CustomEvent('timeline:playheadmoved', { bubbles: true, detail: { t } }));
      return;
    }

    // Cursor hint
    if (!this._dragClip) {
      const clip = this._clipAt(pos.x, pos.y);
      if (clip && this._inResizeZone(clip, pos.x)) {
        this._el.style.cursor = 'ew-resize';
      } else if (clip) {
        this._el.style.cursor = 'grab';
      } else {
        this._el.style.cursor = 'default';
      }
    }

    if (!(e.buttons & 1) || !this._dragClip) return;

    const dxSec = (pos.x - this._dragOriginX) / this._pxPerSec();
    if (this._dragMode === 'move') {
      this._dragClip.start = Math.round(Math.max(0, this._dragOriginStart + dxSec) * 1000) / 1000;
    } else if (this._dragMode === 'resize') {
      this._dragClip.duration = Math.round(Math.max(0.5, this._dragOriginDur + dxSec) * 1000) / 1000;
    }
    this._el.style.cursor = this._dragMode === 'resize' ? 'ew-resize' : 'grabbing';
    this.redraw();
    this._el.dispatchEvent(new CustomEvent('timeline:clipchanged', { bubbles: true }));
  }

  _onMouseUp(_e) {
    if (this._scrubbing) { this._scrubbing = false; return; }
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
}
