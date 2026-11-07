"""Cheap signals over a proxy clip → ranked candidate windows for the vision pass.

What each signal is, and what it is not:
  cut           histogram jump between frames. Reliable for hard cuts.
  transition    several cut-like frames in a row (a wipe or logo sweep). Broadcasts
                usually wrap replays in one, so the shot after it is flagged
                "replay?". A guess: the vision pass must confirm it.
  pan           whole-frame shift between frames (phase correlation). A sudden
                speed-up often means the camera is chasing a long kick. Often,
                not always.
  motion        frame difference after removing the pan: players and ball moving.
  concentration share of that motion inside the busiest 5 % of the picture. High
                when a few players move hard in one spot (a pack, a contest, a
                tackle), but also for a close-up. Weak on its own.
  crowd         audio loudness above its running baseline. A roar follows marks,
                goals, big tackles and umpire calls; commentary can fool it.
None of these says what happened. They only pick where to look; the vision pass
says what is visible, and it can drop a candidate.
"""
from __future__ import annotations

import numpy as np

from . import media

SMALL = (160, 90)


def robust_z(x: np.ndarray) -> np.ndarray:
    med = np.median(x)
    mad = np.median(np.abs(x - med)) * 1.4826 + 1e-6
    return (x - med) / mad


def _hist(frames: np.ndarray, bins: int = 32) -> np.ndarray:
    h = np.stack([np.bincount((f >> 3).ravel(), minlength=bins) for f in frames]).astype(np.float32)
    return h / h.sum(axis=1, keepdims=True)


def _phase_shift(a: np.ndarray, b: np.ndarray, win: np.ndarray) -> tuple[float, float]:
    """Shift (dx, dy) that takes a to b, in small-frame px (integer peak + parabolic refinement)."""
    A = np.fft.fft2((a - a.mean()) * win)
    B = np.fft.fft2((b - b.mean()) * win)
    R = A.conj() * B
    R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real
    iy, ix = np.unravel_index(np.argmax(r), r.shape)
    h, w = r.shape

    def refine(c0, cm, cp):
        d = cm - 2 * c0 + cp
        return 0.0 if abs(d) < 1e-9 else 0.5 * (cm - cp) / d
    dx = ix + refine(r[iy, ix], r[iy, (ix - 1) % w], r[iy, (ix + 1) % w])
    dy = iy + refine(r[iy, ix], r[(iy - 1) % h, ix], r[(iy + 1) % h, ix])
    if dx > w / 2:
        dx -= w
    if dy > h / 2:
        dy -= h
    return float(dx), float(dy)


def compute(proxy, fps: float, width: int, audio_path=None) -> dict:
    """Per-frame signal arrays for a proxy file (audio from audio_path: the proxy itself is video only)."""
    g = media.decode_gray(proxy, *SMALL).astype(np.float32)
    n = len(g)
    hist = _hist(g.astype(np.uint8))
    cut = np.zeros(n, np.float32)
    cut[1:] = 0.5 * np.abs(hist[1:] - hist[:-1]).sum(axis=1)
    win = np.outer(np.hanning(SMALL[1]), np.hanning(SMALL[0])).astype(np.float32)
    pan = np.zeros((n, 2), np.float32)
    resid = np.zeros(n, np.float32)
    conc = np.zeros(n, np.float32)
    m = 8
    for i in range(1, n):
        dx, dy = _phase_shift(g[i - 1], g[i], win)
        pan[i] = (dx, dy)
        sx, sy = int(round(dx)), int(round(dy))
        prev = np.roll(np.roll(g[i - 1], sy, axis=0), sx, axis=1)
        d = np.abs(g[i] - prev)[m:-m, m:-m]
        resid[i] = d.mean() / 255.0
        bh, bw = d.shape[0] // 8, d.shape[1] // 8
        blocks = d[: bh * 8, : bw * 8].reshape(bh, 8, bw, 8).mean(axis=(1, 3)).ravel()
        k = max(1, int(len(blocks) * 0.05))
        tot = blocks.sum() + 1e-6
        conc[i] = np.sort(blocks)[-k:].sum() / tot
    scale = width / SMALL[0]
    speed = np.hypot(pan[:, 0], pan[:, 1]) * scale            # proxy px per frame
    if n > 1:
        speed[0] = speed[1]                                    # frame 0 has no previous frame
    accel = np.zeros(n, np.float32)
    accel[1:] = np.maximum(0, np.diff(speed))
    env, hop = media.decode_audio_rms(audio_path) if audio_path else (None, 0.04)
    if env is not None:
        t = np.arange(n) / fps
        audio = np.interp(t, np.arange(len(env)) * hop, env).astype(np.float32)
        # loudness above a 5 s running median (the crowd's baseline)
        k = max(1, int(5 * fps))
        pad = np.pad(audio, (k // 2, k - k // 2 - 1), mode="edge")
        base = np.array([np.median(pad[i:i + k]) for i in range(n)], np.float32)
        loud = 20 * np.log10((audio + 1e-5) / (base + 1e-5))
    else:
        loud = np.zeros(n, np.float32)
    return {"n": n, "cut": cut, "pan": pan * scale, "speed": speed, "accel": accel, "resid": resid, "conc": conc,
            "loud": loud, "has_audio": env is not None}


def shots(sig: dict, fps: float, cut_thr: float = 0.25) -> tuple[list[dict], list[dict]]:
    """Hard cuts (one frame over cut_thr), transitions (3+ frames in a row well above the clip's
    usual frame-to-frame change, e.g. a wipe) and the shots between them."""
    n = sig["n"]
    d = sig["cut"]
    soft = max(0.05, 8 * float(np.median(d)))
    hard = d > cut_thr
    hot = d > soft
    # a soft run only counts if it is 3+ frames long (a wipe); single soft frames are motion
    keep = hard.copy()
    i = 1
    while i < n:
        if hot[i]:
            j = i
            while j + 1 < n and hot[j + 1]:
                j += 1
            if j - i + 1 >= 3:
                keep[i:j + 1] = True
            i = j + 1
        else:
            i += 1
    hot = keep
    runs, i = [], 1
    while i < n:
        if hot[i]:
            j = i
            while j + 1 < n and hot[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    # cut runs separated by less than 0.8 s merge into one transition (a wipe is several hot frames)
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] <= int(0.8 * fps):
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    cuts = [{"f0": a, "f1": b, "kind": "transition" if b - a >= 2 else "cut"} for a, b in merged]
    out, start = [], 0
    for c in cuts:
        if c["f0"] > start:
            out.append({"f0": start, "f1": c["f0"] - 1})
        start = c["f1"] + 1 if c["kind"] == "transition" else c["f0"]
    if start < n:
        out.append({"f0": start, "f1": n - 1})
    for s in out:
        prev = [c for c in cuts if c["f1"] < s["f0"] + 1 and c["f1"] >= s["f0"] - 2]
        s["after_transition"] = any(c["kind"] == "transition" for c in prev)
        s["replay_suspect"] = s["after_transition"]
    return cuts, out


def candidates(sig: dict, fps: float, shot_list: list[dict], cut_list: list[dict], max_n: int = 8,
               before_s: float = 4.0, after_s: float = 2.5) -> tuple[np.ndarray, list[dict]]:
    n = sig["n"]
    za = np.clip(robust_z(sig["loud"]), 0, 6) if sig["has_audio"] else np.zeros(n)
    zr = np.clip(robust_z(sig["resid"]), 0, 6)
    zp = np.clip(robust_z(sig["accel"]), 0, 6)
    zc = np.clip(robust_z(sig["conc"]), 0, 6)
    w = (0.35, 0.25, 0.2, 0.2) if sig["has_audio"] else (0.0, 0.4, 0.3, 0.3)
    score = w[0] * za + w[1] * zr + w[2] * zp + w[3] * zc
    for c in cut_list:                                   # cut frames themselves are not moments
        score[max(0, c["f0"] - 1):c["f1"] + 2] = 0
    k = max(1, int(0.5 * fps))
    score = np.convolve(score, np.ones(k) / k, mode="same")
    s = score.copy()
    picks = []
    sup = int(3 * fps)
    while len(picks) < max_n:
        i = int(np.argmax(s))
        if s[i] <= 0.6:
            break
        picks.append(i)
        s[max(0, i - sup):i + sup + 1] = -1
    out = []
    for rank, p in enumerate(sorted(picks, key=lambda i: -score[i])):
        shot = next((x for x in shot_list if x["f0"] <= p <= x["f1"]), {"f0": 0, "f1": n - 1, "replay_suspect": False})
        f0 = max(shot["f0"], p - int(before_s * fps))
        f1 = min(shot["f1"], p + int(after_s * fps))
        lo, hi = f0, f1 + 1
        fired = []

        def note(arr, label, why):
            j = lo + int(np.argmax(arr[lo:hi]))
            if arr[j] >= 2:
                fired.append({"signal": label, "frame": j, "z": round(float(arr[j]), 1), "reads_as": why})
        note(za, "crowd", "crowd gets louder (a mark, goal, tackle or umpire call?)")
        note(zp, "pan", "camera speeds up (often chasing a kick)")
        note(zr, "motion", "players or ball moving hard")
        note(zc, "concentration", "motion bunched in one spot (pack, contest or tackle?)")
        if shot.get("replay_suspect"):
            fired.append({"signal": "after_transition", "frame": shot["f0"], "z": None,
                          "reads_as": "shot follows a transition wipe: probably a replay"})
        out.append({"id": f"k{rank + 1}", "rank": rank + 1, "peak_f": int(p), "start_f": int(f0), "end_f": int(f1),
                    "score": round(float(score[p]), 2), "shot": [int(shot["f0"]), int(shot["f1"])],
                    "replay_suspect": bool(shot.get("replay_suspect")), "signals": fired})
    return score, out
