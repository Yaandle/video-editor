"""ffmpeg / ffprobe helpers for the render engine."""
from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path

from .. import config

COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]


def encode_args(fps: int, n_frames: int, preset, out: Path, encoder: str = "libx264") -> list[str]:
    """PNG frames on stdin → H.264 segment. Every segment opens on a keyframe so
    segments concatenate with stream copy."""
    vf = "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p"
    common = ["-y", "-v", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "png", "-i", "-",
              "-frames:v", str(n_frames), "-vf", vf, "-r", str(fps)]
    if encoder == "nvenc":
        codec = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", str(preset.crf + 3), "-b:v", "0", "-profile:v", "high"]
    else:
        codec = ["-c:v", "libx264", "-preset", preset.x264, "-crf", str(preset.crf), "-profile:v", "high",
                 "-x264-params", "keyint=300:min-keyint=1:scenecut=0"]
    return [config.ffmpeg(), *common, *codec, *COLOR, "-video_track_timescale", str(fps * 1000), "-an", str(out)]


def probe(path: Path) -> dict:
    r = subprocess.run([config.ffprobe(), "-v", "error", "-count_packets", "-show_streams", "-show_format", "-of", "json", str(path)],
                       capture_output=True, text=True, env=config.subprocess_env(), timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path.name}: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def summarize(info: dict) -> dict:
    out = {"streams": [], "duration": float(info.get("format", {}).get("duration", 0) or 0)}
    for s in info.get("streams", []):
        item = {"type": s.get("codec_type"), "codec": s.get("codec_name"), "duration": float(s.get("duration", 0) or 0)}
        if s.get("codec_type") == "video":
            item.update(width=s.get("width"), height=s.get("height"), pix_fmt=s.get("pix_fmt"),
                        fps=float(Fraction(s.get("avg_frame_rate", "0/1"))) if s.get("avg_frame_rate", "0/0") != "0/0" else 0,
                        frames=int(s.get("nb_read_packets") or s.get("nb_frames") or 0), color=s.get("color_space"))
        if s.get("codec_type") == "audio":
            item.update(sample_rate=int(s.get("sample_rate", 0)), channels=s.get("channels"),
                        packets=int(s.get("nb_read_packets") or 0))
        out["streams"].append(item)
    return out


def run(args: list[str], timeout: float = 600) -> None:
    r = subprocess.run([config.ffmpeg(), *args], capture_output=True, text=True, env=config.subprocess_env(), timeout=timeout,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(args[:8])}…\n{r.stderr.strip()[-800:]}")
