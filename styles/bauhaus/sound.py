"""Bauhaus sound: clean, wooden and pitched. A marimba voice by modal
synthesis (fundamental + the bar's 4th and 10th partials, fast-decaying
mallet click), pitched by shape (circle low → quarter high); a wood block; a
soft air whoosh; a marimba roll riser; and the 'marimba' bed — an ostinato in
C major pentatonic over a low marimba bass with claves on the off-beats."""
from __future__ import annotations

import numpy as np

from studio.audio import music
from studio.audio.synth import SR, env_exp, fft_filter, rng, stereo, t_axis

SCALE = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]   # C pentatonic, MIDI


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def bar(f, dur=0.9, bright=1.0, seed=0):
    """Tuned marimba bar: partials at 1×, 3.9× and 9.2× with shorter decays, plus a mallet tick."""
    t = t_axis(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.0)
    x += 0.35 * bright * np.sin(2 * np.pi * f * 3.9 * t) * np.exp(-t * 14)
    x += 0.12 * bright * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 32)
    tick = fft_filter(rng(seed).standard_normal(len(t)), lo=1500, hi=6000) * env_exp(t, 400, 0.0002) * 0.15
    a = np.clip(t / 0.002, 0, 1)
    return (x + tick) * a * 0.6


def marimba(seed=0, pitch=None):
    note = SCALE[2 + int(pitch or 0) * 2 % (len(SCALE) - 2)]
    return stereo(bar(hz(note), seed=seed), pan=-0.2 + 0.1 * (int(pitch or 0) % 5), width=0.2)


def block(seed=0, pitch=None):
    t = t_axis(0.12)
    f = 1150 * (1 + 0.08 * ((pitch or 0) % 3))
    x = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.7 * t)) * env_exp(t, 55, 0.0003)
    return stereo(x * 0.5, width=0.1)


def air(seed=0):
    t = t_axis(0.3)
    u = t / 0.3
    x = fft_filter(rng(seed).standard_normal(len(t)), lo=500, hi=3500) * np.sin(np.pi * u) ** 2 * 0.25
    return stereo(x, width=0.7)


air.lead = 0.1


def roll(seed=0, length=0.5):
    """Marimba roll rising into the cut: alternating mallets, getting faster and louder."""
    out = np.zeros(int(round(length * SR)))
    t, k = 0.0, 0
    while t < length:
        u = t / length
        b = bar(hz(SCALE[5 + (k % 4)]), dur=0.25, bright=0.6, seed=seed + k)
        i = int(t * SR)
        n = min(len(b), len(out) - i)
        out[i:i + n] += b[:n] * (0.25 + 0.75 * u)
        t += 0.09 - 0.05 * u
        k += 1
    return stereo(out * 0.8, width=0.3)


def marimba_bed(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    mel = np.zeros((n, 2), np.float32)
    low = np.zeros((n, 2), np.float32)
    perc = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    roots = [48, 45, 41, 43]                      # C, A, F, G
    ostinato = [7, 9, 11, 9, 7, 9, 12, 9]          # scale indices, 8th notes
    for t, g, b, bib, s in music.steps(duration, bpm, offset, stop):
        if s % 2 == 0:
            idx = ostinato[(g // 2) % len(ostinato)]
            music.place(mel, stereo(bar(hz(SCALE[idx]), dur=0.5, seed=seed + g), pan=0.25, width=0.2), t, 0.32)
        if s == 0 and bib in (0, 2):
            music.place(low, stereo(bar(hz(roots[b % 4]), dur=1.0, bright=0.4, seed=seed + g)), t, 0.55)
        if s == 2:
            music.place(perc, block(seed + g, pitch=bib), t, 0.18)
        if s == 0 and bib in (1, 3):
            tt = t_axis(0.06)
            clave = np.sin(2 * np.pi * 2500 * tt) * env_exp(tt, 70, 0.0002)
            music.place(perc, stereo(clave * 0.35, pan=-0.3), t)
    if stop is not None:
        music.place(mel, stereo(bar(hz(36), dur=2.0, bright=0.5, seed=seed) + bar(hz(48), dur=2.0, seed=seed + 1)), stop, 0.8)
    return music.tail_fade(mel + low + perc)


VOICES = {"marimba": marimba, "block": block, "air": air, "roll": roll}
BEDS = {"marimba": marimba_bed}
