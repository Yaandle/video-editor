import { CanvasWidget } from './canvas.js';
import { TimelineWidget } from './timeline.js';
import { PropertiesPanel } from './properties.js';
import { PlaybackController } from './playback.js';
import { MediaBin } from './mediaBin.js';
import { createColorPicker } from './colorPicker.js';

const TRACK_COLOURS_DARK = {
  audio: { bg: '#1A2733', border: '#5AB8FF', text: '#7CC8FF',
  },

  text: { bg: '#24311F', border: '#7DDB63', text: '#9AE87D',
  }, visual: { bg: '#332B1C', border: '#FFD66B', text: '#FFE08A',
  },
};

const TRACK_COLOURS_LIGHT = {
  audio:  { bg: '#F1F7FC', border: '#5AA8E8', text: '#256DAA' },
  text:   { bg: '#F3F8EE', border: '#7EB85A', text: '#03ad03' },
  visual: { bg: '#FCF7EC', border: '#E2B95C', text: '#A86A00' },
};

export function TRACK_COLOURS(track) {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const table = theme === 'light' ? TRACK_COLOURS_LIGHT : TRACK_COLOURS_DARK;
  return table[track] ?? {};
}

export const CLIP_TYPE_TRACK = {
  narration: 'text', code: 'visual', graph: 'visual',
  audio: 'audio', image: 'visual', video: 'visual',
  shape: 'visual',
};

export const THEMES = {
  dark: {
    bg: '#0d1117', text: '#e6edf3', border: '#30363d', titlebar: '#161b22',
    comment: '#8b949e', function: '#d2a8ff', keyword: '#ff7b72',
    string: '#a5d6ff', number: '#79c0ff', variable: '#e6edf3', operator: '#e6edf3',
    cursor: '#e6edf3',
  },
  light: {
    bg: '#ffffff', text: '#24292f', border: '#d0d7de', titlebar: '#f6f8fa',
    comment: '#6e7781', function: '#8250df', keyword: '#cf222e',
    string: '#0a3069', number: '#0550ae', variable: '#24292f', operator: '#24292f',
    cursor: '#24292f',
  },
  monokai: {
    bg: '#272822', text: '#f8f8f2', border: '#75715e', titlebar: '#1e1f1c',
    comment: '#75715e', function: '#a6e22e', keyword: '#f92672',
    string: '#e6db74', number: '#ae81ff', variable: '#f8f8f2', operator: '#f8f8f2',
    cursor: '#f8f8f2',
  },
  simple: {
    bg: '#f9f3ef', text: '#1f2937', border: '#e5d9cf', titlebar: '#f3ede9',
    keyword: '#d97706', string: '#16a34a', comment: '#6b7280', number: '#db2777',
    variable: '#7c3aed', operator: '#374151', function: '#2563eb',
    cursor: '#1f2937',
  },
};

export const UNDO_LIMIT = 100;

// Single source of truth for every Clip field + default. Constructor and
// toDict() both derive from this — a field added here can't silently
// vanish on save the way `layer` did (see #22 postmortem, §1.1).
const CLIP_DEFAULTS = {
  id: '', track: 'visual', clip_type: 'narration', start: 0.0, duration: 5.0,
  content: '',
  x: 0.5, y: 0.15, scale: 1.0,
  scale_x: 1.0,
  scale_y: 1.0,
  animation: 'typewriter', theme: 'dark',
  font_size: null,      // null = fall back to canvas.js's computed default
  font_color: null,
  font_bold: false,
  font_italic: false,
  code_file: '',
  terminal_prompt: '', terminal_title: '',
  graph_type: 'bar', graph_data: '',
  voice_id: '', source_start: 0.0, speed: 1.0,
  text_anim_style: null,
  text_delay_ms: 0,
  text_anim_easing: 'easeInOut',
  text_chars_per_second: 26,
  text_pop_duration_ms: 90,
  text_stagger_ms: 60,
  text_duration_ms: 550,
  text_max_blur: 14,
  text_rise_distance: 22,
  text_line_stagger_ms: 140,
  text_slide_distance: 90,
  text_sweep_width: 140,

  text_font_family: 'Consolas, monospace',
  text_letter_spacing: 0,
  text_line_height: 1.4,
  text_align: 'center',
  text_uppercase: false,
  text_underline: false,
  text_strike: false,
  text_opacity: 1.0,
  text_shadow: null,   // {x,y,blur,color,opacity}
  text_glow: null,     // {blur,color,opacity}
  text_stroke: null,   // {width,color}
  text_plate: null,    // {color,padding,radius}

  layer: 0,
  // shape (#22)
  shape_kind: 'rectangle',
  fill: '#FFFFFF',
  stroke_color: '#000000',
  stroke_width: 0,
  corner_radius: 0,
  rotation: 0,
  sides: 5,
  points: 5,
  inner_radius_ratio: 0.5,
  opacity: 1.0,

  motion_keyframes: null, // or [{t: 0, x: 0.3, y: 0.5}, {t: 1, x: 0.7, y: 0.2}]

  // transitions (#63) — apply to any clip type on any track
  transition_in: null,      // null|'fade'|'slide_up'|'slide_down'|'slide_left'|'slide_right'|'scale_pop'
  transition_in_ms: 500,
  transition_out: null,     // null|'fade'|'slide_up'|'slide_down'|'slide_left'|'slide_right'|'scale_pop'
  transition_out_ms: 500,
};
const CLIP_FIELDS = Object.keys(CLIP_DEFAULTS);

export class Clip {
  constructor(data) {
    for (const f of CLIP_FIELDS) {
      this[f] = data[f] ?? CLIP_DEFAULTS[f];
    }
  }
  end() { return this.start + this.duration; }
  label() {
    if (this.clip_type === 'narration') {
      const preview = this.content.slice(0, 28).replace(/\n/g, ' ');
      return this.content.length > 28 ? `"${preview}…"` : `"${this.content}"`;
    }
    if (this.clip_type === 'code')  return `code · ${this.code_file ? this.code_file.split(/[\\/]/).pop() : 'code block'}`;
    if (this.clip_type === 'graph') return `graph · ${this.graph_type}`;
    if (this.clip_type === 'audio') return `audio · ${this.content.slice(0, 24).replace(/\n/g, ' ')}`;
    if (this.clip_type === 'video') return `video · ${this.code_file ? this.code_file.split(/[\\/]/).pop() : 'video'}`;
    if (this.clip_type === 'image') return `image · ${this.code_file ? this.code_file.split(/[\\/]/).pop() : 'image'}`;
    if (this.clip_type === 'shape') return `shape · ${this.shape_kind}`;
    return this.clip_type;
  }
  toDict() {
    const d = {};
    for (const f of CLIP_FIELDS) d[f] = this[f];
    return d;
  }
}


export function newClip(clip_type, start = 0.0, duration = 5.0) {
  const track = CLIP_TYPE_TRACK[clip_type] ?? 'visual';
  const defaults = {
    code:      { animation: 'typewriter', theme: 'dark', y: 0.55 },
    audio:     { content: 'Narration goes here', y: 0.0 },
    video:     { y: 0.5 },
    shape:     { y: 0.5 },
  };
  return new Clip({ id: genId(), track, clip_type, start, duration, ...(defaults[clip_type] ?? {}) });
}



export class Project {
  constructor(data = {}) {
    this.name             = data.name             ?? 'untitled';
    this.canvas_w         = data.canvas_w          ?? 1080;
    this.canvas_h         = data.canvas_h          ?? 1920;
    this.fps               = data.fps              ?? 30;
    this.duration          = data.duration         ?? 30.0;
    this.background_color  = data.background_color ?? '#000000';
    this.clips             = (data.clips ?? []).map(cd => new Clip(cd));
  }
  toDict() {
    return {
      name: this.name,
      canvas_w: this.canvas_w,
      canvas_h: this.canvas_h,
      fps: this.fps,
      duration: this.duration,
      background_color: this.background_color,
      clips: this.clips.map(c => c.toDict()),
    };
  }
  static fromDict(d) { return new Project(d); }
}

function genId() { return Math.random().toString(36).slice(2, 10); }
function deepCloneClip(clip) {
  return new Clip(clip.toDict());
}




function computeWaveformPeaks(audioBuffer, numBuckets = 600) {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channelData.length / numBuckets));
  const mins = new Float32Array(numBuckets);
  const maxes = new Float32Array(numBuckets);
  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, channelData.length);
    let min = 1.0, max = -1.0;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    mins[i] = min; maxes[i] = max;
  }
  return { mins, maxes, duration: audioBuffer.duration };
}


class WSClient {
  constructor(url, onMessage) {
    this.url = url;
    this.onMessage = onMessage;
    this.ws = null;
    this._connect();
  }
  _connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen    = () => { document.getElementById('ws-dot').className = 'connected'; };
      this.ws.onclose   = () => { document.getElementById('ws-dot').className = ''; setTimeout(() => this._connect(), 3000); };
      this.ws.onerror   = () => { document.getElementById('ws-dot').className = ''; };
      this.ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch {} };
    } catch {}
  }
  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}

class App {
  constructor() {
    this.project      = new Project();
    this._projectPath = null;
    this._dirty       = false;
    this._clipboard   = null;
    // Selection model: _selectedIds is the single source of truth for what's
    // selected; _selectionPrimaryId is the "active" clip (properties panel,
    // copy/duplicate target). Always mutate via _setSelection().
    this._selectedIds = new Set();
    this._selectionPrimaryId = null;
    this._undoStack   = [];
    this._redoStack   = [];
    this._pendingPropsBefore = null;

    this.canvas   = null;
    this.timeline = null;
    this.props    = null;
    this.playback = null;
    this.mediaBin = null;
    this._ws      = null;
    // Audio preview management
    this._audioEls   = {}; // clipId -> HTMLAudioElement
    this._audioTimers = {}; // clipId -> timeout id for scheduled start
    this._audioLoaded = {}; // clipId -> boolean
    

    this._init();
  }

  _init() {
    this.canvas   = new CanvasWidget(document.getElementById('canvas-widget'), this.project, this._selectedIds);
    this.timeline = new TimelineWidget(document.getElementById('timeline-canvas'), this.project);
    this.props    = new PropertiesPanel(document.getElementById('props-inner'));
    // #67c — let the properties panel read/write on-screen dimensions
    this.props.setSizeHooks(
      (clip) => this.canvas.getClipProjectSize(clip),
      (clip, w, h) => this.canvas.setClipProjectSize(clip, w, h),
    );

    this._bgColorDragBefore = null;
    this._bgColorPicker = createColorPicker(document.getElementById('bg-color-picker'), {
      initialColor: this.project.background_color,
      onChange: (hex) => {
        if (this._bgColorDragBefore === null) {
          this._bgColorDragBefore = JSON.stringify(this.project.toDict());
        }
        this.project.background_color = hex;
        this.canvas.redraw();
      },
      onCommit: (hex) => {
        const before = this._bgColorDragBefore ?? JSON.stringify(this.project.toDict());

        this.project.background_color = hex;
        this._dirty = true;
        this._syncProjectToWidgets();
        this._refreshAll();
        this._updateStatus(`Background: ${hex}`);

        this._commit(before);
        this._bgColorDragBefore = null;
      },
    });

    this._wireTimelineResize();

    this.playback = new PlaybackController(this.project, (t) => this._onPlaybackTick(t));

    this.mediaBin = new MediaBin(document.getElementById('media-bin'));
    this.mediaBin.onAddClip((item) => this._addMediaClip(item));
    this.mediaBin.onDeleteClip(async (item) => {
      
      const filename = item.url.split('/').pop();

      const inUse = this.project.clips.some(c => c.code_file === item.url);

      if (inUse) {
        const ok = confirm(
          `"${item.original ?? item.name}" is used by one or more clips on the timeline. ` +
          `Deleting it will break those clips on next render. Delete anyway?`
        );
        if (!ok) {
          // re-add to the bin's list since MediaBin already removed it optimistically
          this.mediaBin.addItem(item);
          return;
        }
      }

      try {
        const res = await fetch(`/media/${filename}`, { method: 'DELETE' });
        if (!res.ok) {
          console.error('Delete failed:', await res.text());
          this.mediaBin.addItem(item); // roll back UI state
          this._updateStatus(`Failed to delete ${item.original ?? item.name}`);
          return;
        }
        this._updateStatus(`Deleted ${item.original ?? item.name}`);
      } catch (err) {
        console.error('Delete error:', err);
        this.mediaBin.addItem(item);
      }
    });
    
    this._loadMediaBin();

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WSClient(`${wsProtocol}//${location.host}/ws`, (msg) => this._onWsMessage(msg));

    this._wireEvents();
    this._wireMenu();
    this._wireToolbar();
    this._wireKeyboard();
    this._wireProjectName()

    this._resizeAll();
    this._updateUndoRedoButtons();
    window.addEventListener('resize', () => this._resizeAll());
  }

  async _uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async _loadMediaBin() {
    try {
      const items = await fetch('/media-list').then(r => r.json());
      items.forEach(item => this.mediaBin.addItem(item));
    } catch (err) {
      console.error('Failed to load media bin', err);
    }
  }

  async _addMediaClip(item, startAt = null) {
    const clip_type = item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image';
    // Prefer metadata from the backend if provided
    const meta = item.metadata ?? null;
    let dur = meta && meta.duration ? meta.duration : null;

    // If audio and no duration provided, probe via HTMLAudioElement
    if (clip_type === 'audio' && !dur) {
      try {
        dur = await this._probeAudioDuration(item.url);
      } catch (err) {
        console.warn('Failed to probe audio duration, falling back to 5s', err);
        dur = 5.0;
      }
    }

    // For other media types, fall back to 5s if unknown
    if (dur == null) dur = 5.0;

    const before = JSON.stringify(this.project.toDict());
    const track = CLIP_TYPE_TRACK[clip_type] ?? 'visual';
    // startAt: explicit drop position (timeline drag-drop, #67b follow-up);
    // otherwise append after the last clip on the target track.
    const start = startAt != null
      ? Math.max(0, startAt)
      : Math.max(this.playback.playhead, this._nextStartForTrack(track));
    const c = newClip(clip_type, start, dur);
    c.code_file = item.url;

    this.project.clips.push(c);
    this._dirty = true;
    this._refreshAll();

    // Ensure audio element for audio clips
    if (c.clip_type === 'audio') this._ensureAudioForClip(c);

    this._setSelection([c.id], c.id);
    this._updateStatus(`Added: ${item.original ?? item.name}`);
    this._commit(before);
  }

  _addShapeClip(shape_kind) {
    const before = JSON.stringify(this.project.toDict());
    const track = 'visual';
    const start = Math.max(this.playback.playhead, this._nextStartForTrack(track));
    const c = newClip('shape', start);
    c.shape_kind = shape_kind;
    this.project.clips.push(c);
    this._dirty = true;
    this._refreshAll();
    this._setSelection([c.id], c.id);
    this._updateStatus(`Added: ${c.label()}`);
    this._commit(before);
  }

  _probeAudioDuration(url) {
    return new Promise((resolve, reject) => {
      const a = new Audio();
      let timeout = setTimeout(() => {
        a.src = '';
        reject(new Error('Timed out loading audio metadata'));
      }, 8000);
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        const d = isFinite(a.duration) ? a.duration : null;
        a.src = '';
        resolve(d);
      }, { once: true });
      a.addEventListener('error', (e) => {
        clearTimeout(timeout);
        a.src = '';
        reject(e);
      }, { once: true });
      a.src = url;
    });
  }

  _ensureAudioForClip(clip) {
    if (!clip || clip.clip_type !== 'audio' || !clip.code_file) return;
    if (this._audioEls[clip.id]) return;
    try {
      const a = new Audio();
      a.src = clip.code_file;
      a.preload = 'metadata';
      a.crossOrigin = 'anonymous';
      a.addEventListener('loadedmetadata', () => {
        this._audioLoaded[clip.id] = true;
        if ((!clip.duration || clip.duration === 0) && isFinite(a.duration)) {
          clip.duration = a.duration;
          this._dirty = true;
          this._refreshAll();
        }
      }, { once: true });
      a.addEventListener('error', () => { this._audioLoaded[clip.id] = false; }, { once: true });
      this._audioEls[clip.id] = a;
      this._loadWaveform(clip);
    } catch (err) {
      console.warn('Failed to create audio element for clip', err);
    }
  }

  _removeAudioForClip(clipId) {
    const a = this._audioEls[clipId];
    if (a) {
      try { a.pause(); } catch {}
      try { a.src = ''; } catch {}
    }
    delete this._audioEls[clipId];
    if (this._audioTimers[clipId]) { clearTimeout(this._audioTimers[clipId]); delete this._audioTimers[clipId]; }
    delete this._audioLoaded[clipId];
  }

  async _loadWaveform(clip) {
    if (!clip || clip.clip_type !== 'audio' || !clip.code_file) return;
    if (clip._peaks || clip._peaksLoading) return;
    clip._peaksLoading = true;
    try {
      const resp = await fetch(clip.code_file);
      const arrayBuf = await resp.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this._waveformCtx) this._waveformCtx = new AudioCtx();
      const audioBuffer = await this._waveformCtx.decodeAudioData(arrayBuf);
      clip._peaks = computeWaveformPeaks(audioBuffer);
    } catch (err) {
      console.warn('Waveform decode failed for clip', clip.id, err);
    } finally {
      clip._peaksLoading = false;
      this.timeline.redraw();
    }
  }

  _clearAudioTimers() {
    Object.values(this._audioTimers).forEach(t => clearTimeout(t));
    this._audioTimers = {};
  }

  _startAudioScheduling() {
    this._clearAudioTimers();
    const playhead = this.playback.playhead;
    for (const clip of this.project.clips) {
      if (clip.clip_type !== 'audio' || !clip.code_file || !clip.duration) continue;
      this._ensureAudioForClip(clip);
      const el = this._audioEls[clip.id];
      const start = clip.start;
      const end = clip.end();
      if (start <= playhead && playhead < end) {
        const srcStart = clip.source_start ?? 0;
        const offset = srcStart + Math.max(0, playhead - start);
        const maxOffset = srcStart + clip.duration - 0.001;
        try {
          if (this._audioLoaded[clip.id]) {
            el.currentTime = Math.min(offset, maxOffset);
            el.play().catch(() => {});
          } else {
            // wait for metadata then set time and play
            el.addEventListener('loadedmetadata', () => {
              try { el.currentTime = Math.min(offset, maxOffset); el.play().catch(() => {}); } catch {}
            }, { once: true });
          }
        } catch (err) { /* ignore */ }
      } else if (start > playhead) {
        const delay = Math.max(0, (start - playhead) * 1000);
        const srcStart = clip.source_start ?? 0;
        this._audioTimers[clip.id] = setTimeout(() => {
          try { const el2 = this._audioEls[clip.id]; if (el2) { el2.currentTime = srcStart; el2.play().catch(() => {}); } } catch (e) {}
        }, delay);
      }
    }
  }

  _pauseAllAudio(stop = false) {
    this._clearAudioTimers();
    for (const id in this._audioEls) {
      const el = this._audioEls[id];
      try { el.pause(); } catch {}
      if (stop) {
        try { el.currentTime = 0; } catch {}
      }
    }
  }

  _resyncAudioOnSeek(t) {
    // Recompute audio positions for new playhead t
    this._clearAudioTimers();
    const playing = this.playback.playing;
    for (const clip of this.project.clips) {
      if (clip.clip_type !== 'audio' || !clip.code_file || !clip.duration) continue;
      this._ensureAudioForClip(clip);
      const el = this._audioEls[clip.id];
      const start = clip.start;
      const end = clip.end();
      const srcStart = clip.source_start ?? 0;
      if (start <= t && t < end) {
        const offset = srcStart + Math.max(0, t - start);
        const maxOffset = srcStart + clip.duration - 0.001;
        try {
          if (this._audioLoaded[clip.id]) {
            el.currentTime = Math.min(offset, maxOffset);
            if (playing) el.play().catch(() => {});
            else el.pause();
          } else {
            el.addEventListener('loadedmetadata', () => {
              try { el.currentTime = Math.min(offset, maxOffset); if (playing) el.play().catch(() => {}); } catch {}
            }, { once: true });
          }
        } catch (err) {}
      } else {
        try { el.pause(); el.currentTime = srcStart; } catch (err) {}
        if (playing && start > t) {
          const delay = Math.max(0, (start - t) * 1000);
          this._audioTimers[clip.id] = setTimeout(() => {
            try { const el2 = this._audioEls[clip.id]; if (el2) { el2.currentTime = srcStart; el2.play().catch(() => {}); } } catch (e) {}
          }, delay);
        }
      }
    }
  }

  _enforceAudioBounds(t) {
    for (const clip of this.project.clips) {
      if (clip.clip_type !== 'audio' || !clip.code_file) continue;
      const el = this._audioEls[clip.id];
      if (!el || el.paused) continue;
      if (t < clip.start || t >= clip.end()) {
        try { el.pause(); } catch {}
      }
    }
  }

  _initAudioForProject() {
    for (const clip of this.project.clips) {
      if (clip.clip_type === 'audio') this._ensureAudioForClip(clip);
    }
  }

  async _onWsMessage(msg) {
    if (msg.type === 'project') {
      this.project = Project.fromDict(msg.data);
      if (msg.filename) this._projectPath = msg.filename;
      this._syncProjectToWidgets();
      this._initAudioForProject();
      this._refreshAll();
      this._dirty = false;
      this._updateTitle();
      return;
    }
    if (msg.type === 'render_status') this._showRenderToast(msg.status, msg.message ?? '');
    if (msg.type === 'save_status') {
      if (msg.status === 'done') {
        this._dirty = false;
        if (msg.filename) this._projectPath = msg.filename;
        this._updateTitle();
        this._updateStatus(`Saved: ${msg.filename ?? msg.path}`);
      } else if (msg.status === 'error') {
        this._updateStatus(`Save/load failed: ${msg.message}`);
      }
    }

    if (msg.type === 'delete_project_result') {
        if (msg.success) {
            this._updateStatus(`Deleted: ${msg.filename}`);

            const projects = await fetch('/projects-list')
                .then(r => r.json());

            document.getElementById('open-project-overlay')?.remove();
            this._showOpenProjectModal(projects);
        } else {
            this._updateStatus(msg.message ?? 'Delete failed');
        }
    }
  }

  _showRenderToast(status, message) {
    const toast = document.getElementById('render-toast');
    toast.className = 'visible';
    if (status === 'started') {
      toast.classList.remove('done', 'error');
      toast.textContent = '⏳ Rendering…';
    } else if (status === 'done') {
      toast.classList.add('done');
      toast.classList.remove('error');
      toast.textContent = `✓ ${message}`;
      setTimeout(() => toast.classList.remove('visible', 'done'), 6000);
    } else if (status === 'error') {
      toast.classList.add('error');
      toast.classList.remove('done');
      toast.textContent = `✗ ${message}`;
      setTimeout(() => toast.classList.remove('visible', 'error'), 8000);
    }
  }

  _wsSend(obj) { this._ws.send(obj); }

  _wireEvents() {
    document.getElementById('canvas-widget').addEventListener('canvas:clipresized', (e) => {
      const clip = this._findClip(e.detail.id);
      if (clip && this._selectionPrimaryId === e.detail.id) this.props.showClip(clip);
      this._dirty = true;
      this._updateStatus();
    });
    document.getElementById('canvas-widget').addEventListener('canvas:selectionchanged', (e) => {
      this._setSelection(e.detail.selectedIds ?? e.detail.ids, e.detail.primaryId);
    });
    document.getElementById('canvas-widget').addEventListener('canvas:deselect', () => {
      this._setSelection([], null);
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:selectionchanged', (e) => {
      this._setSelection(e.detail.selectedIds ?? e.detail.ids, e.detail.primaryId);
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:clipchanged', () => {
      this._dirty = true;
      this.canvas.redraw();
      this._updateStatus();
      this._resyncAudioOnSeek(this.playback.playhead);
    });
    
    document.getElementById('timeline-canvas').addEventListener('timeline:deselect', () => {
      this._setSelection([], null);
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:playheadmoved', (e) => {
      this.playback.seek(e.detail.t);
    });

    // #67b follow-up — media-bin card dragged onto the timeline: add the
    // clip at the dropped (snapped) time instead of appending at track end.
    document.getElementById('timeline-canvas').addEventListener('timeline:mediadropped', (e) => {
      this._addMediaClip(e.detail.item, e.detail.time);
    });

    document.getElementById('timeline-canvas').addEventListener('timeline:slice', (e) => {
      const before = JSON.stringify(this.project.toDict());
      const { sourceId, rightStart, rightDur, rightSourceStart } = e.detail;
      const source = this._findClip(sourceId);
      if (!source) return;
      const right = deepCloneClip(source);
      right.id           = genId();
      right.start        = rightStart;
      right.duration     = rightDur;
      right.source_start = rightSourceStart ?? (source.source_start ?? 0);
      this.project.clips.push(right);
      if (right.clip_type === 'audio') this._ensureAudioForClip(right);
      this._dirty = true;
      this._refreshAll();
      this._updateStatus(`Sliced at ${rightStart.toFixed(2)}s`);
      this._commit(before);
    });

    document.getElementById('props-inner').addEventListener('props:changed', () => {
      this._dirty = true;
      this.canvas.redraw();
      this.timeline.redraw();
      this._updateStatus();
    });
    document.getElementById('props-inner').addEventListener('props:snap', () =>
      this._openSnapModal()
    );

    document.getElementById('props-inner').addEventListener('props:animatepos', () => {
      this.canvas.setTool('motionA');
      this._updateStatus('Click canvas to set START position (Ctrl-click = no snapping)');
    });

    // #63/#64 — preview a clip's transitions/animation from its start
    document.getElementById('props-inner').addEventListener('props:previewclip', (e) => {
      const clip = e.detail?.clip;
      if (clip) this._previewClipAnimation(clip, true);
    });

    document.getElementById('canvas-widget').addEventListener('canvas:motioncaptured', (e) => {
      if (e.detail.point === 'A') {
        this.canvas.setTool('motionB');
        this._updateStatus('Click canvas to set END position');
      } else {
        this.canvas.setTool('select');
        this._dirty = true;
        this.canvas.redraw();
        this.timeline.redraw();
        this._updateStatus('Motion path set');
      }
    });
    document.getElementById('props-inner').addEventListener('props:editstart', () => {
      if (!this._pendingPropsBefore) {
        this._pendingPropsBefore = JSON.stringify(this.project.toDict());
      }
    });
    document.getElementById('props-inner').addEventListener('props:commit', () => {
      if (this._pendingPropsBefore) {
        this._commit(this._pendingPropsBefore);
        this._pendingPropsBefore = null;
      }
    });
    document.getElementById('props-inner').addEventListener('props:advancedtext', (e) => {
      this._openAdvancedTextModal(e.detail.clip);
    });

    document.getElementById('advtext-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'advtext-modal-overlay') this._closeAdvancedTextModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' &&
          document.getElementById('advtext-modal-overlay').classList.contains('open')) {
        this._closeAdvancedTextModal();
      }
    });
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'vidkit:closeAdvancedText') this._closeAdvancedTextModal();
      if (e.data?.type === 'vidkit:applyAdvancedText') this._applyAdvancedTextToClip(e.data.payload);
    });

    document.getElementById('canvas-widget').addEventListener('canvas:committed', (e) => {
      this._commit(e.detail.before);
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:committed', (e) => {
      this._commit(e.detail.before);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-item')) {
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      }
    });

    document.getElementById('snap-modal-cancel').addEventListener('click', () => {
      document.getElementById('snap-modal-overlay').classList.remove('open');
    });
    document.getElementById('snap-modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('snap-modal-overlay'))
        document.getElementById('snap-modal-overlay').classList.remove('open');
    });

  }

  _wireProjectName() {
    const input = document.getElementById('project-name-lbl');
    input.addEventListener('change', () => {
      const newName = input.value.trim();
      if (!newName || newName === this.project.name) {
        input.value = this.project.name; // revert if empty/unchanged
        return;
      }
      this.project.name = newName;
      this._dirty = true;
      this._updateTitle();
      this._updateStatus(`Renamed to ${newName}`);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = this.project.name; input.blur(); }
    });
  }

  _wireTimelineResize() {
    const handle = document.getElementById('timeline-resize-handle');
    if (!handle) return;
    let dragging = false, startY = 0, startH = 0;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = document.getElementById('timeline-container').clientHeight;
      handle.classList.add('active');
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.timeline.resize(startH + (startY - e.clientY));
      this.canvas.resize();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = 'default';
    });
  }

  _wireMenu() {
    document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });

    document.querySelectorAll('.menu-dropdown-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        this._dispatchAction(item.dataset.action, item.dataset.shape ?? null);
      });
    });
  }



  _wireToolbar() {
    document.getElementById('play-btn').addEventListener('click', () => this._togglePlay());
    document.getElementById('stop-btn').addEventListener('click', () => this._stop());
    document.getElementById('add-narration-btn').addEventListener('click', () => this._addClip('narration'));
    document.getElementById('add-code-btn').addEventListener('click', () => this._addClip('code'));
    document.getElementById('add-graph-btn').addEventListener('click', () => this._addClip('graph'));
    document.getElementById('add-audio-btn').addEventListener('click', () => this._addClip('audio'));
    document.getElementById('render-btn').addEventListener('click', () => this._openRenderModal());
      const themeToggleBtn = document.getElementById('theme-toggle');
      const setThemeIcon = (theme) => {
        themeToggleBtn.textContent = theme === 'light' ? '☀' : '☾';
      };
      setThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');

      themeToggleBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      localStorage.setItem('vidkit-theme', next);
      setThemeIcon(next);
      this.timeline.redraw();
    });
      const razorBtn = document.getElementById('razor-btn');
        if (razorBtn) {
      razorBtn.addEventListener('click', () => {
        const next = this.timeline.tool === 'razor' ? 'select' : 'razor';

        this.timeline.setTool(next);
        this.canvas.setTool(next);

        razorBtn.classList.toggle('active', next === 'razor');

        // Optional: keep move button in sync
        if (moveBtn) moveBtn.classList.remove('active');

        this._updateStatus(
          next === 'razor'
            ? 'Razor tool — click a clip to slice'
            : 'Select tool'
        );
      });
    }
    const moveBtn = document.getElementById('move-btn');
    if (moveBtn) {
      moveBtn.addEventListener('click', () => {
        const currently = this.timeline.tool === 'move';
        const next = currently ? 'select' : 'move';
        this.timeline.tool = next;
        this.canvas.setTool(next);   // <-- added
        moveBtn.classList.toggle('active', next === 'move');
        this._updateStatus(next === 'move' ? 'Move tool — drag to move selected clips' : 'Select tool');
      });
    }

    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.addEventListener('click', () => this._undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this._redo());

    const shapeBtn  = document.getElementById('add-shape-btn');
    const shapeMenu = document.getElementById('add-shape-menu');
    if (shapeBtn && shapeMenu) {
      shapeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shapeMenu.classList.toggle('open');
      });
      shapeMenu.querySelectorAll('[data-shape]').forEach(item => {
        item.addEventListener('click', () => {
          shapeMenu.classList.remove('open');
          this._addShapeClip(item.dataset.shape);
        });
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#add-shape-btn') && !e.target.closest('#add-shape-menu')) {
          shapeMenu.classList.remove('open');
        }
      });
    }
  }

  _wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement.tagName;
      const inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

      if (e.code === 'Space' && !inInput) { e.preventDefault(); this._togglePlay(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) { e.preventDefault(); this._deleteSelected(); return; }
      if (e.key.toLowerCase() === 'r' && !inInput && !e.ctrlKey) {
        e.preventDefault();
        const next = this.timeline.tool === 'razor' ? 'select' : 'razor';
        this.timeline.setTool(next);
        const razorBtn = document.getElementById('razor-btn');
        if (razorBtn) razorBtn.classList.toggle('active', next === 'razor');
        this._updateStatus(next === 'razor' ? 'Razor tool — click a clip to slice' : 'Select tool');
        return;
      }
      if ((e.key === '+' || e.key === '=') && !inInput) { e.preventDefault(); this.timeline.zoomIn(); return; }
      if (e.key === '-' && !inInput) { e.preventDefault(); this.timeline.zoomOut(); return; }
      if (e.key === '0' && !inInput) { e.preventDefault(); this.timeline.zoomReset(); return; }
      if (e.key === 'ArrowLeft' && e.shiftKey && !inInput) { e.preventDefault(); this.playback.stepFrame(-1); return; }
      if (e.key === 'ArrowRight' && e.shiftKey && !inInput) { e.preventDefault(); this.playback.stepFrame(1); return; }

      // #67d — arrow keys nudge selected canvas objects.
      // Plain arrow = fine step, Ctrl+arrow = coarse step. (Shift+←/→ stays frame stepping.)
      const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (ARROWS[e.key] && !inInput && !e.shiftKey && this._selectedIds.size > 0) {
        const step = e.ctrlKey || e.metaKey ? 0.02 : 0.005;
        const [dx, dy] = ARROWS[e.key];
        if (!this._nudgeBefore) this._nudgeBefore = JSON.stringify(this.project.toDict());
        if (this.canvas.nudgeSelected(dx * step, dy * step)) {
          e.preventDefault();
          this._dirty = true;
          const clip = this._findClip(this._selectionPrimaryId ?? '');
          if (clip && this._selectedIds.size === 1) this.props.showClip(clip);
          this._updateStatus('Nudged selection');
          clearTimeout(this._nudgeCommitTimer);
          this._nudgeCommitTimer = setTimeout(() => {
            this._commit(this._nudgeBefore);
            this._nudgeBefore = null;
          }, 400);
        }
        return;
      }
      if (e.key === 'Home' && !inInput) { e.preventDefault(); this.playback.seek(0); return; }
      if (e.key === 'End' && !inInput) { e.preventDefault(); this.playback.seek(this.project.duration); return; }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n': e.preventDefault(); this._dispatchAction('new'); break;
          case 'o': e.preventDefault(); this._dispatchAction('open'); break;
          case 's':
            e.preventDefault();
            this._dispatchAction(e.shiftKey ? 'save-as' : 'save');
            break;
          case 'r': e.preventDefault(); this._openRenderModal(); break;
          case 'q': e.preventDefault(); window.close(); break;
          case 'd': if (!inInput) { e.preventDefault(); this._duplicateSelected(); } break;
          case 'x': if (!inInput) { e.preventDefault(); this._cutSelected(); } break;
          case 'c': if (!inInput) { e.preventDefault(); this._copySelected(); } break;
          case 'v': if (!inInput) { e.preventDefault(); this._pasteClip(); } break;
          case 'z':
            e.preventDefault();
            if (e.shiftKey) this._redo(); else this._undo();
            break;
        }
      }
    });
  }

  _dispatchAction(action, payload = null) {
    switch (action) {
      case 'new':           this._newProject(); break;
      case 'open':          this._openProject(); break;
      case 'save':          this._saveProject(); break;
      case 'save-as':       this._saveAs(); break;
      case 'canvas-resize': this._openCanvasResizeModal(); break;
      case 'render':        this._openRenderModal(); break;
      case 'quit':          window.close(); break;
      case 'add-narration': this._addClip('narration'); break;
      case 'add-code':      this._addClip('code'); break;
      case 'add-graph':     this._addClip('graph'); break;
      case 'add-audio':     this._addClip('audio'); break;
      case 'add-image':     this._addClip('image'); break;
      case 'add-shape':     this._addShapeClip(payload ?? 'rectangle'); break;
      case 'delete':        this._deleteSelected(); break;
      case 'duplicate':     this._duplicateSelected(); break;
      case 'cut':           this._cutSelected(); break;
      case 'copy':          this._copySelected(); break;
      case 'paste':         this._pasteClip(); break;
    }
  }

  _togglePlay() {
    this.playback.toggle();
    document.getElementById('play-btn').textContent = this.playback.playing ? '⏸  Pause' : '▶  Play';
    if (this.playback.playing) {
      this._startAudioScheduling();
    } else {
      this._pauseAllAudio(false);
    }
  }

  _stop() {
    this.playback.pause();
    this.playback.seek(0.0);
    document.getElementById('play-btn').textContent = '▶  Play';
    this._pauseAllAudio(true);
  }

  _onPlaybackTick(t, isSeek = false) {
    this.canvas.setPlayhead(t);
    this.timeline.setPlayhead(t);
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms   = Math.floor((t % 1) * 1000);
    document.getElementById('timecode-lbl').textContent =
      `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;

    this._enforceAudioBounds(t);
    if (isSeek || !this.playback.playing) this._resyncAudioOnSeek(t);
  }

  _nextStartForTrack(track) {
    const onTrack = this.project.clips.filter(c => c.track === track);
    if (onTrack.length === 0) return 0.0;
    return Math.max(...onTrack.map(c => c.end()));
  }



  _addClip(clip_type) {
    const before = JSON.stringify(this.project.toDict());
    const track = CLIP_TYPE_TRACK[clip_type] ?? 'visual';
    const start = Math.max(this.playback.playhead, this._nextStartForTrack(track));
    const c = newClip(clip_type, start);
    this.project.clips.push(c);
    this._dirty = true;
    this._refreshAll();
    this._setSelection([c.id], c.id);
    this._updateStatus(`Added: ${clip_type}`);
    this._commit(before);
  }

  _deleteSelected() {
    if (this._selectedIds.size === 0) return;
    const before = JSON.stringify(this.project.toDict());
    for (const id of this._selectedIds) {
      const clip = this._findClip(id);
      if (clip && clip.clip_type === 'audio') this._removeAudioForClip(clip.id);
    }
    this.project.clips = this.project.clips.filter(c => !this._selectedIds.has(c.id));
    this._setSelection([]);
    this.props.clear();
    this._dirty = true;
    this._refreshAll();
    this._commit(before);
  }

  _duplicateSelected() {
    if (!this._selectionPrimaryId) return;
    const before = JSON.stringify(this.project.toDict());
    const clip = this._findClip(this._selectionPrimaryId ?? '');
    if (!clip) return;
    const dup = deepCloneClip(clip);
    dup.id    = genId();
    dup.start = clip.end();
    this.project.clips.push(dup);
    if (dup.clip_type === 'audio') this._ensureAudioForClip(dup);
    this._dirty = true;
    this._refreshAll();
    this._commit(before);
  }

  _copySelected() {
    const clip = this._findClip(this._selectionPrimaryId ?? '');
    if (clip) {
      this._clipboard = deepCloneClip(clip);
      this._updateStatus(`Copied: ${clip.label()}`);
    }
  }

  _cutSelected() {
    const clip = this._findClip(this._selectionPrimaryId ?? '');
    if (clip) {
      this._clipboard = deepCloneClip(clip);
      this._deleteSelected();
      this._updateStatus(`Cut: ${clip.label()}`);
    }
  }

  _pasteClip() {
    if (!this._clipboard) { this._updateStatus('Nothing to paste'); return; }
    const before = JSON.stringify(this.project.toDict());
    const pasted = deepCloneClip(this._clipboard);
    pasted.id    = genId();
    pasted.start = this.playback.playhead;
    this.project.clips.push(pasted);
    if (pasted.clip_type === 'audio') this._ensureAudioForClip(pasted);
    this._dirty = true;
    this._setSelection([pasted.id], pasted.id);
    this._refreshAll();
    this._updateStatus(`Pasted: ${pasted.label()}`);
    this._commit(before);
  }

  _newProject() {
    this._confirmDiscard(() => {
      this.project = new Project();
      this._projectPath = null;
      this._dirty = false;
      this._selectionPrimaryId = null;
      this._syncProjectToWidgets();
      this.props.clear();
      this._refreshAll();
    });
  }

  async _openProject() {
      let projects;
      try {
        const res = await fetch('/projects-list');
        projects = await res.json();
      } catch (err) {
        this._updateStatus('Could not load project list');
        return;
      }
      this._showOpenProjectModal(projects);
    }

  _showOpenProjectModal(projects) {
      let overlay = document.getElementById('open-project-overlay');
      if (overlay) overlay.remove();

      overlay = document.createElement('div');
      overlay.id = 'open-project-overlay';
      overlay.className = 'modal-overlay open';

      const box = document.createElement('div');
      box.className = 'modal-box';
      box.style.minWidth = '220px';

      const heading = document.createElement('h3');
      heading.textContent = 'Open Project';
      heading.style.marginBottom = '10px';
      box.appendChild(heading);

      if (!projects.length) {
        const empty = document.createElement('div');
        empty.className = 'props-placeholder';
        empty.textContent = 'No saved projects yet';
        box.appendChild(empty);
      }

      projects.forEach(p => {
          const row = document.createElement('div');
          row.className = 'snap-option';

          const btn = document.createElement('button');
          btn.className = 'snap-option-label';
          btn.textContent = p.name;

          btn.addEventListener('click', () => {
              this._wsSend({
                  type: 'load_project',
                  filename: p.name
              });
              overlay.remove();
          });

          const del = document.createElement('button');
          del.className = 'snap-option-delete';
          del.innerHTML = '&times;';
          del.title = 'Delete project';

          del.addEventListener('click', (e) => {
              e.stopPropagation();

              if (!confirm(`Delete "${p.name}"?`))
                  return;

              this._wsSend({
                  type: 'delete_project',
                  filename: p.name
              });
          });

          row.appendChild(btn);
          
          box.appendChild(row);
          row.appendChild(del);
      });

      const cancel = document.createElement('span');
      cancel.id = 'snap-modal-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => overlay.remove());
      box.appendChild(cancel);

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

  _saveProject() { this._writeProject(this._projectPath ?? (this.project.name + '.vkit')); }
  async _saveAs() {
    const json = JSON.stringify(this.project.toDict(), null, 2);
    const suggestedName = (this.project.name.endsWith('.vkit') || this.project.name.endsWith('.json'))
      ? this.project.name
      : this.project.name + '.vkit';

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'vidkit project',
            accept: { 'application/json': ['.vkit', '.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        this._updateStatus(`Exported: ${handle.name}`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Save As failed:', err);
          this._updateStatus('Save As failed');
        }
        // AbortError = user cancelled the picker, do nothing
      }
      return;
    }

    // Fallback for browsers without File System Access API (Firefox, Safari)
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    this._updateStatus(`Exported: ${suggestedName}`);
  }

  _writeProject(filename) {
    const name = filename.endsWith('.vkit') || filename.endsWith('.json')
      ? filename
      : filename + '.vkit';

    this._wsSend({
      type: 'save_project',
      data: this.project.toDict(),
      filename: name,
    });
    // _dirty/_projectPath/_updateTitle now happen on save_status confirmation, not here
  }

  _render() { this._wsSend({ type: 'render', data: this.project.toDict() }); }

  _openSnapModal() {
    const SNAP_POSITIONS = [
      [0.5,  0.12, 'top centre'],
      [0.5,  0.50, 'mid centre'],
      [0.5,  0.85, 'bottom centre'],
      [0.25, 0.12, 'top left'],
      [0.75, 0.12, 'top right'],
    ];
    const container = document.getElementById('snap-options');
    container.innerHTML = '';
    SNAP_POSITIONS.forEach(([sx, sy, label]) => {
      const btn = document.createElement('button');
      btn.className = 'snap-option';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const clip = this._findClip(this._selectionPrimaryId ?? '');
        if (clip) {
          clip.x = sx;
          clip.y = sy;
          this.props.showClip(clip);
          this._dirty = true;
          this.canvas.redraw();
          this.timeline.redraw();
          this._updateStatus();
        }
        document.getElementById('snap-modal-overlay').classList.remove('open');
      });
      container.appendChild(btn);
    });
    document.getElementById('snap-modal-overlay').classList.add('open');
  }

  _openAdvancedTextModal(clip) {
    this._advTextClipId = clip.id;
    this._advTextBefore = JSON.stringify(this.project.toDict());
    const iframe = document.getElementById('advtext-iframe');

    const onReady = (e) => {
      if (e.data?.type !== 'vidkit:iframeReady') return;
      iframe.contentWindow.postMessage(
        { type: 'vidkit:loadClip', payload: this._clipToAdvancedState(clip) }, '*'
      );
      window.removeEventListener('message', onReady);
    };
    window.addEventListener('message', onReady);

    iframe.src = 'animationwindow.html?t=' + Date.now(); // forces reload every open
    document.getElementById('advtext-modal-overlay').classList.add('open');
  }

  _closeAdvancedTextModal() {
    document.getElementById('advtext-modal-overlay').classList.remove('open');
    this._advTextClipId = null;
  }
  
  _clipToAdvancedState(clip) {
    return {
      text: clip.content ?? '',
      fontFamily: clip.text_font_family ?? "'Space Grotesk', sans-serif",
      fontSize: clip.font_size ?? 64,
      fontWeight: clip.font_bold ? 700 : 600,
      letterSpacing: clip.text_letter_spacing ?? 0,
      lineHeight: clip.text_line_height ?? 1.15,
      textAlign: clip.text_align ?? 'center',
      bold: !!clip.font_bold,
      italic: !!clip.font_italic,
      underline: !!clip.text_underline,
      strike: !!clip.text_strike,
      uppercase: !!clip.text_uppercase,

      animType: clip.text_anim_style === 'wordblurin' ? 'wordblur' : (clip.text_anim_style ?? 'none'),
      animDuration: clip.text_duration_ms ?? 700,
      animDelay: clip.text_delay_ms ?? 0,
      animStagger: clip.text_stagger_ms ?? 40,
      animEasing: clip.text_anim_easing ?? 'easeInOut',
      loop: false,
      loopPause: 900,

      textColor: clip.font_color ?? '#f5f4f0',
      plate: !!clip.text_plate,
      plateColor: clip.text_plate?.color ?? '#111111',
      platePadding: clip.text_plate?.padding ?? 24,
      plateRadius: clip.text_plate?.radius ?? 0,

      shadow: !!clip.text_shadow,
      shadowX: clip.text_shadow?.x ?? 4,
      shadowY: clip.text_shadow?.y ?? 4,
      shadowBlur: clip.text_shadow?.blur ?? 0,
      shadowColor: clip.text_shadow?.color ?? '#000000',
      shadowOpacity: (clip.text_shadow?.opacity ?? 0.6) * 100,

      glow: !!clip.text_glow,
      glowBlur: clip.text_glow?.blur ?? 20,
      glowColor: clip.text_glow?.color ?? '#d8341c',
      glowOpacity: (clip.text_glow?.opacity ?? 0.7) * 100,

      stroke: !!clip.text_stroke,
      strokeWidth: clip.text_stroke?.width ?? 2,
      strokeColor: clip.text_stroke?.color ?? '#111111',

      textOpacity: (clip.text_opacity ?? 1.0) * 100,
    };
  }

  _applyAdvancedTextToClip(payload) {
    const clip = this._findClip(this._advTextClipId);
    if (!clip) return;

    clip.content = payload.content;
    clip.font_size = payload.typography.fontSize;
    clip.font_color = payload.typography.color;
    clip.font_bold = payload.typography.fontWeight >= 700;
    clip.font_italic = payload.typography.italic;
    clip.text_font_family = payload.typography.fontFamily;
    clip.text_letter_spacing = payload.typography.letterSpacing;
    clip.text_line_height = payload.typography.lineHeight;
    clip.text_align = payload.typography.align;
    clip.text_underline = payload.typography.underline;
    clip.text_strike = payload.typography.strikethrough;
    clip.text_uppercase = payload.typography.uppercase;

    clip.text_anim_style = payload.animation.type === 'none' ? null : payload.animation.type;
    clip.text_duration_ms = payload.animation.durationMs;
    clip.text_stagger_ms = payload.animation.staggerMs;
    clip.text_delay_ms = payload.animation.delayMs ?? 0;
    clip.text_anim_easing = payload.animation.easing ?? 'easeInOut';

    clip.text_shadow = payload.effects.shadow
      ? { ...payload.effects.shadow, opacity: payload.effects.shadow.opacity / 100 }
      : null;
    clip.text_glow = payload.effects.glow
      ? { ...payload.effects.glow, opacity: payload.effects.glow.opacity / 100 }
      : null;
    clip.text_stroke = payload.effects.stroke ?? null;
    clip.text_opacity = payload.effects.opacity / 100;
    clip.text_plate = payload.plate ?? null;

    this._dirty = true;
    this._refreshAll();
    this.canvas.redraw();
    this.timeline.redraw();
    if (this._selectionPrimaryId === clip.id) this.props.showClip(clip);
    this._commit(this._advTextBefore);
    this._closeAdvancedTextModal();
    this._previewClipAnimation(clip);
  }

  // #66 — the canvas animation clock is playhead-driven, so a static redraw
  // after Apply shows the animation's *finished* state. Seek to the clip's
  // start and play so the newly applied animation actually runs.
  _previewClipAnimation(clip, force = false) {
    if (!force && !clip.text_anim_style && !clip.transition_in && !clip.transition_out
        && !(clip.motion_keyframes?.length >= 2)) return;
    if (this.playback.playing) this._togglePlay();  // pause + audio stop
    this.playback.seek(Math.max(0, clip.start));
    this._togglePlay();                             // play from clip start
  }




  _openCanvasResizeModal() {
    const PRESETS = [
      { label: '9:16  — Shorts / Reels  (1080×1920)', w: 1080, h: 1920 },
      { label: '16:9  — YouTube / landscape (1920×1080)', w: 1920, h: 1080 },
      { label: '1:1   — Square  (1080×1080)',             w: 1080, h: 1080 },
      { label: '4:5   — Instagram portrait (1080×1350)',  w: 1080, h: 1350 },
    ];

    let overlay = document.getElementById('canvas-resize-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id        = 'canvas-resize-overlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box" style="min-width:260px">
          <h3 style="color:#ccc;font-size:12px;margin-bottom:10px">Canvas size</h3>
          <div id="canvas-resize-presets"></div>
          <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
            <input id="canvas-w-input" type="number" min="1" max="7680" step="1"
              style="width:72px;background:#1a1a1a;color:#d4d4d4;border:1px solid #333;
                    font-size:11px;padding:3px 4px;border-radius:2px;font-family:Consolas,monospace">
            <span style="color:#555;font-size:11px">×</span>
            <input id="canvas-h-input" type="number" min="1" max="7680" step="1"
              style="width:72px;background:#1a1a1a;color:#d4d4d4;border:1px solid #333;
                    font-size:11px;padding:3px 4px;border-radius:2px;font-family:Consolas,monospace">
            <button id="canvas-resize-apply" class="btn" style="margin-left:4px">Apply</button>
          </div>
          <span id="canvas-resize-cancel"
            style="margin-top:8px;color:#555;font-size:10px;cursor:pointer;display:block;text-align:right">
            Cancel
          </span>
        </div>`;
      document.body.appendChild(overlay);

      const presetContainer = overlay.querySelector('#canvas-resize-presets');
      for (const p of PRESETS) {
        const btn = document.createElement('button');
        btn.className   = 'snap-option';
        btn.textContent = p.label;
        btn.addEventListener('click', () => {
          overlay.querySelector('#canvas-w-input').value = p.w;
          overlay.querySelector('#canvas-h-input').value = p.h;
        });
        presetContainer.appendChild(btn);
      }

      overlay.querySelector('#canvas-resize-apply').addEventListener('click', () => {
        const w = parseInt(overlay.querySelector('#canvas-w-input').value, 10);
        const h = parseInt(overlay.querySelector('#canvas-h-input').value, 10);
        if (!w || !h || w < 1 || h < 1) return;
        const before = JSON.stringify(this.project.toDict());
        this.project.canvas_w = w;
        this.project.canvas_h = h;
        this._dirty = true;
        this._syncProjectToWidgets();
        this._refreshAll();
        this._updateStatus(`Canvas: ${w}×${h}`);
        overlay.classList.remove('open');
        this._commit(before);
      });

      overlay.querySelector('#canvas-resize-cancel').addEventListener('click', () => {
        overlay.classList.remove('open');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    }

    overlay.querySelector('#canvas-w-input').value = this.project.canvas_w;
    overlay.querySelector('#canvas-h-input').value = this.project.canvas_h;
    overlay.classList.add('open');
  }

  // Tight-fit output length: end of the last clip + a small trailing buffer.
  // This is what project.duration *should* be, but nothing currently keeps
  // it in sync when a clip shrinks (e.g. speeding a video clip up shortens
  // its duration but leaves the old, longer project length in place —
  // rendering several extra seconds/minutes of empty black at the end).
  _fitDuration() {
    if (!this.project.clips.length) return 30.0;
    return Math.max(...this.project.clips.map(c => c.end())) + 2.0;
  }

  _openRenderModal() {
    let overlay = document.getElementById('render-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id        = 'render-confirm-overlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-box" style="min-width:300px">
          <h3 style="color:#ccc;font-size:12px;margin-bottom:10px">Render video</h3>
          <div id="render-confirm-info" style="color:#888;font-size:11px;margin-bottom:12px;line-height:1.5"></div>
          <div style="display:flex;gap:6px;align-items:center">
            <label style="color:#aaa;font-size:11px;width:88px">Length (s)</label>
            <input id="render-duration-input" type="number" min="0.1" max="36000" step="0.1"
              style="width:88px;background:#1a1a1a;color:#d4d4d4;border:1px solid #333;
                    font-size:11px;padding:3px 4px;border-radius:2px;font-family:Consolas,monospace">
            <button id="render-duration-fit" class="snap-option" style="width:auto;padding:4px 8px">Fit to clips</button>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;justify-content:flex-end">
            <span id="render-confirm-cancel" style="color:#555;font-size:10px;font-weight:700;cursor:pointer">Cancel</span>
            <button id="render-confirm-go" class="btn">Render</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('#render-duration-fit').addEventListener('click', () => {
        overlay.querySelector('#render-duration-input').value = this._fitDuration().toFixed(1);
      });
      overlay.querySelector('#render-confirm-cancel').addEventListener('click', () => {
        overlay.classList.remove('open');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
      overlay.querySelector('#render-confirm-go').addEventListener('click', () => {
        const v = parseFloat(overlay.querySelector('#render-duration-input').value);
        if (!isNaN(v) && v > 0 && v !== this.project.duration) {
          const before = JSON.stringify(this.project.toDict());
          this.project.duration = Math.round(v * 100) / 100;
          this._dirty = true;
          this._syncProjectToWidgets();
          this._updateStatus();
          this._commit(before);
        }
        overlay.classList.remove('open');
        this._render();
      });
    }

    const fit = this._fitDuration();
    const slack = this.project.duration - fit;
    overlay.querySelector('#render-duration-input').value = fit.toFixed(1);

    const n = this.project.clips.length;
    const tracks = [...new Set(this.project.clips.map(c => c.track))].sort().join(', ') || 'no clips';
    let info = `${n} clip${n !== 1 ? 's' : ''} · ${tracks} · ${this.project.canvas_w}×${this.project.canvas_h} @ ${this.project.fps}fps`;
    if (slack > 0.5) {
      info += `<br><span style="color:#e0a030">Current length is ${this.project.duration.toFixed(1)}s — trimmed to ${fit.toFixed(1)}s below to drop ${slack.toFixed(1)}s of empty tail.</span>`;
    }
    overlay.querySelector('#render-confirm-info').innerHTML = info;
    overlay.classList.add('open');
  }

  _confirmDiscard(onYes) {
    if (!this._dirty) { onYes(); return; }
    document.getElementById('confirm-overlay').classList.add('open');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const cleanup = () => {
      document.getElementById('confirm-overlay').classList.remove('open');
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
    };
    document.getElementById('confirm-yes').addEventListener('click', () => { cleanup(); onYes(); }, { once: true });
    document.getElementById('confirm-no').addEventListener('click', () => { cleanup(); }, { once: true });
  }

  _findClip(id) { return this.project.clips.find(c => c.id === id) ?? null; }

  _setSelection(ids, primaryId = null) {
    const incoming = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
    this._selectedIds.clear();
    for (const id of incoming) this._selectedIds.add(id);
    this._selectionPrimaryId = primaryId ?? (incoming.length ? incoming[0] : null);
    this.canvas.setSelectedIds(this._selectedIds, this._selectionPrimaryId);
    this.timeline.setSelectedIds(this._selectedIds);
    if (this._selectedIds.size === 1) {
      const clip = this._findClip(this._selectionPrimaryId);
      if (clip) this.props.showClip(clip); else this.props.clear();
    } else if (this._selectedIds.size > 1) {
      const clips = [...this._selectedIds].map(id => this._findClip(id)).filter(Boolean);
      this.props.showMultiple(clips);
    } else {
      this.props.clear();
    }
    this._updateStatus();
  }

  _commit(beforeJSON) {
    const afterJSON = JSON.stringify(this.project.toDict());
    if (beforeJSON === afterJSON) return;
    this._undoStack.push({ before: beforeJSON, after: afterJSON });
    if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
    this._redoStack.length = 0;
    this._updateUndoRedoButtons();
  }

  _undo() {
    if (!this._undoStack.length) { this._updateStatus('Nothing to undo'); return; }
    const entry = this._undoStack.pop();
    this._redoStack.push(entry);
    if (this._redoStack.length > UNDO_LIMIT) this._redoStack.shift();
    this._applySnapshot(entry.before);
    this._updateUndoRedoButtons();
    this._updateStatus('Undo');
  }

  _redo() {
    if (!this._redoStack.length) { this._updateStatus('Nothing to redo'); return; }
    const entry = this._redoStack.pop();
    this._undoStack.push(entry);
    if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
    this._applySnapshot(entry.after);
    this._updateUndoRedoButtons();
    this._updateStatus('Redo');
  }

  _applySnapshot(json) {
    this.project = Project.fromDict(JSON.parse(json));
    this._setSelection([], null);
    this._syncProjectToWidgets();
    this._initAudioForProject();
    this._dirty = true;
    this._refreshAll();
  }

  _updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = this._undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this._redoStack.length === 0;
  }

  _syncProjectToWidgets() {
    this.canvas.setProject(this.project);
    this.timeline.setProject(this.project);
    this.playback.setProject(this.project);
  }

  _refreshAll() {
    if (this.project.clips.length > 0) {
      const maxEnd = Math.max(...this.project.clips.map(c => c.end()));
      this.project.duration = maxEnd + 2.0;
    } else {
      this.project.duration = 30.0; // or whatever your empty-project default is
    }
    this.canvas.redraw();
    this.timeline.redraw();
    this._updateStatus();
    this._updateTitle();
  }

  _updateTitle() {
    const dirty = this._dirty ? ' *' : '';
    document.title = `vidkit — ${this.project.name}${dirty}`;
    const nameInput = document.getElementById('project-name-lbl');
    if (document.activeElement !== nameInput) {
      nameInput.value = this.project.name;
    }
  }

  _updateStatus(msg = '') {
    const n = this.project.clips.length;
    const tracks = [...new Set(this.project.clips.map(c => c.track))].sort().join(' · ') || 'no clips';
    const base = `${n} clip${n !== 1 ? 's' : ''} · ${tracks} · ${this.project.duration.toFixed(1)}s · ${this.project.fps}fps · ${this.project.canvas_w}×${this.project.canvas_h}`;
    document.getElementById('status-text').textContent = '  ' + base + (msg ? `  |  ${msg}` : '');
  }

  _resizeAll() {
    this.canvas.resize();
    this.timeline.resize();
  }
}

window.addEventListener('DOMContentLoaded', () => { new App(); });