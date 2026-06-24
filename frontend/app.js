// app.js — Main application controller
import { CanvasWidget } from './canvas.js';
import { TimelineWidget } from './timeline.js';
import { PropertiesPanel } from './properties.js';
import { PlaybackController } from './playback.js';
import { MediaBin } from './mediaBin.js';

// ── Colour palette ─────────────────────────────────────────────────────────────
export const TRACK_COLOURS = {
  audio:  { bg: '#1e3a5f', border: '#2563eb', text: '#93c5fd' },
  text:   { bg: '#14311a', border: '#16a34a', text: '#86efac' },
  visual: { bg: '#2c1e0a', border: '#d97706', text: '#fcd34d' },
};

export const CLIP_TYPE_TRACK = {
  narration: 'text',
  code:      'visual',
  graph:     'visual',
  audio:     'audio',
  image:     'visual',
  video:    'visual',
};

export const THEMES = {
  dark: {
    bg: '#0d1117', text: '#e6edf3', border: '#30363d',
    comment: '#8b949e', function: '#d2a8ff', keyword: '#ff7b72',
  },
  light: {
    bg: '#ffffff', text: '#24292f', border: '#d0d7de',
    comment: '#6e7781', function: '#8250df', keyword: '#cf222e',
  },
  monokai: {
    bg: '#272822', text: '#f8f8f2', border: '#75715e',
    comment: '#75715e', function: '#a6e22e', keyword: '#f92672',
  },
};

// ── Clip model ─────────────────────────────────────────────────────────────────
export class Clip {
  constructor(data) {
    this.id         = data.id         ?? '';
    this.track      = data.track      ?? 'visual';
    this.clip_type  = data.clip_type  ?? 'narration';
    this.start      = data.start      ?? 0.0;
    this.duration   = data.duration   ?? 5.0;
    this.content    = data.content    ?? '';
    this.x          = data.x          ?? 0.5;
    this.y          = data.y          ?? 0.15;
    this.animation  = data.animation  ?? 'typewriter';
    this.theme      = data.theme      ?? 'dark';
    this.code_file  = data.code_file  ?? '';
    this.graph_type = data.graph_type ?? 'bar';
    this.graph_data = data.graph_data ?? '';
    this.voice_id   = data.voice_id   ?? '';
    this.scale = data.scale ?? 1.0;
  }
  end()   { return this.start + this.duration; }
  label() {
    if (this.clip_type === 'narration') {
      const preview = this.content.slice(0, 28).replace(/\n/g, ' ');
      return this.content.length > 28 ? `"${preview}…"` : `"${this.content}"`;
    }
    if (this.clip_type === 'code') {
      const name = this.code_file ? this.code_file.split(/[\\/]/).pop() : 'code block';
      return `code · ${name}`;
    }
    if (this.clip_type === 'graph') return `graph · ${this.graph_type}`;
    if (this.clip_type === 'audio') {
      const preview = this.content.slice(0, 24).replace(/\n/g, ' ');
      return `audio · ${preview}`;
    }
    if (this.clip_type === 'video') {
        const name = this.code_file ? this.code_file.split(/[\\/]/).pop() : 'video';
        return `video · ${name}`;
        }
    if (this.clip_type === 'image') {
        const name = this.code_file ? this.code_file.split(/[\\/]/).pop() : 'image';
        return `image · ${name}`;
    }
    return this.clip_type;
  }
  toDict() {
    return {
      id: this.id, track: this.track, clip_type: this.clip_type,
      start: this.start, duration: this.duration, content: this.content,
      x: this.x, y: this.y, scale: this.scale,   
      animation: this.animation, theme: this.theme,
      code_file: this.code_file, graph_type: this.graph_type,
      graph_data: this.graph_data, voice_id: this.voice_id,
    };
  }
}

// ── Project model ──────────────────────────────────────────────────────────────
export class Project {
  constructor(data = {}) {
    this.name     = data.name     ?? 'untitled';
    this.canvas_w = data.canvas_w ?? 1080;
    this.canvas_h = data.canvas_h ?? 1920;
    this.fps      = data.fps      ?? 30;
    this.duration = data.duration ?? 30.0;
    this.clips    = (data.clips ?? []).map(cd => new Clip(cd));
  }
  toDict() {
    return {
      name: this.name, canvas_w: this.canvas_w, canvas_h: this.canvas_h,
      fps: this.fps, duration: this.duration,
      clips: this.clips.map(c => c.toDict()),
    };
  }
  static fromDict(d) { return new Project(d); }
}

// ── Factory ────────────────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function newClip(clip_type, start = 0.0, duration = 5.0) {
  const track = CLIP_TYPE_TRACK[clip_type] ?? 'visual';
  const defaults = {
    narration: { content: 'New narration text', animation: 'typewriter', theme: 'dark', y: 0.12 },
    code:      { animation: 'typewriter', theme: 'dark', y: 0.55 },
    graph:     { graph_type: 'bar', graph_data: 'A:10,B:20,C:15', theme: 'dark', y: 0.55 },
    audio:     { content: 'Narration goes here', y: 0.0 },
    image:     { theme: 'dark', y: 0.5 },
    video:     { y: 0.5 },
  };
  return new Clip({
    id: genId(), track, clip_type, start, duration,
    ...(defaults[clip_type] ?? {}),
  });
}

// ── Deep clone ────────────────────────────────────────────────────────────────
export function deepCloneClip(clip) {
  return new Clip(JSON.parse(JSON.stringify(clip.toDict())));
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

// ── App ────────────────────────────────────────────────────────────────────────
class App {
  constructor() {
    this.project       = new Project();
    this._projectPath  = null;
    this._dirty        = false;
    this._clipboard    = null;
    this._selectedId   = null;

    // Sub-controllers (instantiated after DOM refs)
    this.canvas   = null;
    this.timeline = null;
    this.props    = null;
    this.playback = null;
    this.mediaBin = null;
    this._ws      = null;
    
    this._init();
  }

  _init() {
        this.canvas   = new CanvasWidget(document.getElementById('canvas-widget'), this.project);
        this.timeline = new TimelineWidget(document.getElementById('timeline-canvas'), this.project);
        this.props    = new PropertiesPanel(document.getElementById('props-inner'));

        this.playback = new PlaybackController(
            this.project,
            (t) => this._onPlaybackTick(t)
        );

        this.mediaBin = new MediaBin(document.getElementById('media-bin'));
        this.mediaBin.onAddClip((item) => this._addMediaClip(item));
        this._loadMediaBin();

        const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this._ws = new WSClient(
            `${wsProtocol}//${location.host}/ws`,
            (msg) => this._onWsMessage(msg)
        );

        this._wireEvents();
        this._wireMenu();
        this._wireToolbar();
        this._wireKeyboard();

        this._seedDemoProject();

        this._resizeAll();
        window.addEventListener('resize', () => this._resizeAll());
    }
  
   // Add to App — upload a file and get back a media entry
    async _uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res  = await fetch('/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { name, url, kind, mime, size }
    }

    // Load existing media on boot
    async _loadMediaBin() {
        try {
            const items = await fetch('/media-list').then(r => r.json());
            items.forEach(item => this.mediaBin.addItem(item));
        } catch (err) {
            console.error('Failed to load media bin', err);
        }
    }

    _addMediaClip(item) {
    const clip_type =
        item.kind === 'video'
        ? 'video'
        : item.kind === 'audio'
            ? 'audio'
            : 'image';

    const dur = clip_type === 'audio' ? 10.0 : 5.0;

    const c = newClip(
        clip_type,
        this.playback.playhead,
        dur
    );

    c.code_file = item.url;

    this.project.clips.push(c);

    this._dirty = true;

    this._refreshAll();

    this._selectedId = c.id;

    this.timeline.setSelectedId(c.id);
    this.canvas.setSelectedId(c.id);

    this.props.showClip(c);

    this.canvas.redraw();

    this._updateStatus(
        `Added: ${item.original ?? item.name}`
    );
    }

  // ── WebSocket ──
  _onWsMessage(msg) {
    if (msg.type === 'project') {
      this.project = Project.fromDict(msg.data);
      this._syncProjectToWidgets();
      this._refreshAll();
      return;
    }
    if (msg.type === 'render_status') {
      this._showRenderToast(msg.status, msg.message ?? '');
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
      setTimeout(() => { toast.classList.remove('visible', 'done'); }, 6000);
    } else if (status === 'error') {
      toast.classList.add('error');
      toast.classList.remove('done');
      toast.textContent = `✗ ${message}`;
      setTimeout(() => { toast.classList.remove('visible', 'error'); }, 8000);
    }
  }
  
  _wsSend(obj) { this._ws.send(obj); }

  // ── Event wiring ──
  _wireEvents() {
    // Canvas events
    document.getElementById('canvas-widget').addEventListener('canvas:clipresized', (e) => {
      const clip = this._findClip(e.detail.id);
      if (clip && this._selectedId === e.detail.id) {
        this.props.showClip(clip);   
      }
      this._dirty = true;
      this._updateStatus();
    });
    document.getElementById('canvas-widget').addEventListener('canvas:select', (e) => {
      this._selectedId = e.detail.id;
      this.timeline.setSelectedId(e.detail.id);
      const clip = this._findClip(e.detail.id);
      if (clip) this.props.showClip(clip);
      this._updateStatus();
    });
    document.getElementById('canvas-widget').addEventListener('canvas:deselect', () => {
      this._selectedId = null;
      this.timeline.setSelectedId(null);
      this.props.clear();
    });

    // Timeline events
    document.getElementById('timeline-canvas').addEventListener('timeline:select', (e) => {
      this._selectedId = e.detail.id;
      this.canvas.setSelectedId(e.detail.id);
      const clip = this._findClip(e.detail.id);
      if (clip) this.props.showClip(clip);
      this._updateStatus();
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:deselect', () => {
      this._selectedId = null;
      this.canvas.setSelectedId(null);
      this.props.clear();
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:playheadmoved', (e) => {
      this.playback.seek(e.detail.t);
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:clipchanged', () => {
      this._dirty = true;
      this.canvas.redraw();
      this._updateStatus();
    });
    document.getElementById('timeline-canvas').addEventListener('timeline:slice', (e) => {
      const { sourceId, rightStart, rightDur, track, clip_type } = e.detail;
      const source = this._findClip(sourceId);
      if (!source) return;
      // Clone the source clip's properties into the right half
      const right = deepCloneClip(source);
      right.id       = genId();
      right.start    = rightStart;
      right.duration = rightDur;
      this.project.clips.push(right);
      this._dirty = true;
      this._refreshAll();
      this._updateStatus(`Sliced at ${rightStart.toFixed(2)}s`);
    });

    // Props events
    document.getElementById('props-inner').addEventListener('props:changed', () => {
      this._dirty = true;
      this.canvas.redraw();
      this.timeline.redraw();
      this._updateStatus();
    });
    document.getElementById('props-inner').addEventListener('props:snap', () => {
      this._openSnapModal();
    });

    // Menu close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu-item')) {
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      }
    });

    // Snap modal cancel
    document.getElementById('snap-modal-cancel').addEventListener('click', () => {
      document.getElementById('snap-modal-overlay').classList.remove('open');
    });
    document.getElementById('snap-modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('snap-modal-overlay'))
        document.getElementById('snap-modal-overlay').classList.remove('open');
    });
    const mediaInput = document.getElementById('media-upload');

    if (mediaInput) {
    mediaInput.addEventListener('change', async (e) => {
        const files = [...e.target.files];
        for (const file of files) {
        try {
            const item = await this._uploadFile(file);
            this.mediaBin.addItem(item);
        } catch (err) {
            console.error(err);
        }
        }
        mediaInput.value = '';
    });
    }
  }

  _wireMenu() {
    // Toggle dropdowns
    document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });

    // Actions
    document.querySelectorAll('.menu-dropdown-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        this._dispatchAction(item.dataset.action);
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
    document.getElementById('render-btn').addEventListener('click', () => this._render());

    // Razor tool toggle
    const razorBtn = document.getElementById('razor-btn');
    if (razorBtn) {
      razorBtn.addEventListener('click', () => {
        const next = this.timeline.tool === 'razor' ? 'select' : 'razor';
        this.timeline.setTool(next);
        razorBtn.classList.toggle('active', next === 'razor');
        this._updateStatus(next === 'razor' ? 'Razor tool — click a clip to slice' : 'Select tool');
      });
    }

    // Zoom controls
    const zoomInBtn    = document.getElementById('zoom-in-btn');
    const zoomOutBtn   = document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('zoom-reset-btn');
    if (zoomInBtn)    zoomInBtn.addEventListener('click',    () => this.timeline.zoomIn());
    if (zoomOutBtn)   zoomOutBtn.addEventListener('click',   () => this.timeline.zoomOut());
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this.timeline.zoomReset());
  }

  _wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't steal shortcuts from inputs/textareas
      const tag = document.activeElement.tagName;
      const inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

      if (e.code === 'Space' && !inInput) {
        e.preventDefault();
        this._togglePlay();
        return;
      }
      if (e.key === 'Delete' && !inInput) {
        e.preventDefault();
        this._deleteSelected();
        return;
      }
      if (e.key.toLowerCase() === 'r' && !inInput && !e.ctrlKey) {
        e.preventDefault();
        const next = this.timeline.tool === 'razor' ? 'select' : 'razor';
        this.timeline.setTool(next);
        const razorBtn = document.getElementById('razor-btn');
        if (razorBtn) razorBtn.classList.toggle('active', next === 'razor');
        this._updateStatus(next === 'razor' ? 'Razor tool — click a clip to slice' : 'Select tool');
        return;
      }
      if ((e.key === '+' || e.key === '=') && !inInput) {
        e.preventDefault(); this.timeline.zoomIn(); return;
      }
      if (e.key === '-' && !inInput) {
        e.preventDefault(); this.timeline.zoomOut(); return;
      }
      if (e.key === '0' && !inInput) {
        e.preventDefault(); this.timeline.zoomReset(); return;
      }
      // Frame step: Shift+Left / Shift+Right
      if (e.key === 'ArrowLeft' && e.shiftKey && !inInput) {
        e.preventDefault(); this.playback.stepFrame(-1); return;
      }
      if (e.key === 'ArrowRight' && e.shiftKey && !inInput) {
        e.preventDefault(); this.playback.stepFrame(1); return;
      }
      // Seek to start/end: Home / End
      if (e.key === 'Home' && !inInput) {
        e.preventDefault(); this.playback.seek(0); return;
      }
      if (e.key === 'End' && !inInput) {
        e.preventDefault(); this.playback.seek(this.project.duration); return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n': e.preventDefault(); this._dispatchAction('new'); break;
          case 'o': e.preventDefault(); this._dispatchAction('open'); break;
          case 's':
            e.preventDefault();
            if (e.shiftKey) this._dispatchAction('save-as');
            else this._dispatchAction('save');
            break;
          case 'r': e.preventDefault(); this._render(); break;
          case 'q': e.preventDefault(); window.close(); break;
          case 'd': if (!inInput) { e.preventDefault(); this._duplicateSelected(); } break;
          case 'x': if (!inInput) { e.preventDefault(); this._cutSelected(); } break;
          case 'c': if (!inInput) { e.preventDefault(); this._copySelected(); } break;
          case 'v': if (!inInput) { e.preventDefault(); this._pasteClip(); } break;
          case 'z':
            e.preventDefault();
            if (e.shiftKey) this._updateStatus('Redo not yet implemented');
            else this._updateStatus('Undo not yet implemented');
            break;
        }
      }
    });
  }

  _dispatchAction(action) {
    switch (action) {
      case 'new':           this._newProject(); break;
      case 'open':          this._openProject(); break;
      case 'save':          this._saveProject(); break;
      case 'save-as':       this._saveAs(); break;
      case 'render':        this._render(); break;
      case 'quit':          window.close(); break;
      case 'add-narration': this._addClip('narration'); break;
      case 'add-code':      this._addClip('code'); break;
      case 'add-graph':     this._addClip('graph'); break;
      case 'add-audio':     this._addClip('audio'); break;
      case 'add-image':     this._addClip('image'); break;
      case 'delete':        this._deleteSelected(); break;
      case 'duplicate':     this._duplicateSelected(); break;
      case 'cut':           this._cutSelected(); break;
      case 'copy':          this._copySelected(); break;
      case 'paste':         this._pasteClip(); break;
    }
  }

  // ── Transport ──
  _togglePlay() {
    this.playback.toggle();
    document.getElementById('play-btn').textContent =
      this.playback.playing ? '⏸  Pause' : '▶  Play';
  }

  _stop() {
    this.playback.pause();
    this.playback.seek(0.0);
    document.getElementById('play-btn').textContent = '▶  Play';
  }

  _onPlaybackTick(t) {
    this.canvas.setPlayhead(t);
    this.timeline.setPlayhead(t);
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms   = Math.floor((t % 1) * 1000);
    document.getElementById('timecode-lbl').textContent =
      `${mins}:${String(secs).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  // ── Clip management ──
  _addClip(clip_type) {
    const start = this.playback.playhead;
    const c = newClip(clip_type, start);
    this.project.clips.push(c);
    this._dirty = true;
    this._refreshAll();
    this._selectedId = c.id;
    this.timeline.setSelectedId(c.id);
    this.canvas.setSelectedId(c.id);
    this.props.showClip(c);
    this.canvas.redraw();
  }

  _deleteSelected() {
    if (!this._selectedId) return;
    this.project.clips = this.project.clips.filter(c => c.id !== this._selectedId);
    this._selectedId = null;
    this.timeline.setSelectedId(null);
    this.canvas.setSelectedId(null);
    this.props.clear();
    this._dirty = true;
    this._refreshAll();
  }

  _duplicateSelected() {
    if (!this._selectedId) return;
    const clip = this._findClip(this._selectedId);
    if (!clip) return;
    const dup = deepCloneClip(clip);
    dup.id    = genId();
    dup.start = clip.end();
    this.project.clips.push(dup);
    this._dirty = true;
    this._refreshAll();
  }

  _copySelected() {
    const clip = this._findClip(this._selectedId ?? '');
    if (clip) {
      this._clipboard = deepCloneClip(clip);
      this._updateStatus(`Copied: ${clip.label()}`);
    }
  }

  _cutSelected() {
    const clip = this._findClip(this._selectedId ?? '');
    if (clip) {
      this._clipboard = deepCloneClip(clip);
      this._deleteSelected();
      this._updateStatus(`Cut: ${clip.label()}`);
    }
  }

  _pasteClip() {
    if (!this._clipboard) { this._updateStatus('Nothing to paste'); return; }
    const pasted = deepCloneClip(this._clipboard);
    pasted.id    = genId();
    pasted.start = this.playback.playhead;
    this.project.clips.push(pasted);
    this._dirty = true;
    this._selectedId = pasted.id;
    this.timeline.setSelectedId(pasted.id);
    this.canvas.setSelectedId(pasted.id);
    this.props.showClip(pasted);
    this._refreshAll();
    this._updateStatus(`Pasted: ${pasted.label()}`);
  }

  // ── Project I/O ──
  _newProject() {
    this._confirmDiscard(() => {
      this.project = new Project();
      this._projectPath = null;
      this._dirty = false;
      this._selectedId = null;
      this._syncProjectToWidgets();
      this.props.clear();
      this._refreshAll();
    });
  }

  _openProject() {
    this._confirmDiscard(() => {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = '.vkit,.json';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            this.project = Project.fromDict(data);
            this._projectPath = file.name;
            this._dirty = false;
            this._selectedId = null;
            this._syncProjectToWidgets();
            this.props.clear();
            this._refreshAll();
          } catch (err) {
            alert('Open failed: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  _saveProject() {
    this._writeProject(this._projectPath ?? (this.project.name + '.vkit'));
  }

  _saveAs() {
    this._writeProject(this.project.name + '.vkit');
  }

  _writeProject(filename) {
    try {
      const json = JSON.stringify(this.project.toDict(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename.endsWith('.vkit') || filename.endsWith('.json')
        ? filename : filename + '.vkit';
      a.click();
      URL.revokeObjectURL(url);
      this._dirty = false;
      this._projectPath = a.download;
      this._updateTitle();
      this._updateStatus(`Saved: ${a.download}`);
      // Also send to backend if connected
      this._wsSend({ type: 'save_project', data: this.project.toDict() });
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  _render() {
    const msg = `Project: ${this.project.name}\nClips: ${this.project.clips.length}\nDuration: ${this.project.duration}s\n\nBackend render not yet wired.\nSave the project as .vkit and call main.py separately for now.`;
    alert(msg);
    this._wsSend({ type: 'render', data: this.project.toDict() });
  }

  // ── Snap modal ──
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
        const clip = this._findClip(this._selectedId ?? '');
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

  // ── Confirm dialog ──
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

  // ── Helpers ──
  _findClip(id) { return this.project.clips.find(c => c.id === id) ?? null; }

  _syncProjectToWidgets() {
    this.canvas.setProject(this.project);
    this.timeline.setProject(this.project);
    this.playback.setProject(this.project);
  }

  _refreshAll() {
    // Auto-extend duration
    if (this.project.clips.length > 0) {
      const maxEnd = Math.max(...this.project.clips.map(c => c.end()));
      if (maxEnd > this.project.duration) this.project.duration = maxEnd + 2.0;
    }
    this.canvas.redraw();
    this.timeline.redraw();
    this._updateStatus();
    this._updateTitle();
  }

  _updateTitle() {
    const dirty = this._dirty ? ' *' : '';
    document.title = `vidkit — ${this.project.name}${dirty}`;
    document.getElementById('project-name-lbl').textContent = this.project.name + dirty;
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

  // ── Demo project ──
  _seedDemoProject() {
    this.project.name     = 'demo — stepper motor';
    this.project.duration = 30.0;

    const clips = [
      newClip('audio',     0.0,  18.0),
      newClip('narration', 0.0,   7.0),
      newClip('code',      0.0,   7.5),
      newClip('narration', 8.0,   5.5),
      newClip('graph',     9.0,   5.0),
      newClip('narration', 15.0,  6.0),
      newClip('code',      15.5,  7.0),
    ];
    clips[0].content   = 'The stepper motor...';
    clips[1].content   = 'The 28BYJ-48 is a small, unipolar stepper motor.';
    clips[1].y         = 0.12;
    clips[2].content   = 'import RPi.GPIO as GPIO\n\nstep_pins = [11,12,13,15]\n\nfor step in full_step_seq:\n    for i, pin in enumerate(step_pins):\n        GPIO.output(pin, step[i])';
    clips[3].content   = 'Full step = 2048 steps per revolution.';
    clips[3].y         = 0.12;
    clips[4].graph_data = 'Phase1:1,Phase2:0,Phase3:0,Phase4:0';
    clips[5].content   = 'Half stepping doubles the resolution to 4096.';
    clips[5].y         = 0.12;
    clips[6].content   = 'half_step_seq = [\n    [1,0,0,0],[1,1,0,0],\n    [0,1,0,0],[0,1,1,0],\n]';

    clips.forEach(c => this.project.clips.push(c));
    this._syncProjectToWidgets();
    this._refreshAll();
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => { new App(); });
