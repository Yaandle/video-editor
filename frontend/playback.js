// playback.js — PlaybackController
export class PlaybackController {
  constructor(project, onTick) {
    this.project = project;
    this._onTick = onTick;
    this.playing = false;
    this.playhead = 0.0;
    this.loop = false; // toggle via .setLoop(bool)
    this._raf = null;
    this._lastTs = null;
  }

  setProject(p) {
    this.project = p;
    this.playhead = Math.min(this.playhead, p.duration);
  }

  setLoop(on) { this.loop = on; }
  toggle() { this.playing ? this.pause() : this._play(); }

  pause() {
    this.playing = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._lastTs = null;
  }

  seek(t) {
    this.playhead = Math.max(0, Math.min(t, this.project.duration));
    this._onTick(this.playhead, true); // true = explicit seek, not a playback tick
  }

  seekRelative(dt) { this.seek(this.playhead + dt); }

  stepFrame(dir = 1) {
    const fps = this.project.fps ?? 30;
    this.seekRelative(dir / fps);
  }

  _play() {
    if (this.playing) return;
    if (this.playhead >= this.project.duration) this.playhead = 0.0;
    this.playing = true;
    this._lastTs = null;
    this._raf = requestAnimationFrame(ts => this._tick(ts));
  }

  _tick(ts) {
    if (!this.playing) return;

    if (this._lastTs !== null) {
      const dt = (ts - this._lastTs) / 1000.0;
      this.playhead = this.playhead + dt;

      if (this.playhead >= this.project.duration) {
        if (this.loop) {
          this.playhead = this.playhead % this.project.duration;
        } else {
          this.playhead = this.project.duration;
          this._onTick(this.playhead);
          this.pause();
          return;
        }
      }
      this._onTick(this.playhead);
    }

    this._lastTs = ts;
    this._raf = requestAnimationFrame(ts2 => this._tick(ts2));
  }
}