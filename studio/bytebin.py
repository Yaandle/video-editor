"""Byte the Overclocked Raccoon: episode script -> voice lines -> timed project.

    python -m studio.bytebin media/bytebin/mon-sl/episode.json          # build projects/bytebin-<slug>.json
    render.bat projects\\bytebin-<slug>.json --preset vertical

The fixed identity lives in media/bytebin/style.json (voice, speed, music, sting, handle,
sign-off). An episode only carries its own script: one entry per voice line, each with the
words spoken (`vo`), the words shown (`cap`, defaults to vo) and, when the picture changes,
the `panel` that starts on that line (see frontend/renderer/scenes/bytebin.js).

Timing comes from the synthesised voice: each line is spoken to its own WAV, placed after
the previous one with a small gap, and its captions are split into chunks of a few words
timed by character share. The project length is rounded up to whole seconds so the
renderer's 1 s chunks concatenate without a second encode.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

from . import paths

STYLE = Path("media/bytebin/style.json")


def chunks(text: str, max_words: int) -> list[str]:
    """Split a caption line into phrases at punctuation, then each phrase into balanced chunks
    of at most `max_words` (7 words -> 4 + 3, not 4 + 2 + 1), so no chunk starts mid-thought."""
    phrases, cur = [], []
    for w in text.split():
        cur.append(w)
        if re.search(r"[.,:;!?]$", w):
            phrases.append(cur)
            cur = []
    if cur:
        phrases.append(cur)
    out = []
    for ph in phrases:
        k = math.ceil(len(ph) / max_words)
        base, extra = divmod(len(ph), k)
        i = 0
        for j in range(k):
            n = base + (1 if j < extra else 0)
            out.append(" ".join(ph[i:i + n]))
            i += n
    return out


def trim_silence(wav: Path, floor_db: float = -42.0, keep: float = 0.03) -> float:
    """Cut the TTS engine's leading/trailing silence (keeping `keep` s); returns the new length."""
    import numpy as np
    import soundfile as sf
    x, sr = sf.read(str(wav))
    mono = np.abs(x if x.ndim == 1 else x.mean(axis=1))
    loud = np.nonzero(mono > 10 ** (floor_db / 20))[0]
    if len(loud):
        a = max(0, loud[0] - int(keep * sr))
        b = min(len(x), loud[-1] + int(keep * sr))
        x = x[a:b]
        sf.write(str(wav), x, sr)
    return len(x) / sr


def build(ep_path: Path, synth_voice: bool = True) -> Path:
    root = paths.ROOT
    style = json.loads((root / STYLE).read_text(encoding="utf-8"))
    ep = json.loads((root / ep_path).read_text(encoding="utf-8")) if not ep_path.is_absolute() else json.loads(ep_path.read_text(encoding="utf-8"))
    slug = ep["slug"]
    vo_dir = Path("media/bytebin") / slug / "vo"
    voice = ep.get("voice", style["voice"]["id"])
    speed = ep.get("speed", style["voice"]["speed"])

    t = style["timing"]["lead_in"]
    clips_audio, beats, caps, cues = [], [], [], []
    for i, line in enumerate(ep["lines"]):
        wav = vo_dir / f"{i:02d}.wav"
        if synth_voice or not (root / wav).exists():
            from .audio import tts
            tts.synth(line["vo"], root / wav, voice=voice, speed=line.get("speed", speed))
            secs = trim_silence(root / wav)
        else:
            import soundfile as sf
            secs = sf.info(str(root / wav)).duration
        t0 = round(t, 3)
        t1 = round(t + secs, 3)
        clips_audio.append({"id": f"vo-{i:02d}", "type": "audio", "layer": 3, "start": t0, "duration": round(secs, 3),
                            "src": wav.as_posix(), "props": {"gain_db": 0, "fade_in": 0.01, "fade_out": 0.04, "duck_music": True}})
        if "panel" in line:
            if beats:
                beats[-1]["t1"] = t0
            beat = {"t0": 0.0 if not beats else t0, "t1": None, **line["panel"]}
            beats.append(beat)
            if len(beats) > 1:
                cues.append({"t": t0, "sound": "whoosh", "gain_db": style["sound"]["whoosh_db"]})
            beat["_line"] = i
            pnl = line["panel"]
            if pnl.get("type") and pnl.get("lines"):   # a key tick per typed character (mirrors typeTimeline in bytebin.js)
                cps = pnl.get("cps", 14)
                tt = 0.15
                for s in pnl["lines"]:
                    if s.startswith("$ "):
                        n_chars = len(s) - 2
                        for n in range(n_chars):
                            if cps <= 16 or n % 2 == 0:
                                cues.append({"t": round(t0 + tt + (n + 0.5) / cps, 3), "sound": "tick", "gain_db": style["sound"]["tick_db"]})
                        tt += n_chars / cps + 0.3
                    elif s:
                        tt += 0.1
        shown = line.get("cap", line["vo"])
        parts = chunks(shown, style["captions"]["max_words"])
        total = sum(len(p) + 2 for p in parts)
        acc = t0
        for p in parts:
            d = secs * (len(p) + 2) / total
            caps.append({"t0": round(acc, 3), "t1": round(acc + d, 3), "text": p})
            acc += d
        t = t1 + line.get("gap", style["timing"]["gap"])

    # "@n" in a panel's *_at key = when the n-th voice line after the panel's own line starts
    starts = [c["start"] for c in clips_audio]
    for beat in beats:
        li = beat.pop("_line")
        def ref(v):
            if isinstance(v, str) and v.startswith("@"):
                j = li + int(v[1:])
                return round(starts[j] - beat["t0"] + 0.05, 3) if j < len(starts) else 0.5
            return v
        for k, v in list(beat.items()):
            if k.endswith("_at"):
                beat[k] = [ref(x) for x in v] if isinstance(v, list) else ref(v)

    end = t - style["timing"]["gap"] + style["timing"]["tail"]
    # the sign-off needs: drop, lid shut, slab out, then a few frames of empty bin (= frame 0)
    so_t0 = beats[-1]["t0"]
    end = max(end, so_t0 + beats[-1].get("drop_at", style["signoff"]["drop_at"]) + 0.85)
    duration = float(math.ceil(end))
    beats[-1]["t1"] = duration
    caps[-1]["t1"] = round(min(duration, caps[-1]["t1"] + 0.4), 3)
    # the sting: impact under the hook claim, pop + sub drop as the lid shuts on the sign-off
    so = beats[-1]
    drop = so["t0"] + so.get("drop_at", style["signoff"]["drop_at"])
    so.setdefault("drop_at", style["signoff"]["drop_at"])
    so.setdefault("line", style["signoff"]["line"])
    so.setdefault("handle", style["handle"])
    cues += [{"t": 0.3, "sound": "impact", "gain_db": style["sound"]["sting_db"]},
             {"t": round(drop + 0.12, 3), "sound": "pop", "gain_db": style["sound"]["sting_db"]},
             {"t": round(drop + 0.16, 3), "sound": "subdrop", "gain_db": style["sound"]["sting_db"] - 4}]

    if not 20 <= duration <= 35:
        print(f"WARNING: {duration:.0f} s is outside the 20-35 s spec")

    project = {
        "schema": "vidkit.project", "version": 1, "name": f"bytebin-{slug}",
        "settings": {"width": 1080, "height": 1920, "fps": 30, "bpm": style["sound"]["bpm"], "subdivision": 1,
                     "beat_offset": 0, "beat_lock": False, "duration": duration, "background": "ink", "style": "neo-brutal"},
        "tracks": [{"index": 0, "name": "Episode", "hidden": False, "muted": False}],
        "clips": [{"id": "ep", "type": "scene.bytebin", "layer": 1, "start": 0.0, "duration": duration,
                   "props": {"pillar": ep["pillar"], "beats": beats, "captions": caps, "draft": ep.get("draft", True),
                             "theme": ep.get("theme", "night"), "handle": style["handle"] if ep.get("theme") == "paper" else ""}},
                  *clips_audio],
        "audio": {"music": {"preset": ep.get("music_preset", style["sound"]["music_preset"]), "seed": ep.get("music_seed", style["sound"]["seed"]),
                            "gain_db": style["sound"]["music_db"], "end_hit": False},
                  "auto_sfx": False, "sfx_gain_db": 0, "target_lufs": -14, "cues": sorted(cues, key=lambda c: c["t"])},
        "meta": {"series": "bytebin", "episode": str(ep_path), "voice": f"kokoro:{voice}@{speed}",
                 "ai_disclosure": "synthetic voice (Kokoro TTS)"},
    }
    out = root / "projects" / f"bytebin-{slug}.json"
    out.write_text(json.dumps(project, indent=2), encoding="utf-8")
    print(f"wrote {paths.rel(out)}: {duration:.0f} s, {len(ep['lines'])} lines, {len(beats)} panels, {len(caps)} caption chunks")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m studio.bytebin")
    ap.add_argument("episode")
    ap.add_argument("--reuse-voice", action="store_true", help="keep existing WAVs")
    a = ap.parse_args(argv)
    build(Path(a.episode), synth_voice=not a.reuse_voice)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
