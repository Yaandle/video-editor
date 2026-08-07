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

  // #67c — hooks provided by app.js so the panel can read/write a clip's
  // on-screen size (in project pixels) without knowing about the canvas.
  setSizeHooks(getSize, setSize) { this._getSize = getSize; this._setSize = setSize; }

  // Route a non-_set mutation through the same editstart/changed/commit flow
  _applyExternal(fn) {
    if (!this._dirtySinceCommit) {
      this._dirtySinceCommit = true;
      this._container.dispatchEvent(new CustomEvent('props:editstart', { bubbles: true }));
    }
    fn();
    this._container.dispatchEvent(new CustomEvent('props:changed', { bubbles: true }));
  }

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

    const multi = this._clips.length > 1;
    if (multi) {
      this._addLabelRow('selected', `${this._clips.length} clips`);
    } else {
      this._addLabelRow('type', c.clip_type);
      this._addLabelRow('kind', c.track);
      this._addLabelRow('layer', `L${(c.layer ?? 0) + 1}`);
    }

    this._addSection('Timing');
    const durSpin = this._addSpin('Duration (s)', c.duration, 0.1, 600, 0.1, 2);
    this._onInputAndChange(durSpin, v => this._set('duration', v));
    if (!multi) {
      const startSpin = this._addSpin('Start (s)', c.start, 0, 3600, 0.1, 2);
      this._onInputAndChange(startSpin, v => this._set('start', v));
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

    // #67c — editable dimensions for visuals/shapes (project pixels).
    // Available whenever the clip is visible on the canvas at the playhead.
    if (!multi && ['image', 'video', 'shape'].includes(c.clip_type) && this._getSize) {
      const size = this._getSize(c);
      this._addSection('Dimensions (px)');
      if (size) {
        const wSpin = this._addSpin('Width', size.w, 1, 8192, 1, 0);
        const hSpin = this._addSpin('Height', size.h, 1, 8192, 1, 0);
        this._onInputAndChange(wSpin, v =>
          this._applyExternal(() => this._setSize?.(c, Math.round(v), null)));
        this._onInputAndChange(hSpin, v =>
          this._applyExternal(() => this._setSize?.(c, null, Math.round(v))));
      } else {
        this._addInlineLabel('Move the playhead over this clip to edit its size.');
      }
    }

    // #28 — crop: select a clip, then either this button or right-click it
    // on the canvas ("Crop image") to enter the crop tool.
    if (!multi && ['image', 'video'].includes(c.clip_type)) {
      const cropBtn = document.createElement('button');
      cropBtn.className = 'props-btn';
      cropBtn.textContent = 'Crop';
      cropBtn.addEventListener('click', () =>
        this._container.dispatchEvent(new CustomEvent('props:crop', { bubbles: true }))
      );
      this._container.appendChild(cropBtn);

      const isCropped = (c.crop_x ?? 0) > 0.001 || (c.crop_y ?? 0) > 0.001 ||
        (c.crop_w ?? 1) < 0.999 || (c.crop_h ?? 1) < 0.999;
      if (isCropped) {
        const resetCropBtn = document.createElement('button');
        resetCropBtn.className = 'props-btn';
        resetCropBtn.textContent = 'Reset crop';
        resetCropBtn.addEventListener('click', () => {
          this._applyExternal(() => {
            c.crop_x = 0; c.crop_y = 0; c.crop_w = 1; c.crop_h = 1;
          });
          this._commitNow();
          this._rebuild();
        });
        this._container.appendChild(resetCropBtn);
      }
    }

    const animateBtn = document.createElement('button');
    animateBtn.className = 'props-btn';
    animateBtn.textContent = 'Animate Position / Zoom';
    animateBtn.addEventListener('click', () =>
      this._container.dispatchEvent(new CustomEvent('props:animatepos', { bubbles: true }))
    );
    this._container.appendChild(animateBtn);

    // #64 / zoom follow-up — motion path editing: any number of stops, each
    // with its own timing (fraction of the clip), position, and zoom level.
    // Two stops reproduce a straight pan; three or more let a clip zoom into
    // a feature, pan to another, and zoom back out. Points can be placed by
    // clicking the canvas (Animate Position/Zoom tool, scroll to set zoom)
    // or added/tuned numerically here.
    const kf = c.motion_keyframes;
    if (!multi && Array.isArray(kf) && kf.length >= 2) {
      this._addSection('Motion path');
      const baseScale = c.scale_x ?? c.scale ?? 1.0;
      const sorted = [...kf].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const dur = c.duration || 1;

      sorted.forEach((k, i) => {
        this._addSection(`Stop ${i + 1}`);

        const tSpin = this._addSpin('Time (s)', (k.t ?? 0) * dur, 0, dur, 0.05, 2);
        let lastT = tSpin.value;
        const commitReorder = () => {
          this._applyExternal(() => {
            c.motion_keyframes.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
          });
          this._commitNow();
          this._rebuild();
        };
        tSpin.addEventListener('input', () => {
          if (tSpin.value === lastT) return;
          lastT = tSpin.value;
          const v = parseFloat(tSpin.value);
          if (isNaN(v)) return;
          this._applyExternal(() => { k.t = Math.max(0, Math.min(1, v / dur)); });
        });
        tSpin.addEventListener('change', commitReorder);

        const xSpin = this._addSpin('X (0–1)', k.x, 0, 1, 0.01, 3);
        this._onInputAndChange(xSpin, v => this._applyExternal(() => { k.x = v; }));
        const ySpin = this._addSpin('Y (0–1)', k.y, 0, 1, 0.01, 3);
        this._onInputAndChange(ySpin, v => this._applyExternal(() => { k.y = v; }));
        const zoomSpin = this._addSpin('Zoom (×)', k.scale ?? baseScale, 0.2, 4, 0.05, 2);
        this._onInputAndChange(zoomSpin, v => this._applyExternal(() => { k.scale = Math.max(0.2, Math.min(4, v)); }));

        const delBtn = document.createElement('button');
        delBtn.className = 'props-btn';
        delBtn.textContent = 'Remove stop';
        delBtn.addEventListener('click', () => {
          this._applyExternal(() => {
            c.motion_keyframes = c.motion_keyframes.filter(other => other !== k);
            if (c.motion_keyframes.length < 2) c.motion_keyframes = null;
          });
          this._commitNow();
          this._rebuild();
        });
        this._container.appendChild(delBtn);
      });

      const clearBtn = document.createElement('button');
      clearBtn.className = 'props-btn';
      clearBtn.textContent = 'Clear motion path';
      clearBtn.addEventListener('click', () => {
        this._applyExternal(() => { c.motion_keyframes = null; });
        this._commitNow();
        this._rebuild();
      });
      this._container.appendChild(clearBtn);
    } else if (!multi && c.track !== 'audio') {
      // Let a motion path be started from the panel alone: seed both
      // keyframes at the clip's current position/zoom, then the canvas
      // tool or the list above refines/extends it.
      const addBtn = document.createElement('button');
      addBtn.className = 'props-btn';
      addBtn.textContent = 'Add motion path';
      addBtn.addEventListener('click', () => {
        const baseScale = c.scale_x ?? c.scale ?? 1.0;
        this._applyExternal(() => {
          c.motion_keyframes = [
            { t: 0, x: c.x ?? 0.5, y: c.y ?? 0.5, scale: baseScale },
            { t: 1, x: c.x ?? 0.5, y: c.y ?? 0.5, scale: baseScale },
          ];
        });
        this._commitNow();
        this._rebuild();
      });
      this._container.appendChild(addBtn);
    }

    // #63 — Canva-style transitions, available on every clip type
    if (c.track !== 'audio') {
      const TRANSITIONS = ['none', 'fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'scale_pop'];
      this._addSection('Transitions');

      const inCombo = this._addCombo('In', TRANSITIONS, c.transition_in ?? 'none');
      inCombo.addEventListener('change', () =>
        this._set('transition_in', inCombo.value === 'none' ? null : inCombo.value));
      const inMs = this._addSpin('In duration (ms)', c.transition_in_ms ?? 500, 50, 5000, 50, 0);
      this._onInputAndChange(inMs, v => this._set('transition_in_ms', Math.round(v)));

      const outCombo = this._addCombo('Out', TRANSITIONS, c.transition_out ?? 'none');
      outCombo.addEventListener('change', () =>
        this._set('transition_out', outCombo.value === 'none' ? null : outCombo.value));
      const outMs = this._addSpin('Out duration (ms)', c.transition_out_ms ?? 500, 50, 5000, 50, 0);
      this._onInputAndChange(outMs, v => this._set('transition_out_ms', Math.round(v)));

      const previewBtn = document.createElement('button');
      previewBtn.className = 'props-btn';
      previewBtn.textContent = '▶ Preview clip';
      previewBtn.addEventListener('click', () =>
        this._container.dispatchEvent(new CustomEvent('props:previewclip', { bubbles: true, detail: { clip: c } }))
      );
      this._container.appendChild(previewBtn);
    }

    
    switch (c.clip_type) {
      case 'narration': {
        this._addSection('Content');
        this._boundTextarea('content', 90);

        this._addSection('Font');
        // Bold, Italic, and Font size live only in Advanced Text Options now
        // (props:advancedtext below) — having them here too let the two
        // panels drift out of sync since both wrote the same clip fields.
        this._addColorPicker('Font color', c.font_color ?? '#ffffff', hex => this._set('font_color', hex));

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

        this._addSection('Speed');
        const speedSpin = this._addSpin('Speed (×)', c.speed ?? 1.0, 0.1, 8, 0.1, 2);
        this._onInputAndChange(speedSpin, v => {
          const newSpeed = Math.max(0.1, Math.min(8, v));
          // Speeding a clip up/down should shorten/lengthen it on the timeline
          // too, not just change how fast it plays within the same slot.
          // Keep the span of source footage the clip covers constant
          // (duration * speed) and solve for the new duration.
          this._applyExternal(() => {
            for (const clip of this._clips) {
              const oldSpeed = clip.speed ?? 1.0;
              const sourceSpan = clip.duration * oldSpeed;
              clip.speed = newSpeed;
              clip.duration = Math.max(0.05, Math.round((sourceSpan / newSpeed) * 1000) / 1000);
            }
          });
          // Reflect the recalculated duration in the Duration spinner above
          // without tearing down/rebuilding this panel (which would drop
          // focus mid-type on the speed field itself).
          durSpin.value = c.duration.toFixed(2);
        });
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
        // ("Scale" spinner removed — it wrote clip.scale, which both canvas
        // and render resolve as scale_x ?? scale, and scale_x always exists,
        // so the control was a no-op. Use W/H or the corner handles.)
        break;
      }
    }

    if (c.clip_type === 'code') {
      this._addSection('Style');
      const themeCombo = this._addCombo('Theme', Object.keys(THEMES), c.theme);
      themeCombo.addEventListener('change', () => this._set('theme', themeCombo.value));
      const animCombo = this._addCombo('Animation', ['typewriter', 'static'], c.animation);
      animCombo.addEventListener('change', () => this._set('animation', animCombo.value));
    }

    if (c.clip_type === 'narration') {
      const animCombo = this._addCombo(
        'Animation',
        ['static', 'typewriter', 'fade', 'slideup', 'scalepop', 'wordblur', 'charstagger', 'linescan', 'glitch'],
        c.text_anim_style === 'wordblurin' ? 'wordblur' : (c.text_anim_style ?? 'static')
      );
      animCombo.addEventListener('change', () => this._set(
        'text_anim_style', animCombo.value === 'static' ? null : animCombo.value
      ));

      const advancedBtn = document.createElement('button');
      advancedBtn.className = 'props-btn';
      advancedBtn.textContent = 'Advanced Text Options';
      advancedBtn.addEventListener('click', () =>
        this._container.dispatchEvent(
          new CustomEvent('props:advancedtext', { 
            bubbles: true,
            detail: { clip: c }
          })
        )
      );
      this._container.appendChild(advancedBtn);
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