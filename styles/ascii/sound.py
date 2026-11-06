"""ASCII sound: a typewriter key, a carriage return (ratchet + bell), a short
FM data chirp, a rising data stream into cuts, and a 'terminal' bed — keys for
hats, a soft kick, a modem-like chirp arpeggio and a low square bass."""
from __future__ import annotations

import numpy as np

from studio.audio import music, synth
from studio.audio.synth import SR, env_exp, fft_filter, rng, saturate, stereo, t_axis


def key(seed=0, pitch=None):
    t = t_axis(0.07)
    strike = fft_filter(rng(seed).standard_normal(len(t)), lo=2000, hi=9000) * env_exp(t, 160, 0.0002)
    thock = np.sin(2 * np.pi * (520 + 40 * ((pitch or seed) % 5)) * t) * env_exp(t, 70, 0.0005) * 0.5
    return stereo(saturate(strike * 0.7 + thock, 1.4) * 0.55, width=0.3)


def carriage(seed=0):
    t = t_axis(0.9)
    ratchet = sum(np.where((t >= k * 0.018) & (t < k * 0.018 + 0.004), 1.0, 0.0) for k in range(10))
    rat = fft_filter(ratchet * rng(seed).standard_normal(len(t)), lo=1500, hi=7000) * 0.5
    bell_t = np.clip(t - 0.2, 0, None)
    bell = (np.sin(2 * np.pi * 2093 * bell_t) + 0.4 * np.sin(2 * np.pi * 5230 * bell_t)) * np.where(t >= 0.2, np.exp(-bell_t * 5), 0) * 0.35
    thud = np.sin(2 * np.pi * 90 * t) * env_exp(t, 18, 0.001) * 0.6
    return stereo(saturate(rat + bell + thud, 1.3) * 0.7, width=0.4)


def chirp(seed=0):
    t = t_axis(0.12)
    f = 1200 + 1800 * np.sin(2 * np.pi * 26 * t) * (t / 0.12)
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * env_exp(t, 22, 0.001) * 0.25
    return stereo(fft_filter(x, hi=7000), width=0.5)


chirp.lead = 0.03


def stream(seed=0, length=0.5):
    t = t_axis(length)
    u = t / length
    rate = 14 + 70 * u ** 2
    gate = (np.sin(2 * np.pi * np.cumsum(rate) / SR) > 0.2).astype(float)
    f = 900 + 2600 * u + 400 * np.sign(np.sin(2 * np.pi * np.cumsum(rate * 0.5) / SR))
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * gate * u ** 1.5 * 0.22
    return stereo(fft_filter(x, hi=8000), width=0.6)


def terminal(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    drums = np.zeros((n, 2), np.float32)
    tones = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    kick = synth.kick(seed=seed, pitch=1.1, punch=0.6)
    bass = [45, 45, 41, 43]          # MIDI roots per bar
    arp = [0, 12, 7, 12, 3, 12, 7, 15]
    kicks = []
    for t, g, bar, bib, s in music.steps(duration, bpm, offset, stop):
        if s == 0 and bib in (0, 2):
            music.place(drums, kick, t, 0.8)
            kicks.append(t)
        if s == 0 and bib in (1, 3):
            music.place(drums, synth.clap(seed + g), t, 0.3)
        music.place(drums, key(seed + g, pitch=g), t, 0.18 if s else 0.28)
        if s % 2 == 0:
            f = 440 * 2 ** ((bass[bar % 4] + 24 + arp[(g // 2) % 8] - 69) / 12)
            tt = t_axis(beat / 2 * 0.8)
            x = np.sign(np.sin(2 * np.pi * f * tt)) * env_exp(tt, 14, 0.002) * 0.1
            music.place(tones, stereo(fft_filter(x, hi=5000), width=0.5), t)
        if s == 0:
            f = 440 * 2 ** ((bass[bar % 4] - 69) / 12)
            tt = t_axis(beat * 0.9)
            x = np.sign(np.sin(2 * np.pi * f * tt)) * env_exp(tt, 4, 0.004) * 0.22
            music.place(tones, stereo(fft_filter(x, hi=900)), t)
    if stop is not None:
        music.place(drums, carriage(seed), stop, 1.0)
        music.place(drums, synth.subdrop(seed, dur=min(1.6, duration - stop)), stop, 0.6)
        kicks.append(stop)
    mix = drums + music.sidechain(tones, kicks, 0.5)
    return music.tail_fade(mix)


VOICES = {"key": key, "carriage": carriage, "chirp": chirp, "stream": stream}
BEDS = {"terminal": terminal}
