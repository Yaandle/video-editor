"""Frame access for the critique: decoded video (what viewers get) and lossless
re-captures through the render harness (what the renderer drew, exactly).

Encoded H.264 frames are good for motion metrics (diff, freezes, silhouettes);
exact checks — palette membership, integer upscaling, determinism — need the
lossless PNG the harness captures before encoding, so `capture()` re-renders
the requested frames.
"""
from __future__ import annotations

import asyncio
import io
import json
import subprocess
from pathlib import Path

import numpy as np

from .. import config


def probe_size(mp4: Path) -> tuple[int, int, float, int]:
    r = subprocess.run([config.ffprobe(), "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=width,height,avg_frame_rate,nb_read_packets", "-of", "json", str(mp4)],
                       capture_output=True, text=True, env=config.subprocess_env())
    s = json.loads(r.stdout)["streams"][0]
    num, den = (int(x) for x in s["avg_frame_rate"].split("/"))
    return int(s["width"]), int(s["height"]), num / den, int(s["nb_read_packets"])


def decode(mp4: Path, width: int = 480, gray: bool = True) -> np.ndarray:
    """All frames scaled to `width` → uint8 array (n, h, w) gray or (n, h, w, 3) RGB."""
    W, H, _, _ = probe_size(mp4)
    h = int(round(H * width / W / 2)) * 2
    fmt = "gray" if gray else "rgb24"
    r = subprocess.run([config.ffmpeg(), "-v", "error", "-i", str(mp4), "-vf", f"scale={width}:{h}:flags=area,format={fmt}",
                        "-f", "rawvideo", "-"], capture_output=True, env=config.subprocess_env())
    if r.returncode != 0:
        raise RuntimeError(f"decode failed: {r.stderr.decode(errors='replace')[-300:]}")
    ch = 1 if gray else 3
    a = np.frombuffer(r.stdout, np.uint8)
    n = a.size // (width * h * ch)
    a = a[: n * width * h * ch]
    return a.reshape((n, h, width)) if gray else a.reshape((n, h, width, 3))


def frame_rgb(mp4: Path, frame: int, fps: float) -> np.ndarray:
    """One full-resolution decoded frame (RGB)."""
    W, H, _, _ = probe_size(mp4)
    r = subprocess.run([config.ffmpeg(), "-v", "error", "-ss", f"{frame / fps:.6f}", "-i", str(mp4), "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, env=config.subprocess_env())
    return np.frombuffer(r.stdout, np.uint8)[: W * H * 3].reshape((H, W, 3))


def capture(project: dict, frames: list[int], width: int, height: int, repeat: bool = False) -> dict:
    """Lossless RGB captures {frame: array} via the harness. With repeat=True every
    frame is rendered a second time after the others (to test determinism) and
    returned as {frame: (first, second)}."""
    from PIL import Image
    from playwright.async_api import async_playwright

    from ..render import harness

    fps = project["settings"]["fps"]

    async def run():
        out = {}
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=harness.launch_args())
            try:
                h = await harness.open_page(browser, width, height)
                await harness.load_project(h, project, width, height)
                for f in frames:
                    await harness.seek(h, f / fps)
                    out[f] = np.asarray(Image.open(io.BytesIO(await harness.capture_png(h))).convert("RGB"))
            finally:
                await browser.close()
            if repeat:
                # Second pass in a fresh browser, reverse order: catches state that leaks
                # between frames (caches, GL bindings) as well as first-frame-only bugs.
                browser = await pw.chromium.launch(args=harness.launch_args())
                try:
                    h = await harness.open_page(browser, width, height)
                    await harness.load_project(h, project, width, height)
                    for f in reversed(frames):
                        await harness.seek(h, f / fps)
                        out[f] = (out[f], np.asarray(Image.open(io.BytesIO(await harness.capture_png(h))).convert("RGB")))
                finally:
                    await browser.close()
        return out

    return asyncio.run(run())
