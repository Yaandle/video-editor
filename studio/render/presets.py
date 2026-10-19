"""Export presets. `draft` is a modifier: half size, fast encode, same frame rate."""
from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Preset:
    name: str
    width: int
    height: int
    fps: int | None          # None = project fps
    crf: int = 16
    x264: str = "medium"
    audio_bitrate: str = "256k"
    draft: bool = False


PRESETS = {
    "1080p30": Preset("1080p30", 1920, 1080, 30),
    "1080p60": Preset("1080p60", 1920, 1080, 60),
    "vertical": Preset("vertical", 1080, 1920, 30),
    "720p30": Preset("720p30", 1280, 720, 30),
    "project": Preset("project", 0, 0, None),
}


def get(name: str, draft: bool = False, project_settings: dict | None = None) -> Preset:
    if name not in PRESETS:
        raise ValueError(f"unknown preset '{name}' (choose: {', '.join(PRESETS)})")
    p = PRESETS[name]
    if name == "project" and project_settings:
        p = replace(p, width=project_settings["width"], height=project_settings["height"], fps=project_settings["fps"])
    if draft:
        p = replace(p, name=p.name + "-draft", width=max(16, (p.width // 2) // 2 * 2), height=max(16, (p.height // 2) // 2 * 2),
                    crf=28, x264="ultrafast", audio_bitrate="128k", draft=True)
    return p
