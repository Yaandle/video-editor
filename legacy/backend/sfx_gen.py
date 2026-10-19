# sfx_gen.py â€” built-in sound-effect pack (#72)
#
# Procedurally synthesizes a small library of simple, generic UI/transition
# sounds (clicks, swipes, whooshes, chimes...) using nothing but the Python
# standard library (wave/struct/math/random). No binary assets are committed
# to the repo and nothing is downloaded â€” the pack is generated once, on the
# machine that runs the app, the first time the server starts. This keeps
# the project fully local/offline and avoids any licensing questions around
# bundled audio.
#
# Regenerate the pack any time by deleting backend/sfx/*.wav and restarting.

import math
import os
import random
import struct
import wave

SAMPLE_RATE = 44100


def _write_wav(path, samples, sample_rate=SAMPLE_RATE):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit PCM
        wf.setframerate(sample_rate)
        buf = bytearray()
        for s in samples:
            v = -1.0 if s < -1.0 else (1.0 if s > 1.0 else s)
            buf += struct.pack("<h", int(v * 32767))
        wf.writeframes(bytes(buf))


def _n(duration):
    return max(1, int(SAMPLE_RATE * duration))


# â”€â”€ Generators â€” each returns a list of floats in [-1, 1] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _gen_click(duration=0.05):
    n = _n(duration)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 140)
        s = (0.55 * random.uniform(-1, 1) + 0.45 * math.sin(2 * math.pi * 3200 * t)) * env
        out.append(s * 0.8)
    return out


def _gen_tick(duration=0.035):
    n = _n(duration)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 220)
        out.append(math.sin(2 * math.pi * 5200 * t) * env * 0.5)
    return out


def _gen_pop(duration=0.15):
    n = _n(duration)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 900 * math.exp(-t * 18) + 90  # pitch falls fast
        phase += 2 * math.pi * freq / SAMPLE_RATE
        env = math.exp(-t * 14)
        out.append(math.sin(phase) * env * 0.7)
    return out


def _gen_pop_up(duration=0.14):
    n = _n(duration)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        frac = t / duration
        freq = 260 + 500 * (1 - math.exp(-t * 30))  # pitch rises
        phase += 2 * math.pi * freq / SAMPLE_RATE
        env = math.sin(math.pi * min(1.0, frac))
        out.append(math.sin(phase) * env * 0.6)
    return out


def _gen_swipe(duration=0.28):
    n = _n(duration)
    out = []
    lp = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        frac = t / duration
        cutoff = 400 + 5000 * frac  # brightens as it sweeps
        alpha = min(0.9, cutoff / SAMPLE_RATE * 6)
        x = random.uniform(-1, 1)
        lp = lp + alpha * (x - lp)
        env = math.sin(math.pi * frac)
        out.append(lp * env * 0.9)
    return out


def _gen_whoosh(duration=0.45):
    n = _n(duration)
    out = []
    lp = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        frac = t / duration
        cutoff = 6000 * (1 - frac) + 300  # darkens as it sweeps
        alpha = min(0.9, cutoff / SAMPLE_RATE * 6)
        x = random.uniform(-1, 1)
        lp = lp + alpha * (x - lp)
        env = math.sin(math.pi * frac) ** 0.7
        out.append(lp * env * 0.85)
    return out


def _gen_transition(duration=0.6):
    n = _n(duration)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        frac = t / duration
        freq = 220 + (880 - 220) * (frac ** 1.5)
        phase += 2 * math.pi * freq / SAMPLE_RATE
        env = math.sin(math.pi * frac)
        out.append(math.sin(phase) * env * 0.5)
    return out


def _gen_chime(duration=0.9):
    n = _n(duration)
    out = []
    partials = [(880.0, 1.0, 4.0755), (1318.5, 0.5, 4.6), (1760.0, 0.3, 5.2), (2217.0, 0.15, 6.0)]
    for i in range(n):
        t = i / SAMPLE_RATE
        s = 0.0
        for freq, amp, decay in partials:
            s += amp * math.sin(2 * math.pi * freq * t) * math.exp(-decay * t)
        out.append(s * 0.35)
    return out


def _gen_ding(duration=0.5):
    n = _n(duration)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = (1 - math.exp(-t * 400)) * math.exp(-t * 5.5)
        s = math.sin(2 * math.pi * 1046.5 * t) + 0.4 * math.sin(2 * math.pi * 2093.0 * t)
        out.append(s * env * 0.4)
    return out


# (filename, display label, category, generator)
SFX_CATALOG = [
    ("click.wav",      "Click",      "ui",         _gen_click),
    ("tick.wav",       "Tick",       "ui",         _gen_tick),
    ("pop.wav",        "Pop",        "ui",         _gen_pop),
    ("pop_up.wav",     "Pop Up",     "ui",         _gen_pop_up),
    ("swipe.wav",      "Swipe",      "transition", _gen_swipe),
    ("whoosh.wav",     "Whoosh",     "transition", _gen_whoosh),
    ("transition.wav", "Sweep",      "transition", _gen_transition),
    ("chime.wav",      "Chime",      "notify",     _gen_chime),
    ("ding.wav",        "Ding",      "notify",     _gen_ding),
]


def ensure_sfx_pack(sfx_dir):
    """Generate any missing files in the built-in sfx pack. Idempotent â€”
    existing files are left untouched, so user edits/replacements stick."""
    os.makedirs(sfx_dir, exist_ok=True)
    for filename, _label, _category, gen in SFX_CATALOG:
        path = os.path.join(sfx_dir, filename)
        if os.path.isfile(path):
            continue
        try:
            _write_wav(path, gen())
        except Exception as exc:  # pragma: no cover â€” never block server start
            print(f"[sfx_gen] failed to generate {filename}: {exc}")


def list_sfx_meta():
    return [{"name": fn, "label": label, "category": cat} for fn, label, cat, _ in SFX_CATALOG]

