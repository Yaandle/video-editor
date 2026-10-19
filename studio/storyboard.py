"""Script → storyboard → project. Deterministic; no model required.

Ported from text_to_video/main.py: the [VisualiseCode] / [VisualiseGraph] marker
parser, the h1/h2/body hierarchy heuristic and section timing — re-expressed as
scene clips on the beat grid. studio.llm.storyboard improves the copy and scene
choice when the local model is available, and falls back to this.
"""
from __future__ import annotations

import re

MARKERS = re.compile(r"(\[VisualiseCode(?::[^\]]+)?\].*?\[/VisualiseCode(?::[^\]]*)?\]|\[VisualiseGraph:[^\]]+\].*?\[/VisualiseGraph\])", re.S)
CODE = re.compile(r"\[VisualiseCode(?::([^\]]+))?\](.*?)\[/VisualiseCode(?::[^\]]*)?\]", re.S)
GRAPH = re.compile(r"\[VisualiseGraph:([^\]]+)\](.*?)\[/VisualiseGraph\]", re.S)


def parse_markers(prompt: str) -> list[dict]:
    """text_to_video.parse_prompt_with_markers, returning ordered sections."""
    sections, pos = [], 0
    for m in MARKERS.finditer(prompt):
        before = prompt[pos:m.start()].strip()
        if before:
            sections.append({"type": "text", "content": before})
        tok = m.group(0)
        if tok.startswith("[VisualiseCode"):
            cm = CODE.search(tok)
            mode = (cm.group(1) or "").strip().lower()
            sections.append({"type": "code", "content": cm.group(2).strip("\n"), "typewriter": mode not in ("0", "static")})
        else:
            gm = GRAPH.search(tok)
            parts = gm.group(1).lower().split("|")
            sections.append({"type": "graph", "chart": parts[0].strip() if parts[0].strip() in ("bar", "line") else "bar", "content": gm.group(2).strip()})
        pos = m.end()
    rest = prompt[pos:].strip()
    if rest:
        sections.append({"type": "text", "content": rest})
    return sections


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def break_headline(s: str, max_chars: int = 18) -> str:
    """Two balanced lines for a headline, left as typed (no forced caps)."""
    words = s.split()
    if len(s) <= max_chars or len(words) < 2:
        return s
    best, best_d = 1, 1e9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        d = abs(len(a) - len(b)) + (0 if len(a) <= max_chars * 1.4 else 50)
        if d < best_d:
            best, best_d = i, d
    return " ".join(words[:best]) + "\n" + " ".join(words[best:])


def to_scenes(script: str) -> list[dict]:
    """Ordered scene specs: {type, beats, props}."""
    scenes: list[dict] = []
    secs = parse_markers(script)
    first_text = True
    for sec in secs:
        if sec["type"] == "code":
            scenes.append({"type": "scene.statement", "beats": 4, "props": {"kicker": "Code", "headline": "Here is the code.", "deck": "", "size": "h1"}})
            scenes.append({"type": "code", "beats": 8, "props": {"code": sec["content"][:4000], "typewriter": sec["typewriter"], "title": "snippet"}})
        elif sec["type"] == "graph":
            scenes.append({"type": "graph", "beats": 8, "props": {"data": sec["content"], "chart": sec["chart"], "title": "The numbers"}})
        else:
            sents = sentences(sec["content"])
            if not sents:
                continue
            if first_text:
                head = sents[0]
                deck = " ".join(sents[1:3])
                scenes.append({"type": "scene.title-slam", "beats": 8, "props": {"headline": break_headline(head), "deck": deck[:200], "kicker": "Chapter 01"}})
                sents = sents[3:]
                first_text = False
            # short punchy sentences → statements; runs of medium lines → narrative
            run: list[str] = []
            for s in sents:
                wc = len(s.split())
                if wc <= 9 and len(s) <= 60:
                    if run:
                        scenes.append({"type": "scene.narrative", "beats": 2 * len(run), "props": {"text": "\n".join(run), "beats_per_line": 2}})
                        run = []
                    scenes.append({"type": "scene.statement", "beats": 8, "props": {"headline": break_headline(s), "deck": "", "kicker": f"Point {len(scenes):02d}"}})
                else:
                    run.append(s[:110])
            if run:
                scenes.append({"type": "scene.narrative", "beats": max(4, 2 * len(run)), "props": {"text": "\n".join(run), "beats_per_line": 2}})
    return scenes


def to_project(scenes: list[dict], name: str = "storyboard", width: int = 1920, height: int = 1080, fps: int = 30, bpm: int = 120) -> dict:
    beat = 60 / bpm
    clips, t = [], 0.0
    for i, sc in enumerate(scenes):
        dur = max(1, int(sc.get("beats", 8))) * beat
        is_scene = sc["type"].startswith("scene.")
        base = {"id": f"s{i + 1}", "type": sc["type"], "layer": 2, "start": round(t, 6), "duration": round(dur, 6), "props": sc.get("props", {})}
        if not is_scene:
            # components get a plain coloured backdrop scene underneath
            clips.append({"id": f"bg{i + 1}", "type": "scene.statement", "layer": 3, "start": round(t, 6), "duration": round(dur, 6),
                          "props": {"kicker": "", "headline": " ", "deck": "", "background": "paper"}})
            base.update(layer=1, x=0.5, y=0.55)
        clips.append(base)
        t += dur
    total = round(t, 6) or 4.0
    clips.insert(0, {"id": "nav", "type": "nav-bar", "layer": 0, "start": 0, "duration": total,
                     "props": {"links": [f"{k + 1:02d}" for k in range(min(6, len(scenes)))]}})
    clips.insert(1, {"id": "footer", "type": "footer-bar", "layer": 0, "start": 0, "duration": total,
                     "props": {"left": name, "right": f"{bpm} BPM — {fps} FPS"}})
    return {
        "schema": "vidkit.project", "version": 1, "name": name,
        "settings": {"width": width, "height": height, "fps": fps, "bpm": bpm, "subdivision": 1, "beat_offset": 0, "beat_lock": True,
                     "duration": total, "background": "paper", "style_pack": "neo-brutal"},
        "tracks": [{"index": i, "name": n} for i, n in enumerate(["Chrome", "Components", "Scenes", "Backdrops"])],
        "clips": clips,
        "audio": {"music": {"preset": "brutal-bounce", "seed": 11, "gain_db": -3, "end_hit": True}, "auto_sfx": True, "sfx_gain_db": 0, "target_lufs": -14, "cues": []},
        "meta": {"generator": "storyboard (deterministic)"},
    }
