// motion.js — the only motion vocabulary scenes may use.
//
// Every animated value is a closed-form function of time. A spring here is the
// analytic solution of a damped harmonic oscillator released from x(0)=0
// towards a target of 1 with initial velocity v0; nothing integrates over
// frames, nothing reads a clock. Presets come from design/tokens.json
// (`motion`), one parameter set per property so a "slam" can overshoot in
// position while its scale barely moves (mid-spring frames stay readable).

export function spring(t, { stiffness = 170, damping = 18, mass = 1, v0 = 0 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-6) {                     // critically damped
    return 1 - Math.exp(-w0 * t) * (1 + (w0 - v0) * t);
  }
  if (z < 1) {                                      // underdamped: overshoot + settle
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) *
      (Math.cos(wd * t) + ((z * w0 - v0) / wd) * Math.sin(wd * t));
  }
  const s = Math.sqrt(z * z - 1);                   // overdamped
  const r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  const c2 = (v0 + r1) / (r1 - r2), c1 = 1 - c2;
  return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}

// Default presets — overwritten by setMotionTokens() with tokens.motion so the
// design system, not this file, owns the numbers.
let PRESETS = {
  snappy: { position: { k: 380, c: 26 }, scale: { k: 420, c: 32 }, rotation: { k: 320, c: 24 }, opacity: { k: 520, c: 46 } },
  slam:   { position: { k: 900, c: 50, m: 2 }, scale: { k: 640, c: 40 }, rotation: { k: 520, c: 34 }, opacity: { k: 900, c: 62 } },
  soft:   { position: { k: 120, c: 21 }, scale: { k: 140, c: 24 }, rotation: { k: 120, c: 21 }, opacity: { k: 160, c: 26 } },
  quick:  { position: { k: 600, c: 49 }, scale: { k: 600, c: 49 }, rotation: { k: 600, c: 49 }, opacity: { k: 700, c: 53 } },
  wobble: { position: { k: 260, c: 12 }, scale: { k: 300, c: 14 }, rotation: { k: 260, c: 9 }, opacity: { k: 520, c: 46 } },
};
let STAGGER = { char: 0.022, word: 0.055, line: 0.11, item: 0.133 };
let EXIT_LENGTH = 0.4;

export const PRESET_NAMES = () => Object.keys(PRESETS);
export const PROPERTIES = ['position', 'scale', 'rotation', 'opacity'];

export function setMotionTokens(motion) {
  if (!motion) return;
  const next = {};
  for (const [name, val] of Object.entries(motion)) {
    if (val && typeof val === 'object' && val.position) next[name] = val;
  }
  if (Object.keys(next).length) PRESETS = next;
  if (motion.stagger) STAGGER = { ...STAGGER, ...motion.stagger };
  if (motion.exit?.length) EXIT_LENGTH = motion.exit.length;
  _memo.clear();
}

export function staggerStep(unit) { return STAGGER[unit] ?? STAGGER.item; }
export function exitLength() { return EXIT_LENGTH; }

export function params(preset = 'snappy', prop = 'position') {
  const p = (PRESETS[preset] ?? PRESETS.snappy)[prop] ?? PRESETS.snappy.position;
  return { stiffness: p.k, damping: p.c, mass: p.m ?? 1, v0: p.v0 ?? 0 };
}

/** Spring progress 0→1 (overshooting per preset) for `prop` at local time t. */
export function sp(t, preset = 'snappy', prop = 'position') {
  return spring(t, params(preset, prop));
}

/** Opacity-safe spring: same timing family, clamped to [0, 1]. */
export function fade(t, preset = 'snappy') {
  const v = spring(t, params(preset, 'opacity'));
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const lerp = (a, b, p) => a + (b - a) * p;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);

// ── Analytic timing: arrival, peak, settle ───────────────────────────────────
// Memoized per parameter set; pure (same inputs → same outputs).

const _memo = new Map();
function memo(key, fn) {
  if (!_memo.has(key)) _memo.set(key, fn());
  return _memo.get(key);
}

function analysis(p) {
  const key = `${p.stiffness}|${p.damping}|${p.mass}|${p.v0}`;
  return memo(key, () => {
    const w0 = Math.sqrt(p.stiffness / p.mass);
    const z = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
    let arrival, peak, settle, overshoot = 0;
    // Overshoot below 0.5 % is invisible; such a spring "arrives" when it is
    // within 0.5 % (the frame it looks landed), not when it grazes 1.0 late.
    const underVisible = z < 1 - 1e-6 && p.v0 === 0 &&
      Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z)) >= 0.005;
    if (underVisible) {
      const wd = w0 * Math.sqrt(1 - z * z);
      arrival = (Math.PI - Math.atan2(wd, z * w0)) / wd;      // first crossing of 1
      peak = Math.PI / wd;                                     // first extremum
      overshoot = spring(peak, p) - 1;
      const amp = Math.sqrt(1 + ((z * w0) / wd) ** 2);
      settle = Math.log(amp / 0.005) / (z * w0);               // envelope inside ±0.5 %
    } else {
      // No overshoot: arrival = reaching 99.5 %, found by bisection on a monotone curve.
      const reach = (target) => {
        let lo = 0, hi = 0.05;
        while (spring(hi, p) < target && hi < 30) hi *= 2;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          if (spring(mid, p) < target) lo = mid; else hi = mid;
        }
        return hi;
      };
      arrival = reach(0.995);
      peak = arrival;
      settle = arrival;
    }
    return { arrival, peak, settle, overshoot, zeta: z, w0 };
  });
}

/** Seconds until the spring first reaches its target (the "hit" frame). */
export function arrival(preset = 'snappy', prop = 'position') { return analysis(params(preset, prop)).arrival; }
/** Seconds until maximum overshoot. */
export function peak(preset = 'snappy', prop = 'position') { return analysis(params(preset, prop)).peak; }
/** Seconds until the motion stays within ±0.5 % of target. */
export function settle(preset = 'snappy', prop = 'position') { return analysis(params(preset, prop)).settle; }
export function overshoot(preset = 'snappy', prop = 'position') { return analysis(params(preset, prop)).overshoot; }

/** Arrival rounded up to a whole frame — the frame an impact sound fires on. */
export function arrivalFrames(fps, preset = 'snappy', prop = 'position') {
  return Math.ceil(arrival(preset, prop) * fps - 1e-9);
}

/** Delay so the spring *arrives* exactly `hitAt` seconds after `origin` (frame-quantized). */
export function leadIn(hitAt, fps, preset = 'slam', prop = 'position') {
  return hitAt - arrivalFrames(fps, preset, prop) / fps;
}

// ── Entrance / hold / exit envelope ──────────────────────────────────────────
// enter: { preset, from: 'rise'|'drop'|'left'|'right'|'scale'|'none', delay, distance }
// exit:  { preset, to:   'rise'|'drop'|'left'|'right'|'scale'|'none', length }
// Returns the transform deltas for an element at clip-local time lt.

// Entrance: where the element comes FROM (rise = from below). Exit: where it GOES.
const DIRS = {
  rise: [0, 1], drop: [0, -1], left: [-1, 0], right: [1, 0],
  up: [0, -1], down: [0, 1],
};
const EXIT_DIRS = {
  rise: [0, -1], drop: [0, 1], left: [-1, 0], right: [1, 0],
  up: [0, -1], down: [0, 1],
};

export function envelope(lt, duration, enter, exit, frame = { w: 1920, h: 1080 }) {
  let dx = 0, dy = 0, scale = 1, rot = 0, alpha = 1, entering = false, exiting = false;
  if (enter && enter.from && enter.from !== 'none') {
    const e = lt - (enter.delay ?? 0);
    const preset = enter.preset ?? 'snappy';
    const dist = enter.distance ?? (frame.h * 0.18);
    if (e < settle(preset)) entering = true;
    if (e <= 0) {
      alpha = 0;
    } else {
      const p = sp(e, preset, 'position');
      const dir = DIRS[enter.from];
      if (dir) { dx += dir[0] * dist * (1 - p); dy += dir[1] * dist * (1 - p); }
      if (enter.from === 'scale') scale *= lerp(0.6, 1, sp(e, preset, 'scale'));
      if (enter.from === 'fade') { alpha *= fade(e, preset); }
      if (enter.rotate) rot += enter.rotate * (1 - sp(e, preset, 'rotation'));
      alpha *= fade(e * 1.6, preset);
    }
  }
  if (exit && exit.to && exit.to !== 'none') {
    const len = exit.length ?? EXIT_LENGTH;
    const x = lt - (duration - len);
    if (x > 0) {
      exiting = true;
      const preset = exit.preset ?? 'quick';
      const p = sp(x, preset, 'position');
      const dist = exit.distance ?? (frame.h * 1.1);
      const dir = EXIT_DIRS[exit.to];
      if (dir) { dx += dir[0] * dist * p; dy += dir[1] * dist * p; }
      if (exit.to === 'scale') scale *= lerp(1, 0.001, sp(x, preset, 'scale'));
      if (exit.to === 'fade') alpha *= 1 - fade(x, preset);
    }
  }
  return { dx, dy, scale, rot, alpha, entering, exiting };
}

/** Continuous drift for ambient "never dead" motion (closed form, linear in t). */
export function drift(t, speedPxPerSec) { return t * speedPxPerSec; }

/** Deterministic hash noise in [-1, 1] for (seed, n) — no Math.random anywhere. */
export function hash1(seed, n) {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
}
