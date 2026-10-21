"""Kinetic typography sound: a tight click per word, a low thud for emphasis,
a short air swish, a riser into line changes, and a sparse 'pulse' bed so the
words carry the rhythm. Everything synthesized in numpy (studio.audio.synth)."""
from __future__ import annotations

import numpy as np

from studio.audio import music, synth
from studio.audio.synth import SR, env_exp, fft_filter, rng, saturate, stereo, sweep_phase, t_axis


def click(seed=0, pitch=None):
    """Tight, dry click: a 2 ms noise tick on a pitched transient."""
    t = t_axis(0.045)
    f = 1900 * (1 + 0.04 * ((pitch or 0) % 5))
    x = np.sin(2 * np.pi * f * t) * env_exp(t, 180, 0.0002) * 0.6
    x += fft_filter(rng(seed).standard_normal(len(t)), lo=2500, hi=11000) * env_exp(t, 520, 0.0001) * 0.5
    return stereo(saturate(x, 1.6) * 0.7)


def thud(seed=0):
    """Low, short body hit for emphasised words."""
    t = t_axis(0.32)
    body = np.sin(sweep_phase(58 + 90 * np.exp(-t * 40))) * env_exp(t, 14, 0.001)
    knock = fft_filter(rng(seed).standard_normal(len(t)), lo=180, hi=1800) * env_exp(t, 60, 0.0005) * 0.35
    return stereo(saturate(body + knock, 2.2) * 0.85)


def swish(seed=0):
    t = t_axis(0.22)
    u = t / 0.22
    x = synth.tv_bandpass(rng(seed).standard_normal(len(t)), 900 + 5000 * u, q=2.0) * np.sin(np.pi * u) ** 2
    return stereo(x * 0.5, width=0.7)


def riser(seed=0, length=0.5):
    t = t_axis(length)
    u = t / length
    noise = synth.tv_bandpass(rng(seed).standard_normal(len(t)), 400 + 6500 * u ** 2.2, q=1.8)
    env = u ** 2.4 * (1 - np.clip((u - 0.985) / 0.015, 0, 1))
    return stereo(noise * env * 0.7, width=0.8)


swish.lead = 0.08


def pulse(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    """Sparse bed: kick on 1 and the 'and' of 3, rim on 2 and 4, a sub pulse on the beat, ghost hats."""
    n = int(round(duration * SR))
    drums = np.zeros((n, 2), np.float32)
    sub = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    kick = synth.kick(seed=seed, pitch=0.9, punch=1.2)
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    kicks = []
    for t, g, bar, bib, s in music.steps(duration, bpm, offset, stop):
        if (bib == 0 and s == 0) or (bib == 2 and s == 2):
            music.place(drums, kick, t, 0.95)
            kicks.append(t)
        if s == 0 and bib in (1, 3):
            music.place(drums, click(seed + g), t, 0.45)
            music.place(drums, synth.clap(seed + g), t, 0.18)
        if s in (1, 3) and music._hash(seed, g) > 0.45:
            music.place(drums, synth.hat(seed + g), t, 0.12)
        if s == 0:
            tt = t_axis(beat * 0.9)
            note = np.sin(2 * np.pi * (41.2 if bar % 2 else 49.0) * tt) * env_exp(tt, 3.5, 0.01)
            music.place(sub, stereo(saturate(note, 1.5) * 0.6), t)
    if stop is not None:
        music.place(drums, thud(seed + 5), stop, 1.1)
        music.place(drums, synth.subdrop(seed + 6, dur=min(1.5, duration - stop)), stop, 0.8)
        kicks.append(stop)
    mix = drums + music.sidechain(sub, kicks, 0.6) * 0.8
    return music.tail_fade(mix)


VOICES = {"click": click, "thud": thud, "swish": swish, "riser": riser}
BEDS = {"pulse": pulse}
