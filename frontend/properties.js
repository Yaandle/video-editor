// properties.js — PropertiesPanel
import { THEMES } from './app.js';

export class PropertiesPanel {
  constructor(containerEl) {
    this._container = containerEl;
    this._clip      = null;
    this._updating  = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  showClip(clip) {
    this._clip = clip;
    this._rebuild();
  }

  clear() {
    this._clip = null;
    this._rebuild();
  }

  // ── Build ────────────────────────────────────────────────────────────────────
  _rebuild() {
    this._container.innerHTML = '';

    if (!this._clip) {
      const ph = document.createElement('div');
      ph.className   = 'props-placeholder';
      ph.textContent = 'No clip selected';
      this._container.appendChild(ph);
      return;
    }

    const c = this._clip;

    // Read-only type / track
    this._addLabelRow('type',  c.clip_type);
    this._addLabelRow('track', c.track);

    // ── Timing ──────────────────────────────────────────────────────────────
    this._addSection('Timing');
    const startSpin = this._addSpin('Start (s)',    c.start,    0,   3600, 0.1, 2);
    const durSpin   = this._addSpin('Duration (s)', c.duration, 0.1, 600,  0.1, 2);
    this._onInputAndChange(startSpin, v => this._set('start',    v));
    this._onInputAndChange(durSpin,   v => this._set('duration', v));

    // ── Canvas position (text + visual only) ────────────────────────────────
    if (c.track === 'text' || c.track === 'visual') {
      this._addSection('Canvas position');
      const xSpin = this._addSpin('X (0–1)', c.x, 0, 1, 0.01, 3);
      const ySpin = this._addSpin('Y (0–1)', c.y, 0, 1, 0.01, 3);
      this._onInputAndChange(xSpin, v => this._set('x', v));
      this._onInputAndChange(ySpin, v => this._set('y', v));

      const snapBtn = document.createElement('button');
      snapBtn.className   = 'props-btn';
      snapBtn.textContent = 'Snap to preset…';
      snapBtn.addEventListener('click', () =>
        this._container.dispatchEvent(new CustomEvent('props:snap', { bubbles: true }))
      );
      this._container.appendChild(snapBtn);
    }

    // ── Per-type content ─────────────────────────────────────────────────────
    switch (c.clip_type) {

      case 'narration': {
        this._addSection('Content');
        const te = this._addTextarea(c.content, 90);
        te.addEventListener('input', () => this._set('content', te.value));
        break;
      }

      case 'audio': {
        this._addSection('Content / script');
        const te = this._addTextarea(c.content, 70);
        te.addEventListener('input', () => this._set('content', te.value));
        this._addSection('Voice');
        const voiceInput = this._addTextInput(c.voice_id, 'ElevenLabs voice ID');
        voiceInput.addEventListener('input', () => this._set('voice_id', voiceInput.value));
        break;
      }

      case 'code': {
        this._addSection('Code file');
        const pathInput = this._addTextInput(c.code_file, 'path/to/file.py');
        pathInput.addEventListener('input', () => this._set('code_file', pathInput.value));

        const browseBtn = document.createElement('button');
        browseBtn.className   = 'props-btn';
        browseBtn.textContent = 'Browse…';
        browseBtn.addEventListener('click', () => {
          const fi = document.createElement('input');
          fi.type = 'file';
          fi.onchange = () => {
            if (fi.files[0]) {
              pathInput.value = fi.files[0].name;
              this._set('code_file', fi.files[0].name);
            }
          };
          fi.click();
        });
        this._container.appendChild(browseBtn);

        this._addSection('Terminal');
        const promptInput = this._addTextInput(c.terminal_prompt, 'user@vidkit:~$');
        promptInput.addEventListener('input', () => this._set('terminal_prompt', promptInput.value));

        const titleInput = this._addTextInput(c.terminal_title, 'window title (optional)');
        titleInput.addEventListener('input', () => this._set('terminal_title', titleInput.value));

        const inlineLbl = document.createElement('span');
        inlineLbl.className   = 'props-inline-label';
        inlineLbl.textContent = 'Inline code (overrides file):';
        this._container.appendChild(inlineLbl);
        const inlineTe = this._addTextarea(c.content, 90);
        inlineTe.addEventListener('input', () => this._set('content', inlineTe.value));
        break;
      }

      case 'graph': {
        this._addSection('Graph');
        const gtCombo = this._addCombo('Type', ['bar', 'line', 'pie'], c.graph_type);
        gtCombo.addEventListener('change', () => this._set('graph_type', gtCombo.value));
        this._addSection('Data  (label:value, …)');
        const dataTe = this._addTextarea(c.graph_data, 70);
        dataTe.addEventListener('input', () => this._set('graph_data', dataTe.value));
        break;
      }

      case 'image': {
        this._addSection('Image file');
        const urlLbl = document.createElement('span');
        urlLbl.className   = 'props-inline-label';
        urlLbl.textContent = 'URL / path:';
        this._container.appendChild(urlLbl);
        const urlInput = this._addTextInput(c.code_file, 'https:// or /static/…');
        urlInput.addEventListener('input', () => this._set('code_file', urlInput.value));

        this._addSection('Size');
        const scaleSpin = this._addSpin('Scale', c.scale ?? 1.0, 0.05, 4.0, 0.05, 2);
        this._onInputAndChange(scaleSpin, v => this._set('scale', v));
        break;
      }

      case 'video': {
        this._addSection('Video file');
        const urlLbl = document.createElement('span');
        urlLbl.className   = 'props-inline-label';
        urlLbl.textContent = 'URL / path:';
        this._container.appendChild(urlLbl);
        const urlInput = this._addTextInput(c.code_file, 'https:// or /static/…');
        urlInput.addEventListener('input', () => this._set('code_file', urlInput.value));
        break;
      }
    }

    // ── Style (all non-audio) ────────────────────────────────────────────────
    if (c.clip_type !== 'audio') {
      this._addSection('Style');
      const themeCombo = this._addCombo('Theme', Object.keys(THEMES), c.theme);
      themeCombo.addEventListener('change', () => this._set('theme', themeCombo.value));
    }

    if (c.clip_type === 'code') {
      const animCombo = this._addCombo(
        'Animation',
        ['typewriter', 'static'],
        c.animation
      );
      animCombo.addEventListener('change', () => this._set('animation', animCombo.value));
    }

    if (c.clip_type === 'narration') {
      const animCombo = this._addCombo(
        'Animation',
        ['static', 'typewriter', 'wordblurin', 'linescan'],
        c.text_anim_style ?? 'static'
      );
      animCombo.addEventListener('change', () => this._set(
        'text_anim_style', animCombo.value === 'static' ? null : animCombo.value
      ));
    }

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this._container.appendChild(spacer);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  _set(attr, value) {
    if (this._clip && !this._updating) {
      this._clip[attr] = value;
      this._container.dispatchEvent(new CustomEvent('props:changed', { bubbles: true }));
    }
  }

  // Fire on both input (arrow keys / typing) and change (blur), deduplicated
  _onInputAndChange(input, fn) {
    let last = input.value;
    const handle = () => {
      const v = parseFloat(input.value);
      if (!isNaN(v) && input.value !== last) {
        last = input.value;
        fn(v);
      }
    };
    input.addEventListener('input',  handle);
    input.addEventListener('change', handle);
  }

  _addSection(title) {
    const lbl = document.createElement('span');
    lbl.className   = 'props-section-label';
    lbl.textContent = title.toUpperCase();
    this._container.appendChild(lbl);
  }

  _addLabelRow(key, value) {
    const row = document.createElement('div');
    row.className = 'props-label-row';
    const k = document.createElement('span'); k.className = 'pk'; k.textContent = key;
    const v = document.createElement('span'); v.className = 'pv'; v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    this._container.appendChild(row);
  }

  _addSpin(label, value, min, max, step, decimals) {
    const row   = document.createElement('div');
    row.className = 'props-spin-row';
    const lbl   = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type  = 'number';
    input.min   = min;
    input.max   = max;
    input.step  = step;
    input.value = value.toFixed(decimals);
    row.appendChild(lbl);
    row.appendChild(input);
    this._container.appendChild(row);
    return input;
  }

  _addCombo(label, items, current) {
    const row = document.createElement('div');
    row.className = 'props-combo-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const sel = document.createElement('select');
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item; opt.textContent = item;
      if (item === current) opt.selected = true;
      sel.appendChild(opt);
    }
    row.appendChild(lbl);
    row.appendChild(sel);
    this._container.appendChild(row);
    return sel;
  }

  _addTextarea(content, height) {
    const te = document.createElement('textarea');
    te.className    = 'props-textarea' + (height <= 70 ? ' short' : '');
    te.style.height = height + 'px';
    te.value        = content ?? '';
    this._container.appendChild(te);
    return te;
  }

  _addTextInput(value, placeholder = '') {
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'props-input-text';
    input.value       = value ?? '';
    input.placeholder = placeholder;
    this._container.appendChild(input);
    return input;
  }
}