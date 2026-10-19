"""Generative music bed, locked to the project's beat grid.

Preset "brutal-bounce": four-on-the-floor kick, clap on 2 and 4, offbeat hats
with seeded ghost notes, an offbeat saw bass sidechained to the kick, and
stabbed minor chords (i–VI–III–VII). Arrangement follows the scene cuts: one
section per scene, so energy changes land on the same frames as the picture.
"""
from __future__ import annotations

import numpy as np

from . import synth
from .synth import SR

A_MINOR = [  # (bass root Hz, chord voicing Hz)
    (55.00, (220.00, 261.63, 329.63)),   # Am
    (43.65, (174.61, 220.00, 261.63)),   # F
    (65.41, (196.00, 261.63, 329.63)),   # C
    (49.00, (196.00, 246.94, 293.66)),   # G
]

PATTERNS = {
    # Which layers play, per section role. Sections rotate through these.
    "drive":     {"kick": "four", "clap": True, "hats": "offbeat", "ghosts": True, "bass": True, "stabs": True, "pad": False},
    "lift":      {"kick": "four", "clap": True, "hats": "sixteenth", "ghosts": True, "bass": True, "stabs": True, "pad": False},
    "pulse":     {"kick": "four", "clap": False, "hats": "offbeat", "ghosts": True, "bass": True, "stabs": False, "pad": False},
    "breathe":   {"kick": "half", "clap": True, "hats": "offbeat", "ghosts": False, "bass": True, "stabs": False, "pad": True},
}
ARRANGEMENT = ["drive", "lift", "pulse", "breathe", "lift", "drive"]


def _hash(*xs) -> float:
    v = np.sin(sum((i + 1) * 12.9898 * x for i, x in enumerate(xs)) + 78.233) * 43758.5453
    return float(v - np.floor(v))


def saw(freq: float, dur: float, cutoff: float, detune_cents: float = 0.0) -> np.ndarray:
    """Band-limited saw by additive synthesis up to `cutoff` (no aliasing)."""
    t = synth.t_axis(dur)
    f = freq * 2 ** (detune_cents / 1200)
    n = max(1, int(min(cutoff, SR / 2 - 200) // f))
    x = np.zeros_like(t)
    for k in range(1, n + 1):
        x += np.sin(2 * np.pi * k * f * t) / k * (1.0 if k * f < cutoff * 0.6 else 0.5)
    return x * 0.55


def place(buf: np.ndarray, sig: np.ndarray, t: float, gain: float = 1.0) -> None:
    i = int(round(t * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    s0 = max(0, -i)
    n = min(len(sig) - s0, len(buf) - max(i, 0))
    buf[max(i, 0):max(i, 0) + n] += sig[s0:s0 + n] * gain


def render_bed(duration: float, bpm: float, sections: list[float], seed: int = 7, end_hit: bool = True,
               offset: float = 0.0) -> np.ndarray:
    """Return an (n, 2) float array. `sections` are section start times (scene cuts)."""
    n = int(round(duration * SR))
    drums = np.zeros((n, 2), np.float32)
    bass = np.zeros((n, 2), np.float32)
    keys = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    step = beat / 4
    bounds = sorted(set([0.0] + [s for s in sections if 0 < s < duration])) + [duration]
    kick_times: list[float] = []
    kick_cache = synth.kick(seed=seed)

    # Final bar: stop on the last-but-one beat with an impact + sub drop, let it ring.
    stop_at = duration - 2 * beat if end_hit and duration > 4 * beat else duration + 1

    for si in range(len(bounds) - 1):
        s0, s1 = bounds[si], bounds[si + 1]
        pat = PATTERNS[ARRANGEMENT[si % len(ARRANGEMENT)]]
        nsteps = int(round((s1 - s0) / step))
        for k in range(nsteps):
            t = s0 + k * step
            if t >= stop_at - 1e-6:
                break
            gstep = int(round((t - offset) / step))      # global 16th index
            b, sub = divmod(gstep, 4)
            bar = b // 4
            beat_in_bar = b % 4
            chord = A_MINOR[bar % 4]
            # Kick
            if sub == 0 and (pat["kick"] == "four" or beat_in_bar in (0, 2)):
                place(drums, kick_cache, t, 1.0)
                kick_times.append(t)
            # Clap on 2 and 4
            if pat["clap"] and sub == 0 and beat_in_bar in (1, 3):
                place(drums, synth.clap(seed=seed + gstep), t, 0.55)
                place(drums, synth.snare(seed=seed + gstep), t, 0.25)
            # Hats
            if sub == 2:
                place(drums, synth.hat(seed=seed + gstep, open_=(beat_in_bar == 3 and bar % 2 == 1)), t, 0.42)
            elif pat["hats"] == "sixteenth" and sub in (1, 3):
                place(drums, synth.hat(seed=seed + gstep), t, 0.16 + 0.08 * _hash(seed, gstep))
            elif pat["ghosts"] and sub == 3 and _hash(seed, gstep, 3) > 0.55:
                place(drums, synth.hat(seed=seed + gstep), t, 0.12)
            # Bass: offbeat 8ths on the chord root, octave jump on the last offbeat
            if pat["bass"] and sub == 2:
                f = chord[0] * (2 if beat_in_bar == 3 and _hash(seed, bar) > 0.4 else 1)
                note = saw(f, step * 1.7, cutoff=900) * synth.env_exp(synth.t_axis(step * 1.7), 9, 0.004)
                place(bass, synth.stereo(note * 0.75), t)
            # Chord stabs on the "and" of 2 and the "e" of 4 (syncopated)
            if pat["stabs"] and ((beat_in_bar == 1 and sub == 2) or (beat_in_bar == 3 and sub == 1)):
                dur = 0.22
                tt = synth.t_axis(dur)
                env = synth.env_exp(tt, 13, 0.003)
                for j, fr in enumerate(chord[1]):
                    l = saw(fr, dur, 2600, -7) * env
                    r = saw(fr, dur, 2600, 7) * env
                    place(keys, np.stack([l, r * 0.9], 1).astype(np.float32), t, 0.16)
            # Pad on each bar start (breathe sections)
            if pat["pad"] and sub == 0 and beat_in_bar == 0:
                dur = min(4 * beat, s1 - t)
                tt = synth.t_axis(dur)
                env = np.clip(tt / 0.35, 0, 1) * np.clip((dur - tt) / 0.25, 0, 1)
                for fr in chord[1]:
                    l = saw(fr / 2, dur, 1400, -9) * env
                    r = saw(fr / 2, dur, 1400, 9) * env
                    place(keys, np.stack([l, r], 1).astype(np.float32), t, 0.07)

    if end_hit and stop_at < duration:
        place(drums, synth.impact(seed=seed + 99, size=1.1), stop_at, 0.9)
        place(drums, synth.subdrop(seed=seed + 98, dur=min(2.0, duration - stop_at)), stop_at, 0.8)
        kick_times.append(stop_at)

    # Sidechain: bass and keys duck under every kick (closed-form envelope per kick).
    duck = np.ones(n, np.float32)
    for kt in kick_times:
        i = int(round(kt * SR))
        m = min(n - i, int(0.32 * SR))
        if m <= 0:
            continue
        tt = np.arange(m) / SR
        duck[i:i + m] = np.minimum(duck[i:i + m], (1 - 0.72 * np.exp(-tt * 13)).astype(np.float32))
    bass *= duck[:, None]
    keys *= duck[:, None]
    mix = drums * 0.9 + bass * 0.85 + keys * 0.9
    # 30 ms fade at the very end so the file never ends on a click.
    f = int(0.03 * SR)
    mix[-f:] *= np.linspace(1, 0, f, dtype=np.float32)[:, None]
    return mix.astype(np.float32)
