"""Style-pack helpers on the optional local model.

    suggest_style(script, packs) -> {"available", "style", "reason", "alternates"}
    kinetic_copy(text, beats)    -> {"available", "lines": [{"text", "beats", "emphasis"}]}

Output is JSON data only, constrained by a schema, then validated here (pack ids
must be installed, every word count and beat total must add up). When the model
is missing the result says so ({"available": False}) and the editor hides the
feature — there is no fake fallback that pretends to read the mood.
"""
from __future__ import annotations

import re

from . import client


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}


def suggest_style(script: str, packs: list[dict]) -> dict:
    st = client.status()
    if not st["available"]:
        return _unavailable(st["reason"])
    script = script.strip()
    if not script:
        return {"available": True, "error": "empty script"}
    ids = [p["id"] for p in packs if p["id"] != "neo-brutal"] + ["neo-brutal"]
    listing = "\n".join(f"- {p['id']}: {p.get('label', p['id'])} — {p.get('description', '')}" for p in packs)
    schema = {
        "type": "object", "additionalProperties": False, "required": ["style", "reason", "alternates"],
        "properties": {
            "style": {"enum": ids},
            "reason": {"type": "string", "maxLength": 200},
            "alternates": {"type": "array", "maxItems": 2, "items": {"enum": ids}},
        },
    }
    prompt = ("Pick the animation style pack that best fits the mood and subject of this script. "
              "Explain in one plain sentence. Offer up to two alternates.\n\nStyle packs:\n"
              f"{listing}\n\nSCRIPT:\n{script[:3000]}")
    try:
        data = client.generate_json(prompt, schema, max_tokens=200)
    except Exception as e:
        return _unavailable(f"model failed: {e}")
    if data.get("style") not in ids:
        return {"available": True, "error": "model chose an unknown style"}
    data["alternates"] = [a for a in data.get("alternates", []) if a in ids and a != data["style"]][:2]
    return {"available": True, **data}


def kinetic_copy(text: str, beats: int = 8) -> dict:
    """Rewrite copy into short beat-sized lines for kinetic typography."""
    st = client.status()
    if not st["available"]:
        return _unavailable(st["reason"])
    text = text.strip()
    if not text:
        return {"available": True, "error": "empty text"}
    beats = max(2, min(64, int(beats)))
    schema = {
        "type": "object", "additionalProperties": False, "required": ["lines"],
        "properties": {"lines": {"type": "array", "minItems": 1, "maxItems": 16, "items": {
            "type": "object", "additionalProperties": False, "required": ["text", "beats", "emphasis"],
            "properties": {
                "text": {"type": "string", "maxLength": 40},
                "beats": {"type": "integer", "minimum": 1, "maximum": 8},
                "emphasis": {"type": "string", "maxLength": 24},
            }}}},
    }
    prompt = (f"Rewrite this copy for kinetic typography across exactly {beats} beats. Lines of 1-4 words, "
              "sentence case (never all caps), keep the meaning, no new claims or numbers. For each line give how many "
              "beats it holds and the one word to emphasise (must appear in the line).\n\nCOPY:\n" + text[:1200])
    try:
        data = client.generate_json(prompt, schema, max_tokens=500)
    except Exception as e:
        return _unavailable(f"model failed: {e}")
    lines = []
    for ln in data["lines"]:
        t = ln["text"].strip()
        letters = re.sub(r"[^A-Za-z]", "", t)
        if len(letters) > 3 and letters.isupper():
            t = t.capitalize()
        emph = ln["emphasis"] if ln["emphasis"].lower() in t.lower() else (t.split()[-1] if t.split() else "")
        lines.append({"text": t, "beats": ln["beats"], "emphasis": emph})
    total = sum(ln["beats"] for ln in lines)
    if total != beats and lines:
        lines[-1]["beats"] = max(1, lines[-1]["beats"] + beats - total)
    return {"available": True, "lines": lines}
