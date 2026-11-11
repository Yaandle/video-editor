"""Probe, proxy and decode clips with the studio's own ffmpeg (no downloads, ever).

The proxy is what every later step addresses: constant frame rate at the
source's nominal rate, every frame a keyframe (exact seeks), trimmed to the
clip range, start time 0. Frame numbers in the moments file are proxy frames.
"""
from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np

from .. import config


def _run(args: list[str], timeout: float = 900, input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, timeout=timeout, input=input_bytes, env=config.subprocess_env())
    if r.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} failed: {r.stderr.decode('utf-8', 'replace').strip()[-800:]}")
    return r


def probe(path: Path) -> dict:
    """{width, height, fps (Fraction), fps_float, frames, duration, vfr, audio} of a video file."""
    r = _run([config.ffprobe(), "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(path)])
    info = json.loads(r.stdout)
    v = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    if not v:
        raise ValueError(f"{path.name}: no video stream")
    rfr = Fraction(v.get("r_frame_rate", "0/1"))
    afr = Fraction(v.get("avg_frame_rate", "0/1")) if v.get("avg_frame_rate", "0/0") != "0/0" else rfr
    frames = int(v.get("nb_read_frames") or v.get("nb_frames") or 0)
    dur = float(v.get("duration") or info.get("format", {}).get("duration") or 0)
    return {
        "width": int(v["width"]), "height": int(v["height"]),
        "fps": rfr, "fps_float": float(rfr), "avg_fps": float(afr),
        "frames": frames, "duration": dur,
        # r_frame_rate vs avg_frame_rate disagreeing by more than 0.5 % is the usual VFR tell
        "vfr": bool(rfr and afr and abs(float(rfr) - float(afr)) / float(rfr) > 0.005),
        "audio": any(s.get("codec_type") == "audio" for s in info["streams"]),
        "codec": v.get("codec_name"),
    }


def nominal_fps(fps: Fraction) -> Fraction:
    """Snap a measured rate to the broadcast rate it is meant to be (25, 29.97, 50, 59.94 …)."""
    for cand in (Fraction(24000, 1001), Fraction(24), Fraction(25), Fraction(30000, 1001), Fraction(30),
                 Fraction(50), Fraction(60000, 1001), Fraction(60)):
        if abs(float(fps) - float(cand)) < 0.02:
            return cand
    return fps.limit_denominator(1001)


def fps_json(fps: Fraction) -> float | int:
    """fps as stored in JSON: an int when whole, else the float of the exact fraction."""
    return int(fps) if fps.denominator == 1 else float(fps)


def video_start(path: Path) -> float:
    r = _run([config.ffprobe(), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=start_time", "-of", "json", str(path)])
    return float(json.loads(r.stdout)["streams"][0].get("start_time") or 0)


def make_proxy(src: Path, out: Path, t_in: float | None = None, t_out: float | None = None,
               max_width: int = 1920, keep_audio: bool = True) -> dict:
    """Trim [t_in, t_out) seconds of src into an all-intra CFR proxy. Returns the proxy's probe.

    The proxy is video only, so its first frame sits at t = 0: the renderer's frame decoder
    seeks to frame / fps, and an audio track's priming delay would push every frame one late.
    The audio (if any) goes to <proxy>-audio.wav, cut from the same range."""
    info = probe(src)
    fps = nominal_fps(info["fps"] if not info["vfr"] else Fraction(info["avg_fps"]).limit_denominator(1001))
    out.parent.mkdir(parents=True, exist_ok=True)
    w = min(max_width, info["width"]) // 2 * 2
    args = [config.ffmpeg(), "-v", "error", "-y"]
    if t_in is not None:
        args += ["-ss", f"{t_in:.6f}"]
    args += ["-i", str(src)]
    if t_out is not None:
        args += ["-t", f"{(t_out - (t_in or 0)):.6f}"]
    args += ["-map", "0:v:0", "-vf", f"fps={fps.numerator}/{fps.denominator},scale={w}:-2:flags=lanczos,setsar=1",
             "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-g", "1", "-bf", "0",
             "-pix_fmt", "yuv420p"]
    args += ["-an", "-movflags", "+faststart", "-avoid_negative_ts", "make_zero", str(out)]
    _run(args)
    p = probe(out)
    if p["fps"] != fps:
        raise RuntimeError(f"proxy fps {p['fps']} != requested {fps}")
    st = video_start(out)
    if abs(st) > 1e-6:
        raise RuntimeError(f"proxy video starts at {st:.6f} s, not 0: frame numbers would be off by one")
    p["audio_file"] = None
    if keep_audio and info["audio"]:
        wav = out.with_name(out.stem + "-audio.wav")
        a = [config.ffmpeg(), "-v", "error", "-y"]
        if t_in is not None:
            a += ["-ss", f"{t_in:.6f}"]
        a += ["-i", str(src)]
        if t_out is not None:
            a += ["-t", f"{(t_out - (t_in or 0)):.6f}"]
        _run(a + ["-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(wav)])
        p["audio_file"] = wav
    p["audio"] = p["audio_file"] is not None
    return p


def decode_gray(path: Path, width: int = 160, height: int = 90) -> np.ndarray:
    """Every frame as uint8 grayscale (n, h, w), in order, one per proxy frame."""
    r = _run([config.ffmpeg(), "-v", "error", "-i", str(path), "-vf", f"scale={width}:{height}:flags=area,format=gray",
              "-fps_mode", "passthrough", "-f", "rawvideo", "-"], timeout=1800)
    a = np.frombuffer(r.stdout, np.uint8)
    return a.reshape(-1, height, width)


def decode_rgb(path: Path, width: int = 64, height: int = 36) -> np.ndarray:
    r = _run([config.ffmpeg(), "-v", "error", "-i", str(path), "-vf", f"scale={width}:{height}:flags=area,format=rgb24",
              "-fps_mode", "passthrough", "-f", "rawvideo", "-"], timeout=1800)
    return np.frombuffer(r.stdout, np.uint8).reshape(-1, height, width, 3)


def decode_audio_rms(path: Path, hop_s: float = 0.04) -> tuple[np.ndarray, float] | tuple[None, float]:
    """Mono RMS envelope (one value per hop) or (None, hop) for a silent clip."""
    sr = 16000
    try:
        r = _run([config.ffmpeg(), "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(sr),
                  "-f", "s16le", "-"], timeout=1800)
    except RuntimeError:
        return None, hop_s
    x = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0
    if not len(x):
        return None, hop_s
    hop = int(sr * hop_s)
    n = len(x) // hop
    env = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)
    return env, hop_s


def extract_frames(path: Path, frames: list[int], fps: float) -> dict[int, "Image.Image"]:  # noqa: F821
    """Full-resolution PIL images of the given proxy frames (exact: the proxy is all-intra CFR)."""
    from PIL import Image
    out = {}
    for f in sorted(set(frames)):
        r = _run([config.ffmpeg(), "-v", "error", "-ss", f"{f / fps:.6f}", "-i", str(path), "-frames:v", "1",
                  "-f", "image2pipe", "-vcodec", "png", "-"])
        import io
        out[f] = Image.open(io.BytesIO(r.stdout)).convert("RGB")
    return out
