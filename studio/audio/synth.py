"""Synthesized voices — every sound in a render is generated here, in numpy.

All voices return float32 arrays shaped (n, 2) at SR. Randomness is seeded so a
given (voice, seed) always produces identical samples; renders are repeatable.
Filtering is done in the frequency domain (static) or by overlap-add blocks
(time-varying), so the only dependency is numpy.
"""
from __future__ import annotations

import numpy as np

SR = 48000


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(round(dur * SR)), dtype=np.float64) / SR


def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed & 0xFFFFFFFF)


def stereo(x: np.ndarray, pan: float = 0.0, width: float = 0.0, seed: int = 0) -> np.ndarray:
    """Equal-power pan; `width` decorrelates by a few samples for air."""
    a = (pan + 1) * np.pi / 4
    left, right = x * np.cos(a), x * np.sin(a)
    if width > 0:
        d = int(width * 0.0006 * SR)
        right = np.concatenate([np.zeros(d), right[:-d]]) if d else right
    return np.stack([left, right], axis=1).astype(np.float32) * np.float32(np.sqrt(2))


def fft_filter(x: np.ndarray, lo: float | None = None, hi: float | None = None, slope: float = 0.15) -> np.ndarray:
    """Static band filter with soft (cosine) skirts, zero phase."""
    n = len(x)
    if n == 0:
        return x
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        w = lo * slope * 4
        g *= np.clip((f - (lo - w)) / (2 * w), 0, 1) ** 2
    if hi:
        w = hi * slope
        g *= np.clip(((hi + w) - f) / (2 * w), 0, 1) ** 2
    return np.fft.irfft(X * g, n)


def tv_bandpass(x: np.ndarray, centre: np.ndarray, q: float = 1.2, block: int = 1024) -> np.ndarray:
    """Time-varying band-pass via overlap-add: `centre` gives Hz per sample."""
    n = len(x)
    hop = block // 2
    win = np.hanning(block)
    out = np.zeros(n + block)
    xp = np.concatenate([x, np.zeros(block)])
    f = np.fft.rfftfreq(block, 1 / SR)
    for start in range(0, n, hop):
        seg = xp[start:start + block] * win
        c = float(centre[min(n - 1, start + hop)])
        bw = c / q
        g = np.exp(-0.5 * ((f - c) / (bw / 2.355)) ** 2)
        out[start:start + block] += np.fft.irfft(np.fft.rfft(seg) * g, block) * win
    return out[:n] / 0.75


def env_exp(t: np.ndarray, decay: float, attack: float = 0.002) -> np.ndarray:
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    return a * np.exp(-t * decay)


def sweep_phase(freq: np.ndarray) -> np.ndarray:
    return 2 * np.pi * np.cumsum(freq) / SR


def saturate(x: np.ndarray, drive: float = 1.5) -> np.ndarray:
    return np.tanh(x * drive) / np.tanh(drive)


# ── Drums ──────────────────────────────────────────────────────────────────────

def kick(seed=0, pitch=1.0, punch=1.0) -> np.ndarray:
    t = t_axis(0.5)
    f = (46 + 120 * np.exp(-t * 32)) * pitch
    body = np.sin(sweep_phase(f)) * env_exp(t, 7.0, 0.0015)
    click = fft_filter(rng(seed).standard_normal(len(t)), lo=1500, hi=9000) * env_exp(t, 400, 0.0003) * 0.35 * punch
    return stereo(saturate(body * 0.95 + click, 1.8) * 0.9)


def snare(seed=0) -> np.ndarray:
    t = t_axis(0.32)
    tone = (np.sin(2 * np.pi * 186 * t) * 0.6 + np.sin(2 * np.pi * 332 * t) * 0.3) * env_exp(t, 22)
    noise = fft_filter(rng(seed).standard_normal(len(t)), lo=1200, hi=9500) * env_exp(t, 15) * 0.55
    return stereo(saturate(tone + noise, 1.3) * 0.7, width=0.6)


def clap(seed=0) -> np.ndarray:
    t = t_axis(0.38)
    n = fft_filter(rng(seed).standard_normal(len(t)), lo=1100, hi=6200)
    env = np.zeros_like(t)
    for off in (0.0, 0.011, 0.022):
        tt = np.clip(t - off, 0, None)
        env += np.where(t >= off, np.exp(-tt * 140), 0)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) * 11), 0) * 0.55
    return stereo(n * env * 0.5, width=0.9)


def hat(seed=0, open_=False) -> np.ndarray:
    t = t_axis(0.42 if open_ else 0.07)
    n = fft_filter(rng(seed).standard_normal(len(t)), lo=7200, hi=16000)
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (5203, 6127, 7412)) * 0.06
    return stereo((n * 0.5 + fft_filter(metal, lo=6000)) * env_exp(t, 9 if open_ else 70, 0.0005) * 0.45, width=0.5)


# ── UI / motion sounds ─────────────────────────────────────────────────────────

def tick(seed=0, pitch=1.0) -> np.ndarray:
    t = t_axis(0.06)
    x = (np.sin(2 * np.pi * 2350 * pitch * t) + 0.5 * np.sin(2 * np.pi * 4700 * pitch * t)) * env_exp(t, 95, 0.0004)
    x += fft_filter(rng(seed).standard_normal(len(t)), lo=3000) * env_exp(t, 600, 0.0002) * 0.3
    return stereo(x * 0.45)


def click(seed=0) -> np.ndarray:
    t = t_axis(0.05)
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=1800, hi=7000) * env_exp(t, 260, 0.0002)
    x += np.sin(2 * np.pi * 1180 * t) * env_exp(t, 120, 0.0005) * 0.5
    return stereo(saturate(x, 1.4) * 0.6)


def pop(seed=0, pitch=1.0) -> np.ndarray:
    t = t_axis(0.16)
    f = (170 + 720 * np.exp(-t * 34)) * pitch
    x = np.sin(sweep_phase(f)) * env_exp(t, 26, 0.0008)
    return stereo(saturate(x, 1.2) * 0.7)


def whoosh(seed=0, dur=0.42, pan_from=-0.6, pan_to=0.6) -> np.ndarray:
    t = t_axis(dur)
    n = rng(seed).standard_normal(len(t))
    u = t / dur
    centre = 380 + 4200 * np.sin(np.pi * np.clip(u * 0.9, 0, 1)) ** 2
    x = tv_bandpass(n, centre, q=1.6)
    env = np.sin(np.pi * u) ** 1.6
    x = x * env
    pan = pan_from + (pan_to - pan_from) * u
    a = (pan + 1) * np.pi / 4
    return (np.stack([x * np.cos(a), x * np.sin(a)], 1) * 0.55 * np.sqrt(2)).astype(np.float32)


def riser(seed=0, dur=0.5) -> np.ndarray:
    t = t_axis(dur)
    u = t / dur
    n = rng(seed).standard_normal(len(t))
    noise = tv_bandpass(n, 500 + 7000 * u ** 2, q=1.4)
    tone = np.sin(sweep_phase(220 + 660 * u ** 1.6)) * 0.25
    env = u ** 2.2 * (1 - np.clip((u - 0.97) / 0.03, 0, 1))
    return stereo((noise * 0.5 + tone) * env * 0.6, width=0.8)


def impact(seed=0, size=1.0) -> np.ndarray:
    t = t_axis(1.3)
    boom = np.sin(sweep_phase(42 + 70 * np.exp(-t * 18))) * env_exp(t, 3.4, 0.001)
    thump = np.sin(2 * np.pi * 118 * t) * env_exp(t, 16, 0.001) * 0.5
    crack = fft_filter(rng(seed).standard_normal(len(t)), lo=600, hi=7000) * env_exp(t, 30, 0.0004) * 0.35
    tail = fft_filter(rng(seed + 1).standard_normal(len(t)), lo=200, hi=2500) * env_exp(t, 5, 0.01) * 0.06
    return stereo(saturate((boom + thump + crack + tail) * size, 2.0) * 0.82, width=0.4)


def subdrop(seed=0, dur=1.4) -> np.ndarray:
    t = t_axis(dur)
    x = np.sin(sweep_phase(30 + 64 * np.exp(-t * 2.4))) * env_exp(t, 1.9, 0.004)
    return stereo(saturate(x, 1.3) * 0.9)


VOICES = {
    "kick": kick, "snare": snare, "clap": clap, "hat": hat, "tick": tick, "click": click, "pop": pop,
    "whoosh": whoosh, "riser": riser, "impact": impact, "subdrop": subdrop,
}


def voice(name: str, seed: int = 0, **kw) -> np.ndarray:
    fn = VOICES.get(name)
    if fn is None:
        raise KeyError(f"unknown sound '{name}' (known: {', '.join(sorted(VOICES))})")
    return fn(seed=seed, **kw)
