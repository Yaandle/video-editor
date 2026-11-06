"""Halftone sound: a print-press thunk (platen closing), a dry clack (type
furniture), a paper slide, a paper-feed riser, and a 'press' bed — a
letterpress running at tempo: thunk on 1 and 3, clack on 2 and 4, a shaker
of paper on the 16ths and a low bowed drone that moves with the bars."""
from __future__ import annotations

import numpy as np

from studio.audio import music, synth
from studio.audio.synth import SR, env_exp, fft_filter, rng, saturate, stereo, sweep_phase, t_axis


def thunk(seed=0):
    t = t_axis(0.42)
    body = np.sin(sweep_phase(70 + 60 * np.exp(-t * 30))) * env_exp(t, 11, 0.002)
    wood = fft_filter(rng(seed).standard_normal(len(t)), lo=250, hi=2400) * env_exp(t, 45, 0.0006) * 0.5
    metal = np.sin(2 * np.pi * 612 * t) * env_exp(t, 30, 0.001) * 0.08
    return stereo(saturate(body + wood + metal, 2.0) * 0.8)


def clack(seed=0, pitch=None):
    t = t_axis(0.09)
    f = 1350 * (1 + 0.05 * ((pitch or 0) % 4))
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=900, hi=6000) * env_exp(t, 120, 0.0002)
    x += np.sin(2 * np.pi * f * t) * env_exp(t, 90, 0.0004) * 0.35
    return stereo(saturate(x, 1.5) * 0.6, width=0.4)


def slide(seed=0):
    """Paper sliding over paper: brown-ish noise with a soft hump."""
    t = t_axis(0.36)
    u = t / 0.36
    n = np.cumsum(rng(seed).standard_normal(len(t)))
    n = fft_filter(n - np.convolve(n, np.ones(400) / 400, mode="same"), lo=300, hi=5000)
    x = n / (np.abs(n).max() + 1e-9) * np.sin(np.pi * u) ** 1.4
    return stereo(x * 0.45, width=0.8)


slide.lead = 0.1


def feed(seed=0, length=0.5):
    """Paper feed into a cut: a ratcheting rise ending on the cut."""
    t = t_axis(length)
    u = t / length
    tick_rate = 12 + 30 * u
    clicks = (np.sin(2 * np.pi * np.cumsum(tick_rate) / SR) > 0.96).astype(float)
    x = fft_filter(clicks * rng(seed).standard_normal(len(t)), lo=1500, hi=8000) * 0.6
    x += synth.tv_bandpass(rng(seed + 1).standard_normal(len(t)), 300 + 3000 * u ** 2, q=1.5) * 0.4
    return stereo(x * u ** 1.8 * 0.7, width=0.6)


def press(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    drums = np.zeros((n, 2), np.float32)
    drone = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    hits = []
    roots = [49.0, 49.0, 43.65, 55.0]
    for t, g, bar, bib, s in music.steps(duration, bpm, offset, stop):
        if s == 0 and bib in (0, 2):
            music.place(drums, thunk(seed + g), t, 0.95)
            hits.append(t)
        if s == 0 and bib in (1, 3):
            music.place(drums, clack(seed + g), t, 0.6)
        if s in (1, 2, 3):
            sh = fft_filter(rng(seed + g).standard_normal(int(0.05 * SR)), lo=4000, hi=12000) * env_exp(t_axis(0.05), 60, 0.003)
            music.place(drums, stereo(sh * 0.3, width=0.6), t, 0.18 + 0.1 * (s == 2))
        if s == 0 and bib == 0:
            dur = min(4 * beat, duration - t)
            tt = t_axis(dur)
            f = roots[bar % 4]
            x = sum(np.sin(2 * np.pi * f * h * tt + h) / h for h in (1, 2, 3, 5))
            env = np.clip(tt / 0.4, 0, 1) * np.clip((dur - tt) / 0.3, 0, 1)
            music.place(drone, stereo(saturate(x * 0.5, 1.2) * env * 0.5, width=0.3), t)
    if stop is not None:
        music.place(drums, thunk(seed + 99), stop, 1.2)
        music.place(drums, synth.subdrop(seed + 98, dur=min(1.6, duration - stop)), stop, 0.7)
        hits.append(stop)
    mix = drums + music.sidechain(drone, hits, 0.55) * 0.7
    return music.tail_fade(mix)


VOICES = {"thunk": thunk, "clack": clack, "slide": slide, "feed": feed}
BEDS = {"press": press}
