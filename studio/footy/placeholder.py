"""A synthetic, clearly labelled placeholder clip for testing the pipeline.

NOT real footage. 1280×720 at 25 fps, 300 frames (12 s), drawn with PIL:
  f0–199    wide shot from the wing. A carrier runs and kicks at f100; two
            forwards both lead into the same space while defenders cover; the
            kick lands in a marking contest at f146 and a third defender spoils
            it; a sweeper gathers the loose ball (~f185).
  f200–209  a broadcast-style transition wipe
  f210–299  a tight replay angle of the contest at half speed
Crowd noise rises at the kick and roars at the spoil, so the cheap signals
(cuts, motion, pan, audio) have something to find.

Every frame carries its own index: "SRC F0123" text and a 12-bit barcode in
the bottom-right corner (read by `barcode()`), so decode and freeze exactness
can be checked end to end.
"""
from __future__ import annotations

import math
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .. import config, paths

W, H, FPS, N = 1280, 720, 25, 300
BITS = 12
CELL = 12
BAR_X, BAR_Y = W - 16 - (BITS + 2) * CELL, H - 16 - CELL

# field metres → keyframes (frame: (X, Y)); X toward the right goal, Y from the near wing (0) to the far side
KEYS = {
    "A1": {0: (42, 22), 100: (58, 22), 130: (62, 23), 200: (66, 24)},
    "A2": {0: (84, 40), 50: (83, 39), 100: (74.5, 31), 130: (74.8, 29.2), 146: (75.3, 28.9), 160: (76, 28), 200: (78, 27)},
    "A3": {0: (86, 16), 50: (85, 17), 100: (75.5, 26), 130: (75.6, 27.6), 146: (75.8, 28.0), 160: (76.5, 27), 200: (79, 25)},
    "A4": {0: (55, 44), 100: (63, 40), 200: (70, 36)},
    "A5": {0: (50, 8), 100: (60, 10), 200: (68, 13)},
    "B1": {0: (81, 37), 50: (81, 36.5), 100: (76.5, 32.5), 146: (76.2, 29.8), 160: (77, 29), 200: (79, 28)},
    "B2": {0: (88, 24), 50: (87, 24.5), 100: (79, 27), 130: (76.8, 28), 146: (76.1, 28.3), 160: (76.8, 27.5), 200: (78, 26.5)},
    "B3": {0: (92, 14), 100: (88, 16), 146: (85, 18), 185: (83.5, 19.5), 200: (90, 17)},
    "B4": {0: (57, 38), 100: (65, 35), 200: (72, 32)},
    "B5": {0: (62, 12), 100: (68, 14), 200: (74, 16)},
}
CONTEST = {"A2", "A3", "B1", "B2"}
TEAM = {"A": ((236, 236, 230), (32, 52, 110)), "B": ((40, 44, 58), (226, 226, 220))}   # jumper, shorts
KICK_F, SPOIL_F, PICKUP_F = 100, 146, 185
WIPE0, REPLAY0 = 200, 210


def _smooth(p: float) -> float:
    p = min(1.0, max(0.0, p))
    return p * p * (3 - 2 * p)


def pos(keys: dict, f: float) -> tuple[float, float]:
    ks = sorted(keys)
    if f <= ks[0]:
        return keys[ks[0]]
    for a, b in zip(ks, ks[1:]):
        if f <= b:
            p = (f - a) / (b - a)
            # linear in the middle of a leg so leads look like running, eased only a little
            p = 0.7 * p + 0.3 * _smooth(p)
            (x0, y0), (x1, y1) = keys[a], keys[b]
            return x0 + (x1 - x0) * p, y0 + (y1 - y0) * p
    return keys[ks[-1]]


def ball(f: float) -> tuple[float, float, float]:
    """Ball (X, Y, height m)."""
    if f < KICK_F:
        x, y = pos(KEYS["A1"], f)
        return x + 0.5, y, 1.0
    if f < SPOIL_F:
        p = (f - KICK_F) / (SPOIL_F - KICK_F)
        x0, y0 = pos(KEYS["A1"], KICK_F)
        x0 += 0.6
        x1, y1 = 75.6, 28.5
        return x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, 1.0 + 15 * 4 * p * (1 - p) + 2.0 * p
    if f < SPOIL_F + 10:
        p = (f - SPOIL_F) / 10
        return 75.6 + 3.4 * p, 28.5 - 4.5 * p, 3.0 + 3 * 4 * p * (1 - p) - 2.8 * p
    if f < PICKUP_F:
        p = (f - SPOIL_F - 10) / (PICKUP_F - SPOIL_F - 10)
        p = 1 - (1 - p) ** 2
        return 79 + 4.5 * p, 24 - 4.5 * p, 0.2
    x, y = pos(KEYS["B3"], f)
    return x + 0.5, y, 1.0


def scale(Y: float) -> float:
    return 1 - Y * 0.008


def project(X: float, Y: float, cam: dict) -> tuple[float, float, float]:
    s = scale(Y)
    sx = 640 + (X - cam["x"]) * 30 * s
    sy = 630 - Y * 8.5
    z = cam.get("zoom", 1.0)
    if z != 1.0:
        sx = 640 + (sx - cam["zx"]) * z
        sy = 360 + (sy - cam["zy"]) * z
    return sx, sy, s * z


def _font(size: int, bold: bool = False):
    for name in ("SpaceMono-Bold.ttf" if bold else "SpaceMono-Regular.ttf",):
        p = paths.FONTS / "space-mono" / name
        if p.is_file():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def draw_field(d: ImageDraw.ImageDraw, cam: dict) -> None:
    d.rectangle([0, 0, W, H], fill=(62, 118, 58))
    # mowing stripes every 6 m along X
    for k in range(-2, 40):
        x0, x1 = k * 6.0, k * 6.0 + 3.0
        if k % 2:
            continue
        pts = [project(x0, -10, cam)[:2], project(x1, -10, cam)[:2], project(x1, 80, cam)[:2], project(x0, 80, cam)[:2]]
        d.polygon(pts, fill=(70, 130, 64))
    # far boundary line and fence
    far = [project(x, 63, cam)[:2] for x in np.linspace(0, 140, 60)]
    d.line(far, fill=(240, 240, 235), width=max(2, int(3 * cam.get("zoom", 1))))
    fence = [project(x, 66, cam)[:2] for x in np.linspace(0, 140, 60)]
    top = min(p[1] for p in fence)
    if top > 0:
        d.rectangle([0, 0, W, top], fill=(54, 58, 66))
        d.rectangle([0, max(0, top - 26 * cam.get("zoom", 1)), W, top], fill=(205, 72, 40))
    # 50 m arc around the right goal (X 110, Y 30)
    arc = [(110 - 50 * math.cos(a), 30 + 50 * math.sin(a)) for a in np.linspace(-0.62, 0.62, 50)]
    d.line([project(x, y, cam)[:2] for x, y in arc], fill=(238, 238, 232), width=max(2, int(3 * cam.get("zoom", 1))))


def draw_player(d: ImageDraw.ImageDraw, pid: str, f: float, cam: dict) -> None:
    X, Y = pos(KEYS[pid], f)
    sx, sy, s = project(X, Y, cam)
    h = 92 * s
    jumper, shorts = TEAM[pid[0]]
    vx = pos(KEYS[pid], f + 1)[0] - X
    run = math.sin(f * 0.9 + sum(map(ord, pid)) % 7) * (0.5 if abs(vx) > 0.02 else 0.08)
    d.ellipse([sx - 0.32 * h, sy - 0.07 * h, sx + 0.32 * h, sy + 0.07 * h], fill=(40, 80, 38))
    hip = (sx, sy - 0.48 * h)
    for side in (-1, 1):
        d.line([hip, (sx + side * run * 0.25 * h, sy)], fill=(214, 170, 132), width=max(2, int(0.07 * h)))
    d.rectangle([sx - 0.13 * h, sy - 0.56 * h, sx + 0.13 * h, sy - 0.42 * h], fill=shorts)
    d.rectangle([sx - 0.15 * h, sy - 0.86 * h, sx + 0.15 * h, sy - 0.55 * h], fill=jumper)
    sh = (sx, sy - 0.82 * h)
    up = pid in CONTEST and 136 <= f <= 152
    for side in (-1, 1):
        end = (sx + side * 0.12 * h, sy - 1.18 * h) if up else (sx + side * 0.2 * h, sy - 0.58 * h)
        if pid == "B2" and 143 <= f <= 149 and side == 1:
            end = (sx + 0.05 * h, sy - 1.32 * h)
        d.line([sh, end], fill=(214, 170, 132), width=max(2, int(0.06 * h)))
    d.ellipse([sx - 0.08 * h, sy - 1.02 * h, sx + 0.08 * h, sy - 0.86 * h], fill=(214, 170, 132))


def draw_ball(d: ImageDraw.ImageDraw, f: float, cam: dict) -> None:
    X, Y, Z = ball(f)
    gx, gy, s = project(X, Y, cam)
    r = 7 * s
    d.ellipse([gx - r * 1.2, gy - r * 0.4, gx + r * 1.2, gy + r * 0.4], fill=(38, 74, 36))
    by = gy - Z * 8.5 * s * 0.9
    d.ellipse([gx - r * 1.25, by - r * 0.8, gx + r * 1.25, by + r * 0.8], fill=(150, 34, 26), outline=(240, 230, 220))


def camera(f: int, state: dict) -> dict:
    target = ball(f)[0] + 7
    state["x"] = state.get("x", target) + (target - state.get("x", target)) * 0.06
    return {"x": state["x"]}


def frame_image(f: int, state: dict) -> Image.Image:
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    if f < WIPE0:
        cam = camera(f, state)
        t = float(f)
    elif f < REPLAY0:
        cam = {"x": state["x"]}
        t = float(WIPE0)
    else:
        t = 122 + (f - REPLAY0) * 0.5
        sx, sy, _ = project(75.6, 28.6, {"x": 72.0})
        cam = {"x": 72.0, "zoom": 2.2, "zx": sx, "zy": sy - 30}
    draw_field(d, cam)
    for pid in sorted(KEYS, key=lambda p: -pos(KEYS[p], t)[1]):
        draw_player(d, pid, t, cam)
    draw_ball(d, t, cam)
    if WIPE0 <= f < REPLAY0:
        p = (f - WIPE0 + 1) / (REPLAY0 - WIPE0)
        for i in range(8):
            x = -400 + p * 2100 - i * 90
            d.polygon([(x, 0), (x + 70, 0), (x - 290, H), (x - 360, H)], fill=(250, 200, 30) if i % 2 else (20, 20, 20))
        d.text((W / 2 - 120, H / 2 - 30), "REPLAY", font=_font(52, True), fill=(250, 250, 250))
    if f >= REPLAY0:
        d.rectangle([W - 190, 24, W - 24, 70], fill=(20, 20, 20))
        d.text((W - 176, 30), "REPLAY", font=_font(28, True), fill=(250, 200, 30))
    # labels and the frame barcode
    d.rectangle([12, H - 44, 640, H - 12], fill=(0, 0, 0))
    d.text((22, H - 41), "PLACEHOLDER - SYNTHETIC CLIP - NOT REAL FOOTAGE", font=_font(18, True), fill=(255, 220, 60))
    d.rectangle([BAR_X - 4, BAR_Y - 34, W - 12, BAR_Y + CELL + 4], fill=(0, 0, 0))
    d.text((BAR_X + 2, BAR_Y - 32), f"SRC F{f:04d}", font=_font(20, True), fill=(255, 255, 255))
    cells = [1] + [(f >> (BITS - 1 - i)) & 1 for i in range(BITS)] + [0]
    for i, b in enumerate(cells):
        x = BAR_X + i * CELL
        d.rectangle([x, BAR_Y, x + CELL - 1, BAR_Y + CELL - 1], fill=(255, 255, 255) if b else (0, 0, 0))
    return img


def barcode(img: Image.Image | np.ndarray) -> int | None:
    """Frame index from the barcode of a placeholder frame at its own 1280×720 size (None if unreadable)."""
    a = np.asarray(img.convert("L") if isinstance(img, Image.Image) else img, dtype=np.float32)
    if a.shape[:2] != (H, W):
        return None
    vals = [a[BAR_Y + CELL // 2 - 2:BAR_Y + CELL // 2 + 3, BAR_X + i * CELL + CELL // 2 - 2:BAR_X + i * CELL + CELL // 2 + 3].mean()
            for i in range(BITS + 2)]
    bits = [v > 127 for v in vals]
    if not bits[0] or bits[-1]:
        return None
    n = 0
    for b in bits[1:-1]:
        n = (n << 1) | int(b)
    return n


def crowd_audio(sr: int = 48000) -> np.ndarray:
    rng = np.random.default_rng(7)
    n = int(N / FPS * sr)
    t = np.arange(n) / sr
    white = rng.standard_normal(n).astype(np.float32)
    # one-pole low-pass for a crowd-ish rumble
    y = np.empty_like(white)
    acc = 0.0
    a = 0.06
    for i in range(n):
        acc += a * (white[i] - acc)
        y[i] = acc
    y /= np.abs(y).max() + 1e-9
    f = t * FPS
    envl = 0.08 + 0.05 * np.exp(-((f - KICK_F) / 18) ** 2) + 0.42 * np.exp(-((f - SPOIL_F - 8) / 14) ** 2)
    envl = np.where(f >= WIPE0, 0.05, envl)
    out = y * envl
    for at, amp in ((KICK_F, 0.35), (SPOIL_F, 0.22)):
        k = (t - at / FPS)
        burst = np.where(k >= 0, np.sin(2 * np.pi * 85 * k) * np.exp(-k * 28), 0) * amp
        out += burst.astype(np.float32)
    return np.stack([out, out], axis=1).astype(np.float32)


def make(out_dir: Path | None = None) -> Path:
    """Write media/afl-breakdown/placeholder/placeholder-source.mp4 (the 'supplied' file)."""
    out_dir = out_dir or paths.MEDIA / "afl-breakdown" / "placeholder"
    out_dir.mkdir(parents=True, exist_ok=True)
    wav = out_dir / "placeholder-crowd.wav"
    a = crowd_audio()
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
    out = out_dir / "placeholder-source.mp4"
    cmd = [config.ffmpeg(), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=config.subprocess_env())
    state: dict = {}
    for f in range(N):
        p.stdin.write(frame_image(f, state).tobytes())
    p.stdin.close()
    err = p.stderr.read().decode("utf-8", "replace")
    if p.wait() != 0:
        raise RuntimeError(f"placeholder encode failed: {err[-500:]}")
    wav.unlink(missing_ok=True)
    return out
