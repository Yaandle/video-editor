// properties.js — Port of PropertiesPanel
import { THEMES } from './app.js';

export class PropertiesPanel {
  constructor(containerEl) {
    this._container = containerEl;
    this._clip      = null;
    this._updating  = false;
  }

  // ── Public API ──
  showClip(clip) {
    this._clip = clip;
    this._rebuild();
  }

  clear() {
    this._clip = null;
    this._rebuild();
  }

  // ── Internal ──
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

    // Read-only type/track
    this._addLabelRow('type',  c.clip_type);
    this._addLabelRow('track', c.track);

    // ── Timing ──
    this._addSection('Timing');
    const startSpin = this._addDoubleSpin('Start (s)',    c.start,    0,   3600, 0.1, 2);
    const durSpin   = this._addDoubleSpin('Duration (s)', c.duration, 0.5, 600,  0.5, 2);
    startSpin.addEventListener('change', () => this._set('start',    parseFloat(startSpin.value)));
    durSpin.addEventListener(  'change', () => this._set('duration', parseFloat(durSpin.value)));

    // ── Position (text / visual clips) ──
    if (c.track === 'text' || c.track === 'visual') {
      this._addSection('Canvas position');
      const xSpin = this._addDoubleSpin('X (0–1)', c.x, 0, 1, 0.01, 3);
      const ySpin = this._addDoubleSpin('Y (0–1)', c.y, 0, 1, 0.01, 3);
      xSpin.addEventListener('change', () => this._set('x', parseFloat(xSpin.value)));
      ySpin.addEventListener('change', () => this._set('y', parseFloat(ySpin.value)));

      const snapBtn = document.createElement('button');
      snapBtn.className   = 'props-btn';
      snapBtn.textContent = 'Snap to preset…';
      snapBtn.addEventListener('click', () => {
        this._container.dispatchEvent(new CustomEvent('props:snap', { bubbles: true }));
      });
      this._container.appendChild(snapBtn);
    }

    // ── Content ──
    if (c.clip_type === 'narration' || c.clip_type === 'audio') {
      this._addSection('Content');
      const te = this._addTextarea(c.content, 90);
      te.addEventListener('input', () => this._set('content', te.value));
    }
    else if (c.clip_type === 'code') {
      this._addSection('Code');
      const pathInput = document.createElement('input');
      pathInput.type        = 'text';
      pathInput.className   = 'props-input-text';
      pathInput.value       = c.code_file;
      pathInput.placeholder = 'path/to/file.py';
      pathInput.addEventListener('input', () => this._set('code_file', pathInput.value));
      this._container.appendChild(pathInput);

      const browseBtn = document.createElement('button');
      browseBtn.className   = 'props-btn';
      browseBtn.textContent = 'Browse…';
      browseBtn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type   = 'file';
        fileInput.onchange = () => {
          if (fileInput.files[0]) {
            pathInput.value = fileInput.files[0].name;
            this._set('code_file', fileInput.files[0].name);
          }
        };
        fileInput.click();
      });
      this._container.appendChild(browseBtn);

      const inlineLbl = document.createElement('span');
      inlineLbl.className   = 'props-inline-label';
      inlineLbl.textContent = 'Inline code (overrides file):';
      this._container.appendChild(inlineLbl);
      const inlineTe = this._addTextarea(c.content, 90);
      inlineTe.addEventListener('input', () => this._set('content', inlineTe.value));
    }
    else if (c.clip_type === 'graph') {
      this._addSection('Graph');
      const gtCombo = this._addCombo('Type', ['bar', 'line'], c.graph_type);
      gtCombo.addEventListener('change', () => this._set('graph_type', gtCombo.value));

      this._addSection('Data  (label:value, …)');
      const dataTe = this._addTextarea(c.graph_data, 70);
      dataTe.addEventListener('input', () => this._set('graph_data', dataTe.value));
    }

    // ── Style ──
    if (c.clip_type !== 'audio') {
      this._addSection('Style');
      const themeCombo = this._addCombo('Theme', Object.keys(THEMES), c.theme);
      themeCombo.addEventListener('change', () => this._set('theme', themeCombo.value));
    }

    if (c.clip_type === 'narration' || c.clip_type === 'code') {
      const animCombo = this._addCombo('Animation', ['typewriter', 'wordblurin', 'linescan', 'static'], c.animation);
      animCombo.addEventListener('change', () => this._set('animation', animCombo.value));
    }

    // Stretch spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this._container.appendChild(spacer);
  }

  _set(attr, value) {
    if (this._clip && !this._updating) {
      this._clip[attr] = value;
      this._container.dispatchEvent(new CustomEvent('props:changed', { bubbles: true }));
    }
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
    const k = document.createElement('span');
    k.className   = 'pk';
    k.textContent = key;
    const v = document.createElement('span');
    v.className   = 'pv';
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    this._container.appendChild(row);
  }

  _addDoubleSpin(label, value, min, max, step, decimals) {
    const row = document.createElement('div');
    row.className = 'props-spin-row';
    const lbl = document.createElement('label');
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
      opt.value = item;
      opt.textContent = item;
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
    te.className = 'props-textarea' + (height <= 70 ? ' short' : '');
    te.style.height = height + 'px';
    te.value = content;
    this._container.appendChild(te);
    return te;
  }
}
