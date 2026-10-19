"""Editor backend.

    start.bat     or     python -m studio.server [--open] [--port 8765]

Serves the editor, projects (REST, with autosave + recent list), uploads, the
render queue (progress over a WebSocket, cancel), a synthesized audio preview of
the timeline, exact video frames, and the optional local-LLM tools.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import os
import shutil
import threading
import time
import uuid
import wave
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, jsbridge, paths, schema
from .render import vframes
from .render.engine import Job, RenderError, render

paths.ensure_dirs()
app = FastAPI(title="vidkit studio")
RECENT = paths.PROJECTS / "recent.json"
_clients: set[WebSocket] = set()
_loop: asyncio.AbstractEventLoop | None = None


def _safe_name(name: str, exts=(".json", ".vkit")) -> Path:
    base = os.path.basename(name)
    if not base or base.startswith("."):
        raise HTTPException(400, "bad file name")
    if not base.endswith(exts):
        base += ".json"
    return paths.PROJECTS / base


def _error(code: str, message: str, status: int = 400, **extra):
    return JSONResponse({"ok": False, "code": code, "message": message, **extra}, status_code=status)


def _touch_recent(file: str):
    items = json.loads(RECENT.read_text(encoding="utf-8")) if RECENT.is_file() else []
    items = [i for i in items if i["file"] != file]
    items.insert(0, {"file": file, "opened": datetime.now().isoformat(timespec="seconds")})
    RECENT.write_text(json.dumps(items[:12], indent=2), encoding="utf-8")


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(config.ffmpeg_dir())}


@app.get("/api/projects")
def list_projects():
    items = []
    for p in sorted(paths.PROJECTS.iterdir(), key=lambda x: -x.stat().st_mtime):
        if p.is_file() and p.suffix in (".json", ".vkit") and p.name != "recent.json":
            items.append({"file": p.name, "name": p.stem, "kind": "legacy" if p.suffix == ".vkit" else "v1",
                          "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")})
    recent = json.loads(RECENT.read_text(encoding="utf-8")) if RECENT.is_file() else []
    autosaves = [{"file": a.name, "modified": datetime.fromtimestamp(a.stat().st_mtime).isoformat(timespec="seconds")}
                 for a in sorted(paths.AUTOSAVE.glob("*.json"), key=lambda x: -x.stat().st_mtime)]
    return {"projects": items, "recent": recent, "autosaves": autosaves}


@app.get("/api/projects/{name}")
def get_project(name: str):
    path = _safe_name(name)
    if not path.is_file():
        return _error("not_found", f"No project called {path.name} in projects/", 404)
    try:
        data = schema.load(path)
    except ValueError as e:
        return _error("invalid_project", str(e), 422)
    _touch_recent(path.name)
    return {"ok": True, "file": path.name, "project": data, "migrated": path.suffix == ".vkit"}


@app.put("/api/projects/{name}")
def save_project(name: str, project: dict = Body(...)):
    path = _safe_name(name, exts=(".json",))
    try:
        data = schema.validate(project)
    except ValueError as e:
        return _error("invalid_project", str(e), 422)
    errs = jsbridge.validate_props(data)
    if errs:
        return _error("invalid_props", "Some clip properties are invalid:\n" + "\n".join(errs[:10]), 422)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    _touch_recent(path.name)
    return {"ok": True, "file": path.name}


@app.post("/api/autosave/{name}")
def autosave(name: str, project: dict = Body(...)):
    base = os.path.basename(name).replace(".json", "") or "untitled"
    out = paths.AUTOSAVE / f"{base}.json"
    out.write_text(json.dumps({"saved": datetime.now().isoformat(timespec="seconds"), "project": project}), encoding="utf-8")
    return {"ok": True, "file": out.name}


@app.get("/api/autosave/{name}")
def get_autosave(name: str):
    p = paths.AUTOSAVE / os.path.basename(name)
    if not p.is_file():
        return _error("not_found", "no autosave", 404)
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/catalogue")
def catalogue():
    return jsbridge.catalogue()


@app.post("/api/validate")
def validate(project: dict = Body(...)):
    try:
        data = schema.validate(project)
    except ValueError as e:
        return {"ok": False, "errors": str(e).splitlines()[1:]}
    from . import beatgrid
    errs = jsbridge.validate_props(data)
    grid = beatgrid.validate(data, jsbridge.events(data))
    return {"ok": not errs and not grid["violations"], "errors": errs, "beat_grid": grid}


# ── Media ─────────────────────────────────────────────────────────────────────

def _kind(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    return "video" if ext in ("mp4", "mov", "webm", "mkv") else "audio" if ext in ("mp3", "wav", "ogg", "m4a", "flac") else "image"


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    stem, ext = os.path.splitext(os.path.basename(file.filename or "upload"))
    tag = hashlib.md5(f"{stem}{time.time()}".encode()).hexdigest()[:8]
    dest = paths.UPLOADS / f"{stem}_{tag}{ext}"
    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(1 << 20):
            f.write(chunk)
            size += len(chunk)
    meta = await run_in_threadpool(_probe, dest)
    return {"name": dest.name, "original": file.filename, "url": f"media/uploads/{dest.name}", "kind": _kind(ext), "size": size, "metadata": meta}


def _probe(p: Path) -> dict:
    if _kind(p.suffix) == "image":
        return {}
    try:
        from .render import ffmpeg as ff
        info = ff.summarize(ff.probe(p))
        v = [s for s in info["streams"] if s["type"] == "video"]
        return {"duration": info["duration"], **({"width": v[0]["width"], "height": v[0]["height"], "fps": v[0]["fps"]} if v else {})}
    except Exception:
        return {}


@app.get("/media-list")
def media_list():
    out = []
    for p in sorted(paths.UPLOADS.iterdir()):
        if p.is_file() and not p.name.startswith("."):
            out.append({"name": p.name, "url": f"media/uploads/{p.name}", "kind": _kind(p.suffix)})
    for i in json.loads(paths.MANIFEST.read_text(encoding="utf-8")).get("images", []):
        out.append({"name": Path(i["file"]).name, "url": i["file"], "kind": "image", "library": True,
                    "credit": f"{i['author']} — {i['license']}"})
    return out


@app.get("/media-meta/{name}")
def media_meta(name: str):
    p = paths.UPLOADS / os.path.basename(name)
    if not p.is_file():
        return _error("not_found", "file not found", 404)
    return _probe(p)


@app.delete("/media/uploads/{name}")
def delete_media(name: str):
    p = paths.UPLOADS / os.path.basename(name)
    if not p.is_file():
        return _error("not_found", "file not found", 404)
    trash = paths.MEDIA / ".trash"
    trash.mkdir(exist_ok=True)
    shutil.move(str(p), str(trash / p.name))       # recoverable, never hard-deleted
    return {"ok": True, "moved_to": paths.rel(trash / p.name)}


@app.get("/api/vframe")
def vframe(src: str, fps: float, frame: int):
    try:
        return FileResponse(vframes.frame_path(src, fps, frame), media_type="image/png")
    except FileNotFoundError as e:
        return _error("missing_media", str(e), 404)


# ── Audio preview ─────────────────────────────────────────────────────────────

@app.post("/api/audio/preview")
def audio_preview(project: dict = Body(...)):
    """The mastered timeline mix as WAV (same mix the export muxes)."""
    from .audio import mix
    try:
        data = schema.validate(project)
        events = jsbridge.events(data)
        master, stats = mix.master_timeline(data, events)
    except Exception as e:
        return _error("audio_failed", f"Could not build the audio preview: {e}", 422)
    pcm = (master.clip(-1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(mix.SR); w.writeframes(pcm)
    return Response(buf.getvalue(), media_type="audio/wav", headers={"X-Integrated-LUFS": str(stats.get("pre_master", {}).get("integrated_lufs"))})


# ── Render queue ──────────────────────────────────────────────────────────────

JOBS: dict[str, dict] = {}
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="render")


def _push(msg: dict):
    if _loop is None:
        return
    async def send():
        dead = []
        for ws in list(_clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _clients.discard(ws)
    asyncio.run_coroutine_threadsafe(send(), _loop)


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if k not in ("_job",)}


def _run_job(jid: str):
    j = JOBS[jid]
    j["status"] = "running"
    j["started"] = time.time()
    _push({"type": "render", "job": _public(j)})

    def progress(p):
        j["progress"] = {k: p.get(k) for k in ("stage", "done", "total", "percent", "eta", "fps")}
        _push({"type": "render", "job": _public(j)})
    j["_job"].on_progress = progress
    try:
        rep = render(j["_job"])
        j.update(status="done", output=rep["output"], report={k: rep.get(k) for k in ("seconds", "chunks", "audio", "av_drift_s", "warnings")})
    except RenderError as e:
        j.update(status="cancelled" if e.code == "cancelled" else "failed", error=str(e), code=e.code)
    except Exception as e:  # surface everything; never a silent failure
        j.update(status="failed", error=f"{type(e).__name__}: {e}", code="internal")
    j["finished"] = time.time()
    _push({"type": "render", "job": _public(j)})


@app.post("/api/render")
def queue_render(body: dict = Body(...)):
    project = body.get("project")
    if not project:
        return _error("no_project", "Send the project to render.")
    try:
        data = schema.validate(project)
    except ValueError as e:
        return _error("invalid_project", str(e), 422)
    name = data["name"]
    src = paths.CACHE / "jobs" / f"{uuid.uuid4().hex[:8]}.json"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(json.dumps(data), encoding="utf-8")
    t0, t1 = body.get("t0"), body.get("t1")
    jid = uuid.uuid4().hex[:8]
    job = Job(project_path=src, project=data, preset=body.get("preset", "1080p30"), draft=bool(body.get("draft")),
              t0=float(t0) if t0 is not None else None, t1=float(t1) if t1 is not None else None)
    JOBS[jid] = {"id": jid, "name": name, "preset": job.preset + ("-draft" if job.draft else ""), "range": [t0, t1],
                 "status": "queued", "progress": None, "queued": time.time(), "_job": job}
    _executor.submit(_run_job, jid)
    _push({"type": "render", "job": _public(JOBS[jid])})
    return {"ok": True, "id": jid}


@app.get("/api/render/jobs")
def jobs():
    return [_public(j) for j in sorted(JOBS.values(), key=lambda j: -j["queued"])]


@app.post("/api/render/{jid}/cancel")
def cancel(jid: str):
    j = JOBS.get(jid)
    if not j:
        return _error("not_found", "no such job", 404)
    j["_job"].cancel.set()
    if j["status"] == "queued":
        j["status"] = "cancelled"
        _push({"type": "render", "job": _public(j)})
    return {"ok": True}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    _clients.add(websocket)
    try:
        await websocket.send_json({"type": "hello", "jobs": [_public(j) for j in JOBS.values()]})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)


# ── Local LLM (optional) ──────────────────────────────────────────────────────

@app.get("/api/llm/status")
def llm_status():
    from .llm import client
    return client.status()


@app.post("/api/llm/storyboard")
def llm_storyboard(body: dict = Body(...)):
    from .llm import storyboard as sb
    script = str(body.get("script", "")).strip()
    if not script:
        return _error("empty_script", "Paste a script first.")
    return sb.make_storyboard(script, name=body.get("name") or "storyboard", use_llm=bool(body.get("use_llm", True)))


@app.post("/api/llm/headlines")
def llm_headlines(body: dict = Body(...)):
    from .llm import storyboard as sb
    return sb.headline_variants(str(body.get("text", "")))


@app.post("/api/llm/captions")
def llm_captions(body: dict = Body(...)):
    from .llm import storyboard as sb
    return sb.chunk_captions(str(body.get("text", "")), int(body.get("max_words", 6)))


@app.on_event("startup")
async def _startup():
    global _loop
    _loop = asyncio.get_running_loop()


# Static last, so /api routes win.
app.mount("/assets", StaticFiles(directory=paths.ASSETS), name="assets")
app.mount("/design", StaticFiles(directory=paths.DESIGN), name="design")
app.mount("/media", StaticFiles(directory=paths.MEDIA), name="media")
app.mount("/renders", StaticFiles(directory=paths.RENDERS), name="renders")
app.mount("/", StaticFiles(directory=paths.FRONTEND, html=True), name="frontend")


def main(argv=None) -> int:
    import uvicorn
    ap = argparse.ArgumentParser(prog="python -m studio.server")
    ap.add_argument("--port", type=int, default=config.get("server", "port"))
    ap.add_argument("--host", default=config.get("server", "host"))
    ap.add_argument("--open", action="store_true", help="open the editor in the default browser")
    a = ap.parse_args(argv)
    os.environ["PATH"] = config.subprocess_env()["PATH"]
    url = f"http://{a.host}:{a.port}/editor.html"
    if a.open:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"vidkit studio → {url}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
