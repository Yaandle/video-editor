"""LLM-assisted storyboard, headline variants, caption chunking, scene order.

Every function returns data validated against a schema; on any model problem it
falls back to the deterministic implementation and says so in `source`.
"""
from __future__ import annotations

import re

from .. import jsbridge, storyboard
from . import client

SCENES_FOR_LLM = ["scene.title-slam", "scene.statement", "scene.narrative", "scene.beat-grid", "scene.spring-lab",
                  "scene.editorial", "scene.render-queue", "scene.outro"]


def _catalogue_text() -> str:
    cat = {c["type"]: c for c in jsbridge.catalogue()}
    lines = []
    for t in SCENES_FOR_LLM:
        c = cat.get(t)
        if not c:
            continue
        props = ", ".join(f"{k} ({v.get('type', 'enum')})" for k, v in c["props"]["properties"].items()
                          if v.get("type") in ("string",) and k not in ("background", "image", "credit"))
        lines.append(f"- {t}: {c['description']} Text props: {props}")
    return "\n".join(lines)


def storyboard_schema() -> dict:
    return {
        "type": "object", "additionalProperties": False, "required": ["title", "scenes"],
        "properties": {
            "title": {"type": "string", "maxLength": 60},
            "scenes": {"type": "array", "minItems": 2, "maxItems": 12, "items": {
                "type": "object", "additionalProperties": False, "required": ["type", "beats", "props"],
                "properties": {
                    "type": {"enum": SCENES_FOR_LLM},
                    "beats": {"type": "integer", "minimum": 4, "maximum": 16},
                    "props": {"type": "object", "additionalProperties": {"type": "string", "maxLength": 220}},
                }}},
        },
    }


def _clean_props(scene_type: str, props: dict) -> tuple[dict, list[str]]:
    """Keep only props the registry accepts; strip anything shouty."""
    cat = {c["type"]: c for c in jsbridge.catalogue()}
    allowed = cat.get(scene_type, {}).get("props", {}).get("properties", {})
    out, notes = {}, []
    for k, v in props.items():
        if k not in allowed or allowed[k].get("type") != "string":
            notes.append(f"dropped {scene_type}.{k}")
            continue
        v = v.strip()
        letters = re.sub(r"[^A-Za-z]", "", v)
        if k in ("headline",) and len(letters) > 4 and letters.isupper():
            v = v.capitalize()
            notes.append(f"de-capitalised {scene_type}.headline")
        out[k] = v.replace("\\n", "\n")
    return out, notes


def make_storyboard(script: str, name: str = "storyboard", use_llm: bool = True) -> dict:
    fallback = {"source": "deterministic", "notes": []}
    st = client.status()
    if not use_llm or not st["available"]:
        scenes = storyboard.to_scenes(script)
        fallback["notes"].append("local model unavailable" if use_llm else "LLM disabled for this request")
        return {**fallback, "project": storyboard.to_project(scenes, name=name)}
    prompt = (f"Turn this script into a storyboard of 4–8 scenes for a 16:9 motion video at 120 BPM (2 beats = 1 second).\n"
              f"Use only these scene types:\n{_catalogue_text()}\n"
              "Headlines: max 2 short lines separated by \\n, sentence case, may wrap one key word in [[double brackets]] for a highlight. "
              "Kickers: 1–3 words. Start with scene.title-slam and end with scene.outro.\n\nSCRIPT:\n" + script[:4000])
    try:
        data = client.generate_json(prompt, storyboard_schema(), max_tokens=1600)
    except Exception as e:  # model missing, crashed, or produced bad JSON → deterministic path
        scenes = storyboard.to_scenes(script)
        return {"source": "deterministic", "notes": [f"LLM failed: {e}"], "project": storyboard.to_project(scenes, name=name)}
    scenes, notes = [], []
    for sc in data["scenes"]:
        props, n = _clean_props(sc["type"], sc.get("props", {}))
        notes += n
        scenes.append({"type": sc["type"], "beats": sc["beats"], "props": props})
    project = storyboard.to_project(scenes, name=data.get("title") or name)
    errors = jsbridge.validate_props(project)
    if errors:
        return {"source": "deterministic", "notes": [f"LLM output failed validation: {errors[:3]}"],
                "project": storyboard.to_project(storyboard.to_scenes(script), name=name)}
    return {"source": "llm", "notes": notes, "project": project}


def headline_variants(text: str, n: int = 5) -> dict:
    schema = {"type": "object", "additionalProperties": False, "required": ["variants"],
              "properties": {"variants": {"type": "array", "minItems": 3, "maxItems": 8, "items": {"type": "string", "maxLength": 60}}}}
    try:
        data = client.generate_json(f"Write {n} alternative headlines (max 7 words, sentence case, no all caps) for: {text}", schema, max_tokens=300)
        return {"source": "llm", "variants": [v for v in data["variants"] if not v.isupper()][:n]}
    except Exception as e:
        words = text.strip().rstrip(".").split()
        base = [text.strip(), " ".join(words[:5]) + ".", (" ".join(words[-4:]) + ".").capitalize()]
        return {"source": "deterministic", "variants": list(dict.fromkeys(base)), "note": str(e)}


def chunk_captions(text: str, max_words: int = 6) -> dict:
    """Split narration into caption chunks (deterministic: phrase breaks; LLM: semantic)."""
    schema = {"type": "object", "additionalProperties": False, "required": ["chunks"],
              "properties": {"chunks": {"type": "array", "items": {"type": "string", "maxLength": 60}}}}
    try:
        data = client.generate_json(f"Split into caption chunks of at most {max_words} words at natural phrase breaks. Keep every word, in order:\n{text}", schema, max_tokens=800)
        if " ".join(data["chunks"]).split() == text.split():
            return {"source": "llm", "chunks": data["chunks"]}
        raise ValueError("model changed the words")
    except Exception as e:
        words, chunks, cur = text.split(), [], []
        for w in words:
            cur.append(w)
            if len(cur) >= max_words or re.search(r"[.,;:!?]$", w):
                chunks.append(" ".join(cur))
                cur = []
        if cur:
            chunks.append(" ".join(cur))
        return {"source": "deterministic", "chunks": chunks, "note": str(e)}


def suggest_order(titles: list[str]) -> dict:
    schema = {"type": "object", "additionalProperties": False, "required": ["order"],
              "properties": {"order": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": max(0, len(titles) - 1)}}}}
    try:
        listing = "\n".join(f"{i}: {t}" for i, t in enumerate(titles))
        data = client.generate_json(f"Order these scenes for the clearest story (hook first, call to action last). Return indices.\n{listing}", schema, max_tokens=200)
        if sorted(data["order"]) == list(range(len(titles))):
            return {"source": "llm", "order": data["order"]}
        raise ValueError("not a permutation")
    except Exception as e:
        return {"source": "deterministic", "order": list(range(len(titles))), "note": str(e)}
