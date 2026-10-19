"""CLI: python -m studio.render project.json [--range 2.0-4.5] [--preset 1080p30] [--draft]"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .engine import Job, RenderError, render
from .presets import PRESETS


def parse_range(s: str | None):
    if not s:
        return None, None
    a, _, b = s.partition("-")
    return (float(a) if a else None), (float(b) if b else None)


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.render", description="Deterministic render of a vidkit project.")
    ap.add_argument("project", help="project .json (or legacy .vkit)")
    ap.add_argument("--range", help="seconds, e.g. 2.0-4.5 (default: whole project)")
    ap.add_argument("--preset", default="1080p30", choices=list(PRESETS))
    ap.add_argument("--draft", action="store_true", help="half size, fast encode")
    ap.add_argument("--workers", type=int, default=0, help="Chromium workers (default from config.json)")
    ap.add_argument("--encoder", choices=["libx264", "nvenc"], default="libx264")
    ap.add_argument("--no-cache", action="store_true", help="re-render every chunk")
    ap.add_argument("--out", help="output .mp4 path")
    a = ap.parse_args(argv)
    t0, t1 = parse_range(a.range)
    job = Job(project_path=Path(a.project), preset=a.preset, t0=t0, t1=t1, draft=a.draft, workers=a.workers,
              encoder=a.encoder, use_cache=not a.no_cache, out=Path(a.out) if a.out else None)
    try:
        rep = render(job)
    except RenderError as e:
        print(f"\nRENDER FAILED {e}", file=sys.stderr)
        return 2
    print(f"\n✓ {rep['output']}  ({rep['seconds']} s, chunks {rep['chunks']['cached']} cached / {rep['chunks']['rendered']} rendered)")
    au = rep["audio"]["final"]
    print(f"  audio {au.get('integrated_lufs')} LUFS, TP {au.get('true_peak_dbtp')} dBTP · A/V drift {rep.get('av_drift_s', 0) * 1000:.1f} ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
