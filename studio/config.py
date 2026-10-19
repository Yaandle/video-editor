"""Machine configuration: config.json at the repo root, overridable by env vars.

Nothing machine-specific lives in source. Keys:
  server.host / server.port
  ffmpeg.dir            folder holding ffmpeg(.exe) and ffprobe(.exe); env VIDKIT_FFMPEG_DIR
  render.workers        Chromium workers for export; env VIDKIT_RENDER_WORKERS
  llm.model_path        GGUF file (first shard); env VIDKIT_LLM_MODEL
  llm.server_exe        llama-server executable name or path; env VIDKIT_LLM_SERVER
  llm.port, llm.n_gpu_layers, llm.ctx, llm.enabled
"""
from __future__ import annotations

import json
import os
import shutil
from functools import lru_cache
from pathlib import Path

from . import paths

DEFAULT_LLM_MODEL = str(Path("models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"))  # override in config.json / VIDKIT_LLM_MODEL

DEFAULTS: dict = {
    "server": {"host": "127.0.0.1", "port": 8765},
    "ffmpeg": {"dir": None},
    "render": {"workers": 4, "chunk_seconds": 1.0},
    "llm": {
        "enabled": True,
        "model_path": DEFAULT_LLM_MODEL,
        "server_exe": "llama-server",
        "port": 8089,
        "ctx": 4096,
        "n_gpu_layers": 99,
        "temperature": 0.2,
    },
}

ENV = {
    ("ffmpeg", "dir"): "VIDKIT_FFMPEG_DIR",
    ("render", "workers"): "VIDKIT_RENDER_WORKERS",
    ("llm", "model_path"): "VIDKIT_LLM_MODEL",
    ("llm", "server_exe"): "VIDKIT_LLM_SERVER",
    ("server", "port"): "VIDKIT_PORT",
}


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


@lru_cache(maxsize=1)
def load() -> dict:
    cfg = DEFAULTS
    if paths.CONFIG_FILE.is_file():
        cfg = _merge(DEFAULTS, json.loads(paths.CONFIG_FILE.read_text(encoding="utf-8")))
    for (section, key), env in ENV.items():
        if os.environ.get(env):
            val = os.environ[env]
            if isinstance(DEFAULTS[section][key], int) and not isinstance(DEFAULTS[section][key], bool):
                val = int(val)
            cfg = _merge(cfg, {section: {key: val}})
    return cfg


def save_key(section: str, key: str, value) -> None:
    """Persist one key into config.json (used by doctor fixes)."""
    data = {}
    if paths.CONFIG_FILE.is_file():
        data = json.loads(paths.CONFIG_FILE.read_text(encoding="utf-8"))
    data.setdefault(section, {})[key] = value
    paths.CONFIG_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    load.cache_clear()


def get(section: str, key: str):
    return load()[section][key]


# ── ffmpeg resolution ──────────────────────────────────────────────────────────

def _exe(name: str) -> str:
    return name + (".exe" if os.name == "nt" else "")


def ffmpeg_dir() -> Path | None:
    """Folder containing both ffmpeg and ffprobe: config → tools/ffmpeg/bin → PATH."""
    candidates = []
    if get("ffmpeg", "dir"):
        candidates.append(Path(get("ffmpeg", "dir")))
    candidates.append(paths.TOOLS / "ffmpeg" / "bin")
    on_path = shutil.which("ffmpeg")
    if on_path:
        candidates.append(Path(on_path).parent)
    for d in candidates:
        if (d / _exe("ffmpeg")).is_file() and (d / _exe("ffprobe")).is_file():
            return d
    return None


def ffmpeg() -> str:
    d = ffmpeg_dir()
    if not d:
        raise FileNotFoundError("ffmpeg/ffprobe not found. Run doctor.bat to locate or install them.")
    return str(d / _exe("ffmpeg"))


def ffprobe() -> str:
    d = ffmpeg_dir()
    if not d:
        raise FileNotFoundError("ffmpeg/ffprobe not found. Run doctor.bat to locate or install them.")
    return str(d / _exe("ffprobe"))


def subprocess_env() -> dict:
    """Environment for child processes with the resolved ffmpeg dir first on PATH."""
    env = dict(os.environ)
    d = ffmpeg_dir()
    if d:
        env["PATH"] = str(d) + os.pathsep + env.get("PATH", "")
    return env
