// inspector.js — schema-driven properties for the selection. Every clip type's
// props come from its registry schema; the envelope (timing, transform,
// enter/exit) and the style pack are the same for every type. With nothing
// selected it shows the project: its style pack ("scene settings") and params.

import * as registry from './renderer/registry.js';
import { el, field, section, schemaFields } from './forms.js';

const PRESETS = ['snappy', 'slam', 'soft', 'quick', 'wobble'];
const FROMS = ['none', 'rise', 'drop', 'left', 'right', 'scale', 'fade'];

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.clips = [];
    this.before = null;
  }

  /** Coalesce live edits into one undo step: snapshot on the first change, commit on `final`. */
  _edit(fn, final) {
    if (!this.before) this.before = this.app.snapshot();
    fn();
    if (final) {
      const b = this.before;
      this.before = null;
      this.app.commit(b);
    } else {
      this.app.liveUpdate();
    }
  }

  show(clips) {
    this.clips = clips;
    this.before = null;
    this.render();
  }

  refreshValues() { /* fields hold their own values; a full rebuild happens on selection change */ }

  render() {
    const r = this.root;
    r.innerHTML = '';
    const chip = document.getElementById('insp-kind');
    if (!this.clips.length) { chip.textContent = 'project'; this._project(); return; }
    if (this.clips.length > 1) { chip.textContent = `${this.clips.length} clips`; this._multi(); return; }
    const clip = this.clips[0];
    const def = registry.get(clip.type);
    chip.textContent = def?.kind ?? 'clip';
    r.append(el('div', { class: 'insp-head' },
      el('span', { class: 'label', text: def?.category ?? 'Clip' }),
      el('h3', { text: def?.label ?? clip.type }),
      el('p', { class: 'hint', text: def?.description ?? '' })));
    if (!def) { r.append(el('p', { class: 'warn', text: `Unknown clip type "${clip.type}" — is its style pack installed?` })); return; }
    if (clip.type === 'text' || def.textStudio) {
      const b = el('button', { class: 'btn', type: 'button', 'data-icon': 'text-aa', text: 'Open in Text Studio' });
      b.addEventListener('click', () => this.app.openTextStudio(clip));
      r.append(el('div', { class: 'rows', style: 'padding:12px' }, b));
    }
    const props = this.app.renderer.props(clip.id) ?? registry.defaults(clip.type);
    if (Object.keys(def.schema).length) {
      r.append(section('Content', true, ...schemaFields(def.schema, props, (k, v, meta) => this._edit(() => { clip.props = { ...clip.props, [k]: v }; }, meta.final), { assetList: 'asset-list' })));
    }
    r.append(this._styleSection(clip));
    r.append(this._timing(clip, def));
    if (def.visual !== false) r.append(this._transform(clip, def));
    if (def.visual !== false && def.kind !== 'scene') r.append(this._enterExit(clip));
    this._assetDatalist();
  }

  _styleSection(clip) {
    const rows = [];
    rows.push(this.app.styleSelect('Style pack', clip.style, (id) => this._edit(() => { clip.style = id; clip.style_params = {}; }, true) || this.render()));
    const id = clip.style ?? this.app.project.settings.style;
    const pack = registry.stylePack(id);
    if (clip.style && pack && Object.keys(pack.schema).length) {
      rows.push(...schemaFields(pack.schema, registry.styleParams(id, clip.style_params).value,
        (k, v, meta) => this._edit(() => { clip.style_params = { ...(clip.style_params ?? {}), [k]: v }; }, meta.final)));
    }
    rows.push(el('p', { class: 'hint', text: pack?.description ?? '' }));
    return section('Style', !!clip.style, ...rows);
  }

  _timing(clip, def) {
    const num = (k, label, o) => field(k, { type: 'number', label, ...o }, clip[k], (v, m) => this._edit(() => { clip[k] = v; }, m.final), { noRange: true });
    const rows = [el('div', { class: 'field-row' }, num('start', 'Start s', { min: 0, step: 0.001 }), num('duration', 'Duration s', { min: 0.04, step: 0.001 })),
      num('layer', 'Layer (0 draws on top)', { min: 0, max: 999, step: 1 })];
    if (def.media === 'video' || def.media === 'audio') {
      rows.push(el('div', { class: 'field-row' }, num('source_start', 'Source in s', { min: 0, step: 0.01 }), num('speed', 'Speed ×', { min: 0.1, max: 8, step: 0.05 })));
    }
    const snap = el('button', { class: 'btn sm', type: 'button', 'data-icon': 'metronome', text: 'Snap to beat grid' });
    snap.addEventListener('click', () => this.app.snapSelected());
    rows.push(snap);
    return section('Timing', false, ...rows);
  }

  _transform(clip, def) {
    const num = (k, label, o) => field(k, { type: 'number', label, ...o }, clip[k], (v, m) => this._edit(() => { clip[k] = v; }, m.final));
    const rows = [];
    if (def.kind !== 'scene') {
      rows.push(el('div', { class: 'field-row' }, num('x', 'X (frame)', { min: -0.5, max: 1.5, step: 0.001 }), num('y', 'Y (frame)', { min: -0.5, max: 1.5, step: 0.001 })),
        el('div', { class: 'field-row' }, num('scale_x', 'Scale X', { min: 0.05, max: 8, step: 0.01 }), num('scale_y', 'Scale Y', { min: 0.05, max: 8, step: 0.01 })),
        num('rotation', 'Rotation °', { min: -180, max: 180, step: 0.5 }));
      if (clip.keyframes?.length) {
        const clear = el('button', { class: 'btn sm', type: 'button', text: `Clear ${clip.keyframes.length} motion stops` });
        clear.addEventListener('click', () => this._edit(() => { clip.keyframes = []; }, true));
        rows.push(field('keyframe_mode', { type: 'enum', label: 'Motion path', options: ['spring', 'linear'] }, clip.keyframe_mode, (v) => this._edit(() => { clip.keyframe_mode = v; }, true)), clear);
      }
    }
    rows.push(num('opacity', 'Opacity', { min: 0, max: 1, step: 0.01 }));
    return section('Transform', false, ...rows);
  }

  _enterExit(clip) {
    const en = clip.enter ?? { preset: 'snappy', from: 'none', delay: 0, hit: false, sfx: true };
    const ex = clip.exit ?? { preset: 'quick', to: 'none', length: 0.4 };
    const setEn = (k, v, final) => this._edit(() => { clip.enter = { ...en, [k]: v }; if (clip.enter.from === 'none') clip.enter = null; en[k] = v; }, final);
    const setEx = (k, v, final) => this._edit(() => { clip.exit = { ...ex, [k]: v }; if (clip.exit.to === 'none') clip.exit = null; ex[k] = v; }, final);
    return section('Enter / exit', false,
      field('from', { type: 'enum', label: 'Enter from', options: FROMS }, en.from, (v, m) => setEn('from', v, m.final), { selectEnums: true }),
      field('preset', { type: 'enum', label: 'Enter spring', options: PRESETS }, en.preset, (v, m) => setEn('preset', v, m.final), { selectEnums: true }),
      field('delay', { type: 'number', label: 'Enter delay s', min: 0, max: 30, step: 0.01 }, en.delay, (v, m) => setEn('delay', v, m.final), { noRange: true }),
      field('hit', { type: 'bool', label: 'Impact on arrival (beat-locked)' }, en.hit, (v, m) => setEn('hit', v, m.final)),
      field('to', { type: 'enum', label: 'Exit to', options: FROMS }, ex.to, (v, m) => setEx('to', v, m.final), { selectEnums: true }),
      field('length', { type: 'number', label: 'Exit length s', min: 0.05, max: 10, step: 0.01 }, ex.length, (v, m) => setEx('length', v, m.final), { noRange: true }));
  }

  _multi() {
    const n = this.clips.length;
    this.root.append(el('div', { class: 'insp-empty' }, el('h3', { text: `${n} clips selected` }), el('p', { text: 'Move them together on the stage or the timeline. Style applies to all of them:' })));
    this.root.append(section('Style', true, this.app.styleSelect('Style pack', this.clips[0].style, (id) => this._edit(() => { for (const c of this.clips) { c.style = id; c.style_params = {}; } }, true))));
  }

  _project() {
    const p = this.app.project;
    const s = p.settings;
    this.root.append(el('div', { class: 'insp-empty' }, el('h3', { text: p.name }),
      el('p', { text: `${s.width}×${s.height} · ${s.fps} fps · ${s.bpm ?? '—'} BPM · ${s.duration.toFixed(2)} s · ${p.clips.length} clips` })));
    const rows = [this.app.styleSelect('Project style pack', s.style, (id) => this._edit(() => { s.style = id ?? 'neo-brutal'; s.style_params = {}; }, true) || this.render(), false)];
    const pack = registry.stylePack(s.style);
    if (pack && Object.keys(pack.schema).length) {
      rows.push(...schemaFields(pack.schema, registry.styleParams(s.style, s.style_params).value, (k, v, m) => this._edit(() => { s.style_params = { ...s.style_params, [k]: v }; }, m.final)));
    }
    rows.push(el('p', { class: 'hint', text: `${pack?.description ?? ''} Clips can override it in their own Style section (at most two packs on screen at once).` }));
    this.root.append(section('Scene style', true, ...rows));
    const more = el('button', { class: 'btn', type: 'button', 'data-icon': 'gear', text: 'Project settings…' });
    more.addEventListener('click', () => this.app.action('settings'));
    this.root.append(el('div', { class: 'rows', style: 'padding:12px' }, more));
  }

  _assetDatalist() {
    if (document.getElementById('asset-list')) return;
    const dl = el('datalist', { id: 'asset-list' });
    for (const m of this.app.mediaItems) dl.append(el('option', { value: m.url }));
    document.body.append(dl);
  }
}
