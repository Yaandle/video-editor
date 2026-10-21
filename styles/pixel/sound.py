"""Pixel-art sound: a chiptune voice set built from the three classic channel
types, synthesized sample-exact in numpy — pulse (square with duty), triangle,
and noise from a 15-bit linear-feedback shift register (deterministic, like
the hardware). Voices: jump, coin, hit, blip, power-up riser. Bed: 'chiptune'
— a 25 % pulse lead, triangle bass and LFSR drums."""
from __future__ import annotations

import numpy as np

from studio.audio import music
from studio.audio.synth import SR, stereo, t_axis

_LFSR_CACHE: dict = {}


def lfsr(n: int, short: bool = False, seed: int = 1) -> np.ndarray:
    """±1 noise from a 15-bit LFSR (tap 1, or tap 6 for the metallic short mode)."""
    key = (n, short, seed)
    if key not in _LFSR_CACHE:
        reg = (seed * 2654435761 & 0x7FFF) or 1
        out = np.empty(n)
        tap = 6 if short else 1
        for i in range(n):
            bit = (reg ^ (reg >> tap)) & 1
            reg = (reg >> 1) | (bit << 14)
            out[i] = 1.0 if reg & 1 else -1.0
        _LFSR_CACHE[key] = out
    return _LFSR_CACHE[key]


def noise(dur: float, rate: float, short=False, seed=1) -> np.ndarray:
    """LFSR clocked at `rate` Hz, held between clocks (that held step is the chip timbre)."""
    n = int(round(dur * SR))
    steps = max(1, int(dur * rate) + 1)
    seq = lfsr(steps, short, seed)
    idx = np.minimum((np.arange(n) * rate / SR).astype(int), steps - 1)
    return seq[idx]


def pulse(freq, t, duty=0.5):
    ph = np.cumsum(np.broadcast_to(freq, t.shape)) / SR if np.ndim(freq) else freq * t
    return np.where(ph % 1.0 < duty, 0.5, -0.5)


def tri(freq, t):
    ph = np.cumsum(np.broadcast_to(freq, t.shape)) / SR if np.ndim(freq) else freq * t
    x = 2 * np.abs(2 * (ph % 1.0) - 1) - 1
    return np.round(x * 7.5) / 7.5          # 4-bit stepped triangle


def steps_env(t, decay, levels=15):
    """Volume envelope quantised to 16 steps (chip volume registers)."""
    return np.floor(np.exp(-t * decay) * levels) / levels


def jump(seed=0):
    t = t_axis(0.16)
    f = 260 * 2 ** (t / 0.16 * 1.6)
    return stereo(pulse(f, t, 0.5) * steps_env(t, 9) * 0.6)


jump.lead = 0.02


def coin(seed=0, pitch=None):
    t = t_axis(0.3)
    f = np.where(t < 0.06, 987.8, 1318.5)
    return stereo(pulse(f, t, 0.5) * steps_env(np.where(t < 0.06, 0.0, t - 0.06), 9) * 0.5)


def hit(seed=0):
    t = t_axis(0.35)
    n = noise(0.35, 7000 - 6000 * np.clip(t[-1], 0, 1), seed=seed + 1) * steps_env(t, 14) * 0.6
    body = tri(110 * 2 ** (-t * 6), t) * steps_env(t, 10) * 0.7
    return stereo(n + body)


def blip(seed=0, pitch=None):
    t = t_axis(0.05)
    f = 1760 * 2 ** (((pitch or 0) % 5) / 12)
    return stereo(pulse(f, t, 0.25) * steps_env(t, 30) * 0.4)


def powerup(seed=0, length=0.5):
    t = t_axis(length)
    notes = [57, 60, 64, 69, 72, 76, 81]
    k = np.minimum((t / length * len(notes)).astype(int), len(notes) - 1)
    f = 440 * 2 ** ((np.array(notes)[k] - 69 + 12) / 12)
    return stereo(pulse(f, t, 0.125) * (0.25 + 0.75 * t / length) * 0.35)


def chiptune(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    lead = np.zeros((n, 2), np.float32)
    bass = np.zeros((n, 2), np.float32)
    drums = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    step = beat / 4
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    roots = [57, 53, 60, 55]                       # A, F, C, G
    # A 2-bar lead phrase in A minor pentatonic (16th steps; None = rest).
    phrase = [69, None, 72, None, 76, None, 74, 72, None, 69, None, 67, 69, None, None, None,
              72, None, 76, None, 79, None, 76, 74, None, 72, None, 74, 72, None, 69, None]
    for t, g, bar, bib, s in music.steps(duration, bpm, offset, stop):
        root = roots[bar % 4]
        note = phrase[g % len(phrase)]
        if note is not None:
            tt = t_axis(step * 0.95)
            music.place(lead, stereo(pulse(440 * 2 ** ((note - 69) / 12), tt, 0.25) * steps_env(tt, 6) * 0.22), t)
        if s in (0, 2):
            tt = t_axis(step * 1.8)
            f = 440 * 2 ** ((root - 69 - 12 + (12 if s == 2 else 0)) / 12)
            music.place(bass, stereo(tri(f, tt) * 0.45), t)
        if s == 0 and bib in (0, 2):
            tt = t_axis(0.12)
            music.place(drums, stereo(tri(140 * 2 ** (-tt * 18), tt) * steps_env(tt, 18) * 0.9), t)
        if s == 0 and bib in (1, 3):
            music.place(drums, stereo(noise(0.14, 9000, seed=seed + g) * steps_env(t_axis(0.14), 22) * 0.5), t)
        if s == 2:
            music.place(drums, stereo(noise(0.04, 15000, short=True, seed=seed + g) * steps_env(t_axis(0.04), 60) * 0.25), t)
    if stop is not None:
        music.place(drums, hit(seed), stop, 1.0)
        music.place(lead, powerup(seed, length=min(1.0, duration - stop)), stop, 0.6)
    return music.tail_fade(lead + bass + drums)


VOICES = {"jump": jump, "coin": coin, "hit": hit, "blip": blip, "powerup": powerup}
BEDS = {"chiptune": chiptune}
