"""Stills: exact frames as PNG through the export harness (same pixels as the mp4).

    python -m studio.render.stills projects/math-code-demo.json --at 2.5,6,9.75
    python -m studio.render.stills projects/x.json --every 2 --scale 0.5 --out reports/stills/x

Each still is written as <name>_<t>s.png next to <name>_<t>s.json (the renderer's
report for that frame: boxes, warnings, styles). Faster than a range render when
all you need is to look at a few frames, and nothing is cached or encoded.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .. import paths, schema
from . import harness


async def capture(project: dict, times: list[float], out: Path, scale: float = 1.0) -> list[Path]:
    from playwright.async_api import async_playwright
    s = project["settings"]
    w, h = int(round(s["width"] * scale)) // 2 * 2, int(round(s["height"] * scale)) // 2 * 2
    out.mkdir(parents=True, exist_ok=True)
    written = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=harness.launch_args())
        try:
            page = await harness.open_page(browser, w, h)
            await harness.load_project(page, project, w, h)
            for t in times:
                report = await harness.seek(page, t)
                png = await harness.capture_png(page)
                stem = f"{project['name']}_{t:07.3f}s".replace(".", "_")
                (out / f"{stem}.png").write_bytes(png)
                (out / f"{stem}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
                written.append(out / f"{stem}.png")
                warn = report.get("warnings") or []
                print(f"  {t:7.3f}s  {stem}.png" + (f"  ⚠ {'; '.join(warn[:3])}" if warn else ""))
        finally:
            await browser.close()
    return written


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.render.stills", description=__doc__.splitlines()[0])
    ap.add_argument("project")
    ap.add_argument("--at", help="comma-separated seconds, e.g. 1.5,3,4.25")
    ap.add_argument("--every", type=float, help="one still every N seconds over the whole project")
    ap.add_argument("--scale", type=float, default=1.0, help="size relative to the project (0.5 = half)")
    ap.add_argument("--out", help="output folder (default reports/stills/<name>)")
    a = ap.parse_args(argv)
    project = schema.load(Path(a.project))
    dur = float(project["settings"]["duration"])
    times = [float(v) for v in a.at.split(",")] if a.at else []
    if a.every:
        k = 0
        while k * a.every < dur:
            times.append(round(k * a.every, 3))
            k += 1
    if not times:
        ap.error("give --at or --every")
    out = Path(a.out) if a.out else paths.REPORTS / "stills" / project["name"]
    asyncio.run(capture(project, sorted(set(times)), out, a.scale))
    print(f"✓ {len(set(times))} stills in {paths.rel(out) if hasattr(paths, 'rel') else out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
