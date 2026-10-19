"""Render engine: project.json → validated → chunked deterministic capture →
ffmpeg → muxed, probed mp4 + report.

Each chunk is a fixed run of frames aligned to absolute frame numbers and is
cached under renders/.cache/chunks/<key>.mp4, keyed by everything that can
change its pixels. Re-rendering a range only renders the chunks it touches;
an interrupted render resumes from the chunks already on disk.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from .. import beatgrid, config, jsbridge, lint_motion, paths, schema
from ..audio import mix
from . import ffmpeg as ff
from . import harness, presets

CHUNK_DIR = paths.CACHE / "chunks"


class RenderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"[{code}] {message}")
        self.code = code


class Cancelled(RenderError):
    def __init__(self):
        super().__init__("cancelled", "render cancelled")


@dataclass
class Job:
    project_path: Path
    preset: str = "1080p30"
    t0: Optional[float] = None
    t1: Optional[float] = None
    draft: bool = False
    workers: int = 0
    encoder: str = "libx264"
    use_cache: bool = True
    out: Optional[Path] = None
    project: Optional[dict] = None              # already-loaded project (server), else read from path
    on_progress: Optional[Callable[[dict], None]] = None
    cancel: threading.Event = field(default_factory=threading.Event)


class Log:
    def __init__(self, path: Path, echo: bool = True):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.f = path.open("w", encoding="utf-8")
        self.echo = echo

    def __call__(self, msg: str):
        line = f"{datetime.now().strftime('%H:%M:%S')} {msg}"
        self.f.write(line + "\n")
        self.f.flush()
        if self.echo:
            print(line, flush=True)

    def close(self):
        self.f.close()


def _hash_files(files) -> str:
    h = hashlib.sha256()
    for f in sorted(files, key=lambda p: str(p)):
        h.update(str(paths.rel(f)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def renderer_hash() -> str:
    files = [p for p in paths.RENDERER.rglob("*.js")] + [paths.FRONTEND / "render.html", paths.TOKENS]
    return _hash_files(files)[:24]


def _asset_refs(clip: dict) -> list[str]:
    refs = []
    if clip.get("src"):
        refs.append(clip["src"])

    def walk(v):
        if isinstance(v, str) and (v.startswith("assets/") or v.startswith("media/")):
            refs.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(clip.get("props") or {})
    return refs


def check_assets(project: dict) -> list[str]:
    missing = []
    tokens = json.loads(paths.TOKENS.read_text(encoding="utf-8"))
    for role, f in tokens.get("fonts", {}).items():
        if not (paths.ROOT / f["file"]).is_file():
            missing.append(f"font {f['family']} ({role}): {f['file']}")
    for c in project["clips"]:
        for ref in _asset_refs(c):
            if not (paths.ROOT / ref.lstrip("/")).is_file():
                missing.append(f"clip {c['id']}: {ref}")
    return missing


def chunk_key(project: dict, preset, fa: int, fb: int, rhash: str, encoder: str) -> str:
    s = project["settings"]
    fps = s["fps"]
    ta, tb = fa / fps, fb / fps
    overlapping = [c for c in project["clips"] if c["start"] < tb and c["start"] + c["duration"] > ta]
    timing = [(c["id"], c["type"], c["layer"], round(c["start"], 6), round(c["duration"], 6)) for c in project["clips"]]
    assets = []
    for c in overlapping:
        for ref in _asset_refs(c):
            p = paths.ROOT / ref.lstrip("/")
            if p.is_file():
                st = p.stat()
                assets.append((ref, st.st_size, st.st_mtime_ns))
    blob = json.dumps({"r": rhash, "s": s, "tracks": project.get("tracks"), "w": preset.width, "h": preset.height,
                       "crf": preset.crf, "x264": preset.x264, "enc": encoder, "fa": fa, "fb": fb,
                       "clips": overlapping, "timing": timing, "assets": assets}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


def _slim(rep: dict) -> dict:
    def r(v):
        return round(v, 1) if isinstance(v, float) else v
    boxes = [{k: r(v) for k, v in b.items() if k != "container" or v} for b in rep.get("boxes", [])]
    return {"frame": rep["frame"], "t": rep["t"], "animating": rep.get("animating", False), "boxes": boxes,
            "warnings": rep.get("warnings", []), "clips": rep.get("clips", [])}


async def _render_chunk(h: harness.Page, project: dict, preset, fa: int, fb: int, dest: Path, encoder: str,
                        job: Job, tick: Callable[[int], None]) -> None:
    fps = project["settings"]["fps"]
    tmp = dest.with_suffix(".part.mp4")
    rep_tmp = dest.with_suffix(".part.jsonl")
    args = ff.encode_args(fps, fb - fa, preset, tmp, encoder)
    proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
                                                stderr=asyncio.subprocess.PIPE, env=config.subprocess_env())
    reports = []
    try:
        for f in range(fa, fb):
            if job.cancel.is_set():
                raise Cancelled()
            rep = await harness.seek(h, f / fps)
            if rep["frame"] != f:
                raise RenderError("frame_mismatch", f"harness rendered frame {rep['frame']} for requested {f}")
            png = await harness.capture_png(h)
            proc.stdin.write(png)
            await proc.stdin.drain()
            reports.append(_slim(rep))
            tick(1)
        proc.stdin.close()
        err = (await proc.stderr.read()).decode(errors="replace")
        rc = await proc.wait()
        if rc != 0:
            raise RenderError("encode_failed", f"ffmpeg exited {rc} on frames {fa}-{fb}: {err[-400:]}")
    except BaseException:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        tmp.unlink(missing_ok=True)
        raise
    got = ff.summarize(ff.probe(tmp))
    vs = [s for s in got["streams"] if s["type"] == "video"]
    if not vs or vs[0]["frames"] != fb - fa:
        tmp.unlink(missing_ok=True)
        raise RenderError("frame_count", f"chunk {fa}-{fb}: expected {fb - fa} frames, ffprobe counted {vs[0]['frames'] if vs else 0}")
    rep_tmp.write_text("\n".join(json.dumps(r, separators=(",", ":")) for r in reports) + "\n", encoding="utf-8")
    os.replace(rep_tmp, dest.with_suffix(".jsonl"))
    os.replace(tmp, dest)


async def _capture(project: dict, preset, todo: list[tuple[int, int, Path]], workers: int, encoder: str, job: Job,
                   log: Log, progress: dict) -> None:
    from playwright.async_api import async_playwright
    queue: asyncio.Queue = asyncio.Queue()
    for item in todo:
        queue.put_nowait(item)
    errors: list[BaseException] = []

    def tick(n):
        progress["done"] += n
        _emit(job, progress, log)

    async with async_playwright() as pw:
        async def worker(wi: int):
            browser = await pw.chromium.launch(args=["--disable-lcd-text", "--font-render-hinting=none", "--force-color-profile=srgb"])
            try:
                h = await harness.open_page(browser, preset.width, preset.height)
                await harness.load_project(h, project, preset.width, preset.height)
                while not queue.empty() and not errors:
                    fa, fb, dest = queue.get_nowait()
                    await _render_chunk(h, project, preset, fa, fb, dest, encoder, job, tick)
                    log(f"chunk {fa:>6}-{fb:<6} rendered by worker {wi}")
            except BaseException as exc:      # first failure stops everyone
                errors.append(exc)
                job.cancel.set() if not isinstance(exc, Cancelled) else None
            finally:
                await browser.close()

        await asyncio.gather(*(worker(i) for i in range(workers)))
    if errors:
        real = [e for e in errors if not isinstance(e, Cancelled)]
        raise real[0] if real else errors[0]


def _emit(job: Job, p: dict, log: Log | None = None):
    elapsed = time.time() - p["t_start"]
    done, total = p["done"], max(1, p["total"])
    rate = done / elapsed if elapsed > 0 and done else 0
    eta = (total - done) / rate if rate else None
    p.update(elapsed=round(elapsed, 1), fps=round(rate, 2), eta=round(eta, 1) if eta is not None else None,
             percent=round(100 * done / total, 1))
    if job.on_progress:
        job.on_progress(dict(p))
    if log and (done == total or done % 30 == 0):
        eta_s = f"{int(eta // 60)}:{int(eta % 60):02d}" if eta is not None else "--:--"
        log(f"progress {done}/{total} frames  {p['percent']:5.1f}%  {rate:5.1f} fps  ETA {eta_s}")


def render(job: Job) -> dict:
    """Run a render job synchronously (spins its own event loop). Returns the report."""
    t_start = time.time()
    paths.ensure_dirs()
    project = job.project or schema.load(Path(job.project_path))
    name = project["name"].replace(" ", "_")
    s = project["settings"]
    p = presets.get(job.preset, job.draft, s)
    if p.fps and p.fps != s["fps"]:
        project = schema.validate({**project, "settings": {**s, "fps": p.fps}})
        s = project["settings"]
    fps = s["fps"]
    total = int(round(s["duration"] * fps))
    f0 = 0 if job.t0 is None else max(0, int(round(job.t0 * fps)))
    f1 = total if job.t1 is None else min(total, int(round(job.t1 * fps)))
    if f1 <= f0:
        raise RenderError("bad_range", f"empty range {job.t0}-{job.t1} (project is {s['duration']} s)")
    suffix = "" if (f0 == 0 and f1 == total) else f"_{f0 / fps:.2f}-{f1 / fps:.2f}s"
    out = job.out or (paths.RENDERS / name / f"{name}_{p.name}{suffix}.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    log = Log(out.with_suffix(".log"))
    report: dict = {"project": project["name"], "source": str(job.project_path), "preset": p.name, "size": [p.width, p.height],
                    "fps": fps, "range": {"frames": [f0, f1], "seconds": [f0 / fps, f1 / fps]}, "output": paths.rel(out),
                    "started": datetime.now().isoformat(timespec="seconds"), "warnings": []}
    try:
        log(f"render {project['name']} preset={p.name} {p.width}x{p.height}@{fps} frames {f0}-{f1} ({(f1 - f0) / fps:.2f} s)")
        # 1. Gate checks — every one of these fails the render, never warns past it.
        n_files, problems = lint_motion.run()
        if problems:
            raise RenderError("motion_lint", f"{len(problems)} problem(s): " + "; ".join(problems[:5]))
        report["lint"] = {"files": n_files, "problems": 0}
        prop_errors = jsbridge.validate_props(project)
        if prop_errors:
            raise RenderError("invalid_props", "; ".join(prop_errors[:8]))
        missing = check_assets(project)
        if missing:
            raise RenderError("missing_asset", "; ".join(missing[:8]))
        events = jsbridge.events(project)
        bg = beatgrid.validate(project, events)
        report["beat_grid"] = {"checked": bg["checked"], "violations": bg["violations"], "skipped": bg["skipped"]}
        if s.get("beat_lock") and bg["violations"]:
            raise RenderError("off_grid", f"{len(bg['violations'])} event(s) more than 1 frame off the beat grid: {bg['violations'][:4]}")
        log(f"checks ok: lint {n_files} files, props ok, assets ok, beat grid {bg['checked']} events / {len(bg['violations'])} off")

        # 2. Plan chunks.
        cf = max(1, int(round(config.get("render", "chunk_seconds") * fps)))
        rhash = renderer_hash()
        CHUNK_DIR.mkdir(parents=True, exist_ok=True)
        chunks = []
        for k in range(f0 // cf, math.ceil(f1 / cf)):
            fa, fb = k * cf, min((k + 1) * cf, total)
            key = chunk_key(project, p, fa, fb, rhash, job.encoder)
            chunks.append((fa, fb, CHUNK_DIR / f"{key}.mp4"))
        todo = [c for c in chunks if not (job.use_cache and c[2].is_file() and c[2].with_suffix(".jsonl").is_file())]
        report["chunks"] = {"total": len(chunks), "cached": len(chunks) - len(todo), "rendered": len(todo), "frames_per_chunk": cf}
        log(f"chunks: {len(chunks)} total, {len(chunks) - len(todo)} cached, {len(todo)} to render")

        # 3. Capture missing chunks in parallel.
        workers = max(1, min(job.workers or config.get("render", "workers"), len(todo) or 1))
        progress = {"stage": "frames", "done": 0, "total": sum(fb - fa for fa, fb, _ in todo), "t_start": time.time()}
        if todo:
            asyncio.run(_capture(project, p, todo, workers, job.encoder, job, log, progress))
        report["workers"] = workers
        report["frames_rendered"] = progress["done"]

        # 4. Assemble video for the exact range.
        if job.on_progress:
            job.on_progress({"stage": "assemble", "percent": 100.0, "done": progress["done"], "total": progress["total"]})
        work = paths.CACHE / "work" / hashlib.sha1(str(out).encode()).hexdigest()[:12]
        work.mkdir(parents=True, exist_ok=True)
        lst = work / "concat.txt"
        lst.write_text("".join(f"file '{c[2].as_posix()}'\n" for c in chunks), encoding="utf-8")
        joined = work / "video.mp4"
        ff.run(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])
        c0 = chunks[0][0]
        if f0 != c0 or f1 != chunks[-1][1]:
            trimmed = work / "video_trim.mp4"
            ff.run(["-y", "-v", "error", "-i", str(joined), "-vf", f"trim=start_frame={f0 - c0}:end_frame={f1 - c0},setpts=PTS-STARTPTS",
                    "-c:v", "libx264", "-preset", p.x264, "-crf", str(p.crf), "-pix_fmt", "yuv420p", *ff.COLOR, "-r", str(fps), str(trimmed)])
            joined = trimmed

        # 5. Audio for the same frames, then mux.
        wav = work / "audio.wav"
        audio = mix.render_range(project, events, f0, f1, wav)
        report["audio"] = audio
        log(f"audio: {audio['final'].get('integrated_lufs')} LUFS, true peak {audio['final'].get('true_peak_dbtp')} dBTP, "
            f"clipped samples {audio['clipped_samples']}")
        ff.run(["-y", "-v", "error", "-i", str(joined), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                "-c:a", "aac", "-b:a", p.audio_bitrate, "-ar", "48000", "-movflags", "+faststart", str(out)])

        # 6. Validate the file we are about to hand over.
        info = ff.summarize(ff.probe(out))
        report["ffprobe"] = info
        v = [x for x in info["streams"] if x["type"] == "video"]
        a = [x for x in info["streams"] if x["type"] == "audio"]
        problems = []
        if len(v) != 1 or len(a) != 1:
            problems.append(f"expected 1 video + 1 audio stream, got {len(v)} + {len(a)}")
        if v and v[0]["frames"] != f1 - f0:
            problems.append(f"frame count {v[0]['frames']} != expected {f1 - f0}")
        if v and (v[0]["width"], v[0]["height"]) != (p.width, p.height):
            problems.append(f"size {v[0]['width']}x{v[0]['height']} != {p.width}x{p.height}")
        if v and abs(v[0]["fps"] - fps) > 0.01:
            problems.append(f"frame rate {v[0]['fps']} != {fps}")
        if v and a:
            drift = abs(v[0]["duration"] - a[0]["duration"])
            report["av_drift_s"] = round(drift, 4)
            if drift > 1.0 / fps + 1e-3:
                problems.append(f"audio/video duration drift {drift * 1000:.1f} ms > 1 frame")
        if audio["clipped_samples"]:
            problems.append(f"{audio['clipped_samples']} clipped audio samples")
        tp = audio["final"].get("true_peak_dbtp")
        if tp is not None and tp > mix.TP_MAX + 0.05:
            problems.append(f"true peak {tp} dBTP above {mix.TP_MAX}")
        if problems:
            raise RenderError("validation", "; ".join(problems))

        # 7. Frame reports for the quality gate.
        reports_path = out.with_suffix(".frames.jsonl")
        with reports_path.open("w", encoding="utf-8") as fo:
            for fa, fb, dest in chunks:
                for line in dest.with_suffix(".jsonl").read_text(encoding="utf-8").splitlines():
                    if line and f0 <= json.loads(line)["frame"] < f1:
                        fo.write(line + "\n")
        warn = {}
        for line in reports_path.read_text(encoding="utf-8").splitlines():
            for w in json.loads(line)["warnings"]:
                warn[w] = warn.get(w, 0) + 1
        report["warnings"] = [f"{w} (x{n})" for w, n in warn.items()]
        report["frame_reports"] = paths.rel(reports_path)
        report["events"] = {k: len(v) for k, v in events.items()}
        report["status"] = "ok"
        report["seconds"] = round(time.time() - t_start, 1)
        log(f"done: {paths.rel(out)} in {report['seconds']} s — {info['streams'][0]['frames']} frames, "
            f"A/V drift {report.get('av_drift_s', 0) * 1000:.1f} ms")
        shutil.rmtree(work, ignore_errors=True)
        return report
    except RenderError as e:
        report.update(status="failed", error=str(e), code=e.code)
        log(f"FAILED {e}")
        raise
    except harness.HarnessError as e:
        report.update(status="failed", error=str(e), code="harness")
        log(f"FAILED [harness] {e}")
        raise RenderError("harness", str(e)) from e
    finally:
        report["finished"] = datetime.now().isoformat(timespec="seconds")
        out.with_suffix(".report.json").write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        log.close()
