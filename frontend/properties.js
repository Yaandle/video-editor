// properties.js — PropertiesPanel
import { THEMES } from './app.js';
import { createColorPicker } from './colorPicker.js';

export class PropertiesPanel {
  constructor(containerEl) {
    this._container = containerEl;
    this._clips = []; 
    this._updating = false;
    this._dirtySinceCommit = false;
    this._container.addEventListener('change', () => this._commitNow());
  }

  showClip(clip) { this._clip = clip; this._clips = clip ? [clip] : []; this._rebuild(); }
  showMultiple(clips) { this._clips = clips ?? []; this._clip = this._clips[0] ?? null; this._rebuild(); } 
  clear() { this._clip = null; this._clips = []; this._rebuild(); }

  _commitNow() {
    if (this._dirtySinceCommit) {
      this._dirtySinceCommit = false;
      this._container.dispatchEvent(new CustomEvent('props:commit', { bubbles: true }));
    }
  }



  _rebuild() {
    this._container.innerHTML = '';

    if (!this._clip) {
      const ph = document.createElement('div');
      ph.className = 'props-placeholder';
      ph.textContent = 'No clip selected';
      this._container.appendChild(ph);
      return;
    }

    const c = this._clip;

    this._addLabelRow('type', c.clip_type);
    this._addLabelRow('track', c.track);

    const multi = this._clips.length > 1;
    if (multi) {
      this._addLabelRow('selected', `${this._clips.length} clips`);
    } else {
      this._addLabelRow('type', c.clip_type);
      this._addLabelRow('track', c.track);
    }

    this._addSection('Timing');
    const durSpin = this._addSpin('Duration (s)', c.duration, 0.1, 600, 0.1, 2);
    this._onInputAndChange(durSpin, v => this._set('duration', v));
    if (!multi) {
      const startSpin = this._addSpin('Start (s)', c.start, 0, 3600, 0.1, 2);
      this._onInputAndChange(startSpin, v => this._set('start', v));
    }


    const sameType = this._clips.every(cl => cl.clip_type === c.clip_type);
    if (!multi || sameType) {
      switch (c.clip_type) { /* unchanged */ }
    }
    


    if (c.track === 'text' || c.track === 'visual') {
      this._addSection('Canvas position');
      const xSpin = this._addSpin('X (0–1)', c.x, 0, 1, 0.01, 3);
      const ySpin = this._addSpin('Y (0–1)', c.y, 0, 1, 0.01, 3);
      this._onInputAndChange(xSpin, v => this._set('x', v));
      this._onInputAndChange(ySpin, v => this._set('y', v));

      const snapBtn = document.createElement('button');
      snapBtn.className = 'props-btn';
      snapBtn.textContent = 'Snap to preset…';
      snapBtn.addEventListener('click', () =>
        this._container.dispatchEvent(new CustomEvent('props:snap', { bubbles: true }))
      );
      this._container.appendChild(snapBtn);
    }

    switch (c.clip_type) {
      case 'narration': {
        this._addSection('Content');
        this._boundTextarea('content', 90);

        this._addSection('Font');
        const fontSizeSpin = this._addSpin('Font size', c.font_size ?? 24, 7, 200, 1, 0);
        this._onInputAndChange(fontSizeSpin, v => this._set('font_size', Math.round(v)));

        this._addColorPicker('Font color', c.font_color ?? '#ffffff', hex => this._set('font_color', hex));

        const styleRow = document.createElement('div');
        styleRow.className = 'props-spin-row';
        const boldLbl = document.createElement('label');
        boldLbl.textContent = 'Bold';
        const boldCheck = document.createElement('input');
        boldCheck.type = 'checkbox';
        boldCheck.checked = !!c.font_bold;
        boldCheck.addEventListener('change', () => this._set('font_bold', boldCheck.checked));
        styleRow.appendChild(boldLbl);
        styleRow.appendChild(boldCheck);
        this._container.appendChild(styleRow);

        const italicRow = document.createElement('div');
        italicRow.className = 'props-spin-row';
        const italicLbl = document.createElement('label');
        italicLbl.textContent = 'Italic';
        const italicCheck = document.createElement('input');
        italicCheck.type = 'checkbox';
        italicCheck.checked = !!c.font_italic;
        italicCheck.addEventListener('change', () => this._set('font_italic', italicCheck.checked));
        italicRow.appendChild(italicLbl);
        italicRow.appendChild(italicCheck);
        this._container.appendChild(italicRow);

        break;
      }

      case 'audio': {
        this._addSection('Content / script');
        this._boundTextarea('content', 70);
        this._addSection('Voice');
        this._boundTextInput('voice_id', 'ElevenLabs voice ID');
        break;
      }

      case 'code': {
        this._addSection('Code file');
        const pathInput = this._boundTextInput('code_file', 'path/to/file.py');

        const browseBtn = document.createElement('button');
        browseBtn.className = 'props-btn';
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
        this._boundTextInput('terminal_prompt', 'user@vidkit:~$');
        this._boundTextInput('terminal_title', 'window title (optional)');

        this._addInlineLabel('Inline code (overrides file):');
        this._boundTextarea('content', 90);
        break;
      }

      case 'graph': {
        this._addSection('Graph');
        const gtCombo = this._addCombo('Type', ['bar', 'line', 'pie'], c.graph_type);
        gtCombo.addEventListener('change', () => this._set('graph_type', gtCombo.value));
        this._addSection('Data  (label:value, …)');
        this._boundTextarea('graph_data', 70);
        break;
      }

      case 'image': {
        this._addSection('Image file');
        this._addInlineLabel('URL / path:');
        this._boundTextInput('code_file', 'https:// or /static/…');
        break;
      }

      case 'video': {
        this._addSection('Video file');
        this._addInlineLabel('URL / path:');
        this._boundTextInput('code_file', 'https:// or /static/…');
        break;
      }

      case 'shape': {
        this._addSection('Shape');
        const shapeCombo = this._addCombo(
          'Shape', ['rectangle', 'circle', 'triangle', 'polygon', 'arrow', 'star', 'line'], c.shape_kind
        );
        shapeCombo.addEventListener('change', () => {
          this._set('shape_kind', shapeCombo.value);
          this._rebuild();
        });

        this._addSection('Fill & stroke');
        this._addColorPicker('Fill', c.fill, hex => this._set('fill', hex));
        this._addColorPicker('Stroke', c.stroke_color, hex => this._set('stroke_color', hex));

        const strokeWidthSpin = this._addSpin('Stroke width', c.stroke_width, 0, 40, 0.5, 1);
        this._onInputAndChange(strokeWidthSpin, v => this._set('stroke_width', v));

        if (c.shape_kind === 'rectangle') {
          const cornerSpin = this._addSpin('Corner radius', c.corner_radius, 0, 200, 1, 0);
          this._onInputAndChange(cornerSpin, v => this._set('corner_radius', v));
        }

        if (c.shape_kind === 'polygon' || c.shape_kind === 'star') {
          const sidesSpin = this._addSpin(
            c.shape_kind === 'polygon' ? 'Sides' : 'Points',
            c.shape_kind === 'polygon' ? c.sides : c.points,
            3, 20, 1, 0
          );
          this._onInputAndChange(sidesSpin, v =>
            this._set(c.shape_kind === 'polygon' ? 'sides' : 'points', Math.round(v))
          );
          if (c.shape_kind === 'star') {
            const innerSpin = this._addSpin('Inner radius ratio', c.inner_radius_ratio, 0.05, 0.95, 0.01, 2);
            this._onInputAndChange(innerSpin, v => this._set('inner_radius_ratio', v));
          }
        }

        this._addSection('Transform');
        const opacitySpin = this._addSpin('Opacity', c.opacity ?? 1.0, 0, 1, 0.01, 2);
        this._onInputAndChange(opacitySpin, v => this._set('opacity', v));
        const rotationSpin = this._addSpin('Rotation (°)', c.rotation, -180, 180, 1, 0);
        this._onInputAndChange(rotationSpin, v => this._set('rotation', v));
        const scaleSpin = this._addSpin('Scale', c.scale ?? 1.0, 0.05, 4.0, 0.05, 2);
        this._onInputAndChange(scaleSpin, v => this._set('scale', v));
        break;
      }
    }

    if (c.clip_type === 'code') {
      this._addSection('Style');
      const themeCombo = this._addCombo('Theme', Object.keys(THEMES), c.theme);
      themeCombo.addEventListener('change', () => this._set('theme', themeCombo.value));
  }

    if (c.clip_type === 'code') {
      const animCombo = this._addCombo('Animation', ['typewriter', 'static'], c.animation);
      animCombo.addEventListener('change', () => this._set('animation', animCombo.value));
    }

    if (c.clip_type === 'narration') {
      const animCombo = this._addCombo(
        'Animation', ['static', 'typewriter', 'wordblurin', 'linescan'], c.text_anim_style ?? 'static'
      );
      animCombo.addEventListener('change', () => this._set(
        'text_anim_style', animCombo.value === 'static' ? null : animCombo.value
      ));
    }

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this._container.appendChild(spacer);
  }

  _set(attr, value) {
    if (this._clips.length && !this._updating) {
      if (!this._dirtySinceCommit) {
        this._dirtySinceCommit = true;
        this._container.dispatchEvent(new CustomEvent('props:editstart', { bubbles: true }));
      }
      for (const clip of this._clips) clip[attr] = value;
      this._container.dispatchEvent(new CustomEvent('props:changed', { bubbles: true }));
    }
  }

  _boundTextarea(attr, height) {
    const te = this._addTextarea(this._clip[attr], height);
    te.addEventListener('input', () => this._set(attr, te.value));
    return te;
  }

  _boundTextInput(attr, placeholder = '') {
    const input = this._addTextInput(this._clip[attr], placeholder);
    input.addEventListener('input', () => this._set(attr, input.value));
    return input;
  }

  _addInlineLabel(text) {
    const lbl = document.createElement('span');
    lbl.className = 'props-inline-label';
    lbl.textContent = text;
    this._container.appendChild(lbl);
  }

  _addColorPicker(label, initialHex, onSet) {
    this._addInlineLabel(label);
    const holder = document.createElement('div');
    holder.className = 'props-colorpicker';
    this._container.appendChild(holder);

    createColorPicker(holder, {
      initialColor: initialHex,
      onChange: (hex) => onSet(hex),
      onCommit: (hex) => { onSet(hex); this._commitNow(); },
    });
  }

  _onInputAndChange(input, fn) {
    let last = input.value;
    const handle = () => {
      const v = parseFloat(input.value);
      if (!isNaN(v) && input.value !== last) {
        last = input.value;
        fn(v);
      }
    };
    input.addEventListener('input', handle);
    input.addEventListener('change', handle);
  }

  _addSection(title) {
    const lbl = document.createElement('span');
    lbl.className = 'props-section-label';
    lbl.textContent = title.toUpperCase();
    this._container.appendChild(lbl);
  }

  _addLabelRow(key, value) {
    const row = document.createElement('div');
    row.className = 'props-label-row';
    const k = document.createElement('span'); k.className = 'pk'; k.textContent = key;
    const v = document.createElement('span'); v.className = 'pv'; v.textContent = value;
    row.appendChild(k); row.appendChild(v);
    this._container.appendChild(row);
  }

  _addSpin(label, value, min, max, step, decimals) {
    const row = document.createElement('div');
    row.className = 'props-spin-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min; input.max = max; input.step = step;
    input.value = value.toFixed(decimals);
    row.appendChild(lbl); row.appendChild(input);
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
    row.appendChild(lbl); row.appendChild(sel);
    this._container.appendChild(row);
    return sel;
  }

  _addTextarea(content, height) {
    const te = document.createElement('textarea');
    te.className = 'props-textarea' + (height <= 70 ? ' short' : '');
    te.style.height = height + 'px';
    te.value = content ?? '';
    this._container.appendChild(te);
    return te;
  }

  _addTextInput(value, placeholder = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'props-input-text';
    input.value = value ?? '';
    input.placeholder = placeholder;
    this._container.appendChild(input);
    return input;
  }
}