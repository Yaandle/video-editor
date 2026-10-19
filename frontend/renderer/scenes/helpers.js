// helpers.js — beat scheduling + exits shared by scene modules.

import { arrivalFrames, sp, settle, peak } from '../motion.js';

/** Beat clock for a scene clip: times are project seconds. */
export function clock(clip, env) {
  const beat = env.beat?.valid ? env.beat.beat : 0.5;
  const fps = env.settings?.fps ?? env.fps ?? 30;
  const B = (n) => clip.start + n * beat;
  /** Element whose `preset` spring lands exactly on beat n. */
  const land = (n, preset = 'slam', prop = 'position') => {
    const hit = B(n);
    const start = hit - arrivalFrames(fps, preset, prop) / fps;
    return { hit, start, settle: start + settle(preset, prop), peak: start + peak(preset, prop), preset };
  };
  return { beat, fps, B, land, end: clip.start + clip.duration };
}

/** 0 → 1 exit progress over the last `len` seconds (quick, critically damped). */
export function exitP(env, clip, len = 0.32, delay = 0) {
  const x = env.t - (clip.start + clip.duration - len) - delay;
  return x > 0 ? Math.min(1, Math.max(0, sp(x, 'quick', 'position'))) : 0;
}

/** Motion + hit events for a list of landings (for collectEvents). */
export function landingEvents(list) {
  const out = [];
  for (const l of list) {
    if (!l) continue;
    out.push({ kind: 'motion', role: l.role ?? 'element', start: l.start, peak: l.peak, settle: l.settle, preset: l.preset });
    if (l.sound !== null) out.push({ kind: 'hit', t: l.hit, sound: l.sound ?? 'impact', gain_db: l.gain_db ?? -6 });
  }
  return out;
}
