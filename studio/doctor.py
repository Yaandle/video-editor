"""Studio doctor — verifies the toolchain and fixes what it can.

    doctor.bat            or    python -m studio.doctor [--no-fix] [--llm-test] [--quick]

Prints a PASS / FIXED / SKIP / FAIL table and writes reports/doctor.json.
Exit code 1 when anything is FAIL.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

from . import config, paths, tooling

PASS, FIXED, SKIP, FAIL = "PASS", "FIXED", "SKIP", "FAIL"


class Doctor:
    def __init__(self, fix: bool = True):
        self.fix = fix
        self.rows: list[dict] = []

    def add(self, name: str, status: str, detail: str):
        self.rows.append({"check": name, "status": status, "detail": detail})
        mark = {"PASS": "✓", "FIXED": "✓", "SKIP": "–", "FAIL": "✗"}[status]
        print(f"  {mark} {name:<28} {status:<6} {detail}", flush=True)

    def run(self, name: str, fn):
        try:
            fn()
        except Exception as exc:  # a crashing check is a failing check, with its reason
            self.add(name, FAIL, f"{type(exc).__name__}: {exc}".splitlines()[0][:160])
            if os.environ.get("VIDKIT_DEBUG"):
                traceback.print_exc()

    # ── checks ────────────────────────────────────────────────────────────────

    def python(self):
        v = sys.version_info
        ok = v >= (3, 11)
        venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
        self.add("Python", PASS if ok else FAIL, f"{platform.python_version()} ({'venv ' + Path(sys.prefix).name if venv else 'system'}) {sys.executable}")

    def python_deps(self):
        mods = ["fastapi", "uvicorn", "websockets", "multipart", "playwright", "numpy", "PIL", "pydantic"]
        missing = [m for m in mods if not _importable(m)]
        if missing and self.fix:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(paths.ROOT / "requirements.txt")], capture_output=True, text=True)
            importlib.invalidate_caches()
            still = [m for m in missing if not _importable(m)]
            if not still:
                self.add("Python packages", FIXED, f"installed {', '.join(missing)}")
                return
            self.add("Python packages", FAIL, f"missing {', '.join(still)}; pip said: {r.stderr.strip()[-160:]}")
            return
        if missing:
            self.add("Python packages", FAIL, f"missing {', '.join(missing)} (pip install -r requirements.txt)")
            return
        import numpy, pydantic, playwright  # noqa
        from importlib.metadata import version
        self.add("Python packages", PASS, f"numpy {numpy.__version__}, pydantic {pydantic.__version__}, playwright {version('playwright')}, fastapi {version('fastapi')}")

    def node(self):
        exe = shutil.which("node")
        if not exe:
            self.add("Node.js", FAIL, "node not on PATH — install Node 18+ (needed for renderer events + tests)")
            return
        ver = subprocess.run([exe, "--version"], capture_output=True, text=True).stdout.strip()
        major = int(ver.lstrip("v").split(".")[0])
        r = subprocess.run([exe, "--test", "frontend/tests/*.test.mjs"], capture_output=True, text=True, cwd=str(paths.ROOT),
                           encoding="utf-8", errors="replace")
        summary = [ln.lstrip("ℹ# ").strip() for ln in r.stdout.splitlines() if ln.lstrip("ℹ# ").startswith(("pass ", "fail "))]
        if major < 18:
            self.add("Node.js", FAIL, f"{ver} is too old (need 18+)")
        elif r.returncode != 0:
            self.add("Node.js + renderer tests", FAIL, f"{ver}; tests failed: {' '.join(summary)} {r.stdout[-300:]}")
        else:
            self.add("Node.js + renderer tests", PASS, f"{ver}; {' '.join(summary)}; no npm packages required")

    def ffmpeg(self):
        d = config.ffmpeg_dir()
        status = PASS
        if not d and self.fix:
            ok, msg = tooling.install_ffmpeg_into_project()
            d = config.ffmpeg_dir()
            status = FIXED if ok and d else FAIL
            if status == FAIL:
                self.add("ffmpeg + ffprobe", FAIL, msg)
                return
        if not d:
            self.add("ffmpeg + ffprobe", FAIL, "not found (run doctor without --no-fix, or set ffmpeg.dir in config.json)")
            return
        ffm, ffp = config.ffmpeg(), config.ffprobe()
        v1, v2 = tooling.ffmpeg_version(ffm), tooling.ffmpeg_version(ffp)
        on_path = shutil.which("ffmpeg")
        where = paths.rel(d)
        note = "" if on_path else " (not on system PATH; .bat entry points and the studio prepend it)"
        self.add("ffmpeg + ffprobe", status, f"ffmpeg {v1}, ffprobe {v2} in {where}{note}")
        enc = tooling.encoders(ffm)
        need = [e for e in ("libx264", "aac") if e not in enc]
        hw = [e for e in ("h264_nvenc", "h264_qsv", "h264_amf") if e in enc]
        working = [e for e in hw if tooling.hw_encoder_works(ffm, e)]
        if need:
            self.add("Encoders", FAIL, f"missing {', '.join(need)}")
        else:
            self.add("Encoders", PASS, f"libx264, aac; hardware usable: {', '.join(working) or 'none'}"
                     + (f" (compiled but unusable: {', '.join(sorted(set(hw) - set(working)))})" if set(hw) - set(working) else ""))

    def playwright(self):
        import asyncio
        from playwright.async_api import async_playwright
        from .render import harness

        async def shot():
            async with async_playwright() as pw:
                b = await pw.chromium.launch()
                try:
                    h = await harness.open_page(b, 320, 180)
                    proj = _smoke_project(320, 180, 1.0)
                    await harness.load_project(h, proj, 320, 180)
                    rep = await harness.seek(h, 0.5)
                    png = await harness.capture_png(h)
                    return b.version, len(png), len(rep["boxes"])
                finally:
                    await b.close()
        try:
            ver, size, boxes = asyncio.run(shot())
            self.add("Playwright Chromium", PASS, f"Chromium {ver}; 1-frame headless render ok ({size} B PNG, {boxes} boxes reported)")
        except Exception as exc:
            msg = str(exc)
            if self.fix and ("Executable doesn't exist" in msg or "playwright install" in msg):
                subprocess.run([sys.executable, "-m", "playwright", "install", "chromium", "chromium-headless-shell"], capture_output=True)
                ver, size, boxes = asyncio.run(shot())
                self.add("Playwright Chromium", FIXED, f"installed browser; Chromium {ver}; 1-frame render ok ({size} B)")
            else:
                raise

    def assets(self):
        tokens = json.loads(paths.TOKENS.read_text(encoding="utf-8"))
        missing, lic = [], set()
        for role, f in tokens["fonts"].items():
            if not (paths.ROOT / f["file"]).is_file():
                missing.append(f["file"])
            if not (paths.ROOT / f.get("licence", "")).is_file():
                missing.append(f"licence for {f['family']}")
            lic.add(f["family"])
        self.add("Fonts (self-hosted)", FAIL if missing else PASS,
                 f"missing {', '.join(missing)}" if missing else f"{', '.join(sorted(lic))} with OFL licences")
        icons = list((paths.ICONS / "phosphor-bold").glob("*.svg"))
        ok_i = len(icons) > 20 and (paths.ICONS / "LICENSE-phosphor.txt").is_file()
        self.add("Icons", PASS if ok_i else FAIL, f"{len(icons)} Phosphor (bold) SVGs + MIT licence" if ok_i else "icons or licence missing")
        man = json.loads(paths.MANIFEST.read_text(encoding="utf-8")) if paths.MANIFEST.is_file() else {"images": []}
        bad = [i["file"] for i in man["images"] if not (paths.ROOT / i["file"]).is_file() or not i.get("license") or not i.get("author") or not i.get("source_url")]
        self.add("Images + MANIFEST", FAIL if bad or not man["images"] else PASS,
                 f"problems: {bad[:4]}" if bad else f"{len(man['images'])} photos/textures, each with source, author, licence")
        paths.ensure_dirs()
        self.add("Asset folders", PASS, ", ".join(paths.rel(d) for d in paths.REQUIRED_DIRS[:6]) + " …")

    def disk(self):
        probe = paths.RENDERS / f".write_test_{os.getpid()}"
        probe.write_bytes(b"x" * 1024)
        probe.unlink()
        free = shutil.disk_usage(paths.ROOT).free / 1e9
        drive = paths.ROOT.anchor or "/"
        self.add("Write access + disk", PASS if free > 2 else FAIL, f"{drive} writable, {free:.1f} GB free" + ("" if free > 2 else " (need > 2 GB)"))

    def lint(self):
        from . import lint_motion
        n, problems = lint_motion.run()
        self.add("Motion lint", FAIL if problems else PASS, f"{len(problems)} problem(s): {problems[:2]}" if problems else f"{n} renderer files clean")

    def schema_and_grid(self):
        from . import beatgrid, jsbridge, schema
        showcase = paths.PROJECTS / "showcase.json"
        p = schema.load(showcase)
        errs = jsbridge.validate_props(p)
        r = beatgrid.validate(p, jsbridge.events(p))
        ok = not errs and not r["violations"]
        self.add("Schema + beat grid", PASS if ok else FAIL,
                 f"showcase.json valid; {r['checked']} cuts/hits checked, {len(r['violations'])} off-grid" if ok else f"props: {errs[:2]} grid: {r['violations'][:2]}")

    def smoke_render(self):
        from .render.engine import Job, render
        work = paths.CACHE / "doctor"
        work.mkdir(parents=True, exist_ok=True)
        proj = _smoke_project(640, 360, 2.0)
        pj = work / "smoke.json"
        pj.write_text(json.dumps(proj), encoding="utf-8")
        t = time.time()
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rep = render(Job(project_path=pj, project=None, preset="project", workers=2, use_cache=False, out=work / "smoke.mp4"))
        v = [s for s in rep["ffprobe"]["streams"] if s["type"] == "video"][0]
        a = [s for s in rep["ffprobe"]["streams"] if s["type"] == "audio"][0]
        au = rep["audio"]["final"]
        self.add("Smoke render (2 s)", PASS,
                 f"{v['frames']} frames {v['width']}x{v['height']} h264 + {a['codec']} {a['sample_rate']} Hz, drift {rep['av_drift_s'] * 1000:.1f} ms, "
                 f"{au['integrated_lufs']} LUFS / {au['true_peak_dbtp']} dBTP, {time.time() - t:.1f} s")

    def llm(self, test: bool):
        from .llm import client
        st = client.status()
        if not st["available"]:
            self.add("Local LLM (optional)", SKIP, f"LLM: skipped — {st['reason']}")
            return
        if not test:
            self.add("Local LLM (optional)", PASS, f"available: {Path(st['model']).name} via {Path(st['server']).name} (not loaded; --llm-test to try)")
            return
        t = time.time()
        out = client.generate_json("Return a JSON object with key ok set to true.", {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, max_tokens=20)
        self.add("Local LLM (optional)", PASS if out.get("ok") is True else FAIL, f"generated {out} in {time.time() - t:.1f} s")


def _importable(m: str) -> bool:
    try:
        importlib.import_module(m)
        return True
    except Exception:
        return False


def _smoke_project(w: int, h: int, dur: float) -> dict:
    return {
        "schema": "vidkit.project", "version": 1, "name": "doctor-smoke",
        "settings": {"width": w, "height": h, "fps": 30, "bpm": 120, "subdivision": 1, "beat_offset": 0, "beat_lock": True,
                     "duration": dur, "background": "paper", "style_pack": "neo-brutal"},
        "tracks": [{"index": 0, "name": "A"}],
        "clips": [
            {"id": "b", "type": "block", "layer": 1, "start": 0, "duration": dur, "x": 0.72, "y": 0.5, "props": {"w": 560, "h": 420, "fill": "lime"}},
            {"id": "t", "type": "text", "layer": 0, "start": 0, "duration": dur, "x": 0.08, "y": 0.3,
             "props": {"text": "Smoke test\n[[passes.]]", "role": "display", "anim_unit": "line", "anim_from": "mask", "anim_preset": "slam", "exit_to": "none"}},
        ],
        "audio": {"music": {"preset": "brutal-bounce", "seed": 3, "gain_db": -2, "end_hit": False}, "auto_sfx": True, "sfx_gain_db": 0, "target_lufs": -14, "cues": []},
        "meta": {},
    }


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="python -m studio.doctor")
    ap.add_argument("--no-fix", action="store_true", help="report only, change nothing")
    ap.add_argument("--llm-test", action="store_true", help="load the local model and generate a token")
    ap.add_argument("--quick", action="store_true", help="skip the smoke render")
    a = ap.parse_args(argv)
    os.environ["PATH"] = config.subprocess_env()["PATH"]
    print(f"\nvidkit studio doctor — {paths.ROOT}\n")
    d = Doctor(fix=not a.no_fix)
    d.run("Python", d.python)
    d.run("Python packages", d.python_deps)
    d.run("Node.js", d.node)
    d.run("ffmpeg + ffprobe", d.ffmpeg)
    d.run("Playwright Chromium", d.playwright)
    d.run("Assets", d.assets)
    d.run("Write access + disk", d.disk)
    d.run("Motion lint", d.lint)
    d.run("Schema + beat grid", d.schema_and_grid)
    if not a.quick:
        d.run("Smoke render (2 s)", d.smoke_render)
    d.run("Local LLM (optional)", lambda: d.llm(a.llm_test))
    fails = [r for r in d.rows if r["status"] == FAIL]
    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} CHECK(S) FAILED") + "\n")
    paths.REPORTS.mkdir(exist_ok=True)
    (paths.REPORTS / "doctor.json").write_text(json.dumps({"when": datetime.now().isoformat(timespec="seconds"), "rows": d.rows}, indent=2), encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
