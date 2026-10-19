// canvas.js — the stage. The picture comes from renderer.renderFrame(), the
// same call the export makes; this widget only adds editing overlays: selection
// frames and handles, snapping guides (column grid, centre lines, other
// elements), crop edges and motion-path stops. Hit-testing uses the renderer's
// per-frame box report, so what you click is exactly what was drawn.

import { layoutGrid, color } from './renderer/tokens.js';
import { layoutFrame } from './renderer/core.js';

const HANDLE = 10;
const SNAP_PX = 8;

export class StageWidget {
  constructor(canvasEl, app) {
    this.el = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.app = app;
    this.renderer = null;
    this.t = 0;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.showGrid = false; this.showSafe = false;
    this.tool = 'select';
    this.selected = new Set();
    this.primary = null;
    this.pendingZoom = 1;
    this.report = null;
    this.guides = [];
    this._drag = null;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvasEl.parentElement);
  }

  setRenderer(r) { this.renderer = r; this.redraw(); }
  setSelection(ids, primary) { this.selected = new Set(ids); this.primary = primary ?? [...this.selected][0] ?? null; this.redraw(); }
  setTool(t) {
    this.tool = t;
    this.el.style.cursor = t === 'motion' || t === 'crop' ? 'crosshair' : 'default';
    this.redraw();
  }
  fit() { this.zoom = 1; this.panX = 0; this.panY = 0; this.redraw(); }

  resize() {
    const p = this.el.parentElement;
    this.dpr = window.devicePixelRatio || 1;
    this.W = p.clientWidth; this.H = p.clientHeight;
    this.el.width = Math.round(this.W * this.dpr);
    this.el.height = Math.round(this.H * this.dpr);
    this.redraw();
  }

  get project() { return this.app.project; }

  /** Screen rect of the frame (CSS px), honouring zoom and pan. */
  frameRect() {
    const s = this.project.settings;
    const pad = 36;
    const aw = Math.max(10, this.W - pad * 2), ah = Math.max(10, this.H - pad * 2);
    const k = Math.min(aw / s.width, ah / s.height) * this.zoom;
    const w = s.width * k, h = s.height * k;
    return { x: (this.W - w) / 2 + this.panX, y: (this.H - h) / 2 + this.panY, w, h, k };
  }

  /** Layout px → screen px helpers (layout frame = project dims). */
  _toScreen(r, b) {
    const k = r.w / this.project.settings.width;
    return { x: r.x + b.x * k, y: r.y + b.y * k, w: b.w * k, h: b.h * k };
  }

  /** Union of every box a clip reported this frame. */
  clipBox(id) {
    if (!this.report) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of this.report.boxes) {
      if (b.clipId !== id) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  redraw() {
    if (!this.renderer || !this.W) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const r = this.frameRect();
    // hard shadow + frame border, editor chrome only
    ctx.fillStyle = color('ink');
    ctx.fillRect(r.x + 8, r.y + 8, r.w, r.h);
    try {
      this.report = this.renderer.renderFrame(ctx, this.t, { x: r.x, y: r.y, width: r.w, height: r.h });
      this._renderError = null;
    } catch (e) {
      this._renderError = e.message;
      ctx.fillStyle = color('orange');
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = color('ink');
      ctx.font = '700 14px "Space Mono", monospace';
      ctx.fillText('Render error — see status bar', r.x + 16, r.y + 28);
      this.app.status(e.message, 'error');
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = color('ink');
    ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
    this._overlays(ctx, r);
  }

  _overlays(ctx, r) {
    const s = this.project.settings;
    const k = r.w / s.width;
    const frame = layoutFrame(s, s.width, s.height);
    if (this.showGrid) {
      const g = layoutGrid({ w: frame.w, h: frame.h });
      ctx.fillStyle = 'rgba(35,66,245,0.10)';
      for (let i = 0; i < g.columns; i++) ctx.fillRect(r.x + g.colX(i) * k, r.y, g.colW * k, r.h);
      ctx.fillStyle = 'rgba(35,66,245,0.55)';
      ctx.fillRect(r.x + g.margin * k, r.y, 1, r.h);
      ctx.fillRect(r.x + r.w - g.margin * k, r.y, 1, r.h);
    }
    if (this.showSafe) {
      const g = layoutGrid({ w: frame.w, h: frame.h });
      ctx.strokeStyle = color('orange'); ctx.lineWidth = 2;
      ctx.strokeRect(r.x + g.safe.x * k, r.y + g.safe.y * k, g.safe.w * k, g.safe.h * k);
    }
    for (const gd of this.guides) {
      ctx.fillStyle = color('cobalt');
      if (gd.axis === 'x') ctx.fillRect(r.x + gd.v * k - 1, r.y, 2, r.h);
      else ctx.fillRect(r.x, r.y + gd.v * k - 1, r.w, 2);
    }
    // Selection
    for (const id of this.selected) {
      const lb = this.clipBox(id);
      if (!lb) continue;
      const b = this._toScreen(r, lb);
      const clip = this.project.clips.find((c) => c.id === id);
      const isScene = clip?.kind === 'scene';
      ctx.strokeStyle = color('cobalt');
      ctx.lineWidth = 2;
      if (isScene) {
        ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        continue;
      }
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      if (id === this.primary && this.selected.size === 1 && this.tool === 'select') {
        for (const [hx, hy] of this._corners(b)) {
          ctx.fillStyle = color('white'); ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeStyle = color('ink'); ctx.lineWidth = 2; ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
        }
      }
      if (this.tool === 'crop' && id === this.primary) this._cropOverlay(ctx, b);
    }
    if (this.tool === 'motion') this._motionOverlay(ctx, r);
    if (this._marquee) {
      const m = this._marquee;
      ctx.fillStyle = 'rgba(35,66,245,0.12)';
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeStyle = color('cobalt'); ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
  }

  _corners(b) { return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]; }

  _cropOverlay(ctx, b) {
    ctx.fillStyle = color('orange');
    for (const [x, y, w, h] of [[b.x - 4, b.y + b.h / 2 - 14, 8, 28], [b.x + b.w - 4, b.y + b.h / 2 - 14, 8, 28], [b.x + b.w / 2 - 14, b.y - 4, 28, 8], [b.x + b.w / 2 - 14, b.y + b.h - 4, 28, 8]]) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color('ink'); ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    }
  }

  _motionOverlay(ctx, r) {
    const clip = this.project.clips.find((c) => c.id === this.primary);
    if (!clip || clip.kind === 'scene') return;
    const kf = [...(clip.keyframes ?? [])].sort((a, b) => a.t - b.t);
    ctx.strokeStyle = color('cobalt'); ctx.lineWidth = 3;
    ctx.beginPath();
    kf.forEach((k, i) => { const x = r.x + k.x * r.w, y = r.y + k.y * r.h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.font = '700 11px "Space Mono", monospace';
    kf.forEach((k, i) => {
      const x = r.x + k.x * r.w, y = r.y + k.y * r.h;
      ctx.fillStyle = color('lime'); ctx.fillRect(x - 9, y - 9, 18, 18);
      ctx.strokeStyle = color('ink'); ctx.lineWidth = 2; ctx.strokeRect(x - 9, y - 9, 18, 18);
      ctx.fillStyle = color('ink'); ctx.fillText(String(i + 1), x - 4, y + 4);
    });
  }

  // ── Interaction ────────────────────────────────────────────────────────────
  _pos(e) { const b = this.el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }

  /** Topmost clip under a screen point (lower layer draws on top). */
  hit(px, py) {
    const r = this.frameRect();
    const active = this.project.clips
      .filter((c) => c.start <= this.t && this.t < c.end() && !this.project.isLayerHidden(c.layer) && c.visual)
      .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
    for (const c of active) {
      if (c.kind === 'scene') continue;
      const lb = this.clipBox(c.id);
      if (!lb) continue;
      const b = this._toScreen(r, lb);
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return c;
    }
    const inFrame = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    return inFrame ? active.find((c) => c.kind === 'scene') ?? null : null;
  }

  _bind() {
    const el = this.el;
    el.addEventListener('mousedown', (e) => this._down(e));
    window.addEventListener('mousemove', (e) => this._move(e));
    window.addEventListener('mouseup', (e) => this._up(e));
    el.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => { const p = this._pos(e); const c = this.hit(p.x, p.y); if (c) this.app.openClipEditor(c); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this._pos(e); const c = this.hit(p.x, p.y);
      if (!c) return;
      if (!this.selected.has(c.id)) this.app.select([c.id], c.id);
      this.app.showContextMenu(c, e.clientX, e.clientY);
    });
  }

  _down(e) {
    const p = this._pos(e);
    if (e.button === 1 || (e.button === 0 && this.app.spaceDown)) { this._drag = { kind: 'pan', x: e.clientX, y: e.clientY, px: this.panX, py: this.panY }; return; }
    if (e.button !== 0) return;
    const r = this.frameRect();
    const s = this.project.settings;
    if (this.tool === 'motion') {
      const clip = this.project.clips.find((c) => c.id === this.primary);
      if (!clip || clip.kind === 'scene') { this.app.status('Select a component (not a scene) to give it a motion path.'); return; }
      const nx = (p.x - r.x) / r.w, ny = (p.y - r.y) / r.h;
      const tn = Math.max(0, Math.min(1, (this.t - clip.start) / clip.duration));
      const before = this.app.snapshot();
      const kf = (clip.keyframes ?? []).filter((k) => Math.abs(k.t - tn) > 0.01);
      kf.push({ t: Math.round(tn * 1000) / 1000, x: Math.round(nx * 1000) / 1000, y: Math.round(ny * 1000) / 1000, scale: this.pendingZoom });
      if (kf.length === 1 && tn > 0) kf.unshift({ t: 0, x: clip.x, y: clip.y, scale: clip.scale_x });
      clip.keyframes = kf.sort((a, b) => a.t - b.t);
      this.app.commit(before, `Motion stop ${clip.keyframes.length} at ${(tn * 100).toFixed(0)} % · zoom ${this.pendingZoom.toFixed(2)}×`);
      return;
    }
    // Handles (resize / crop) on the primary selection first.
    const prim = this.project.clips.find((c) => c.id === this.primary);
    if (prim && prim.kind !== 'scene') {
      const lb = this.clipBox(prim.id);
      if (lb) {
        const b = this._toScreen(r, lb);
        if (this.tool === 'crop' && ['image', 'video'].includes(prim.type)) {
          const edge = Math.abs(p.x - b.x) < 12 ? 'l' : Math.abs(p.x - (b.x + b.w)) < 12 ? 'r' : Math.abs(p.y - b.y) < 12 ? 't' : Math.abs(p.y - (b.y + b.h)) < 12 ? 'b' : null;
          if (edge) { this._drag = { kind: 'crop', edge, x: p.x, y: p.y, b, crop: { ...(prim.crop ?? { x: 0, y: 0, w: 1, h: 1 }) }, clip: prim, before: this.app.snapshot() }; return; }
        }
        if (this.tool === 'select') {
          const corner = this._corners(b).findIndex(([hx, hy]) => Math.abs(p.x - hx) <= HANDLE && Math.abs(p.y - hy) <= HANDLE);
          if (corner >= 0) {
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            this._drag = { kind: 'resize', clip: prim, cx, cy, d0: Math.hypot(p.x - cx, p.y - cy) || 1, sx: prim.scale_x, sy: prim.scale_y, before: this.app.snapshot() };
            return;
          }
        }
      }
    }
    const c = this.hit(p.x, p.y);
    if (!c) {
      if (!(e.shiftKey || e.ctrlKey)) this.app.select([], null);
      this._marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      const ids = new Set(this.selected);
      ids.has(c.id) ? ids.delete(c.id) : ids.add(c.id);
      this.app.select([...ids], c.id);
    } else if (!this.selected.has(c.id)) {
      this.app.select([c.id], c.id);
    }
    if (this.tool !== 'select' || c.kind === 'scene') return;
    const movers = [...this.selected].map((id) => this.project.clips.find((x) => x.id === id)).filter((x) => x && x.kind !== 'scene');
    const boxes = movers.map((m) => this.clipBox(m.id)).filter(Boolean);
    const union = boxes.length ? boxes.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x2: Math.max(a.x2 ?? a.x + a.w, b.x + b.w), y2: Math.max(a.y2 ?? a.y + a.h, b.y + b.h) }), { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }) : null;
    this._drag = {
      kind: 'move', x: p.x, y: p.y, before: this.app.snapshot(), union,
      origins: movers.map((m) => ({ clip: m, x: m.x, y: m.y, kf: (m.keyframes ?? []).map((k) => ({ ...k })) })),
    };
  }

  _snapTargets(excludeIds) {
    const s = this.project.settings;
    const g = layoutGrid({ w: s.width, h: s.height });
    const xs = [s.width / 2, g.margin, s.width - g.margin], ys = [s.height / 2, g.margin, s.height - g.margin];
    for (let i = 0; i < g.columns; i++) { xs.push(g.colX(i), g.colX(i) + g.colW); }
    for (const c of this.project.clips) {
      if (excludeIds.has(c.id) || c.kind === 'scene') continue;
      const b = this.clipBox(c.id);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  _move(e) {
    const p = this._pos(e);
    const d = this._drag;
    if (this._marquee && e.buttons & 1) { this._marquee.x1 = p.x; this._marquee.y1 = p.y; this.redraw(); return; }
    if (!d || !(e.buttons & 7)) return;
    const r = this.frameRect();
    const s = this.project.settings;
    const k = r.w / s.width;
    if (d.kind === 'pan') { this.panX = d.px + e.clientX - d.x; this.panY = d.py + e.clientY - d.y; this.redraw(); return; }
    if (d.kind === 'resize') {
      const f = Math.max(0.05, Math.hypot(p.x - d.cx, p.y - d.cy) / d.d0);
      d.clip.scale_x = Math.round(Math.max(0.05, Math.min(20, d.sx * f)) * 1000) / 1000;
      d.clip.scale_y = Math.round(Math.max(0.05, Math.min(20, (e.shiftKey ? d.sy : d.sy * f))) * 1000) / 1000;
      this.app.liveUpdate();
      return;
    }
    if (d.kind === 'crop') {
      const c = { ...d.crop };
      const dx = (p.x - d.x) / d.b.w * c.w, dy = (p.y - d.y) / d.b.h * c.h;
      if (d.edge === 'l') { const nx = Math.max(0, Math.min(c.x + c.w - 0.05, c.x + dx)); c.w += c.x - nx; c.x = nx; }
      if (d.edge === 'r') c.w = Math.max(0.05, Math.min(1 - c.x, c.w + dx));
      if (d.edge === 't') { const ny = Math.max(0, Math.min(c.y + c.h - 0.05, c.y + dy)); c.h += c.y - ny; c.y = ny; }
      if (d.edge === 'b') c.h = Math.max(0.05, Math.min(1 - c.y, c.h + dy));
      for (const key of ['x', 'y', 'w', 'h']) c[key] = Math.round(c[key] * 1000) / 1000;
      d.clip.crop = c;
      this.app.liveUpdate();
      return;
    }
    if (d.kind === 'move') {
      let dxL = (p.x - d.x) / k, dyL = (p.y - d.y) / k;
      this.guides = [];
      if (d.union && !e.altKey) {
        const ex = new Set(d.origins.map((o) => o.clip.id));
        const { xs, ys } = this._snapTargets(ex);
        const u = d.union;
        const bx = [u.x + dxL, (u.x + u.x2) / 2 + dxL, u.x2 + dxL];
        const by = [u.y + dyL, (u.y + u.y2) / 2 + dyL, u.y2 + dyL];
        let best = SNAP_PX / k, sx = null;
        for (const t of xs) for (const v of bx) { if (Math.abs(t - v) < best) { best = Math.abs(t - v); sx = t - v; } }
        if (sx !== null) { dxL += sx; this.guides.push({ axis: 'x', v: bx.map((v) => v + sx).find((v) => xs.some((t) => Math.abs(t - v) < 0.5)) }); }
        best = SNAP_PX / k; let sy = null;
        for (const t of ys) for (const v of by) { if (Math.abs(t - v) < best) { best = Math.abs(t - v); sy = t - v; } }
        if (sy !== null) { dyL += sy; this.guides.push({ axis: 'y', v: by.map((v) => v + sy).find((v) => ys.some((t) => Math.abs(t - v) < 0.5)) }); }
      }
      for (const o of d.origins) {
        o.clip.x = Math.round((o.x + dxL / s.width) * 10000) / 10000;
        o.clip.y = Math.round((o.y + dyL / s.height) * 10000) / 10000;
        if (o.kf.length) o.clip.keyframes = o.kf.map((kk) => ({ ...kk, x: kk.x + dxL / s.width, y: kk.y + dyL / s.height }));
      }
      this.app.liveUpdate();
    }
  }

  _up() {
    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      if (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4) {
        const r = this.frameRect();
        const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
        const ids = [];
        for (const c of this.project.clips) {
          if (c.kind === 'scene') continue;
          const lb = this.clipBox(c.id);
          if (!lb) continue;
          const b = this._toScreen(r, lb);
          if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) ids.push(c.id);
        }
        this.app.select(ids, ids[0] ?? null);
      }
      this.redraw();
      return;
    }
    const d = this._drag;
    this._drag = null;
    this.guides = [];
    if (!d) return;
    if (d.before && d.kind !== 'pan') this.app.commit(d.before);
    this.redraw();
  }

  _wheel(e) {
    e.preventDefault();
    if (this.tool === 'motion' && !e.ctrlKey) {
      this.pendingZoom = Math.max(0.2, Math.min(6, this.pendingZoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      this.app.badge(`Motion path: click to add a stop at the playhead · zoom ${this.pendingZoom.toFixed(2)}× (scroll) · Esc to finish`);
      return;
    }
    const p = this._pos(e);
    const r0 = this.frameRect();
    const z0 = this.zoom;
    this.zoom = Math.max(0.2, Math.min(8, this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    // keep the point under the cursor fixed
    const f = this.zoom / z0;
    const cx = this.W / 2 + this.panX, cy = this.H / 2 + this.panY;
    this.panX += (p.x - cx) * (1 - f);
    this.panY += (p.y - cy) * (1 - f);
    void r0;
    this.redraw();
  }

  nudge(dx, dy) {
    const s = this.project.settings;
    let moved = false;
    for (const id of this.selected) {
      const c = this.project.clips.find((x) => x.id === id);
      if (!c || c.kind === 'scene') continue;
      c.x += dx / s.width; c.y += dy / s.height;
      moved = true;
    }
    return moved;
  }
}
