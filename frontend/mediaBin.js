// mediaBin.js — Media browser / upload panel
export class MediaBin {
  constructor(containerEl) {
    this._el    = containerEl;
    this._items = [];
    this._onAdd = null;
    this._build();
  }

  onAddClip(fn) { this._onAdd = fn; }

  addItem(item) {
    if (this._items.find(i => i.url === item.url)) return;
    this._items.push(item);
    this._renderGrid();
  }

  setItems(items) { this._items = items; this._renderGrid(); }

  // ── DOM ──
  _build() {
    this._el.innerHTML = '';

    const header = document.createElement('div');
    header.id = 'mediabin-header';
    header.textContent = 'MEDIA';
    this._el.appendChild(header);

    const zone = document.createElement('div');
    zone.id = 'mediabin-dropzone';
    const hint = document.createElement('span');
    hint.textContent = 'Drop files or';
    const uploadBtn = document.createElement('button');
    uploadBtn.className   = 'btn btn-add';
    uploadBtn.textContent = '+ Upload';
    uploadBtn.addEventListener('click', () => this._pickFiles());
    zone.appendChild(hint);
    zone.appendChild(uploadBtn);
    this._el.appendChild(zone);

    zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      [...e.dataTransfer.files].forEach(f => this._uploadFile(f));
    });

    this._grid = document.createElement('div');
    this._grid.id = 'mediabin-grid';
    this._el.appendChild(this._grid);
  }

  _renderGrid() {
    this._grid.innerHTML = '';
    if (!this._items.length) {
      const empty = document.createElement('div');
      empty.className   = 'mediabin-empty';
      empty.textContent = 'No media yet';
      this._grid.appendChild(empty);
      return;
    }
    this._items.forEach(item => this._grid.appendChild(this._makeCard(item)));
  }

  _makeCard(item) {
    const card = document.createElement('div');
    card.className  = 'mediabin-card';
    card.draggable  = true;
    card.title      = item.original ?? item.name;

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'mediabin-thumb';

    if (item.kind === 'image' || item.kind === 'svg') {
      const img = document.createElement('img');
      img.src = item.url;
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      thumb.appendChild(img);
    } else if (item.kind === 'video') {
      const vid = document.createElement('video');
      vid.src   = item.url;
      vid.muted = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      vid.addEventListener('loadeddata', () => { vid.currentTime = 0.5; });
      thumb.appendChild(vid);
    } else {
      const icon = document.createElement('div');
      icon.className   = 'mediabin-icon';
      icon.textContent = item.kind === 'audio' ? '♪' : '?';
      thumb.appendChild(icon);
    }

    card.appendChild(thumb);

    const lbl = document.createElement('div');
    lbl.className   = 'mediabin-label';
    const n = item.original ?? item.name;
    lbl.textContent = n.length > 18 ? n.slice(0, 15) + '…' : n;
    card.appendChild(lbl);

    const addBtn = document.createElement('div');
    addBtn.className   = 'mediabin-add-btn';
    addBtn.textContent = '+';
    addBtn.title       = 'Add to timeline';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._onAdd?.(item); });
    card.appendChild(addBtn);

    // Drag from bin → timeline drop zone
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/vidkit-media', JSON.stringify(item));
    });

    return card;
  }

  // ── Upload ──
  _pickFiles() {
    const input = document.createElement('input');
    input.type     = 'file';
    input.multiple = true;
    input.accept   = 'image/*,video/*,audio/*,.svg';
    input.onchange = () => [...input.files].forEach(f => this._uploadFile(f));
    input.click();
  }

  async _uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    try {
      const res  = await fetch('/upload', { method: 'POST', body: form });
      if (!res.ok) { console.error('Upload failed:', await res.text()); return; }
      this.addItem(await res.json());
    } catch (err) {
      console.error('Upload error:', err);
    }
  }
}