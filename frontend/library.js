// library.js — the left panel: scene templates and components (grouped by
// category, style-pack components under their pack), media (uploads + the
// licence-logged image library) and sounds (every synthesized voice, core and
// pack, with a preview). Items drag onto the timeline or add at the playhead.

import * as registry from './renderer/registry.js';
import { el, decorateIcons } from './forms.js';

const CAT_ICON = { Scenes: 'layout', Text: 'text-aa', Media: 'image', Shapes: 'shapes', Data: 'chart-bar', Chrome: 'sticker', Audio: 'speaker-high', Other: 'cube' };

export class Library {
  constructor(app) {
    this.app = app;
    this.tabs = document.querySelectorAll('#library .tabs button');
    this.tabs.forEach((b) => b.addEventListener('click', () => this.tab(b.dataset.tab)));
  }

  tab(name) {
    this.tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    for (const t of ['scenes', 'media', 'sounds']) document.getElementById(`lib-${t}`).classList.toggle('hidden', t !== name);
    if (name === 'media') this.media();
    if (name === 'sounds') this.sounds();
  }

  build() {
    const root = document.getElementById('lib-scenes');
    root.innerHTML = '';
    const groups = new Map();
    for (const d of registry.all()) {
      const g = d.pack ? `Style · ${registry.stylePack(d.pack)?.label ?? d.pack}` : d.category;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(d);
    }
    const order = ['Scenes', 'Text', 'Chrome', 'Shapes', 'Data', 'Media', 'Audio'];
    const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
    for (const g of keys) {
      const box = el('div', { class: 'lib-group' }, el('div', { class: 'label', text: g }));
      for (const d of groups.get(g)) {
        if (d.media) continue;   // media clips come from the Media tab
        const tile = el('button', { class: 'tile', type: 'button', draggable: 'true', title: d.description ?? '' },
          el('span', { class: 'sw', 'data-icon': CAT_ICON[d.category] ?? 'cube', style: `background:${d.kind === 'scene' ? 'var(--orange)' : d.pack ? 'var(--cobalt)' : 'var(--lime)'}` }),
          el('span', {}, el('b', { text: d.label ?? d.type }), el('small', { text: (d.description ?? '').slice(0, 70) })));
        tile.addEventListener('click', () => this.app.addClip(d.type));
        tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/vidkit-item', JSON.stringify({ kind: 'type', type: d.type })));
        box.append(tile);
      }
      if (box.children.length > 1) root.append(box);
    }
    decorateIcons(root);
  }

  async media() {
    const root = document.getElementById('lib-media');
    root.innerHTML = '';
    const input = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*,audio/*', style: 'display:none' });
    const drop = el('div', { class: 'dropzone' }, el('b', { text: 'Drop files or click to upload' }), el('p', { class: 'hint', text: 'Images, video and audio go to media/uploads/.' }));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); this.upload([...e.dataTransfer.files]); });
    input.addEventListener('change', () => this.upload([...input.files]));
    root.append(drop, input);
    const grid = el('div', { class: 'media-grid' });
    root.append(grid);
    try {
      this.app.mediaItems = await (await fetch('/media-list')).json();
    } catch { grid.append(el('p', { class: 'hint', text: 'Media list unavailable.' })); return; }
    for (const m of this.app.mediaItems) {
      const thumb = el('div', { class: 'thumb', style: m.kind === 'image' ? `background-image:url("/${m.url}")` : '' });
      if (m.kind !== 'image') thumb.dataset.icon = m.kind === 'video' ? 'video-camera' : 'waveform';
      const card = el('div', { class: 'media-card', draggable: 'true', title: m.credit ?? m.name }, thumb, el('div', { class: 'name', text: m.name }));
      const add = el('button', { class: 'btn sm icon add', type: 'button', title: 'Add at playhead', 'data-icon': 'plus' });
      add.addEventListener('click', (e) => { e.stopPropagation(); this.app.addMedia(m); });
      card.append(add);
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/vidkit-item', JSON.stringify({ kind: 'media', url: m.url, mediaKind: m.kind, metadata: m.metadata ?? null })));
      grid.append(card);
    }
    decorateIcons(root);
  }

  async upload(files) {
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      this.app.status(`Uploading ${f.name}…`);
      try {
        const r = await fetch('/upload', { method: 'POST', body: fd });
        if (!r.ok) throw new Error(r.statusText);
        const item = await r.json();
        this.app.toast(`Uploaded ${item.name}`, 'ok');
      } catch (e) { this.app.toast(`Upload failed: ${f.name} — ${e.message}`, 'error'); }
    }
    this.media();
  }

  async sounds() {
    const root = document.getElementById('lib-sounds');
    root.innerHTML = '';
    root.append(el('p', { class: 'hint', text: 'Every sound is synthesized in code. Motion cues pick them automatically; style packs remap them to their own voices.' }));
    let voices = [];
    try { voices = await (await fetch('/api/audio/voices')).json(); } catch { /* server offline */ }
    let group = null;
    for (const v of voices) {
      const g = v.includes('.') ? registry.stylePack(v.split('.')[0])?.label ?? v.split('.')[0] : 'Core';
      if (g !== group) { group = g; root.append(el('div', { class: 'label', style: 'margin:12px 0 6px', text: g })); }
      const play = el('button', { class: 'btn sm icon', type: 'button', title: 'Play', 'data-icon': 'play' });
      play.addEventListener('click', () => { this._audio?.pause(); this._audio = new Audio(`/api/audio/voice?name=${encodeURIComponent(v)}`); this._audio.play(); });
      root.append(el('div', { class: 'sound-row' }, el('b', { text: v.split('.').pop() }), el('small', { class: 'mono', text: v }), play));
    }
    decorateIcons(root);
  }
}
