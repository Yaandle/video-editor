"""Project schema v1 — the single source of truth for project.json.

    python -m studio.schema validate projects/showcase.json
    python -m studio.schema migrate  projects/old.vkit      (writes old.json beside it)
    python -m studio.schema json-schema > project.schema.json

The envelope is validated here (pydantic, extra fields forbidden). Per-type
`props` are validated by the renderer registry (studio.jsbridge) so the one file
that defines a clip type also defines its props.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

PRESETS = Literal["snappy", "slam", "soft", "quick", "wobble"]
SOUNDS = Literal["kick", "snare", "clap", "hat", "tick", "click", "pop", "whoosh", "riser", "impact", "subdrop"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Settings(Strict):
    width: int = Field(1920, ge=16, le=7680)
    height: int = Field(1080, ge=16, le=7680)
    fps: int = Field(30, ge=1, le=120)
    bpm: Optional[float] = Field(120, gt=0, le=400)
    subdivision: int = Field(1, ge=1, le=16)
    beat_offset: float = 0.0
    beat_lock: bool = True
    duration: float = Field(..., gt=0, le=36000)
    background: str = "paper"
    style_pack: str = "neo-brutal"

    @model_validator(mode="after")
    def whole_frames(self):
        if self.bpm:
            fps_step = 60.0 / self.bpm / self.subdivision * self.fps
            if abs(fps_step - round(fps_step)) > 1e-6:
                good = [b for b in range(60, 181) if abs((60 / b / self.subdivision * self.fps) % 1) < 1e-9
                        or abs((60 / b / self.subdivision * self.fps) % 1 - 1) < 1e-9]
                raise ValueError(
                    f"{self.bpm} BPM / {self.subdivision} at {self.fps} fps gives {fps_step:.3f} frames per grid step; "
                    f"it must be a whole number so every grid line is a frame. Try one of: {good[:10]}")
        return self


class Track(Strict):
    index: int = Field(..., ge=0)
    name: Optional[str] = None
    hidden: bool = False
    muted: bool = False
    locked: bool = False


class Enter(Strict):
    preset: PRESETS = "snappy"
    from_: Literal["none", "rise", "drop", "left", "right", "scale", "fade"] = Field("rise", alias="from")
    delay: float = 0.0
    distance: Optional[float] = None
    rotate: Optional[float] = None
    hit: bool = False
    sfx: bool = True


class Exit(Strict):
    preset: PRESETS = "quick"
    to: Literal["none", "rise", "drop", "left", "right", "scale", "fade"] = "drop"
    length: float = Field(0.4, gt=0, le=10)
    distance: Optional[float] = None


class Crop(Strict):
    x: float = Field(0, ge=0, le=1)
    y: float = Field(0, ge=0, le=1)
    w: float = Field(1, gt=0, le=1)
    h: float = Field(1, gt=0, le=1)


class Keyframe(Strict):
    t: float = Field(..., ge=0, le=1)
    x: float
    y: float
    scale: Optional[float] = Field(None, gt=0, le=20)


class Clip(Strict):
    id: str = Field(..., pattern=r"^[A-Za-z0-9_.\-]{1,64}$")
    type: str = Field(..., min_length=1)
    name: Optional[str] = None
    layer: int = Field(0, ge=0, le=999)
    start: float = Field(..., ge=0)
    duration: float = Field(..., gt=0)
    x: float = 0.5
    y: float = 0.5
    scale_x: float = Field(1.0, gt=0, le=40)
    scale_y: float = Field(1.0, gt=0, le=40)
    rotation: float = 0.0
    opacity: float = Field(1.0, ge=0, le=1)
    crop: Optional[Crop] = None
    keyframes: list[Keyframe] = Field(default_factory=list)
    keyframe_mode: Literal["spring", "linear"] = "spring"
    enter: Optional[Enter] = None
    exit: Optional[Exit] = None
    src: Optional[str] = None
    source_start: float = Field(0.0, ge=0)
    speed: float = Field(1.0, ge=0.1, le=8)
    props: dict = Field(default_factory=dict)

    @field_validator("src")
    @classmethod
    def relative_src(cls, v):
        if v and (re.match(r"^[A-Za-z]:", v) or v.startswith("\\\\")):
            raise ValueError("src must be project-relative (e.g. media/uploads/clip.mp4), not an absolute path")
        return v


class Cue(Strict):
    t: float = Field(..., ge=0)
    sound: SOUNDS
    gain_db: float = Field(-6, ge=-60, le=12)
    length: Optional[float] = Field(None, gt=0, le=10)
    ends_at: Optional[float] = None
    pitch: Optional[float] = None


class Music(Strict):
    preset: Literal["brutal-bounce"] = "brutal-bounce"
    seed: int = 7
    gain_db: float = Field(-2, ge=-60, le=12)
    end_hit: bool = True


class Audio(Strict):
    music: Optional[Music] = None
    auto_sfx: bool = True
    sfx_gain_db: float = Field(0, ge=-60, le=12)
    target_lufs: float = Field(-14, ge=-30, le=-6)
    cues: list[Cue] = Field(default_factory=list)


class Project(Strict):
    schema_: Literal["vidkit.project"] = Field("vidkit.project", alias="schema")
    version: Literal[1] = 1
    name: str = Field(..., min_length=1, max_length=120)
    settings: Settings
    tracks: list[Track] = Field(default_factory=list)
    clips: list[Clip] = Field(default_factory=list)
    audio: Audio = Field(default_factory=Audio)
    meta: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_ids(self):
        seen = set()
        for c in self.clips:
            if c.id in seen:
                raise ValueError(f"duplicate clip id '{c.id}'")
            seen.add(c.id)
        return self


def format_errors(e: ValidationError) -> list[str]:
    out = []
    for err in e.errors():
        loc = ".".join(str(p) for p in err["loc"])
        out.append(f"{loc}: {err['msg']}")
    return out


def validate(data: dict) -> dict:
    """Validated, normalized project dict (raises ValueError with readable lines)."""
    try:
        p = Project.model_validate(data)
    except ValidationError as e:
        raise ValueError("project.json is invalid:\n  " + "\n  ".join(format_errors(e))) from None
    return p.model_dump(by_alias=True, mode="json")


def json_schema() -> dict:
    return Project.model_json_schema(by_alias=True)


# ── v0 (.vkit) migration ──────────────────────────────────────────────────────

_ANIM_V0 = {
    "typewriter": dict(anim_from="type", anim_unit="char"),
    "wordblurin": dict(anim_from="rise", anim_unit="word", anim_preset="soft"),
    "wordblur": dict(anim_from="rise", anim_unit="word", anim_preset="soft"),
    "linescan": dict(anim_from="left", anim_unit="line", anim_preset="snappy"),
    "fade": dict(anim_from="rise", anim_unit="block", anim_preset="soft"),
    "slideup": dict(anim_from="rise", anim_unit="block", anim_preset="snappy"),
    "scalepop": dict(anim_from="scale", anim_unit="block", anim_preset="slam"),
    "charstagger": dict(anim_from="rise", anim_unit="char", anim_preset="snappy"),
    "glitch": dict(anim_from="tilt", anim_unit="word", anim_preset="slam"),
}
_TRANS_IN = {"fade": "fade", "slide_up": "rise", "slide_down": "drop", "slide_left": "right", "slide_right": "left", "scale_pop": "scale"}
_TRANS_OUT = {"fade": "fade", "slide_up": "rise", "slide_down": "drop", "slide_left": "left", "slide_right": "right", "scale_pop": "scale"}


def _media_src(url: str | None) -> str | None:
    if not url:
        return None
    rel = url.lstrip("/")
    if rel.startswith("media/") and not rel.startswith("media/uploads/"):
        rel = "media/uploads/" + rel[len("media/"):]
    if rel.startswith("sfx/"):
        rel = "legacy/backend/sfx/" + rel[len("sfx/"):]
    return rel


def migrate_v0(old: dict, name: str | None = None) -> dict:
    notes: list[str] = []
    w, h = int(old.get("canvas_w", 1080)), int(old.get("canvas_h", 1920))
    clips = []
    dur = float(old.get("duration", 30))
    for c in old.get("clips", []):
        ct = c.get("clip_type")
        base = {
            "id": re.sub(r"[^A-Za-z0-9_.\-]", "_", str(c.get("id") or f"c{len(clips)}"))[:64],
            "layer": int(c.get("layer", 0) or 0),
            "start": max(0.0, float(c.get("start", 0))),
            "duration": max(0.04, float(c.get("duration", 5))),
            "x": float(c.get("x", 0.5)), "y": float(c.get("y", 0.5)),
            "scale_x": float(c.get("scale_x", c.get("scale", 1.0)) or 1.0),
            "scale_y": float(c.get("scale_y", c.get("scale", 1.0)) or 1.0),
            "rotation": float(c.get("rotation", 0) or 0),
        }
        kf = c.get("motion_keyframes") or []
        if isinstance(kf, list) and len(kf) >= 2:
            base["keyframes"] = [{"t": max(0, min(1, float(k.get("t", 0)))), "x": float(k.get("x", 0.5)), "y": float(k.get("y", 0.5)),
                                  **({"scale": float(k["scale"])} if k.get("scale") else {})} for k in kf]
            base["keyframe_mode"] = "linear"      # v0 interpolated linearly; keep the look
        ti, to = c.get("transition_in"), c.get("transition_out")
        if ti in _TRANS_IN:
            base["enter"] = {"preset": "snappy", "from": _TRANS_IN[ti]}
        if to in _TRANS_OUT:
            base["exit"] = {"preset": "quick", "to": _TRANS_OUT[to], "length": max(0.05, (c.get("transition_out_ms") or 500) / 1000)}
        if ct == "narration":
            fam = str(c.get("text_font_family") or "").lower()
            font = "mono" if ("mono" in fam or "consola" in fam or "courier" in fam) else "display" if "archivo black" in fam or "bebas" in fam else "body"
            props = {
                "text": c.get("content", ""), "style": "custom", "role": "body", "font": font,
                "size_px": int(c.get("font_size") or round(w / 18)),
                "color": c.get("font_color") or "#e6edf3", "align": c.get("text_align") or "center",
                "width": max(0.05, min(1.0, 0.88 * base["scale_x"])),
                "case": "upper" if c.get("text_uppercase") else "as-typed",
                "anim_delay": float(c.get("text_delay_ms") or 0) / 1000, "hit": False,
                "exit_to": "none", "anim_from": "none", "plate": "none",
            }
            if c.get("font_bold"):
                props["weight"] = 700
            props.update(_ANIM_V0.get(c.get("text_anim_style") or "", {}))
            if c.get("text_plate"):
                props["plate"] = "box"
                props["plate_fill"] = c["text_plate"].get("color", "ink")
            if c.get("text_stroke") and c["text_stroke"].get("width"):
                props["outline"] = float(c["text_stroke"]["width"])
                props["outline_color"] = c["text_stroke"].get("color", "ink")
            if c.get("text_shadow"):
                props["hard_shadow"] = True
                if c["text_shadow"].get("blur"):
                    notes.append(f"{base['id']}: blurred text shadow became a hard offset shadow")
            if c.get("text_glow"):
                notes.append(f"{base['id']}: text glow dropped (design rules: no glow)")
            base["opacity"] = max(0.0, min(1.0, float(c.get("text_opacity", 1.0) or 1.0)))
            clips.append({**base, "type": "text", "props": props})
        elif ct == "code":
            clips.append({**base, "type": "code", "props": {
                "code": c.get("content", ""), "title": c.get("terminal_title") or "",
                "theme": "paper" if c.get("theme") in ("light", "simple") else "ink",
                "typewriter": (c.get("animation") or "typewriter") == "typewriter"}})
        elif ct == "graph":
            clips.append({**base, "type": "graph", "props": {"data": c.get("graph_data", ""), "chart": c.get("graph_type", "bar")
                                                             if c.get("graph_type") in ("bar", "line") else "bar"}})
        elif ct in ("image", "video", "audio"):
            src = _media_src(c.get("code_file") or c.get("src"))
            if not src:
                notes.append(f"{base['id']}: {ct} clip without a file was dropped")
                continue
            crop = {k: float(c.get(f"crop_{k}", d)) for k, d in (("x", 0), ("y", 0), ("w", 1), ("h", 1))}
            extra = {"src": src}
            if ct != "audio" and crop != {"x": 0, "y": 0, "w": 1, "h": 1}:
                extra["crop"] = crop
            if ct in ("video", "audio"):
                extra["source_start"] = float(c.get("source_start", 0) or 0)
            if ct == "video":
                extra["speed"] = max(0.1, min(8.0, float(c.get("speed", 1) or 1)))
            props = {} if ct == "audio" else {"fit": "contain", "frame": "none"}
            clips.append({**base, "type": ct, **extra, "props": props})
        elif ct == "shape":
            kind = c.get("shape_kind", "rectangle")
            clips.append({**base, "type": "shape", "opacity": max(0.0, min(1.0, float(c.get("opacity", 1) or 1))), "props": {
                "kind": kind if kind in ("rectangle", "circle", "triangle", "polygon", "star", "line", "arrow") else "rectangle",
                "size": 200, "fill": c.get("fill", "#FFFFFF"), "stroke": c.get("stroke_color", "#000000"),
                "stroke_width": float(c.get("stroke_width", 0) or 0), "shadow": False,
                "sides": max(3, min(16, int(c.get("sides", 6) or 6))), "points": max(2, min(24, int(c.get("points", 5) or 5))),
                "inner_ratio": max(0.1, min(0.95, float(c.get("inner_radius_ratio", 0.5) or 0.5)))}})
        else:
            notes.append(f"{base['id']}: unknown clip type '{ct}' dropped")
    layers = sorted({c["layer"] for c in clips} | set(old.get("hidden_layers", [])))
    tracks = [{"index": i, "name": f"L{i + 1}", "hidden": i in set(old.get("hidden_layers", []))} for i in layers]
    end = max([c["start"] + c["duration"] for c in clips] + [0.1])
    return {
        "schema": "vidkit.project", "version": 1, "name": name or old.get("name") or "untitled",
        "settings": {"width": w, "height": h, "fps": int(old.get("fps", 30)), "bpm": None, "subdivision": 1, "beat_offset": 0,
                     "beat_lock": False, "duration": max(dur if dur > 0 else end, 0.1), "background": old.get("background_color") or "#000000",
                     "style_pack": "neo-brutal"},
        "tracks": tracks, "clips": clips,
        "audio": {"music": None, "auto_sfx": False, "sfx_gain_db": 0, "target_lufs": -14, "cues": []},
        "meta": {"migrated_from": "vkit-v0", "migrated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "migration_notes": notes},
    }


def load(path: Path) -> dict:
    """Load .json (v1) or .vkit (v0, migrated in memory) and validate."""
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if path.suffix.lower() == ".vkit" or "clips" in data and "settings" not in data:
        data = migrate_v0(data, name=path.stem)
    return validate(data)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.schema")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("path")
    m = sub.add_parser("migrate"); m.add_argument("path")
    sub.add_parser("json-schema")
    a = ap.parse_args(argv)
    if a.cmd == "json-schema":
        print(json.dumps(json_schema(), indent=2))
        return 0
    try:
        data = load(Path(a.path))
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    if a.cmd == "migrate":
        out = Path(a.path).with_suffix(".json")
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {out}")
        for n in data["meta"].get("migration_notes", []):
            print(f"  note: {n}")
        return 0
    from . import jsbridge
    errs = jsbridge.validate_props(data)
    if errs:
        print("props invalid:\n  " + "\n  ".join(errs), file=sys.stderr)
        return 1
    print(f"ok: {a.path} — {len(data['clips'])} clips, {data['settings']['duration']} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
