"""T5: check a rendered episode the way a phone viewer would meet it.

  - length 20–45 s; 1080×1920 at 30 fps
  - audio: a stream is present, about −14 LUFS, and no silent stretch longer than 1 s
  - text, from the renderer's own per-frame report (frames.jsonl): captions and card lines
    are 48 px or larger, contrast at least 4.5:1, on screen for their reading time
    (1 s + 0.26 s a word), and inside the safe area, with nothing under the app's
    right-hand button column (x > 940 between y 900 and 1550)
  - A/V drift of one frame at most

Returns a dict with `checks` (name, ok, detail) and `ok`.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

from .. import config, paths
from ..render import ffmpeg as ff

LENGTH = (20.0, 45.0)
MIN_CAPTION_PX = 48
MIN_CONTRAST = 4.5
SAFE = {"x0": 60, "x1": 1020, "y0": 200, "y1": 1500}
RAIL = {"x": 940, "y0": 900, "y1": 1550}
READ_BASE, READ_PER_WORD = 1.0, 0.26
CAPTION_NAMES = ("caption", "series-line", "close-result", "close-could", "close-couldnt")


def _lum(hex_: str) -> float:
    h = hex_.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def silent_stretches(mp4: Path, thr_db: float = -50.0, win: float = 0.1) -> list[tuple[float, float]]:
    r = subprocess.run([config.ffmpeg(), "-v", "error", "-i", str(mp4), "-map", "0:a:0", "-ac", "1", "-ar", "8000",
                        "-f", "s16le", "-"], capture_output=True, env=config.subprocess_env())
    if r.returncode != 0 or not r.stdout:
        return [(0.0, float("inf"))]
    x = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768
    n = int(8000 * win)
    k = len(x) // n
    if k == 0:
        return [(0.0, len(x) / 8000)]
    rms = np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12)
    quiet = 20 * np.log10(rms) < thr_db
    out, start = [], None
    for i, q in enumerate(list(quiet) + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * win > 1.0:
                out.append((round(start * win, 2), round(i * win, 2)))
            start = None
    return out


def verify(mp4: Path) -> dict:
    mp4 = Path(mp4)
    checks = []

    def add(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    p = ff.probe(mp4)
    v = next(s for s in p["streams"] if s["codec_type"] == "video")
    a = next((s for s in p["streams"] if s["codec_type"] == "audio"), None)
    dur = float(p["format"]["duration"])
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    fps = num / den
    add("length", LENGTH[0] <= dur <= LENGTH[1], f"{dur:.2f} s (want {LENGTH[0]:.0f}–{LENGTH[1]:.0f})")
    add("resolution", (v["width"], v["height"]) == (1080, 1920), f"{v['width']}×{v['height']}")
    add("frame rate", abs(fps - 30) < 1e-3, f"{fps:g} fps")

    rep_path = mp4.with_suffix(".report.json")
    rep = json.loads(rep_path.read_text(encoding="utf-8")) if rep_path.is_file() else {}
    if a is None:
        add("audio present", False, "no audio stream")
    else:
        sil = silent_stretches(mp4)
        lufs = ((rep.get("audio") or {}).get("final") or {}).get("integrated_lufs")
        add("audio present", not sil, "no silent stretch over 1 s" if not sil else f"silent: {sil[:4]}{' …' if len(sil) > 4 else ''}")
        add("loudness", lufs is not None and lufs > -70 and abs(lufs + 14) <= 1.0, f"{lufs} LUFS (want −14 ±1)")
    drift = rep.get("av_drift_s")
    if drift is not None:
        add("A/V drift", abs(drift) <= 1 / 30 + 1e-6, f"{drift * 1000:.1f} ms")

    jl = mp4.with_suffix(".frames.jsonl")
    if not jl.is_file():
        add("text report", False, f"missing {jl.name}")
    else:
        shown: dict[str, int] = {}
        small, low, unsafe, rail = set(), set(), set(), set()
        for line in jl.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            for b in r["boxes"]:
                if b.get("kind") != "text" or b.get("name") not in CAPTION_NAMES:
                    continue
                txt = b.get("text", "")
                shown[txt] = shown.get(txt, 0) + 1
                if b.get("size", 0) < MIN_CAPTION_PX:
                    small.add(f"{txt[:30]} ({b.get('size')} px)")
                if b.get("fg") and b.get("bg") and contrast(b["fg"], b["bg"]) < MIN_CONTRAST:
                    low.add(f"{txt[:30]} ({contrast(b['fg'], b['bg']):.1f}:1)")
                x0, y0, x1, y1 = b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]
                if x0 < SAFE["x0"] or x1 > SAFE["x1"] or y0 < SAFE["y0"] or y1 > SAFE["y1"]:
                    unsafe.add(f"{txt[:30]} ({x0:.0f},{y0:.0f})–({x1:.0f},{y1:.0f})")
                if x1 > RAIL["x"] and y1 > RAIL["y0"] and y0 < RAIL["y1"]:
                    rail.add(f"{txt[:30]} reaches x {x1:.0f}")
        add("caption size", not small, f"all ≥ {MIN_CAPTION_PX} px" if not small else "; ".join(sorted(small)))
        add("contrast", not low, f"all ≥ {MIN_CONTRAST}:1" if not low else "; ".join(sorted(low)))
        add("safe area", not unsafe, "inside" if not unsafe else "; ".join(sorted(unsafe)))
        add("button column", not rail, "clear" if not rail else "; ".join(sorted(rail)))
        slow = []
        for txt, n in shown.items():
            need = (READ_BASE + READ_PER_WORD * len(txt.split())) * 30
            if n < need:
                slow.append(f"\"{txt[:34]}\" {n / 30:.1f} s < {need / 30:.1f} s")
        add("reading time", not slow, f"{len(shown)} lines, all long enough" if not slow else "; ".join(slow))
    return {"render": paths.rel(mp4) if mp4.is_relative_to(paths.ROOT) else str(mp4), "checks": checks,
            "ok": all(c["ok"] for c in checks)}
