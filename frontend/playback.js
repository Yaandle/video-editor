// playback.js — PlaybackController
export class PlaybackController {
  constructor(project, onTick) {
    this.project  = project;
    this._onTick  = onTick;
    this.playing  = false;
    this.playhead = 0.0;
    this._raf     = null;
    this._lastTs  = null;
  }

  setProject(p) {
    this.project = p;
  }

  toggle() {
    if (this.playing) this.pause();
    else this._play();
  }

  pause() {
    this.playing = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._lastTs = null;
  }

  seek(t) {
    this.playhead = Math.max(0, Math.min(t, this.project.duration));
    this._onTick(this.playhead);
  }

  // ── Internal ──
  _play() {
    if (this.playing) return;
    if (this.playhead >= this.project.duration) this.playhead = 0.0;
    this.playing = true;
    this._lastTs = null;
    this._raf = requestAnimationFrame((ts) => this._tick(ts));
  }

  _tick(ts) {
    if (!this.playing) return;
    if (this._lastTs !== null) {
      const dt = (ts - this._lastTs) / 1000.0;
      this.playhead = Math.min(this.playhead + dt, this.project.duration);
      this._onTick(this.playhead);
      if (this.playhead >= this.project.duration) {
        this.pause();
        return;
      }
    }
    this._lastTs = ts;
    this._raf = requestAnimationFrame((ts2) => this._tick(ts2));
  }
}