"""Images for the vision pass and the review: contact sheets, grid frames, signal strips, proofs."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .. import paths

INK, PAPER, LIME, ORANGE, COBALT = (18, 18, 18), (243, 239, 228), (205, 245, 69), (255, 79, 31), (35, 66, 245)


def font(size: int, bold: bool = True):
    p = paths.FONTS / "space-mono" / ("SpaceMono-Bold.ttf" if bold else "SpaceMono-Regular.ttf")
    return ImageFont.truetype(str(p), size) if p.is_file() else ImageFont.load_default()


def tc(frame: int, fps: float) -> str:
    s = frame / fps
    return f"{int(s // 60):02d}:{s % 60:05.2f}"


def contact_sheet(images: dict[int, Image.Image], fps: float, out: Path, title: str, cols: int = 4, tile_w: int = 400) -> Path:
    keys = sorted(images)
    iw, ih = images[keys[0]].size
    th = int(tile_w * ih / iw)
    bar = 30
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w + (cols + 1) * 8, 46 + rows * (th + bar + 8) + 8), PAPER)
    d = ImageDraw.Draw(sheet)
    d.text((10, 10), title, font=font(20), fill=INK)
    for i, f in enumerate(keys):
        x = 8 + (i % cols) * (tile_w + 8)
        y = 46 + (i // cols) * (th + bar + 8)
        sheet.paste(images[f].resize((tile_w, th), Image.LANCZOS), (x, y))
        d.rectangle([x, y + th, x + tile_w, y + th + bar], fill=INK)
        d.text((x + 8, y + th + 5), f"f{f:05d}  {tc(f, fps)}", font=font(16), fill=PAPER)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out


def grid_frame(img: Image.Image, frame: int, fps: float, out: Path, step: int = 100) -> Path:
    """The frame at full size with a labelled video-px grid, for reading positions off it."""
    im = img.copy()
    d = ImageDraw.Draw(im, "RGBA")
    w, h = im.size
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 255, 255, 90 if x % (step * 5) else 160), width=1)
        d.text((x + 3, 3), str(x), font=font(13), fill=(255, 255, 0, 230))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(255, 255, 255, 90 if y % (step * 5) else 160), width=1)
        d.text((3, y + 3), str(y), font=font(13), fill=(255, 255, 0, 230))
    d.rectangle([w - 260, 0, w, 26], fill=(0, 0, 0, 200))
    d.text((w - 252, 4), f"f{frame:05d}  {tc(frame, fps)}", font=font(16), fill=(255, 255, 255, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


def signal_strip(sig: dict, score: np.ndarray, cuts: list[dict], cands: list[dict], fps: float, out: Path, width: int = 1400) -> Path:
    rows = [("crowd dB", sig["loud"]), ("pan accel", sig["accel"]), ("motion", sig["resid"]), ("concentration", sig["conc"]), ("score", score)]
    rh, left = 70, 150
    im = Image.new("RGB", (width, 40 + rh * len(rows) + 30), PAPER)
    d = ImageDraw.Draw(im)
    n = sig["n"]
    X = lambda f: left + (width - left - 10) * f / max(1, n - 1)  # noqa: E731
    for c in cands:
        d.rectangle([X(c["start_f"]), 30, X(c["end_f"]), 30 + rh * len(rows)], fill=(226, 236, 190))
        d.text((X(c["peak_f"]) + 3, 12), c["id"], font=font(14), fill=INK)
    for c in cuts:
        d.rectangle([X(c["f0"]), 30, max(X(c["f0"]) + 2, X(c["f1"])), 30 + rh * len(rows)], fill=ORANGE if c["kind"] == "transition" else COBALT)
    for r, (label, arr) in enumerate(rows):
        y0 = 30 + r * rh
        d.text((8, y0 + rh / 2 - 9), label, font=font(14), fill=INK)
        a = np.asarray(arr, np.float32)
        lo, hi = float(np.percentile(a, 1)), float(np.percentile(a, 99.5))
        if hi - lo < 1e-9:
            hi = lo + 1
        pts = [(X(i), y0 + rh - 6 - (rh - 12) * (min(max(v, lo), hi) - lo) / (hi - lo)) for i, v in enumerate(a)]
        d.line(pts, fill=INK, width=2)
        d.line([(left, y0 + rh), (width - 10, y0 + rh)], fill=(200, 196, 186))
    for s in range(0, int(n / fps) + 1):
        d.text((X(s * fps) - 6, 34 + rh * len(rows)), f"{s}s", font=font(12, False), fill=INK)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


# ── proofs: the proposed annotations on the raw freeze frame, for review ──────

def _pt(ref, tracks, f, sample):
    if ref is None:
        return None
    if "track" in ref:
        if ref["track"] not in tracks:
            return None
        p = sample(ref["track"], f)
        return None if p is None else (p[0] + ref.get("dx", 0), p[1] + ref.get("dy", 0))
    return (ref["x"], ref["y"])


def proof(img: Image.Image, moment: dict, out: Path, sample, step: int = 100) -> Path:
    """Raw freeze frame + grid + every annotation drawn plainly, ADJUST flags in orange.
    sample(track_id, frame) -> (x, y) comes from the renderer's own interpolation (studio/footy/plan.mjs)."""
    im = img.copy().convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 255, 255, 60), width=1)
        d.text((x + 2, 2), str(x), font=font(12), fill=(255, 255, 0, 200))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(255, 255, 255, 60), width=1)
        d.text((2, y + 2), str(y), font=font(12), fill=(255, 255, 0, 200))
    f = moment["freeze_f"]
    tracks = moment.get("tracks", {})
    for tid, t in tracks.items():
        keys = t.get("keys", [])
        path = [sample(tid, k["f"]) for k in keys]
        if len(path) > 1:
            d.line(path, fill=(255, 255, 255, 120), width=2)
        for k in keys:
            d.ellipse([k["x"] - 3, k["y"] - 3, k["x"] + 3, k["y"] + 3], fill=(255, 255, 255, 200))
    for i, a in enumerate(moment.get("annotations", [])):
        col = {"lime": LIME, "orange": ORANGE, "cobalt": COBALT, "paper": PAPER, "ink": INK}.get(a.get("color", ""), LIME)
        kind = a["kind"]
        label = f"{i + 1}:{kind}"
        anchor = None
        if kind in ("ring", "spotlight"):
            p = _pt(a.get("at") or {"track": a.get("track")}, tracks, f, sample)
            if p:
                r = a.get("r", 60)
                ry = r * (a.get("squash", 0.42 if kind == "ring" else 1.3))
                cy = p[1] if kind == "ring" else p[1] - ry * 0.7
                d.ellipse([p[0] - r, cy - ry, p[0] + r, cy + ry], outline=col + (255,), width=4)
                anchor = (p[0] + r + 4, cy - 10)
        elif kind in ("arrow", "line"):
            p0, p1 = _pt(a.get("from"), tracks, f, sample), _pt(a.get("to"), tracks, f, sample)
            if p0 and p1:
                via = _pt(a.get("via"), tracks, f, sample)
                pts = [p0, via, p1] if via else [p0, p1]
                d.line(pts, fill=col + (255,), width=5)
                if kind == "arrow":
                    d.ellipse([p1[0] - 8, p1[1] - 8, p1[0] + 8, p1[1] + 8], fill=col + (255,))
                anchor = ((p0[0] + p1[0]) / 2 + 6, (p0[1] + p1[1]) / 2)
        elif kind == "zone":
            pts = [_pt(q, tracks, f, sample) for q in a.get("points", [])]
            pts = [q for q in pts if q]
            if len(pts) >= 3:
                d.polygon(pts, outline=col + (255,), fill=col + (60,))
                anchor = pts[0]
        elif kind == "label":
            p = _pt(a.get("at"), tracks, f, sample)
            if p:
                d.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=col + (255,))
                anchor = (p[0] + 8, p[1] - 8)
        text = label + (f" '{a.get('label') or a.get('text')}'" if (a.get("label") or a.get("text")) else "")
        if a.get("adjust"):
            text += "  ADJUST?"
        ax, ay = anchor if anchor else (10, 30 + 26 * i)
        tw = d.textlength(text, font=font(15))
        d.rectangle([ax, ay, ax + tw + 10, ay + 22], fill=(ORANGE if a.get("adjust") else INK) + (230,))
        d.text((ax + 5, ay + 2), text, font=font(15), fill=PAPER)
    d.rectangle([0, h - 30, w, h], fill=(0, 0, 0, 210))
    d.text((8, h - 26), f"REVIEW PROOF - not for posting - moment {moment['id']} - freeze f{f}", font=font(16), fill=(255, 220, 60))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out
