// playback.js — PlaybackController
export class PlaybackController {
  constructor(project, onTick) {
    this.project  = project;
    this._onTick  = onTick;
    this.playing  = false;
    this.playhead = 0.0;
    this.loop     = false;       // toggle via .setLoop(bool)
    this._raf     = null;
    this._lastTs  = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  setProject(p) {
    this.project = p;
    // Clamp playhead to new duration
    this.playhead = Math.min(this.playhead, p.duration);
  }

  setLoop(on) { this.loop = on; }

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
    this._onTick(this.playhead, true); // true = explicit seek, not a playback tick
  }

  // Step forward / back by dt seconds (for frame-stepping)
  seekRelative(dt) {
    this.seek(this.playhead + dt);
  }

  // Step by exactly one frame
  stepFrame(dir = 1) {
    const fps = this.project.fps ?? 30;
    this.seekRelative(dir / fps);
  }

  // ── Internal ────────────────────────────────────────────────────────────────
  _play() {
    if (this.playing) return;
    // Restart from beginning if at end
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