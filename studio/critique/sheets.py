"""Review stills and contact sheets.

Stills: every spring's start / peak / settle frame, ±2 frames around each cut,
every 0.25 s, and every flagged frame. Sheets are 6×4 grids of 480 px frames
labelled with time and why the frame was picked; a handful of full-resolution
PNGs go next to them for close inspection.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .. import paths
from . import frames as F


def choose(events: dict, reports: list[dict], f0: int, fps: float, n: int, flagged: list[int]) -> list[tuple[int, str]]:
    want: dict[int, str] = {}

    def add(f: int, why: str):
        i = int(round(f)) - f0
        if 0 <= i < n and i not in want:
            want[i] = why

    for i in flagged:
        add(f0 + i, "flag")
    for c in events.get("cuts", []):
        for k in (-2, 2):
            add(c["t"] * fps + k, f"cut{k:+d}")
    for mv in events.get("motion", []):
        add(mv["start"] * fps, "start")
        add(mv["peak"] * fps, "peak")
        add(mv["settle"] * fps, "settle")
    step = max(1, int(round(0.25 * fps)))
    for i in range(0, n, step):
        add(f0 + i, "0.25s")
    return sorted(want.items())


def _font(size: int):
    for f in (paths.FONTS / "space-mono" / "SpaceMono-Bold.ttf", paths.FONTS / "jetbrains-mono" / "JetBrainsMono-Variable.ttf"):
        try:
            return ImageFont.truetype(str(f), size)
        except OSError:
            continue
    return ImageFont.load_default()


def write(out_dir: Path, rgb_small: np.ndarray, stills: list[tuple[int, str]], f0: int, fps: float, mp4: Path,
          per_sheet: int = 24, full_res: int = 6) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in [*out_dir.glob("sheet_*.png"), *out_dir.glob("still_*.png")]:
        old.unlink()
    h, w = rgb_small.shape[1:3]
    cols, label_h, pad = 6, 22, 6
    font = _font(13)
    files = []
    for si in range(0, len(stills), per_sheet):
        chunk = stills[si:si + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + label_h + pad) + pad), (18, 18, 18))
        d = ImageDraw.Draw(sheet)
        for k, (i, why) in enumerate(chunk):
            x = pad + (k % cols) * (w + pad)
            y = pad + (k // cols) * (h + label_h + pad)
            sheet.paste(Image.fromarray(rgb_small[i]), (x, y))
            d.rectangle([x, y + h, x + w, y + h + label_h], fill=(205, 245, 69) if why == "flag" else (243, 239, 228))
            d.text((x + 6, y + h + 3), f"{(f0 + i) / fps:6.2f}s  f{f0 + i}  {why}", fill=(18, 18, 18), font=font)
        p = out_dir / f"sheet_{si // per_sheet + 1:02d}.png"
        sheet.save(p)
        files.append(p)
    # A few full-resolution stills: settle frames first (what holds on screen), then flags.
    order = [s for s in stills if s[1] == "settle"] + [s for s in stills if s[1] == "flag"] + [s for s in stills if s[1] == "0.25s"]
    seen = set()
    for i, why in order:
        if len(seen) >= full_res:
            break
        if i in seen:
            continue
        seen.add(i)
        Image.fromarray(F.frame_rgb(mp4, i, fps)).save(out_dir / f"still_{(f0 + i) / fps:06.2f}s_{why}.png")
    return files
