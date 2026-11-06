"""Style packs from the command line.

    python -m studio.styles list
    python -m studio.styles render kinetic [--draft] [--range 0-4]     demo → renders/styles/<id>/
    python -m studio.styles critique kinetic                            critique of the demo render
    python -m studio.styles check                                       one-frame render of every pack (doctor)
    python -m studio.styles thumbs                                      styles/<id>/thumb.jpg from the demo renders

Each pack's demo lives in styles/<id>/demo.json; its tokens.json "demo" key may
name the frame used for the thumbnail ("thumb_t").
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from . import config, jsbridge, paths, schema


def packs() -> list[dict]:
    return [p for p in jsbridge.call("styles") if p["id"] != "neo-brutal"]


def demo_path(pid: str) -> Path:
    return paths.STYLES / pid / "demo.json"


def render_demo(pid: str, preset: str = "1080p30", draft: bool = False, t0=None, t1=None, workers: int = 0) -> dict:
    from .render.engine import Job, render
    out = paths.RENDERS / "styles" / pid / f"{pid}_{preset}{'-draft' if draft else ''}{'' if t0 is None else f'_{t0:.2f}-{t1:.2f}s'}.mp4"
    return render(Job(project_path=demo_path(pid), preset=preset, draft=draft, t0=t0, t1=t1, out=out, workers=workers))


def one_frame(pid: str) -> dict:
    """Render one settled frame of the pack's demo through the harness (doctor's per-pack test)."""
    from playwright.async_api import async_playwright

    from .render import harness
    proj = schema.load(demo_path(pid))
    t = float((json.loads((paths.STYLES / pid / "tokens.json").read_text(encoding="utf-8")).get("demo") or {}).get("thumb_t", proj["settings"]["duration"] * 0.45))

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=harness.launch_args())
            try:
                h = await harness.open_page(b, 640, 360)
                info = await harness.load_project(h, proj, 640, 360)
                t_a = time.perf_counter()
                rep = await harness.seek(h, t)
                png = await harness.capture_png(h)
                return {"ms": round((time.perf_counter() - t_a) * 1000), "png": len(png), "boxes": len(rep["boxes"]), "gl": (info.get("gl") or {}).get("renderer"), "styles": rep.get("styles")}
            finally:
                await b.close()
    return asyncio.run(run())


def thumbs() -> list[Path]:
    from PIL import Image

    from .critique import frames as F
    out = []
    for p in packs():
        mp4 = paths.RENDERS / "styles" / p["id"] / f"{p['id']}_1080p30.mp4"
        if not mp4.is_file():
            continue
        t = float((p.get("demo") or {}).get("thumb_t", 3.0))
        img = Image.fromarray(F.frame_rgb(mp4, int(round(t * 30)), 30)).resize((640, 360), Image.LANCZOS)
        dest = paths.STYLES / p["id"] / "thumb.jpg"
        img.save(dest, quality=88)
        out.append(dest)
    return out


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    import os
    os.environ["PATH"] = config.subprocess_env()["PATH"]
    ap = argparse.ArgumentParser(prog="python -m studio.styles")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    r = sub.add_parser("render"); r.add_argument("pack"); r.add_argument("--draft", action="store_true"); r.add_argument("--range"); r.add_argument("--preset", default="1080p30"); r.add_argument("--workers", type=int, default=0)
    c = sub.add_parser("critique"); c.add_argument("pack"); c.add_argument("--samples", type=int, default=12)
    sub.add_parser("check")
    sub.add_parser("thumbs")
    a = ap.parse_args(argv)
    ids = [p["id"] for p in packs()]
    if a.cmd == "list":
        for p in packs():
            print(f"{p['id']:<20} {p['label']:<28} components: {', '.join(p['components']) or '—'}")
        return 0
    if a.cmd == "check":
        bad = 0
        for pid in ids:
            try:
                r = one_frame(pid)
                print(f"  ✓ {pid:<20} {r['ms']:>5} ms  {r['boxes']} boxes  styles={r['styles']}  gl={r['gl']}")
            except Exception as e:
                bad += 1
                print(f"  ✗ {pid:<20} {str(e).splitlines()[0][:160]}")
        return 1 if bad else 0
    if a.cmd == "thumbs":
        for f in thumbs():
            print(paths.rel(f))
        return 0
    targets = ids if a.pack == "all" else [a.pack]
    rc = 0
    for pid in targets:
        if a.cmd == "render":
            t0 = t1 = None
            if a.range:
                x, _, y = a.range.partition("-")
                t0, t1 = float(x), float(y)
            rep = render_demo(pid, a.preset, a.draft, t0, t1, a.workers)
            print(f"✓ {pid}: {rep['output']} ({rep['seconds']} s)")
        else:
            from .critique.__main__ import main as critique_main
            mp4 = paths.RENDERS / "styles" / pid / f"{pid}_1080p30.mp4"
            rc |= critique_main([str(mp4), "--samples", str(a.samples)])
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
