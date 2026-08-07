// mediaBin.js — Media browser / upload panel + built-in sound effects (#72)
const THUMB_FIT_STYLE = 'width:100%;height:100%;object-fit:contain;';

export class MediaBin {
  constructor(containerEl) {
    this._el = containerEl;
    this._items = [];
    this._sfxItems = [];
    this._onAdd = null;
    this._previewAudio = null; // shared <audio> for sfx preview playback
    this._playingSfxRow = null;
    this._build();
  }

  onAddClip(fn) { this._onAdd = fn; }

  addItem(item) {
    if (this._items.find(i => i.url === item.url)) return;
    this._items.push(item);
    this._renderGrid();
  }

  // #72 — built-in sound effects (fetched from /sfx-list), kept in their own
  // section: no upload/delete, just preview + drag/add like regular media.
  addSfxItem(item) {
    if (this._sfxItems.find(i => i.url === item.url)) return;
    this._sfxItems.push(item);
    this._renderSfxList();
  }

  _build() {
    this._el.innerHTML = '';

    // Single scroll container so the panel has one scrollbar across both
    // the media grid and the sound-effects list below it.
    const scroll = document.createElement('div');
    scroll.id = 'mediabin-scroll';
    this._el.appendChild(scroll);

    const header = document.createElement('div');
    header.className = 'mediabin-section-header';
    header.id = 'mediabin-header';
    header.textContent = 'MEDIA';
    scroll.appendChild(header);

    const zone = document.createElement('div');
    zone.id = 'mediabin-dropzone';
    const hint = document.createElement('span');
    hint.textContent = 'Drop files or';
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn btn-add';
    uploadBtn.textContent = '+ Upload';
    uploadBtn.addEventListener('click', () => this._pickFiles());
    zone.appendChild(hint);
    zone.appendChild(uploadBtn);
    scroll.appendChild(zone);

    // #67b — accept drops from the OS file explorer anywhere on the media
    // panel, not just the small dropzone. Without the document-level
    // preventDefault the browser navigates to the dropped file instead.
    if (!MediaBin._pageDropGuarded) {
      MediaBin._pageDropGuarded = true;
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => e.preventDefault());
    }

    let dragDepth = 0;
    const setDragOver = (on) => {
      zone.classList.toggle('drag-over', on);
      this._el.classList.toggle('drag-over', on);
    };
    this._el.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      setDragOver(true);
    });
    this._el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    this._el.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    });
    this._el.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      setDragOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) files.forEach(f => this._uploadFile(f));
    });

    this._grid = document.createElement('div');
    this._grid.id = 'mediabin-grid';
    scroll.appendChild(this._grid);

    const sfxHeader = document.createElement('div');
    sfxHeader.className = 'mediabin-section-header';
    sfxHeader.id = 'sfxbin-header';
    sfxHeader.textContent = 'SOUND EFFECTS';
    scroll.appendChild(sfxHeader);

    this._sfxList = document.createElement('div');
    this._sfxList.id = 'sfxbin-list';
    scroll.appendChild(this._sfxList);

    this._renderGrid();
    this._renderSfxList();
  }

  _renderGrid() {
    this._grid.innerHTML = '';
    if (!this._items.length) {
      const empty = document.createElement('div');
      empty.className = 'mediabin-empty';
      empty.textContent = 'No media yet';
      this._grid.appendChild(empty);
      return;
    }
    this._items.forEach(item => this._grid.appendChild(this._makeCard(item)));
  }

  _makeCard(item) {
    const card = document.createElement('div');
    card.className = 'mediabin-card';
    card.draggable = true;
    card.title = item.original ?? item.name;

    const thumb = document.createElement('div');
    thumb.className = 'mediabin-thumb';

    if (item.kind === 'image' || item.kind === 'svg') {
      const img = document.createElement('img');
      img.src = item.url;
      img.style.cssText = THUMB_FIT_STYLE;
      thumb.appendChild(img);
    } else if (item.kind === 'video') {
      const vid = document.createElement('video');
      vid.src = item.url;
      vid.muted = true;
      vid.style.cssText = THUMB_FIT_STYLE;
      vid.addEventListener('loadeddata', () => { vid.currentTime = 0.5; });
      thumb.appendChild(vid);
    } else {
      const icon = document.createElement('div');
      icon.className = 'mediabin-icon';
      icon.textContent = item.kind === 'audio' ? '♪' : '?';
      thumb.appendChild(icon);
    }

    card.appendChild(thumb);

    const lbl = document.createElement('div');
    lbl.className = 'mediabin-label';
    const n = item.original ?? item.name;
    lbl.textContent = n.length > 18 ? n.slice(0, 15) + '…' : n;
    card.appendChild(lbl);

    const addBtn = document.createElement('div');
    addBtn.className = 'mediabin-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add to timeline';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._onAdd?.(item); });
    card.appendChild(addBtn);

    const delBtn = document.createElement('div');
    delBtn.className = 'mediabin-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from media bin';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._removeItem(item);
    });
    card.appendChild(delBtn);

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/vidkit-media', JSON.stringify(item));
    });

    return card;
  }

  // ── Sound effects (#72) ──────────────────────────────────────────────
  _renderSfxList() {
    this._sfxList.innerHTML = '';
    if (!this._sfxItems.length) {
      const empty = document.createElement('div');
      empty.className = 'mediabin-empty';
      empty.textContent = 'No sound effects found';
      this._sfxList.appendChild(empty);
      return;
    }
    this._sfxItems.forEach(item => this._sfxList.appendChild(this._makeSfxRow(item)));
  }

  _makeSfxRow(item) {
    const row = document.createElement('div');
    row.className = 'sfx-row';
    row.draggable = true;
    row.title = `${item.original ?? item.name} — drag onto the timeline`;

    const playBtn = document.createElement('button');
    playBtn.className = 'sfx-play-btn';
    playBtn.textContent = '▶';
    playBtn.title = 'Preview';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._previewSfx(item, row, playBtn);
    });
    row.appendChild(playBtn);

    const lbl = document.createElement('div');
    lbl.className = 'sfx-name';
    lbl.textContent = item.original ?? item.name;
    row.appendChild(lbl);

    const addBtn = document.createElement('div');
    addBtn.className = 'sfx-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add to timeline';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._onAdd?.(item); });
    row.appendChild(addBtn);

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/vidkit-media', JSON.stringify(item));
    });

    return row;
  }

  _previewSfx(item, row, playBtn) {
    if (!this._previewAudio) this._previewAudio = new Audio();
    const a = this._previewAudio;
    // Clicking the currently-playing row's button again stops it.
    if (this._playingSfxRow === row && !a.paused) {
      a.pause();
      a.currentTime = 0;
      this._setSfxPlayingState(null);
      return;
    }
    try { a.pause(); } catch {}
    a.src = item.url;
    a.currentTime = 0;
    a.play().catch(() => {});
    this._setSfxPlayingState(row);
    a.onended = () => this._setSfxPlayingState(null);
  }

  _setSfxPlayingState(row) {
    this._sfxList?.querySelectorAll('.sfx-row.playing').forEach(r => {
      r.classList.remove('playing');
      const btn = r.querySelector('.sfx-play-btn');
      if (btn) btn.textContent = '▶';
    });
    this._playingSfxRow = row;
    if (row) {
      row.classList.add('playing');
      const btn = row.querySelector('.sfx-play-btn');
      if (btn) btn.textContent = '■';
    }
  }

  _removeItem(item) {
    this._items = this._items.filter(i => i.url !== item.url);
    this._renderGrid();
    this._onDelete?.(item);
  }

  onDeleteClip(fn) { this._onDelete = fn; }

  _pickFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*,.svg';
    input.onchange = () => [...input.files].forEach(f => this._uploadFile(f));
    input.click();
  }

  async _uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const zone = this._el.querySelector('#mediabin-dropzone');
    const hint = zone?.querySelector('span');
    const prevText = hint?.textContent;
    if (hint) hint.textContent = `Uploading ${file.name.slice(0, 18)}…`;
    try {
      const res = await fetch('/upload', { method: 'POST', body: form });
      if (!res.ok) { console.error('Upload failed:', await res.text()); return; }
      this.addItem(await res.json());
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      if (hint) hint.textContent = prevText;
    }
  }
}
