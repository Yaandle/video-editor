"""Locate / install external tools (ffmpeg, ffprobe, llama-server) — used by doctor."""
from __future__ import annotations

import os
import re
import shutil
import string
import subprocess
from pathlib import Path

from . import config, paths


def _exe(name: str) -> str:
    return name + (".exe" if os.name == "nt" else "")


def run(cmd: list[str], timeout: float = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=config.subprocess_env(),
                          encoding="utf-8", errors="replace")


def ffmpeg_version(exe: str) -> str | None:
    try:
        out = run([exe, "-hide_banner", "-version"], timeout=20).stdout
    except Exception:
        return None
    m = re.search(r"version (\S+)", out)
    return m.group(1) if m else None


def candidate_ffmpeg_dirs() -> list[Path]:
    """Places ffmpeg builds commonly live on Windows (and PATH everywhere)."""
    found: list[Path] = []
    w = shutil.which("ffmpeg")
    if w:
        found.append(Path(w).parent)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and "ffmpeg" in entry.lower():
            found.append(Path(entry))
    home = Path.home()
    roots = [home / "Downloads", home / "scoop" / "shims", home / "AppData" / "Local" / "Microsoft" / "WinGet" / "Links"]
    if os.name == "nt":
        for d in string.ascii_uppercase:
            drive = Path(f"{d}:/")
            if not drive.exists():
                continue
            roots += [drive / "Downloads", drive / "ffmpeg", drive / "tools", drive / "Program Files" / "ffmpeg",
                      drive / "ProgramData" / "chocolatey" / "bin"]
    for r in roots:
        if not r.is_dir():
            continue
        if (r / _exe("ffmpeg")).is_file():
            found.append(r)
        for sub in sorted(r.glob("ffmpeg*"))[:6]:
            for bin_dir in (sub / "bin", sub / sub.name / "bin", sub):
                if (bin_dir / _exe("ffmpeg")).is_file():
                    found.append(bin_dir)
    out, seen = [], set()
    for f in found:
        key = str(f.resolve()).lower() if f.exists() else str(f).lower()
        if key not in seen and (f / _exe("ffmpeg")).is_file() and (f / _exe("ffprobe")).is_file():
            seen.add(key)
            out.append(f)
    return out


def install_ffmpeg_into_project() -> tuple[bool, str]:
    """Copy a found ffmpeg build into tools/ffmpeg/bin so the project is self-contained."""
    dest = paths.TOOLS / "ffmpeg" / "bin"
    for src in candidate_ffmpeg_dirs():
        if src.resolve() == dest.resolve():
            continue
        if not ffmpeg_version(str(src / _exe("ffmpeg"))):
            continue
        dest.mkdir(parents=True, exist_ok=True)
        for f in src.iterdir():
            if f.suffix.lower() in (".exe", ".dll", "") and f.is_file() and (f.name.lower().startswith(("ffmpeg", "ffprobe")) or f.suffix.lower() == ".dll"):
                shutil.copy2(f, dest / f.name)
        if (dest / _exe("ffmpeg")).is_file() and ffmpeg_version(str(dest / _exe("ffmpeg"))):
            (dest.parent / "SOURCE.txt").write_text(f"Copied by doctor from {src}\n", encoding="utf-8")
            return True, f"copied from {src}"
    return False, "no ffmpeg+ffprobe build found on PATH or common folders; install one (e.g. gyan.dev essentials) and set ffmpeg.dir in config.json"


def encoders(exe: str) -> set[str]:
    out = run([exe, "-hide_banner", "-encoders"], timeout=30).stdout
    return {m.group(1) for m in re.finditer(r"^\s*[VAS][\w.]{5}\s+(\S+)", out, re.M)}


def hw_encoder_works(exe: str, name: str) -> bool:
    """A real 0.2 s encode — NVENC/QSV/AMF may be compiled in but unusable."""
    try:
        r = run([exe, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=256x144:r=30:d=0.2", "-c:v", name, "-f", "null", "-"], timeout=30)
        return r.returncode == 0
    except Exception:
        return False


def llama_server() -> str | None:
    exe = config.get("llm", "server_exe")
    if exe and Path(exe).is_file():
        return str(Path(exe))
    return shutil.which(exe or "llama-server")
