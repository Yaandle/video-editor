"""Mixer + master bus.

music bed + motion-driven SFX cues + uploaded audio/video sound → master →
loudness-normalized to the project target (default −14 LUFS integrated) with a
true-peak-safe limiter → measured with ffmpeg (ebur128 + astats) and reported.

The full timeline is always mastered (and cached); renders of a range slice the
mastered timeline, so a draft of 2.0–4.5 s sounds exactly like the same span of
the final export.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

import numpy as np

from .. import config, paths
from . import music, synth
from .synth import SR

LIMIT_LINEAR = 0.80          # alimiter ceiling ≈ −1.9 dBFS sample peak → true peak under −1 dBTP
TP_MAX = -1.0                # dBTP the render report requires


def db(x: float) -> float:
    return 10 ** (x / 20)


def _ff(args: list[str], input_bytes: bytes | None = None, timeout: float = 300) -> subprocess.CompletedProcess:
    return subprocess.run([config.ffmpeg(), "-hide_banner", "-nostats", *args], input=input_bytes, capture_output=True,
                          timeout=timeout, env=config.subprocess_env())


def decode(path: Path) -> np.ndarray:
    """Any audio/video file → (n, 2) float32 at SR (cached on disk)."""
    st = path.stat()
    key = hashlib.sha1(f"{path}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:16]
    cache = paths.CACHE / "audio" / f"{key}.f32"
    if cache.is_file():
        return np.fromfile(cache, dtype=np.float32).reshape(-1, 2)
    r = _ff(["-v", "error", "-i", str(path), "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    if r.returncode != 0:
        raise RuntimeError(f"cannot decode audio from {path.name}: {r.stderr.decode(errors='replace')[-300:]}")
    data = np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2)
    cache.parent.mkdir(parents=True, exist_ok=True)
    data.tofile(cache)
    return data


def _place(buf: np.ndarray, sig: np.ndarray, t: float, gain: float = 1.0) -> None:
    music.place(buf, sig, t, gain)


def _seed(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def cue_signal(cue: dict, idx: int) -> tuple[np.ndarray, float]:
    """Synthesize one cue; returns (signal, start time) — risers end on their cut."""
    sound = cue["sound"]
    seed = _seed(sound, idx, round(cue["t"], 4))
    if sound == "riser":
        length = float(cue.get("length", 0.5))
        sig = synth.riser(seed=seed, dur=length)
        return sig, float(cue.get("ends_at", cue["t"] + length)) - length
    if sound == "tick":
        p = cue.get("pitch")
        return synth.tick(seed=seed, pitch=1.0 + 0.06 * ((p or 0) % 8)), cue["t"]
    if sound == "whoosh":
        return synth.whoosh(seed=seed), cue["t"] - 0.12      # whoosh peaks into the motion
    if sound == "impact":
        return synth.impact(seed=seed, size=1.0), cue["t"]
    return synth.voice(sound, seed=seed), cue["t"]


def build_timeline(project: dict, events: dict) -> tuple[np.ndarray, dict]:
    s = project["settings"]
    dur = float(s["duration"])
    n = int(round(dur * SR))
    a = project.get("audio") or {}
    info = {"cues": 0, "clips": 0, "music": None}
    master = np.zeros((n, 2), np.float32)

    hidden = {t["index"] for t in project.get("tracks", []) if t.get("hidden") or t.get("muted")}
    duck = np.ones(n, np.float32)
    clip_bus = np.zeros((n, 2), np.float32)
    for c in project["clips"]:
        if c["type"] not in ("audio", "video") or not c.get("src") or c.get("layer", 0) in hidden:
            continue
        src = (paths.ROOT / str(c["src"]).lstrip("/")).resolve()
        if not src.is_file():
            raise FileNotFoundError(f"audio source missing for clip {c['id']}: {c['src']}")
        try:
            data = decode(src)
        except RuntimeError:
            if c["type"] == "video":
                continue        # silent video: nothing to mix
            raise
        props = c.get("props") or {}
        start_s = int(round(float(c.get("source_start", 0)) * SR))
        length = int(round(float(c["duration"]) * SR))
        seg = data[start_s:start_s + length].copy()
        if len(seg) == 0:
            continue
        fi, fo = int(props.get("fade_in", 0.02) * SR), int(props.get("fade_out", 0.05) * SR)
        if fi > 0:
            seg[:fi] *= np.linspace(0, 1, min(fi, len(seg)), dtype=np.float32)[:, None][:len(seg[:fi])]
        if fo > 0:
            seg[-fo:] *= np.linspace(1, 0, min(fo, len(seg)), dtype=np.float32)[:, None][-len(seg[-fo:]):]
        _place(clip_bus, seg, float(c["start"]), db(float(props.get("gain_db", 0))))
        info["clips"] += 1
        if props.get("duck_music", True) and c["type"] == "audio":
            i0 = int(round(float(c["start"]) * SR))
            duck[max(0, i0):min(n, i0 + len(seg))] = db(-9)

    if a.get("music"):
        m = a["music"]
        cuts = [c["t"] for c in events.get("cuts", []) if c.get("edge") == "in"]
        bed = music.render_bed(dur, float(s.get("bpm") or 120), cuts, seed=int(m.get("seed", 7)),
                               end_hit=bool(m.get("end_hit", True)), offset=float(s.get("beat_offset", 0)))
        # smooth the duck so it never clicks
        k = int(0.08 * SR)
        if k > 1 and duck.min() < 1:
            duck = np.convolve(duck, np.ones(k) / k, mode="same").astype(np.float32)
        master += bed * db(float(m.get("gain_db", -2))) * duck[:, None]
        info["music"] = m.get("preset", "brutal-bounce")

    if a.get("auto_sfx", True):
        sfx_gain = db(float(a.get("sfx_gain_db", 0)))
        for i, cue in enumerate(events.get("cues", [])):
            sig, t0 = cue_signal(cue, i)
            _place(master, sig, t0, db(float(cue.get("gain_db", -6))) * sfx_gain)
            info["cues"] += 1
    for i, cue in enumerate(a.get("cues", [])):
        sig, t0 = cue_signal(cue, 10_000 + i)
        _place(master, sig, t0, db(float(cue.get("gain_db", -6))))
        info["cues"] += 1
    master += clip_bus
    return master, info


def measure(raw: bytes) -> dict:
    """Integrated loudness, LRA, true peak (ebur128) and sample peak (astats) of f32le stereo."""
    r = _ff(["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-af", "ebur128=peak=true:framelog=quiet,astats=metadata=0:measure_perchannel=none",
             "-f", "null", "-"], input_bytes=raw)
    err = r.stderr.decode(errors="replace")
    def grab(pat, default=None):
        m = re.findall(pat, err)
        return float(m[-1]) if m else default
    return {
        "integrated_lufs": grab(r"I:\s+(-?[\d.]+|-inf) LUFS"),
        "lra_lu": grab(r"LRA:\s+(-?[\d.]+) LU"),
        "true_peak_dbtp": grab(r"Peak:\s+(-?[\d.]+|-inf) dBFS"),
        "sample_peak_db": grab(r"Peak level dB:\s+(-?[\d.]+|-inf)"),
    }


def _limit(x: np.ndarray, gain_db: float) -> np.ndarray:
    raw = (x * db(gain_db)).astype(np.float32).tobytes()
    r = _ff(["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
             "-af", f"alimiter=limit={LIMIT_LINEAR}:attack=4:release=60:level=false:latency=true",
             "-f", "f32le", "-ar", str(SR), "-ac", "2", "-"], input_bytes=raw)
    if r.returncode != 0:
        raise RuntimeError(f"limiter failed: {r.stderr.decode(errors='replace')[-400:]}")
    y = np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2)
    if len(y) < len(x):
        y = np.concatenate([y, np.zeros((len(x) - len(y), 2), np.float32)])
    return y[:len(x)]


def master_timeline(project: dict, events: dict) -> tuple[np.ndarray, dict]:
    """Full-timeline master at the target loudness (cached by its inputs)."""
    a = project.get("audio") or {}
    target = float(a.get("target_lufs", -14))
    key_src = json.dumps({"p": {k: project[k] for k in ("settings", "clips", "tracks", "audio")}, "e": events, "v": 3}, sort_keys=True)
    srcs = sorted({str(c.get("src")) for c in project["clips"] if c.get("src") and c["type"] in ("audio", "video")})
    for sname in srcs:
        sp = paths.ROOT / sname.lstrip("/")
        if sp.is_file():
            key_src += f"|{sname}:{sp.stat().st_mtime_ns}"
    key = hashlib.sha256(key_src.encode()).hexdigest()[:20]
    cache = paths.CACHE / "audio" / f"master_{key}.f32"
    meta = cache.with_suffix(".json")
    if cache.is_file() and meta.is_file():
        return np.fromfile(cache, dtype=np.float32).reshape(-1, 2), json.loads(meta.read_text())

    raw, info = build_timeline(project, events)
    if not np.any(raw):
        out, stats = raw, {"integrated_lufs": None, "note": "silent timeline"}
    else:
        m0 = measure(raw.tobytes())
        gain = target - (m0["integrated_lufs"] if m0["integrated_lufs"] is not None else target)
        out = _limit(raw, gain)
        m1 = measure(out.tobytes())
        if m1["integrated_lufs"] is not None and abs(target - m1["integrated_lufs"]) > 0.3:
            gain += target - m1["integrated_lufs"]       # second pass: the limiter ate some level
            out = _limit(raw, gain)
        stats = {"pre_master": m0, "master_gain_db": round(gain, 2)}
    stats.update(info)
    cache.parent.mkdir(parents=True, exist_ok=True)
    out.astype(np.float32).tofile(cache)
    meta.write_text(json.dumps(stats))
    return out, stats


def render_range(project: dict, events: dict, frame0: int, frame1: int, out_wav: Path) -> dict:
    """Write the mastered audio for frames [frame0, frame1) and return loudness numbers."""
    fps = project["settings"]["fps"]
    master, stats = master_timeline(project, events)
    i0 = int(round(frame0 / fps * SR))
    i1 = int(round(frame1 / fps * SR))
    seg = master[i0:i1]
    if len(seg) < i1 - i0:
        seg = np.concatenate([seg, np.zeros((i1 - i0 - len(seg), 2), np.float32)])
    raw = seg.astype(np.float32).tobytes()
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    r = _ff(["-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-c:a", "pcm_s24le", str(out_wav)], input_bytes=raw)
    if r.returncode != 0:
        raise RuntimeError(f"writing {out_wav.name} failed: {r.stderr.decode(errors='replace')[-300:]}")
    final = measure(raw) if np.any(seg) else {"integrated_lufs": None, "true_peak_dbtp": None, "sample_peak_db": None, "lra_lu": None}
    clipped = int(np.sum(np.abs(seg) >= 0.999))
    return {"samples": int(len(seg)), "sample_rate": SR, "range_seconds": [frame0 / fps, frame1 / fps], "final": final,
            "clipped_samples": clipped, "master": stats, "target_lufs": float((project.get("audio") or {}).get("target_lufs", -14))}
