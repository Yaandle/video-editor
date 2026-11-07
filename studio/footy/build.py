"""Approved moments file → vidkit project (one breakdown scene per kept moment).

Refuses unless the moments file is approved and unchanged since approval.
Timing comes from the renderer's own plan (plan.mjs), so clip lengths, footage
audio, freeze ticks and voice lines line up with the frames exactly.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .. import config, jsbridge, paths, schema
from . import moments as M

PLAN_JS = paths.ROOT / "studio" / "footy" / "plan.mjs"
OUT_FPS = 30
CATEGORY_LINK = {"positioning": "Position", "spacing": "Spacing", "contest": "Contest", "decision": "Decision", "technique": "Technique"}


def node(cmd: str, payload: dict):
    r = subprocess.run([jsbridge.node(), str(PLAN_JS), cmd], input=json.dumps(payload), capture_output=True, text=True,
                       cwd=str(paths.ROOT), encoding="utf-8", timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"plan.mjs {cmd} failed: {r.stderr.strip()[-1500:]}")
    return json.loads(r.stdout)


def media_seconds(path: Path) -> float:
    r = subprocess.run([config.ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True, env=config.subprocess_env())
    return float(json.loads(r.stdout)["format"]["duration"])


def scene_moment(m: M.Moment) -> dict:
    """The moment as the scene reads it (aliases resolved, review-only fields dropped)."""
    d = m.model_dump(by_alias=True, exclude_none=True)
    caps = d.get("captions", {})
    out = {
        "id": m.id, "title": m.title, "category": m.category,
        "in_f": m.in_f, "freeze_f": m.freeze_f, "out_f": m.out_f,
        "captions": {
            **({"watch": caps["watch"]["text"]} if caps.get("watch") else {}),
            "freeze": [c["text"] for c in caps.get("freeze", [])],
            **({"outcome": caps["outcome"]["text"]} if caps.get("outcome") else {}),
        },
        "tracks": {k: {"label": t["label"], "keys": t["keys"], "interp": t.get("interp", "smooth")} for k, t in d.get("tracks", {}).items()},
        "annotations": [{k: v for k, v in a.items() if k not in ("claims", "adjust", "note")} for a in d.get("annotations", [])],
        "camera": d.get("camera", {}),
        "playback": {k: v for k, v in d.get("playback", {}).items() if v is not None},
    }
    if m.slow_until_f is not None:
        out["slow_until_f"] = m.slow_until_f
    return out


def build(moments_path: Path, project_path: Path | None = None, name: str = "afl-breakdown") -> Path:
    data = M.load(moments_path)
    M.require_approved(data)
    errors, _warns, mf = M.check(data)
    if errors:
        raise ValueError("moments file has errors:\n  " + "\n  ".join(errors))
    clips = {c.id: c for c in mf.clips}
    kept = [m for m in mf.moments if m.status == "keep"]
    project_path = project_path or paths.PROJECTS / f"{name}.json"

    scene_clips, audio_clips, cues = [], [], []
    t = 0.0
    frames_total = 0
    for i, m in enumerate(kept, 1):
        c = clips[m.clip]
        sm = scene_moment(m)
        if m.voice:
            vp = paths.ROOT / m.voice
            if not vp.is_file():
                raise FileNotFoundError(f"moment {m.id}: voice file missing: {m.voice}")
            sm["voice_s"] = round(media_seconds(vp), 3)
        clip_meta = {"fps": c.fps, "frames": c.frames, "width": c.width, "height": c.height, "placeholder": c.placeholder}
        p = node("plan", {"clip": clip_meta, "moments": [sm], "fps": OUT_FPS, "timing": {}})
        n = p["frames"]
        start = frames_total / OUT_FPS
        s = c.source
        credit = ("Placeholder clip — synthetic, not real footage" if c.placeholder else
                  " · ".join(x for x in [f"Footage: {s.broadcaster}" if s.broadcaster else "Footage", s.competition, s.match, s.date] if x))
        scene_clips.append({
            "id": f"bd-{m.id}", "type": "scene.footy-breakdown", "name": m.title, "layer": 1,
            "start": round(start, 6), "duration": round(n / OUT_FPS, 6), "src": c.proxy,
            "props": {"clip": clip_meta, "moments": [sm], "index": i, "series": mf.series, "credit": credit},
        })
        rec = p["moments"][0]
        if mf.audio.freeze_tick:
            cues.append({"t": round((frames_total + rec["freeze0"]) / OUT_FPS, 6), "sound": "tick", "gain_db": -16})
        if mf.audio.footage and c.audio and c.audio_file:
            for seg in p["segments"]:
                if seg["kind"] in ("play", "resume") and seg["rate"] == 1 and seg["out1"] > seg["out0"]:
                    audio_clips.append({
                        "id": f"fa-{m.id}-{seg['out0']}", "type": "audio", "layer": 2,
                        "start": round((frames_total + seg["out0"]) / OUT_FPS, 6), "duration": round((seg["out1"] - seg["out0"]) / OUT_FPS, 6),
                        "src": c.audio_file, "source_start": round(seg["src0"] / c.fps, 6),
                        "props": {"gain_db": mf.audio.footage_gain_db, "fade_in": 0.06, "fade_out": 0.12, "duck_music": True},
                    })
        if m.voice:
            audio_clips.append({
                "id": f"vo-{m.id}", "type": "audio", "layer": 2, "start": round((frames_total + rec["voice0"]) / OUT_FPS, 6),
                "duration": sm["voice_s"], "src": m.voice, "props": {"gain_db": 0, "fade_in": 0.02, "fade_out": 0.05, "duck_music": True},
            })
        frames_total += n
        t = frames_total / OUT_FPS

    duration = round(frames_total / OUT_FPS, 6)
    links = [CATEGORY_LINK.get(m.category or "", m.category or m.id) for m in kept]
    chrome = [
        {"id": "nav", "type": "nav-bar", "layer": 0, "start": 0, "duration": duration,
         "props": {"brand": mf.brand, "links": links}},
        {"id": "footer", "type": "footer-bar", "layer": 0, "start": 0, "duration": duration,
         "props": {"left": mf.title, "right": "Coach's review"}},
    ]
    sources = []
    for c in mf.clips:
        s = c.source
        sources.append({"clip": c.id, "placeholder": c.placeholder, "kind": s.kind, "url": s.url, "file": s.file,
                        "proxy": c.proxy, "competition": s.competition, "match": s.match, "date": s.date,
                        "broadcaster": s.broadcaster, "time_range": {"in": s.time_range.in_, "out": s.time_range.out},
                        "rights": s.rights, "notes": s.notes})
    project = {
        "schema": "vidkit.project", "version": 1, "name": name,
        "settings": {"width": 1920, "height": 1080, "fps": OUT_FPS, "bpm": None, "subdivision": 1, "beat_offset": 0,
                     "beat_lock": False, "duration": duration, "background": "paper", "style": "neo-brutal"},
        "tracks": [{"index": 0, "name": "Chrome"}, {"index": 1, "name": "Breakdown"}, {"index": 2, "name": "Audio"}],
        "clips": chrome + scene_clips + audio_clips,
        "audio": {"music": ({"preset": mf.audio.music, "seed": 3, "gain_db": mf.audio.music_gain_db, "end_hit": False} if mf.audio.music else None),
                  "auto_sfx": False, "sfx_gain_db": 0, "target_lufs": -14, "cues": cues},
        "meta": {"generator": "studio.footy build", "moments_file": paths.rel(moments_path),
                 "approval": data["review"], "sources": sources,
                 "placeholder": any(c.placeholder for c in mf.clips),
                 "note": "Footage sources and time ranges are logged in meta.sources: check rights before posting."},
    }
    schema.validate(project)
    errs = jsbridge.validate_props(project)
    if errs:
        raise ValueError("props invalid:\n  " + "\n  ".join(errs))
    project_path.parent.mkdir(parents=True, exist_ok=True)
    project_path.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return project_path
