"""Episode → vidkit project (1080×1920, 30 fps): a DAY card, the kept moments in order, and
the full-time card, all `scene.afl-daily` clips over the episode's frame-exact proxies.

A draft build is allowed any time and every frame says DRAFT. `final=True` refuses unless
the episode is approved and unchanged since (review.py).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .. import jsbridge, paths, schema
from . import cut, review
from . import episode as E

FPS = 30
DAY_S = 2.6
ZOOM = 1.2
QUESTION = "Can the AI beat me yet?"


def _points(score: dict | None, side: str | None):
    if not score or not side:
        return None
    return score.get(f"{side}_points")


def _words(*texts) -> int:
    return sum(len(re.findall(r"[\w'’()-]+", t or "")) for t in texts)


def close_seconds(c: dict) -> float:
    """Lines land 0.5 s apart; then the whole card gets reading time (1 s + 0.26 s a word)."""
    lines = [c.get(k) for k in ("head", "result", "could", "couldnt", "next") if c.get(k)]
    return round(max(4.0, 0.5 * (len(lines) - 1) + 1.0 + 0.26 * _words(*lines)), 2)


def build(path: Path, final: bool = False, name: str | None = None) -> Path:
    ep = E.load(path)
    if final:
        review.require_approved(ep)
    if ep.get("day") is None:
        raise ValueError("set the day number first: python -m studio.daily day <episode> N")
    kept = sorted([m for m in ep["moments"] if m["status"] == "keep"], key=lambda m: m["order"])
    if not kept:
        raise ValueError("no moments kept: run `daily cut` first")
    missing = [m["id"] for m in kept if not (m.get("caption") or "").strip()]
    if missing:
        raise ValueError(f"no caption for {', '.join(missing)}: run `daily captions` or write them")
    clips = {c["id"]: c for c in ep["clips"]}
    me, ai = ep["sides"].get("me"), ep["sides"].get("ai")
    draft = not review.is_approved(ep)
    name = name or f"afl-daily-day{int(ep['day']):03d}"

    out_clips, t = [], 0
    first, last = kept[0], kept[-1]

    def add(cid: str, src: str, frames: int, props: dict):
        nonlocal t
        out_clips.append({"id": cid, "type": "scene.afl-daily", "layer": 1, "start": round(t / FPS, 6),
                          "duration": round(frames / FPS, 6), "src": src, "props": {**props, "draft": draft}})
        t += frames

    c0 = clips[first["clip"]]
    clipmeta = lambda c: {"fps": c["fps"], "frames": c["frames"], "width": c["width"], "height": c["height"]}
    add("day", c0["proxy"], round(DAY_S * FPS), {"mode": "day", "clip": clipmeta(c0), "frame": first["in_f"],
                                                   "day": int(ep["day"]), "question": QUESTION, "zoom": ZOOM})
    for m in kept:
        c = clips[m["clip"]]
        fmap = cut.frame_map(m)
        ev = next((i for i, f in enumerate(fmap) if f >= m["event_f"]), -1)
        sf = m.get("score_f") if m.get("score_f") is not None else m["event_f"]
        at_n = next((i for i, f in enumerate(fmap) if f >= sf), -1) if m.get("type") in ("goal", "behind") else -1
        sb, sa = m.get("score_before"), m.get("score_after")
        score = {}
        if me and ai and sb and sa:
            score = {"before": {"me": _points(sb, me), "ai": _points(sb, ai)},
                     "after": {"me": _points(sa, me), "ai": _points(sa, ai)}, "at_n": at_n}
        add(f"moment-{m['id']}", c["proxy"], len(fmap), {
            "mode": "moment", "clip": clipmeta(c), "map": fmap, "day": int(ep["day"]), "caption": m["caption"],
            "kind": m.get("type") or "", "quarter": int(m.get("quarter") or 0), "score": score, "event_n": ev, "zoom": ZOOM,
        })
    cl = clips[last["clip"]]
    close = {k: (ep.get("closing") or {}).get(k) for k in ("head", "result", "could", "couldnt", "next")}
    add("close", cl["proxy"], round(close_seconds(close) * FPS), {"mode": "close", "clip": clipmeta(cl),
                                                                    "frame": cut.frame_map(last)[-1], "close": close, "zoom": ZOOM})

    duration = round(t / FPS, 6)
    music = ep.get("music") or None
    audio_clips = []
    if music and music.get("confirmed") and music.get("file"):
        audio_clips.append({"id": "music", "type": "audio", "layer": 2, "start": 0, "duration": duration,
                            "src": music["file"], "source_start": float(music.get("start_s") or 0),
                            "props": {"gain_db": float(music.get("gain_db") or 0), "fade_in": 0.3, "fade_out": 1.0, "duck_music": False}})
    project = {
        "schema": "vidkit.project", "version": 1, "name": name,
        "settings": {"width": 1080, "height": 1920, "fps": FPS, "bpm": None, "subdivision": 1, "beat_offset": 0,
                     "beat_lock": False, "duration": duration, "background": "paper", "style": "neo-brutal"},
        "tracks": [{"index": 1, "name": "Episode"}, {"index": 2, "name": "Music"}],
        "clips": out_clips + audio_clips,
        "audio": {"music": None, "auto_sfx": False, "sfx_gain_db": 0, "target_lufs": -14, "cues": []},
        "meta": {"generator": "studio.daily build", "episode": paths.rel(path), "draft": draft,
                 "approval": ep.get("review"), "day": ep["day"], "music": music,
                 "source": {"folder": ep["source"]["folder"], "exported_at": ep["source"].get("exported_at"), "kind": ep["source"]["kind"]},
                 "note": "Nothing in this pipeline posts or uploads. Check the music licence before posting."},
    }
    schema.validate(project)
    errs = jsbridge.validate_props(project)
    if errs:
        raise ValueError("props invalid:\n  " + "\n  ".join(errs))
    out = paths.PROJECTS / f"{name}.json"
    out.write_text(json.dumps(project, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return out
