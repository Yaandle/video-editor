// beat.js — beat grid maths shared by the timeline, the scene scheduler and
// (via studio/beatgrid.py, same formulas) the render-time validator.
//
// A grid step is 60 / bpm / subdivision seconds. Settings are only valid when a
// step is a whole number of frames, so every grid line is an exact frame.

export function grid(settings) {
  const fps = settings.fps ?? 30;
  const bpm = settings.bpm;
  if (!bpm) return null;
  const subdivision = settings.subdivision ?? 1;
  const beat = 60 / bpm;
  const step = beat / subdivision;
  const offset = settings.beat_offset ?? 0;
  const framesPerStep = step * fps;
  return {
    fps, bpm, subdivision, beat, step, offset,
    framesPerBeat: beat * fps,
    framesPerStep,
    valid: Math.abs(framesPerStep - Math.round(framesPerStep)) < 1e-9,
    bar: beat * 4,
  };
}

/** Nearest grid line to t (seconds). Returns t unchanged without a grid. */
export function snap(t, settings, mode = 'step') {
  const g = grid(settings);
  if (!g) return t;
  const unit = mode === 'beat' ? g.beat : mode === 'bar' ? g.bar : g.step;
  return g.offset + Math.round((t - g.offset) / unit) * unit;
}

/** Time of beat n (0-based) — a convenience for scene scheduling. */
export function beatTime(n, settings) {
  const g = grid(settings);
  return g ? g.offset + n * g.beat : n * 0.5;
}

/** Frame distance from t to the nearest grid line. */
export function offGridFrames(t, settings) {
  const g = grid(settings);
  if (!g) return 0;
  return Math.abs(t - snap(t, settings)) * g.fps;
}

/** All grid lines in [t0, t1) — for drawing the timeline. */
export function lines(t0, t1, settings, mode = 'step') {
  const g = grid(settings);
  if (!g) return [];
  const unit = mode === 'beat' ? g.beat : mode === 'bar' ? g.bar : g.step;
  const out = [];
  let n = Math.ceil((t0 - g.offset) / unit - 1e-9);
  for (let t = g.offset + n * unit; t < t1; n++, t = g.offset + n * unit) {
    const beatIndex = Math.round((t - g.offset) / g.beat);
    const onBeat = Math.abs((t - g.offset) / g.beat - beatIndex) < 1e-6;
    out.push({ t, onBeat, onBar: onBeat && beatIndex % 4 === 0, beat: beatIndex });
  }
  return out;
}
