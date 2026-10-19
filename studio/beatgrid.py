"""Beat grid: snap() and the timeline validator.

    python -m studio.beatgrid projects/showcase.json

Fails when any cut (scene boundary), hit (spring arrival that makes a sound)
or manual cue is more than one frame off a grid line. Same formulas as
frontend/renderer/beat.js.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def grid(settings: dict) -> dict | None:
    bpm = settings.get("bpm")
    if not bpm:
        return None
    fps = settings["fps"]
    sub = settings.get("subdivision", 1)
    beat = 60.0 / bpm
    step = beat / sub
    return {"fps": fps, "bpm": bpm, "beat": beat, "step": step, "offset": settings.get("beat_offset", 0.0),
            "frames_per_step": step * fps, "frames_per_beat": beat * fps}


def snap(t: float, settings: dict, mode: str = "step") -> float:
    g = grid(settings)
    if not g:
        return t
    unit = {"beat": g["beat"], "bar": g["beat"] * 4}.get(mode, g["step"])
    return g["offset"] + round((t - g["offset"]) / unit) * unit


def off_grid_frames(t: float, settings: dict) -> float:
    g = grid(settings)
    return 0.0 if not g else abs(t - snap(t, settings)) * g["fps"]


def validate(project: dict, events: dict, tolerance_frames: float = 1.0) -> dict:
    s = project["settings"]
    g = grid(s)
    result = {"checked": 0, "violations": [], "grid": g, "skipped": None}
    if not g:
        result["skipped"] = "project has no bpm"
        return result
    if abs(g["frames_per_step"] - round(g["frames_per_step"])) > 1e-6:
        result["violations"].append({"kind": "settings", "detail": f"{g['frames_per_step']:.3f} frames per grid step (must be whole)"})
        return result
    items = [("cut", c) for c in events.get("cuts", [])] + [("hit", h) for h in events.get("hits", [])]
    items += [("cue", c) for c in (project.get("audio") or {}).get("cues", [])]
    duration = s["duration"]
    for kind, it in items:
        t = float(it["t"])
        if kind == "cut" and (t <= 1e-9 or abs(t - duration) < 1e-9):
            result["checked"] += 1
            continue
        off = off_grid_frames(t, s)
        result["checked"] += 1
        if off > tolerance_frames + 1e-6:
            result["violations"].append({"kind": kind, "t": round(t, 4), "off_frames": round(off, 3),
                                         "nearest": round(snap(t, s), 4), "clip": it.get("clipId")})
    return result


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.beatgrid")
    ap.add_argument("project")
    a = ap.parse_args(argv)
    from . import jsbridge, schema
    p = schema.load(Path(a.project))
    r = validate(p, jsbridge.events(p))
    if r["skipped"]:
        print(f"beat grid: skipped ({r['skipped']})")
        return 0
    g = r["grid"]
    print(f"beat grid: {g['bpm']} BPM, {g['frames_per_beat']:.0f} frames/beat, step {g['frames_per_step']:.0f} frames — "
          f"{r['checked']} events checked, {len(r['violations'])} off-grid")
    for v in r["violations"]:
        print(f"  ✗ {v}")
    return 1 if r["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
