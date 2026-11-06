"""Dithering sound: everything passes through a bit crusher (amplitude
quantised to a few bits, sample-and-hold at a low rate) — blips, noise bursts,
a crunchy impact, a stepped sweep into cuts, and a 'bitcrush' bed."""
from __future__ import annotations

import numpy as np

from studio.audio import music, synth
from studio.audio.synth import SR, env_exp, fft_filter, rng, stereo, sweep_phase, t_axis


def crush(x: np.ndarray, bits: int = 4, rate: int = 8000) -> np.ndarray:
    """Quantise to `bits` and hold each sample for SR/rate samples (deterministic)."""
    hold = max(1, SR // rate)
    y = np.repeat(x[::hold], hold)[: len(x)]
    q = 2 ** (bits - 1)
    return np.round(np.clip(y, -1, 1) * q) / q


def square(f, t, duty=0.5):
    return np.where((f * t) % 1.0 < duty, 1.0, -1.0)


def blip(seed=0, pitch=None):
    t = t_axis(0.08)
    f = 880 * 2 ** (((pitch or 0) % 5) / 12 * 2)
    x = square(f, t, 0.25) * env_exp(t, 45, 0.0005) * 0.5
    return stereo(crush(x, 4, 11025))


def burst(seed=0):
    t = t_axis(0.18)
    x = rng(seed).standard_normal(len(t)) * env_exp(t, 18, 0.001) * 0.5
    return stereo(crush(fft_filter(x, lo=800), 3, 6000), width=0.5)


burst.lead = 0.06


def crunch(seed=0):
    t = t_axis(0.4)
    body = np.sin(sweep_phase(55 + 140 * np.exp(-t * 28))) * env_exp(t, 9, 0.001)
    noise = rng(seed).standard_normal(len(t)) * env_exp(t, 40, 0.0005) * 0.5
    return stereo(crush((body + noise) * 0.8, 4, 9000))


def sweep(seed=0, length=0.5):
    t = t_axis(length)
    u = t / length
    steps = np.floor(u * 12) / 12            # pitch climbs in 12 hard steps
    x = square(220 * 2 ** (steps * 2.5), t, 0.5) * u ** 1.6 * 0.35
    return stereo(crush(x, 3, 7000), width=0.3)


def bitcrush(duration, bpm, sections, seed=7, end_hit=True, offset=0.0):
    n = int(round(duration * SR))
    drums = np.zeros((n, 2), np.float32)
    keys = np.zeros((n, 2), np.float32)
    beat = 60.0 / bpm
    stop = duration - 2 * beat if end_hit and duration > 4 * beat else None
    kick = stereo(crush(synth.kick(seed=seed)[:, 0], 5, 12000))
    arp = [0, 7, 12, 3, 0, 7, 10, 15]
    roots = [57, 53, 60, 55]            # A, F, C, G (MIDI)
    kicks = []
    for t, g, bar, bib, s in music.steps(duration, bpm, offset, stop):
        if s == 0 and bib in (0, 2):
            music.place(drums, kick, t, 0.9)
            kicks.append(t)
        if s == 0 and bib in (1, 3):
            music.place(drums, burst(seed + g), t, 0.55)
        if s == 2:
            music.place(drums, stereo(crush(synth.hat(seed + g)[:, 0], 3, 9000)), t, 0.25)
        if s in (0, 2):
            note = roots[bar % 4] + arp[(g // 2) % len(arp)]
            f = 440 * 2 ** ((note - 69) / 12)
            tt = t_axis(beat / 2 * 0.9)
            x = square(f, tt, 0.5 if (g // 2) % 2 else 0.25) * env_exp(tt, 8, 0.002) * 0.22
            music.place(keys, stereo(crush(x, 4, 11025), width=0.4), t)
    if stop is not None:
        music.place(drums, crunch(seed + 9), stop, 1.1)
        music.place(drums, stereo(crush(synth.subdrop(seed, dur=min(1.6, duration - stop))[:, 0], 5, 8000)), stop, 0.8)
        kicks.append(stop)
    mix = drums + music.sidechain(keys, kicks, 0.5) * 0.9
    return music.tail_fade(mix)


VOICES = {"blip": blip, "burst": burst, "crunch": crunch, "sweep": sweep}
BEDS = {"bitcrush": bitcrush}
