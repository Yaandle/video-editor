// app.js — the editor shell. Owns the project (model.js), the preview renderer
// (the same createRenderer the export uses), the stage and timeline widgets,
// the library, the inspector, dialogs, transport, undo/redo, autosave and the
// render queue. Everything visual on the stage comes from renderer.renderFrame.

import { createRenderer } from './renderer/core.js';
import * as registry from './renderer/registry.js';
import { setTokens } from './renderer/tokens.js';
import { grid as beatGrid, snap as beatSnap } from './renderer/beat.js';
import { loadPack, installedPacks } from './renderer/styles.js';
import { Project, Clip, newClip, computeLayerReorder, genId } from './model.js';
import { StageWidget } from './canvas.js';
import { TimelineWidget } from './timeline.js';
import { Inspector } from './inspector.js';
import { Library } from './library.js';
import { el, field, schemaFields, decorateIcons } from './forms.js';
import { Transport } from './transport.js';

const $ = (sel) => document.querySelector(sel);
const UNDO_LIMIT = 120;

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

class App {
  constructor() {
    this.project = new Project();
    this.file = null;
    this.undo = []; this.redo = [];
    this.dirty = false;
    this.spaceDown = false;
    this.clipboard = null;
    this.mediaItems = [];
    this.packs = [];
    this.llm = { available: false };
    this.transport = new Transport((t, ended) => this._tick(t, ended));
  }

  async init() {
    const tok = await (await fetch('/design/tokens.json')).json();
    setTokens(tok);
    this._applyTokens(tok);
    this.renderer = await createRenderer({ mode: 'preview', base: '/' });
    this.stage = new StageWidget($('#canvas-widget'), this);
    this.timeline = new TimelineWidget($('#timeline-canvas'), this.project);
    this.inspector = new Inspector($('#props-inner'), this);
    this.library = new Library(this);
    this._wireMenus();
    this._wireToolbar();
    this._wireTimeline();
    this._wireKeyboard();
    this._wireDialogs();
    this._wireSocket();
    await decorateIcons();
    // Style packs: list from the server, then import each so their components show in the library.
    this.packs = await installedPacks().catch(() => []);
    await Promise.all(this.packs.map((p) => loadPack(p.id).catch((e) => this.toast(`Style pack ${p.id} failed to load: ${e.message}`, 'error'))));
    this.library.build();
    this._buildAddMenu();
    const last = await this._fetchJSON('/api/projects').catch(() => null);
    const recent = last?.recent?.[0]?.file;
    if (recent) await this.open(recent, { quiet: true }).catch(() => this._newFromTemplate('untitled', true));
    else await this._newFromTemplate('untitled', true);
    fetch('/api/health').then((r) => r.json()).then((h) => this._server(true, h)).catch(() => this._server(false));
    fetch('/api/llm/status').then((r) => r.json()).then((s) => {
      this.llm = s;
      $('#llm-text').textContent = s.available ? `LLM ${s.running ? 'running' : 'ready'}` : 'LLM off';
      document.body.classList.toggle('llm-on', !!s.available);
    }).catch(() => {});
    setInterval(() => this._autosave(), 20000);
    window.addEventListener('beforeunload', (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  _applyTokens(tok) {
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(tok.palette ?? {})) if (typeof v === 'string') root.setProperty(`--${k}`, v);
  }

  _server(ok, h) {
    $('#srv-dot').className = `dot ${ok ? 'ok' : 'bad'}`;
    $('#srv-text').textContent = ok ? (h?.ffmpeg ? 'server · ffmpeg ok' : 'server · no ffmpeg') : 'server offline';
  }

  async _fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) {
      const err = new Error(data.message ?? `${r.status} ${url}`);
      err.code = data.code; err.data = data;
      throw err;
    }
    return data;
  }

  // ── Status, toasts, badge ──────────────────────────────────────────────────
  status(msg, level = 'info') {
    $('#status-text').textContent = msg;
    if (level === 'error') this.toast(msg, 'error');
  }
  toast(msg, kind = 'info', code = null, detail = null) {
    const t = el('div', { class: `toast ${kind}` }, code ? el('span', { class: 'code', text: code }) : null, el('span', { text: msg }), detail ? el('pre', { text: detail }) : null);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 9000 : 3500);
  }
  badge(msg) {
    const b = $('#stage-badge');
    b.textContent = msg ?? '';
    b.classList.toggle('hidden', !msg);
  }

  // ── Project lifecycle ──────────────────────────────────────────────────────
  async setProject(data, file = null) {
    this.transport.pause();
    this.project = data instanceof Project ? data : new Project(data);
    this.file = file;
    this.undo = []; this.redo = [];
    this.dirty = false;
    this.audioKey = null;
    await this.renderer.load(this.project.toDict()).catch(async (e) => {
      this.toast(`Project has problems: ${e.message}`, 'error');
      await this.renderer.update(this.project.toDict());
    });
    if (this.renderer.errors.length) this.toast(this.renderer.errors.slice(0, 4).join('\n'), 'error', 'invalid props');
    this.stage.setRenderer(this.renderer);
    this.timeline.setProject(this.project);
    $('#project-name').value = this.project.name;
    this.select([], null);
    this.seek(0);
    this._updateTitle();
    this._readout();
  }

  async _newFromTemplate(name, template, frame = '1920x1080', fps = 30, bpm = 120) {
    let data;
    if (template) {
      data = (await this._fetchJSON('/api/projects/showcase.json').catch(() => null))?.project;
    }
    const [w, h] = frame.split('x').map(Number);
    if (!data) data = { name, settings: { width: w, height: h, fps, bpm, duration: 16 }, clips: [] };
    data = JSON.parse(JSON.stringify(data));
    data.name = name;
    data.settings = { ...data.settings, width: w, height: h, fps, bpm };
    await this.setProject(data, null);
  }

  async open(file, { quiet = false } = {}) {
    const res = await this._fetchJSON(`/api/projects/${encodeURIComponent(file)}`);
    await this.setProject(res.project, res.migrated ? null : res.file);
    if (!quiet) this.toast(res.migrated ? `Imported ${file} (old .vkit) — save to keep it as .json` : `Opened ${file}`, 'ok');
  }

  async save(as = false) {
    let file = this.file;
    if (!file || as) {
      const name = prompt('Save project as', this.project.name || 'untitled');
      if (!name) return;
      file = name.replace(/\.json$/i, '') + '.json';
    }
    try {
      await this._fetchJSON(`/api/projects/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.project.toDict()) });
      this.file = file;
      this.dirty = false;
      this._updateTitle();
      this.toast(`Saved ${file}`, 'ok');
    } catch (e) {
      this.toast(e.message, 'error', e.code);
    }
  }

  async _autosave() {
    if (!this.dirty) return;
    const name = (this.file ?? this.project.name ?? 'untitled').replace(/\.json$/, '');
    try {
      await fetch(`/api/autosave/${encodeURIComponent(name)}.json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.project.toDict()) });
      $('#autosave-text').textContent = `autosaved ${new Date().toLocaleTimeString()}`;
    } catch { $('#autosave-text').textContent = 'autosave failed'; }
  }

  _updateTitle() {
    document.title = `${this.dirty ? '• ' : ''}${this.project.name} — vidkit studio`;
  }

  _readout() {
    const s = this.project.settings;
    const pack = registry.stylePack(s.style);
    $('#stage-readout').textContent = `${s.width}×${s.height} · ${s.fps} fps · ${s.bpm ?? '—'} BPM · ${pack?.label ?? s.style}`;
  }

  // ── Undo / redo / commit ───────────────────────────────────────────────────
  snapshot() { return JSON.stringify(this.project.toDict()); }

  commit(before, msg = null) {
    const now = this.snapshot();
    if (before && before !== now) {
      this.undo.push(before);
      if (this.undo.length > UNDO_LIMIT) this.undo.shift();
      this.redo = [];
      this.dirty = true;
      this._updateTitle();
    }
    if (msg) this.status(msg);
    this.refresh();
  }

  async _restore(json) {
    const keepSel = [...this.stage.selected];
    const data = JSON.parse(json);
    this.project = new Project(data);
    await this.renderer.update(this.project.toDict());
    this.timeline.setProject(this.project);
    this.select(keepSel.filter((id) => this.project.clips.some((c) => c.id === id)), null);
    this.dirty = true;
    this._updateTitle();
    this.refresh();
  }
  async doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); await this._restore(this.undo.pop()); this.status('Undo'); }
  async doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); await this._restore(this.redo.pop()); this.status('Redo'); }

  /** Re-resolve props/packs/assets and repaint everything (after any edit). */
  refresh() {
    clearTimeout(this._upd);
    const run = async () => {
      await this.renderer.update(this.project.toDict());
      if (this.renderer.errors.length) this.status(this.renderer.errors[0], 'warn');
      this.stage.redraw();
      this.timeline.redraw();
      this.inspector.refreshValues?.();
      this._readout();
    };
    this._upd = setTimeout(run, 0);
    $('#btn-undo').disabled = !this.undo.length;
    $('#btn-redo').disabled = !this.redo.length;
  }

  /** Cheap repaint during drags (no prop re-resolution needed for transforms). */
  liveUpdate() {
    this.renderer.update(this.project.toDict()).then(() => { this.stage.redraw(); this.timeline.redraw(); });
  }

  // ── Selection + transport ──────────────────────────────────────────────────
  select(ids, primary) {
    this.stage.setSelection(ids, primary);
    this.timeline.setSelectedIds(ids, primary);
    this.inspector.show(ids.map((id) => this.project.clips.find((c) => c.id === id)).filter(Boolean));
  }
  get selectedClips() { return [...this.stage.selected].map((id) => this.project.clips.find((c) => c.id === id)).filter(Boolean); }

  seek(t) {
    const d = this.project.duration;
    t = Math.max(0, Math.min(d, t));
    this.transport.seek(t);
    this._tick(t, true);
  }
  async _tick(t, isSeek) {
    this.stage.t = t;
    if (isSeek || !this.transport.playing) await this.renderer.prepare(t).catch(() => {});
    else this.renderer.prepare(t).catch(() => {});
    this.stage.redraw();
    this.timeline.setPlayhead(t);
    $('#timecode').textContent = fmtTime(t);
    const g = beatGrid(this.project.settings);
    if (g) {
      const n = Math.floor((t - g.offset) / g.beat + 1e-6);
      const bar = Math.floor(n / 4) + 1, beat = (n % 4 + 4) % 4 + 1;
      $('#beatcode').textContent = `Bar ${bar} · ${beat}`;
      $('#beatcode').classList.toggle('downbeat', beat === 1);
    }
    if (!this.transport.playing) $('#btn-play').classList.remove('on');
  }

  async togglePlay() {
    if (this.transport.playing) { this.transport.pause(); $('#btn-play').classList.remove('on'); return; }
    $('#btn-play').classList.add('on');
    await this._ensureAudio();
    this.transport.play(this.project.duration);
  }

  /** The mastered preview mix (same mix the export muxes), rebuilt when audio-relevant data changes. */
  async _ensureAudio() {
    const d = this.project.toDict();
    const key = JSON.stringify([d.settings, d.clips, d.tracks, d.audio]);
    if (key === this.audioKey && this.transport.audio) return;
    this.audioKey = key;
    this.status('Building the audio preview…');
    try {
      const r = await fetch('/api/audio/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? r.statusText); }
      const url = URL.createObjectURL(await r.blob());
      if (this.transport.audio) URL.revokeObjectURL(this.transport.audio.src);
      const a = new Audio(url);
      a.preload = 'auto';
      await new Promise((res) => { a.addEventListener('canplaythrough', res, { once: true }); a.addEventListener('error', res, { once: true }); });
      this.transport.audio = a;
      this.status(`Audio preview ready (${r.headers.get('X-Integrated-LUFS') ?? '?'} LUFS before mastering)`);
    } catch (e) {
      this.transport.audio = null;
      this.status(`No audio preview: ${e.message}`);
    }
  }

  // ── Editing operations ─────────────────────────────────────────────────────
  _freeLayer(start, dur, prefer = 0) {
    let layer = prefer;
    while (this.project.clips.some((c) => (c.layer ?? 0) === layer && c.start < start + dur && c.end() > start)) layer++;
    return layer;
  }

  addClip(type, at = null, extra = {}) {
    const def = registry.get(type);
    if (!def) { this.toast(`Unknown clip type ${type}`, 'error'); return null; }
    const before = this.snapshot();
    const s = this.project.settings;
    let t = at ?? this.stage.t;
    if (this.timeline.beatSnap && beatGrid(s)) t = beatSnap(t, s);
    const clip = newClip(type, Math.max(0, t), extra);
    if (clip.end() > this.project.duration && def.kind === 'scene') this.project.duration = clip.end();
    const prefer = def.kind === 'scene' ? Math.max(1, ...this.project.clips.map((c) => c.layer ?? 0)) : 0;
    clip.layer = extra.layer ?? this._freeLayer(clip.start, clip.duration, prefer);
    this.project.clips.push(clip);
    this.commit(before, `Added ${def.label ?? type}`);
    this.select([clip.id], clip.id);
    return clip;
  }

  addMedia(item, at = null, layer = null) {
    const k = item.mediaKind ?? item.kind;
    const kind = k === 'video' ? 'video' : k === 'audio' ? 'audio' : 'image';
    const dur = item.metadata?.duration ? Math.min(item.metadata.duration, 30) : (kind === 'image' ? 4 : 5);
    return this.addClip(kind, at, { src: item.url, duration: Math.round(dur * 100) / 100, ...(layer != null ? { layer } : {}) });
  }

  deleteSelected() {
    const ids = new Set(this.stage.selected);
    if (!ids.size) return;
    const before = this.snapshot();
    this.project.clips = this.project.clips.filter((c) => !ids.has(c.id));
    this.select([], null);
    this.commit(before, `Deleted ${ids.size} clip${ids.size > 1 ? 's' : ''}`);
  }

  duplicateSelected() {
    const sel = this.selectedClips;
    if (!sel.length) return;
    const before = this.snapshot();
    const ids = [];
    for (const c of sel) {
      const d = new Clip({ ...c.toDict(), id: genId(c.kind === 'scene' ? 's' : 'c'), start: c.end() });
      d.layer = this._freeLayer(d.start, d.duration, c.layer);
      this.project.clips.push(d);
      ids.push(d.id);
    }
    this.commit(before, 'Duplicated');
    this.select(ids, ids[0]);
  }

  copySelected() { this.clipboard = this.selectedClips.map((c) => c.toDict()); if (this.clipboard.length) this.status(`Copied ${this.clipboard.length}`); }
  cutSelected() { this.copySelected(); this.deleteSelected(); }
  paste() {
    if (!this.clipboard?.length) return;
    const before = this.snapshot();
    const t0 = Math.min(...this.clipboard.map((c) => c.start));
    const ids = [];
    for (const c of this.clipboard) {
      const d = new Clip({ ...c, id: genId('c'), start: this.stage.t + (c.start - t0) });
      d.layer = this._freeLayer(d.start, d.duration, c.layer);
      this.project.clips.push(d);
      ids.push(d.id);
    }
    this.commit(before, 'Pasted');
    this.select(ids, ids[0]);
  }

  split(clip = null, t = null) {
    const targets = clip ? [clip] : this.selectedClips;
    t = t ?? this.stage.t;
    const before = this.snapshot();
    let n = 0;
    for (const c of targets) {
      if (t <= c.start + 0.05 || t >= c.end() - 0.05) continue;
      const right = new Clip({ ...c.toDict(), id: genId('c'), start: t, duration: c.end() - t,
        source_start: (c.source_start ?? 0) + (t - c.start) * (c.speed ?? 1), enter: null });
      c.duration = t - c.start;
      c.exit = null;
      this.project.clips.push(right);
      n++;
    }
    if (n) this.commit(before, `Split ${n} clip${n > 1 ? 's' : ''} at ${t.toFixed(2)} s`);
  }

  snapSelected() {
    const s = this.project.settings;
    if (!beatGrid(s)) return this.status('This project has no BPM.');
    const before = this.snapshot();
    for (const c of this.selectedClips) {
      const a = beatSnap(c.start, s), b = beatSnap(c.end(), s);
      c.start = a; c.duration = Math.max(beatGrid(s).step, b - a);
    }
    this.commit(before, 'Snapped to the beat grid');
  }

  reorder(direction) {
    const c = this.selectedClips[0];
    if (!c) return;
    const plan = computeLayerReorder(this.project.clips, c, direction);
    if (!plan) return;
    const before = this.snapshot();
    for (const { id, layer } of plan) this.project.clips.find((x) => x.id === id).layer = layer;
    this.commit(before, `Layer ${direction}`);
  }

  // ── Clip editor (Text Studio for text) ─────────────────────────────────────
  openClipEditor(clip) {
    if (clip.type === 'text' || registry.get(clip.type)?.textStudio) this.openTextStudio(clip);
    else this.select([clip.id], clip.id);
  }

  openTextStudio(clip = null) {
    clip = clip ?? this.selectedClips.find((c) => c.type === 'text' || registry.get(c.type)?.textStudio);
    if (!clip) { this.status('Select a text clip to open it in Text Studio.'); return; }
    const dlg = $('#textstudio-dlg');
    const frame = $('#textstudio-frame');
    const send = () => frame.contentWindow.postMessage({ type: 'open', clip: clip.toDict(), settings: this.project.settings, packs: this.packs, llm: this.llm.available }, location.origin);
    this._tsClip = clip.id;
    if (!frame.src) { frame.src = '/textstudio.html'; frame.addEventListener('load', send, { once: true }); }
    else send();
    dlg.showModal();
  }

  _onTextStudio(msg) {
    const dlg = $('#textstudio-dlg');
    if (msg.type === 'cancel') { dlg.close(); return; }
    if (msg.type !== 'apply') return;
    const clip = this.project.clips.find((c) => c.id === this._tsClip);
    if (!clip) { dlg.close(); return; }
    const before = this.snapshot();
    for (const k of ['props', 'style', 'style_params', 'duration', 'enter', 'exit']) if (k in msg.clip) clip[k] = JSON.parse(JSON.stringify(msg.clip[k]));
    if (msg.clip.type && registry.get(msg.clip.type)) clip.type = msg.clip.type;
    dlg.close();
    this.commit(before, 'Text Studio changes applied');
    this.select([clip.id], clip.id);
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  showContextMenu(clip, x, y) {
    const m = $('#ctxmenu');
    m.innerHTML = '';
    const item = (label, fn, kbd = '') => { const b = el('button', { type: 'button' }, el('span', { text: label }), kbd ? el('kbd', { text: kbd }) : null); b.addEventListener('click', () => { m.classList.remove('open'); fn(); }); m.append(b); };
    if (clip.type === 'text' || registry.get(clip.type)?.textStudio) item('Open in Text Studio…', () => this.openTextStudio(clip), 'Enter');
    item('Duplicate', () => this.duplicateSelected(), 'Ctrl+D');
    item('Split at playhead', () => this.split(clip), 'S');
    item('Snap to beat grid', () => this.snapSelected(), 'Shift+B');
    m.append(el('hr'));
    item('Bring to front', () => this.reorder('front'), 'Ctrl+Shift+]');
    item('Bring forward', () => this.reorder('forward'));
    item('Send backward', () => this.reorder('backward'));
    item('Send to back', () => this.reorder('back'), 'Ctrl+Shift+[');
    m.append(el('hr'));
    item('Delete', () => this.deleteSelected(), 'Del');
    m.style.left = `${Math.min(x, innerWidth - 230)}px`;
    m.style.top = `${Math.min(y, innerHeight - 340)}px`;
    m.classList.add('open');
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  _buildAddMenu() {
    const menu = $('#add-menu');
    menu.innerHTML = '';
    const groups = new Map();
    for (const d of registry.all()) {
      const g = d.pack ? (registry.stylePack(d.pack)?.label ?? d.pack) : d.category;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(d);
    }
    for (const [g, defs] of groups) {
      menu.append(el('div', { class: 'group', text: g }));
      for (const d of defs) {
        const b = el('button', { type: 'button', text: d.label ?? d.type });
        b.addEventListener('click', () => { this._closeMenus(); this.addClip(d.type); });
        menu.append(b);
      }
    }
  }

  _closeMenus() { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); }

  _wireMenus() {
    document.querySelectorAll('.menu > button').forEach((b) => b.addEventListener('click', (e) => {
      const m = b.parentElement;
      const was = m.classList.contains('open');
      this._closeMenus();
      if (!was) m.classList.add('open');
      e.stopPropagation();
    }));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu')) this._closeMenus();
      if (!e.target.closest('#ctxmenu')) $('#ctxmenu').classList.remove('open');
    });
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => { this._closeMenus(); this.action(b.dataset.action); }));
  }

  action(a) {
    const acts = {
      new: () => $('#new-dlg').showModal(),
      open: () => this._openDialog(),
      save: () => this.save(false),
      'save-as': () => this.save(true),
      settings: () => this._settingsDialog(),
      storyboard: () => $('#storyboard-dlg').showModal(),
      undo: () => this.doUndo(), redo: () => this.doRedo(),
      cut: () => this.cutSelected(), copy: () => this.copySelected(), paste: () => this.paste(),
      duplicate: () => this.duplicateSelected(), split: () => this.split(), delete: () => this.deleteSelected(),
      'snap-clip': () => this.snapSelected(),
      'bring-front': () => this.reorder('front'), 'send-back': () => this.reorder('back'),
      render: () => this._renderDialog(false),
      'draft-range': () => this._renderDialog(true),
      queue: () => $('#queue').classList.toggle('hidden'),
      validate: () => this._validate(),
      shortcuts: () => this._shortcuts(),
    };
    acts[a]?.();
  }

  _wireToolbar() {
    $('#btn-start').addEventListener('click', () => this.seek(0));
    $('#btn-play').addEventListener('click', () => this.togglePlay());
    $('#btn-stop').addEventListener('click', () => { this.transport.pause(); this.seek(0); });
    $('#btn-undo').addEventListener('click', () => this.doUndo());
    $('#btn-redo').addEventListener('click', () => this.doRedo());
    $('#btn-textstudio').addEventListener('click', () => this.openTextStudio());
    $('#btn-draft').addEventListener('click', () => this._renderDialog(true));
    $('#btn-render').addEventListener('click', () => this._renderDialog(false));
    $('#queue-btn').addEventListener('click', () => $('#queue').classList.toggle('hidden'));
    $('#queue-close').addEventListener('click', () => $('#queue').classList.add('hidden'));
    const tools = { select: '#tool-select', razor: '#tool-razor', crop: '#tool-crop', motion: '#tool-motion' };
    for (const [name, sel] of Object.entries(tools)) $(sel).addEventListener('click', () => this.setTool(name));
    $('#stage-fit').addEventListener('click', () => this.stage.fit());
    $('#stage-grid').addEventListener('click', (e) => { this.stage.showGrid = !this.stage.showGrid; e.currentTarget.classList.toggle('on', this.stage.showGrid); this.stage.redraw(); });
    $('#stage-safe').addEventListener('click', (e) => { this.stage.showSafe = !this.stage.showSafe; e.currentTarget.classList.toggle('on', this.stage.showSafe); this.stage.redraw(); });
    $('#project-name').addEventListener('change', (e) => {
      const before = this.snapshot();
      this.project.name = e.target.value.trim() || 'untitled';
      this.commit(before);
    });
    const tlHandle = $('#timeline-resize-handle');
    tlHandle.addEventListener('mousedown', (e) => {
      const y0 = e.clientY, h0 = $('#timeline-wrap').clientHeight;
      const move = (ev) => this.timeline.resize(Math.max(80, h0 - (ev.clientY - y0)));
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.stage.resize(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    addEventListener('resize', () => { this.timeline.resize(); this.stage.resize(); });
  }

  setTool(name) {
    this.stage.setTool(name);
    this.timeline.setTool(name === 'razor' ? 'razor' : 'select');
    for (const t of ['select', 'razor', 'crop', 'motion']) $(`#tool-${t}`).classList.toggle('on', t === name);
    this.badge(name === 'motion' ? `Motion path: click to add a stop at the playhead · zoom ${this.stage.pendingZoom.toFixed(2)}× (scroll) · Esc to finish`
      : name === 'crop' ? 'Crop: drag the orange edge handles of an image or video' : name === 'razor' ? 'Razor: click a clip on the timeline to split it' : null);
  }

  _wireTimeline() {
    const tl = $('#timeline-canvas');
    tl.addEventListener('timeline:playheadmoved', (e) => { this.transport.pause(); this.seek(e.detail.t); });
    tl.addEventListener('timeline:selectionchanged', (e) => {
      const { selectedIds, primaryId } = e.detail;
      this.stage.setSelection(selectedIds, primaryId);
      this.inspector.show(selectedIds.map((id) => this.project.clips.find((c) => c.id === id)).filter(Boolean));
    });
    tl.addEventListener('timeline:deselect', () => this.select([], null));
    tl.addEventListener('timeline:clipchanged', () => this.liveUpdate());
    tl.addEventListener('timeline:committed', (e) => this.commit(e.detail.before));
    tl.addEventListener('timeline:contextmenu', (e) => this.showContextMenu(e.detail.clip, e.detail.x, e.detail.y));
    tl.addEventListener('timeline:open', (e) => this.openClipEditor(e.detail.clip));
    tl.addEventListener('timeline:slice', (e) => this.split(e.detail.clip, e.detail.t));
    tl.addEventListener('timeline:layervisibility', (e) => {
      const before = this.snapshot();
      const hidden = this.project.toggleLayerHidden(e.detail.layer);
      this.commit(before, `Layer ${e.detail.layer + 1} ${hidden ? 'hidden' : 'shown'}`);
    });
    tl.addEventListener('timeline:itemdropped', (e) => {
      const { item, time, layer } = e.detail;
      if (item.kind === 'type') this.addClip(item.type, time, { layer });
      else if (item.kind === 'media') this.addMedia(item, time, layer);
    });
    $('#tl-snap').addEventListener('click', (e) => { this.timeline.beatSnap = !this.timeline.beatSnap; e.currentTarget.classList.toggle('on', this.timeline.beatSnap); });
    $('#tl-in').addEventListener('click', () => this._mark('in'));
    $('#tl-out').addEventListener('click', () => this._mark('out'));
    $('#tl-clear').addEventListener('click', () => this._mark('clear'));
    $('#tl-zoom-in').addEventListener('click', () => this.timeline.zoomIn());
    $('#tl-zoom-out').addEventListener('click', () => this.timeline.zoomOut());
  }

  _mark(which) {
    const t = this.stage.t;
    let r = this.timeline.range ?? { t0: 0, t1: this.project.duration };
    if (which === 'clear') r = null;
    else if (which === 'in') r = { t0: t, t1: Math.max(t + 0.1, r.t1) };
    else r = { t0: Math.min(r.t0, t - 0.1), t1: t };
    this.timeline.setRange(r);
    $('#tl-range').textContent = r ? `Range ${r.t0.toFixed(2)}–${r.t1.toFixed(2)} s (${(r.t1 - r.t0).toFixed(2)} s)` : 'No range — I / O to mark one';
  }

  _wireKeyboard() {
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
    addEventListener('keydown', (e) => {
      const tag = (e.target.tagName ?? '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('dialog[open]')) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      const run = (fn) => { e.preventDefault(); fn(); };
      if (k === ' ') { this.spaceDown = true; return run(() => this.togglePlay()); }
      if (ctrl && e.shiftKey && (k === 'Z' || k === 'z')) return run(() => this.doRedo());
      if (ctrl && (k === 'z' || k === 'Z')) return run(() => this.doUndo());
      if (ctrl && (k === 'y' || k === 'Y')) return run(() => this.doRedo());
      if (ctrl && e.shiftKey && (k === 'S' || k === 's')) return run(() => this.save(true));
      if (ctrl && (k === 's' || k === 'S')) return run(() => this.save(false));
      if (ctrl && (k === 'o' || k === 'O')) return run(() => this._openDialog());
      if (ctrl && (k === 'n' || k === 'N')) return run(() => $('#new-dlg').showModal());
      if (ctrl && e.shiftKey && (k === 'R' || k === 'r')) return run(() => this._renderDialog(true));
      if (ctrl && (k === 'r' || k === 'R')) return run(() => this._renderDialog(false));
      if (ctrl && (k === 'x' || k === 'X')) return run(() => this.cutSelected());
      if (ctrl && (k === 'c' || k === 'C')) return run(() => this.copySelected());
      if (ctrl && (k === 'v' || k === 'V')) return run(() => this.paste());
      if (ctrl && (k === 'd' || k === 'D')) return run(() => this.duplicateSelected());
      if (ctrl && e.shiftKey && k === '}') return run(() => this.reorder('front'));
      if (ctrl && e.shiftKey && k === '{') return run(() => this.reorder('back'));
      if (ctrl) return;
      if (k === 'Delete' || k === 'Backspace') return run(() => this.deleteSelected());
      if (k === 'Home') return run(() => this.seek(0));
      if (k === 'End') return run(() => this.seek(this.project.duration));
      if (k === 'Escape') return run(() => { if (this.stage.tool !== 'select') this.setTool('select'); else this.select([], null); });
      if (k === 'Enter' && this.selectedClips[0]) return run(() => this.openClipEditor(this.selectedClips[0]));
      if (k === 'v' || k === 'V') return run(() => this.setTool('select'));
      if (k === 'c' || k === 'C') return run(() => this.setTool('razor'));
      if (k === 's' || k === 'S') return run(() => this.split());
      if (k === 'B' && e.shiftKey) return run(() => this.snapSelected());
      if (k === 'b') return run(() => $('#tl-snap').click());
      if (k === 'i' || k === 'I') return run(() => this._mark('in'));
      if (k === 'o' || k === 'O') return run(() => this._mark('out'));
      if (k === 'x' && e.altKey) return run(() => this._mark('clear'));
      if (k === 'q' || k === 'Q') return run(() => $('#queue').classList.toggle('hidden'));
      if (k === '+' || k === '=') return run(() => this.timeline.zoomIn());
      if (k === '-' || k === '_') return run(() => this.timeline.zoomOut());
      if (k === ',' || k === '.') return run(() => { this.transport.pause(); this.seek(this.stage.t + (k === '.' ? 1 : -1) / this.project.fps); });
      if (k === '?') return run(() => this._shortcuts());
      if (k.startsWith('Arrow') && this.selectedClips.length) {
        return run(() => {
          const step = e.shiftKey ? 10 : 1;
          const before = this.snapshot();
          const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
          if (this.stage.nudge(dx, dy)) this.commit(before);
        });
      }
    });
    addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.source === 'textstudio') this._onTextStudio(e.data); });
  }

  // ── Dialogs ────────────────────────────────────────────────────────────────
  _wireDialogs() {
    document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    // New project
    const seg = (id) => { const s = $(id); s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }); return () => s.querySelector('.on')?.dataset.v; };
    const frameV = seg('#new-frame'), fpsV = seg('#new-fps');
    $('#new-create').addEventListener('click', () => this._confirmDiscard(async () => {
      $('#new-dlg').close();
      await this._newFromTemplate($('#new-name').value.trim() || 'untitled', $('#new-template').checked, frameV(), Number(fpsV()), Number($('#new-bpm').value) || 120)
        .catch((e) => this.toast(e.message, 'error'));
    }));
    // Render
    const presetV = seg('#render-preset');
    $('#render-go').addEventListener('click', async () => {
      const range = $('#render-range').checked ? this.timeline.range : null;
      $('#render-dlg').close();
      try {
        await this._fetchJSON('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: this.project.toDict(), preset: presetV(), draft: $('#render-draft').checked, t0: range?.t0 ?? null, t1: range?.t1 ?? null }) });
        $('#queue').classList.remove('hidden');
        this.toast('Render queued', 'ok');
      } catch (e) { this.toast(e.message, 'error', e.code); }
    });
    // Storyboard
    $('#sb-generate').addEventListener('click', async () => {
      const script = $('#sb-script').value.trim();
      if (!script) return;
      $('#sb-result').textContent = 'Generating…';
      try {
        const res = await this._fetchJSON('/api/llm/storyboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script, use_llm: $('#sb-llm').checked }) });
        this._storyboard = res.project;
        const scenes = res.project.clips.filter((c) => c.type.startsWith('scene.')).length;
        $('#sb-result').innerHTML = '';
        $('#sb-result').append(el('p', { class: 'hint', text: `${scenes} scenes, ${res.project.settings.duration.toFixed(1)} s — ${res.source === 'llm' ? 'written by the local model' : 'deterministic storyboard'}${res.notes?.length ? ` (${res.notes.slice(0, 2).join('; ')})` : ''}` }));
        if (this.llm.available) {
          const s = await this._fetchJSON('/api/llm/suggest-style', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script }) }).catch(() => null);
          if (s?.available && s.style) {
            this._storyboard.settings.style = s.style;
            $('#sb-result').append(el('p', { class: 'hint', text: `Suggested style: ${registry.stylePack(s.style)?.label ?? s.style} — ${s.reason}` }));
          }
        }
        $('#sb-open').disabled = false;
      } catch (e) { $('#sb-result').textContent = e.message; }
    });
    $('#sb-open').addEventListener('click', () => this._confirmDiscard(async () => { $('#storyboard-dlg').close(); await this.setProject(this._storyboard); this.dirty = true; }));
    $('#settings-apply').addEventListener('click', () => this._applySettings());
  }

  _confirmDiscard(fn) {
    if (!this.dirty) return fn();
    const d = $('#confirm-dlg');
    $('#confirm-title').textContent = 'Discard unsaved changes?';
    $('#confirm-msg').textContent = 'The current project has changes that are not saved (the last autosave is in projects/autosave/).';
    const yes = () => { cleanup(); d.close(); fn(); };
    const no = () => { cleanup(); d.close(); };
    const cleanup = () => { $('#confirm-yes').removeEventListener('click', yes); $('#confirm-no').removeEventListener('click', no); };
    $('#confirm-yes').addEventListener('click', yes);
    $('#confirm-no').addEventListener('click', no);
    d.showModal();
  }

  async _openDialog() {
    const list = $('#open-list');
    list.innerHTML = 'Loading…';
    $('#open-dlg').showModal();
    try {
      const data = await this._fetchJSON('/api/projects');
      list.innerHTML = '';
      for (const p of data.projects) {
        const row = el('div', { class: 'list-item' }, el('b', { text: p.name }), el('small', { text: `${p.kind === 'legacy' ? '.vkit (imports) · ' : ''}${p.modified.replace('T', ' ')}` }));
        row.addEventListener('click', () => this._confirmDiscard(async () => { $('#open-dlg').close(); await this.open(p.file).catch((e) => this.toast(e.message, 'error', e.code)); }));
        list.append(row);
      }
      if (!data.projects.length) list.append(el('p', { class: 'hint', text: 'No projects in projects/ yet.' }));
    } catch (e) { list.textContent = e.message; }
  }

  /** Project settings, including the project-wide style pack and its parameters. */
  _settingsDialog() {
    const s = JSON.parse(JSON.stringify(this.project.settings));
    const audio = JSON.parse(JSON.stringify(this.project.audio));
    this._pending = { s, audio };
    const body = $('#settings-body');
    body.innerHTML = '';
    const num = (k, label, o = {}) => field(k, { type: 'number', label, ...o }, s[k], (v) => { s[k] = v; }, { noRange: true });
    body.append(
      el('div', { class: 'grid-2' }, num('width', 'Width px', { min: 16, max: 7680, step: 2 }), num('height', 'Height px', { min: 16, max: 7680, step: 2 })),
      el('div', { class: 'grid-2' }, num('fps', 'Frame rate', { min: 1, max: 120, step: 1 }), num('duration', 'Duration s', { min: 0.1, max: 36000, step: 0.1 })),
      el('div', { class: 'grid-2' }, num('bpm', 'Tempo BPM', { min: 1, max: 400, step: 1 }), num('subdivision', 'Grid subdivision', { min: 1, max: 16, step: 1 })),
      el('div', { class: 'grid-2' }, num('beat_offset', 'Beat offset s', { min: -10, max: 10, step: 0.001 }), num('seed', 'Random seed', { min: 0, max: 2147483647, step: 1 })),
      field('beat_lock', { type: 'bool', label: 'Beat lock (renders fail on off-grid cuts and hits)' }, s.beat_lock, (v) => { s.beat_lock = v; }),
      field('background', { type: 'color', label: 'Background' }, s.background, (v) => { s.background = v; }),
    );
    const styleBox = el('div', { class: 'stylebox' });
    const drawStyle = () => {
      styleBox.innerHTML = '';
      styleBox.append(this.styleSelect('Style pack (whole project)', s.style, (v) => { s.style = v; s.style_params = {}; drawStyle(); }, false));
      const pack = registry.stylePack(s.style);
      if (pack && Object.keys(pack.schema).length) {
        styleBox.append(...schemaFields(pack.schema, registry.styleParams(s.style, s.style_params).value, (k, v) => { s.style_params = { ...s.style_params, [k]: v }; }));
      }
    };
    drawStyle();
    body.append(styleBox);
    const beds = ['brutal-bounce', ...this.packs.filter((p) => p.music).map((p) => `${p.id}.${p.music}`)];
    body.append(
      field('music', { type: 'enum', label: 'Music bed', options: ['none', ...beds] }, audio.music?.preset ?? 'none', (v) => {
        audio.music = v === 'none' ? null : { preset: v, seed: audio.music?.seed ?? 7, gain_db: audio.music?.gain_db ?? -2, end_hit: audio.music?.end_hit ?? true };
      }, { selectEnums: true }),
      field('auto_sfx', { type: 'bool', label: 'Automatic sound effects from motion' }, audio.auto_sfx, (v) => { audio.auto_sfx = v; }),
      field('target_lufs', { type: 'number', label: 'Loudness target LUFS', min: -30, max: -6, step: 0.5 }, audio.target_lufs, (v) => { audio.target_lufs = v; }),
    );
    $('#settings-dlg').showModal();
  }

  async _applySettings() {
    const { s, audio } = this._pending;
    const before = this.snapshot();
    const v = await fetch('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...this.project.toDict(), settings: s, audio }) }).then((r) => r.json()).catch(() => null);
    if (v && v.ok === false && v.errors?.some((e) => /settings|style|audio/.test(e))) {
      this.toast(v.errors.filter((e) => /settings|style|audio/.test(e)).slice(0, 3).join('\n'), 'error', 'settings');
      return;
    }
    if (s.style !== this.project.settings.style) await loadPack(s.style).catch((e) => this.toast(e.message, 'error'));
    this.project.settings = s;
    this.project.audio = audio;
    $('#settings-dlg').close();
    this.stage.resize();
    this.timeline.resize();
    this.commit(before, 'Project settings updated');
  }

  /** <select> of installed packs; `allowInherit` adds "Project style" (clip level). */
  styleSelect(label, value, onChange, allowInherit = true) {
    const options = [...(allowInherit ? ['(project)'] : []), ...registry.stylePacks().map((p) => p.id)];
    const optionLabels = Object.fromEntries(registry.stylePacks().map((p) => [p.id, p.label]));
    optionLabels['(project)'] = `Project style (${registry.stylePack(this.project.settings.style)?.label ?? this.project.settings.style})`;
    return field('style', { type: 'enum', label, options, optionLabels }, value ?? '(project)', async (v) => {
      const id = v === '(project)' ? null : v;
      if (id) await loadPack(id).catch((e) => this.toast(e.message, 'error'));
      onChange(id);
    }, { selectEnums: true });
  }

  _renderDialog(draftRange) {
    const r = this.timeline.range;
    $('#render-draft').checked = draftRange;
    $('#render-range').checked = draftRange && !!r;
    $('#render-range').disabled = !r;
    const s = this.project.settings;
    $('#render-info').textContent = `${this.project.name}: ${s.duration.toFixed(2)} s at ${s.fps} fps (${Math.round(s.duration * s.fps)} frames), style ${registry.stylePack(s.style)?.label ?? s.style}. ${r ? `Range ${r.t0.toFixed(2)}–${r.t1.toFixed(2)} s marked.` : 'Mark a range with I / O to render part of it.'}`;
    $('#render-dlg').showModal();
  }

  async _validate() {
    const v = await fetch('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.project.toDict()) }).then((r) => r.json()).catch((e) => ({ ok: false, errors: [e.message] }));
    if (v.ok) this.toast(`Project OK — ${v.beat_grid?.checked ?? 0} cuts/hits on the beat grid`, 'ok');
    else this.toast('Project has problems', 'error', 'validate', [...(v.errors ?? []), ...(v.beat_grid?.violations ?? []).map((x) => `${x.kind} at ${x.t}s is ${x.off_frames} frames off the grid (nearest ${x.nearest}s)`)].slice(0, 10).join('\n'));
  }

  _shortcuts() {
    const rows = [['Space', 'Play / pause'], ['Home / End', 'Start / end'], [', / .', 'Previous / next frame'], ['V / C', 'Select / razor tool'], ['S', 'Split at playhead'],
      ['Ctrl+D', 'Duplicate'], ['Del', 'Delete'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+S', 'Save'], ['Ctrl+R', 'Render'], ['Ctrl+Shift+R', 'Draft the in/out range'],
      ['I / O / Alt+X', 'In / out / clear range'], ['B', 'Beat snap on/off'], ['Shift+B', 'Snap selection to the grid'], ['Arrows (+Shift)', 'Nudge 1 px (10 px)'],
      ['Enter', 'Open Text Studio'], ['Alt-drag', 'Move without snapping'], ['Space-drag / middle-drag', 'Pan the stage'], ['Q', 'Render queue']];
    const body = $('#shortcuts-body');
    body.innerHTML = '';
    body.append(el('table', { class: 'keys' }, ...rows.map(([k, d]) => el('tr', {}, el('td', { text: k }), el('td', { text: d })))));
    $('#shortcuts-dlg').showModal();
  }

  // ── Render queue (WebSocket) ───────────────────────────────────────────────
  _wireSocket() {
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      this.jobs = this.jobs ?? new Map();
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'hello') for (const j of m.jobs) this.jobs.set(j.id, j);
        if (m.type === 'render') {
          const prev = this.jobs.get(m.job.id);
          this.jobs.set(m.job.id, m.job);
          if (prev?.status !== m.job.status && m.job.status === 'done') this.toast(`Render finished: ${m.job.output}`, 'ok');
          if (prev?.status !== m.job.status && m.job.status === 'failed') this.toast(m.job.error, 'error', m.job.code);
        }
        this._drawQueue();
      };
      ws.onclose = () => { this._server(false); setTimeout(connect, 2000); };
      ws.onopen = () => this._server(true, { ffmpeg: true });
    };
    connect();
  }

  _drawQueue() {
    const list = $('#queue-list');
    list.innerHTML = '';
    const jobs = [...this.jobs.values()].sort((a, b) => b.queued - a.queued);
    const running = jobs.filter((j) => ['queued', 'running'].includes(j.status)).length;
    const btn = $('#queue-btn');
    btn.querySelector('.badge')?.remove();
    if (running) btn.append(el('span', { class: 'badge', text: String(running) }));
    if (!jobs.length) { list.append(el('div', { class: 'job' }, el('span', { class: 'meta', text: 'Nothing rendered yet.' }))); return; }
    for (const j of jobs) {
      const p = j.progress ?? {};
      const row = el('div', { class: `job ${j.status === 'failed' ? 'failed' : ''}` },
        el('div', { class: 'top' }, el('b', { text: `${j.name} · ${j.preset}` }), el('span', { class: `chip ${j.status === 'done' ? 'lime' : j.status === 'failed' ? 'orange' : ''}`, text: j.status })),
        el('div', { class: 'bar' }, el('i', { style: `width:${p.percent ?? (j.status === 'done' ? 100 : 0)}%` })),
        el('span', { class: 'meta', text: j.status === 'running' ? `${p.stage ?? ''} ${p.done ?? 0}/${p.total ?? '?'} frames · ${p.fps ?? 0} fps · ETA ${p.eta ?? '–'} s` : j.status === 'failed' ? j.error : j.output ?? '' }));
      if (j.status === 'running' || j.status === 'queued') {
        const c = el('button', { class: 'btn sm', type: 'button', text: 'Cancel' });
        c.addEventListener('click', () => fetch(`/api/render/${j.id}/cancel`, { method: 'POST' }));
        row.append(c);
      }
      if (j.status === 'done' && j.output) {
        const b = el('button', { class: 'btn sm', type: 'button', text: 'Play' });
        b.addEventListener('click', () => {
          $('#player-title').textContent = j.name;
          $('#player-video').src = `/${j.output}`;
          $('#player-open').href = `/${j.output}`;
          $('#player-meta').textContent = `${j.report?.seconds ?? '?'} s render · ${j.report?.audio?.final?.integrated_lufs ?? '?'} LUFS`;
          $('#player-dlg').showModal();
        });
        row.append(b);
      }
      list.append(row);
    }
  }
}

const app = new App();
window.vidkit = app;
app.init().catch((e) => {
  console.error(e);
  document.body.append(el('div', { class: 'toast error', style: 'position:fixed;left:16px;bottom:48px' }, el('b', { text: 'Editor failed to start' }), el('pre', { text: String(e.stack ?? e) })));
});
