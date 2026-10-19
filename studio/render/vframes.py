"""Exact video frames for the renderer: decoded by ffmpeg at the project frame
rate, a block of frames at a time, cached under renders/.cache/vframes/."""
from __future__ import annotations

import hashlib
import subprocess
import threading
import urllib.parse
from pathlib import Path

from .. import config, paths

BLOCK = 30
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def source_path(src: str) -> Path:
    rel = urllib.parse.unquote(src).lstrip("/")
    p = (paths.ROOT / rel).resolve()
    p.relative_to(paths.ROOT.resolve())
    if not p.is_file():
        raise FileNotFoundError(f"video source missing: {src}")
    return p


def frame_path(src: str, fps: float, frame: int) -> Path:
    path = source_path(src)
    st = path.stat()
    key = hashlib.sha1(f"{path}|{st.st_size}|{st.st_mtime_ns}|{fps}".encode()).hexdigest()[:16]
    folder = paths.CACHE / "vframes" / key
    out = folder / f"{frame:07d}.png"
    if out.is_file():
        return out
    with _guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        if out.is_file():
            return out
        folder.mkdir(parents=True, exist_ok=True)
        start = (frame // BLOCK) * BLOCK
        cmd = [config.ffmpeg(), "-v", "error", "-y", "-ss", f"{start / fps:.6f}", "-i", str(path),
               "-vf", f"fps={fps}", "-frames:v", str(BLOCK), "-start_number", str(start),
               str(folder / "%07d.png")]
        subprocess.run(cmd, check=True, capture_output=True, env=config.subprocess_env())
    if not out.is_file():
        raise FileNotFoundError(f"frame {frame} is past the end of {src}")
    return out
