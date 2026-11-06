"""Sketch sound: quiet desk sounds. A pencil scratch (band-passed noise with a
grainy amplitude), a pencil tick, a ruler stroke, a felt-tip highlighter
squeak, and the 'lofi' bed: soft electric-piano chords (sine partials with a
slow decay) over a brushed off-beat and a low sine bass."""
from __future__ import annotations

import numpy as np

from studio.audio import music
from studio.audio.synth import SR, env_exp, fft_filter, rng, stereo, t_axis


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def scratch(seed=0, pitch=None, length=0.35):
    t = t_axis(length)
    r = rng(seed)
    grain = np.repeat(r.uniform(0.3, 1.0, len(t) // 220 + 1), 220)[: len(t)]
    x = fft_filter(r.standard_normal(len(t)), lo=2200 + 300 * int(pitch or 0) % 900, hi=7500) * grain
    shape = np.clip(t / 0.02, 0, 1) * np.clip((length - t) / 0.08, 0, 1)
    return stereo(x * shape * 0.22, pan=-0.15, width=0.3)


def tick(seed=0, pitch=None):
    t = t_axis(0.06)
    f = 2400 * (1 + 0.06 * (int(pitch or 0) % 5))
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=f * 0.7, hi=f * 1.6) * env_exp(t, 90, 0.0003)
    return stereo(x * 0.35, width=0.1)


def rule(seed=0, length=0.5):
    t = t_axis(length)
    u = t / length
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=900, hi=4200) * np.sin(np.pi * u) ** 1.5
    return stereo(x * 0.2, width=0.5)


rule.lead = 0.2


def marker(seed=0):
    t = t_axis(0.35)
    f = 1700 + 300 * np.sin(2 * np.pi * 3 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.08 + fft_filter(rng(seed).standard_normal(len(t)), lo=1500, hi=5000) * 0.12
    return stereo(x * np.sin(np.pi * t / 0.35) ** 2, width=0.2)


def epiano(f, dur=1.6):
    t = t_axis(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2) + 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 5)
    return x * np.clip(t / 0.006, 0, 1) * 0.3


def lofi_bed(duration, bpm, sections, seed=5, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    keys = np.zeros((n, 2), np.float32)
    low = np.zeros((n, 2), np.float32)
    perc = np.zeros((n, 2), np.float32)
    stop = duration - 2 * (60.0 / bpm) if end_hit and duration > 8 * 60.0 / bpm else None
    chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]   # Am7 Fmaj7 Cmaj7 G7
    for t, g, b, bib, s in music.steps(duration, bpm, offset, stop):
        ch = chords[(b // 2) % 4]
        if s == 0 and bib == 0:
            for k, m in enumerate(ch):
                music.place(keys, stereo(epiano(hz(m)), pan=-0.3 + 0.2 * k, width=0.3), t + 0.012 * k, 0.5)
            music.place(low, stereo(epiano(hz(ch[0] - 24), dur=1.8) * 1.6), t, 0.6)
        if s == 0 and bib in (1, 3):
            tt = t_axis(0.18)
            brush = fft_filter(rng(seed + g).standard_normal(len(tt)), lo=3000, hi=9000) * env_exp(tt, 18, 0.002)
            music.place(perc, stereo(brush * 0.12, width=0.6), t)
    if stop is not None:
        for k, m in enumerate(chords[2]):
            music.place(keys, stereo(epiano(hz(m), dur=2.5), pan=-0.3 + 0.2 * k, width=0.3), stop + 0.015 * k, 0.6)
    return music.tail_fade(keys + low + perc)


def swipe(seed=0, length=0.6):
    """A sheet of paper sliding over another: low, soft noise that swells and settles."""
    t = t_axis(length)
    u = t / length
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=250, hi=2600) * np.sin(np.pi * u) ** 2 * (1 - 0.5 * u)
    return stereo(x * 0.32, pan=0.2, width=0.6)


swipe.lead = 0.15


VOICES = {"scratch": scratch, "tick": tick, "rule": rule, "marker": marker, "swipe": swipe}
BEDS = {"lofi": lofi_bed}
