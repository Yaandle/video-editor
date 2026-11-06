// transport.js — the wall-clock play head for editor pages (editor, Text Studio,
// style previews). It lives outside the renderer on purpose: the renderer only
// ever receives t. When an audio element is attached and running it is the
// clock, so picture follows sound.

export class Transport {
  constructor(onTick, { loop = false } = {}) { this.onTick = onTick; this.playing = false; this.t = 0; this.audio = null; this.loop = loop; }
  play(duration) {
    if (this.playing) return;
    if (this.t >= duration - 1e-3) this.t = 0;
    this.playing = true;
    this.duration = duration;
    this.last = performance.now();
    if (this.audio) { this.audio.currentTime = this.t; this.audio.play().catch(() => {}); }
    const step = (now) => {
      if (!this.playing) return;
      // The audio element is the clock when it is running, so picture follows sound.
      if (this.audio && !this.audio.paused && this.audio.readyState >= 2) this.t = this.audio.currentTime;
      else this.t += (now - this.last) / 1000;
      this.last = now;
      if (this.t >= this.duration) {
        if (this.loop) { this.t %= this.duration; if (this.audio) this.audio.currentTime = this.t; }
        else { this.t = this.duration; this.pause(); this.onTick(this.t, true); return; }
      }
      this.onTick(this.t, false);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.audio?.pause(); }
  seek(t) { this.t = t; if (this.audio) this.audio.currentTime = t; }
}
