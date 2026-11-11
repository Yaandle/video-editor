"""Post covers: one game frame plus a big "Day N", in the same format every day.

The format (keep it, so the profile grid reads as one series):
  - 1080×1920 JPG. The background is a frame of that day's footage, punched in about the
    centre (the replay camera keeps the ball there), with contrast and saturation lifted and
    a soft darkening towards the bottom.
  - "Day N" in Montserrat ExtraBold, 210 px, white, with an 11 px near-black outline and a
    blurred drop shadow. The size is the same every day.
  - Optional kicker line above it (Montserrat Bold, 64 px), for something the day's data shows.
  - Everything sits inside the centre 1080×1440 (3:4) crop that the Instagram and TikTok
    profile grids show. `pos` moves the text between upper, middle and lower in that crop,
    so neighbouring covers don't look identical.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from .. import paths
from ..footy import media

W, H = 1080, 1920
GRID = (240, 1680)                       # y range of the 3:4 profile-grid crop
FONT = paths.ROOT / "styles" / "sketch" / "fonts" / "Montserrat-wght.ttf"
DAY_PX, KICK_PX = 210, 64
STROKE, KICK_STROKE = 11, 6
INK = (20, 20, 22)
POS = {"upper": 0.30, "middle": 0.52, "lower": 0.74}   # text centre, as a fraction of the grid crop


def _font(px: int, weight: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), px)
    f.set_variation_by_axes([weight])
    return f


def find_players(img: Image.Image) -> tuple[float, float] | None:
    """Where the players are, as fractions of the frame: the densest patch of non-grass
    pixels on the field (kits, the ball, posts), ignoring the sky and tree line at the top.
    Pitch lines are thin, so they never make a dense patch."""
    import numpy as np
    small = img.convert("RGB").resize((img.width // 4, img.height // 4))
    hsv = np.asarray(small.convert("HSV"), np.float32)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    grass = (h > 60) & (h < 170) & (s > 0.2)
    mask = (~grass & (v > 0.12)).astype(np.float32)
    # the replay camera looks at the ball, so the players are at or below the frame centre;
    # above that sit the fence, bushes and trees, which also read as "not grass"
    mask[: int(mask.shape[0] * 0.45)] = 0
    mask[int(mask.shape[0] * 0.92):] = 0
    k = 15
    pad = np.pad(mask, k, mode="constant")
    c = pad.cumsum(0).cumsum(1)
    dens = c[2 * k:, 2 * k:] - c[:-2 * k, 2 * k:] - c[2 * k:, :-2 * k] + c[:-2 * k, :-2 * k]
    dens = dens[: mask.shape[0], : mask.shape[1]]
    if dens.max() < 12:
        return None
    y, x = np.unravel_index(int(dens.argmax()), dens.shape)
    return (x + 0.5) / mask.shape[1], (y + 0.5) / mask.shape[0]


def background(img: Image.Image, zoom: float = 1.45, focus_y: float = 0.5, focus: tuple[float, float] | None = None) -> Image.Image:
    img = img.convert("RGB")
    s = max(W / img.width, H / img.height) * zoom
    big = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    cx, cy = (big.width * focus[0], big.height * focus[1]) if focus else (big.width / 2, big.height * focus_y)
    x0 = min(max(0, round(cx - W / 2)), big.width - W)
    y0 = min(max(0, round(cy - H / 2)), big.height - H)
    out = big.crop((x0, y0, x0 + W, y0 + H)).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    out = ImageEnhance.Contrast(out).enhance(1.12)
    out = ImageEnhance.Color(out).enhance(1.15)
    # darken towards the bottom so white text holds up on bright grass
    shade = Image.new("L", (1, H))
    for y in range(H):
        shade.putpixel((0, y), int(120 * max(0.0, (y / H - 0.35) / 0.65) ** 1.4))
    out.paste(Image.new("RGB", (W, H), INK), (0, 0), shade.resize((W, H)))
    return out


MARGIN = 72
# Where "Day N" can sit: (centre y as a fraction of the 3:4 grid crop, alignment). The day
# number picks the starting slot, so neighbouring covers in the grid put the text somewhere
# different; a slot that would cover the players is skipped.
SLOTS = [(0.74, "center"), (0.26, "left"), (0.56, "right"), (0.82, "left"),
         (0.36, "center"), (0.66, "right"), (0.20, "right"), (0.50, "left")]


def _measure(text: str, font: ImageFont.FreeTypeFont, stroke: int) -> tuple[int, int, int, int]:
    return ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), text, font=font, stroke_width=stroke)


def _x(w: float, align: str) -> float:
    return MARGIN if align == "left" else W - MARGIN - w if align == "right" else (W - w) / 2


def _text(base: Image.Image, text: str, font: ImageFont.FreeTypeFont, cy: float, stroke: int, shadow: int,
          align: str = "center", x_left: float | None = None) -> tuple[int, int]:
    d = ImageDraw.Draw(base)
    l, t, r, b = d.textbbox((0, 0), text, font=font, stroke_width=stroke)
    w, h = r - l, b - t
    x = (x_left if x_left is not None else _x(w, align)) - l
    y = cy - h / 2 - t
    sh = Image.new("L", base.size, 0)
    ImageDraw.Draw(sh).text((x + shadow * 0.4, y + shadow), text, font=font, fill=170, stroke_width=stroke)
    sh = sh.filter(ImageFilter.GaussianBlur(shadow))
    base.paste(Image.new("RGB", base.size, (0, 0, 0)), (0, 0), sh)
    d.text((x, y), text, font=font, fill=(255, 255, 255), stroke_width=stroke, stroke_fill=INK)
    return w, h


def make(frame: Image.Image, day: int, out: Path, pos: str = "auto", kicker: str | None = None,
         zoom: float = 2.1, focus_y: float = 0.5) -> Path:
    """pos "auto": find the players, centre the punch-in on them, and place the text in the
    day's slot (SLOTS), moving on to the next slot while it would cover the players."""
    focus = find_players(frame) if pos == "auto" else None
    img = background(frame, zoom, focus_y, focus)
    g0, g1 = GRID
    day_font, kick_font = _font(DAY_PX, 800), _font(KICK_PX, 700)
    label = f"Day {day}"
    l, t, r, b = _measure(label, day_font, STROKE)
    w, h = r - l, b - t
    kick_w = 0
    if kicker:
        kl, _kt, kr, _kb = _measure(kicker, kick_font, KICK_STROKE)
        kick_w = kr - kl
    if pos == "auto":
        player = None
        if focus:
            # where the players land in the cover (the crop centres them unless it hit an edge)
            s = max(W / frame.width, H / frame.height) * zoom
            bw, bh = frame.width * s, frame.height * s
            px, py = focus[0] * bw, focus[1] * bh
            player = (px - min(max(0, px - W / 2), bw - W), py - min(max(0, py - H / 2), bh - H))
        n = len(SLOTS)
        for k in range(n):
            fy, align = SLOTS[(day - 1 + k) % n]
            cy = g0 + (g1 - g0) * fy
            x0 = _x(max(w, kick_w), align)
            top = cy - h / 2 - (KICK_PX * 1.6 if kicker else 0)
            box = (x0 - 40, top - 40, x0 + max(w, kick_w) + 40, cy + h / 2 + 40)
            if player is None or not (box[0] < player[0] + 110 and player[0] - 110 < box[2]
                                      and box[1] < player[1] + 80 and player[1] - 230 < box[3]):
                break
    else:
        fy, align = {"upper": (0.30, "center"), "middle": (0.52, "center"), "lower": (0.74, "center")}[pos]
        cy = g0 + (g1 - g0) * fy
    x0 = _x(max(w, kick_w), align)
    _text(img, label, day_font, cy, STROKE, 14, x_left=x0 if align != "center" else None, align=align)
    if kicker:
        _text(img, kicker, kick_font, cy - h / 2 - KICK_PX * 0.95, KICK_STROKE, 8,
              x_left=x0 if align != "center" else None, align=align)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=90, optimize=True)
    return out


def from_episode(ep: dict, moment: str, day: int, out: Path, at: str = "event", frame: int | None = None, **kw) -> Path:
    m = next(x for x in ep["moments"] if x["id"] == moment)
    c = next(x for x in ep["clips"] if x["id"] == m["clip"])
    f = frame if frame is not None else int(m.get(f"{at}_f") if m.get(f"{at}_f") is not None else m["event_f"])
    img = media.extract_frames(paths.ROOT / c["proxy"], [f], float(c["fps"]))[f]
    return make(img, day, out, **kw)
