# main.py
import asyncio, json, os, hashlib, time, wave, uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from websocket_server import PROJECTS_DIR, VideoEditorServer
from sfx_gen import ensure_sfx_pack, list_sfx_meta

try:
    from moviepy import VideoFileClip, AudioFileClip
    _HAS_MOVIEPY = True
except Exception:
    VideoFileClip = AudioFileClip = None
    _HAS_MOVIEPY = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
SFX_DIR = os.path.join(BASE_DIR, "sfx")
STATIC_DIR = os.path.join(ROOT_DIR, "frontend")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Probing a video/audio file's duration/size with moviepy spawns an ffmpeg
# process â€” cheap once, but /media-list used to redo this for every file on
# every project load. Cache results on disk keyed by (mtime, size) so an
# unchanged file is never re-probed.
_METADATA_CACHE_PATH = os.path.join(UPLOAD_DIR, ".metadata_cache.json")


def _load_metadata_cache():
    try:
        with open(_METADATA_CACHE_PATH, "r", encoding="utf8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_metadata_cache(cache):
    try:
        with open(_METADATA_CACHE_PATH, "w", encoding="utf8") as f:
            json.dump(cache, f)
    except Exception:
        pass


_metadata_cache = _load_metadata_cache()

_UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1MiB â€” bounds handler memory regardless of upload size
_PROBE_TIMEOUT_S = 60  # ffmpeg probe reads headers only and is normally near-instant;
                        # this is a safety net against a hang on a pathological file

# #72 â€” built-in sound-effect pack. Synthesized locally (no downloads, no
# committed binaries); a no-op after the first run since files persist.
ensure_sfx_pack(SFX_DIR)

app = FastAPI()
server = VideoEditorServer()


def _kind_of(ext):
    ext = ext.lstrip(".").lower()
    if ext in ("mp4", "mov", "webm"): return "video"
    if ext in ("mp3", "wav", "ogg"): return "audio"
    return "image"


def _probe_metadata(path, kind):
    meta = {}
    if not (_HAS_MOVIEPY and kind in ("audio", "video")):
        return meta
    try:
        if kind == "video":
            clip = VideoFileClip(path)
            meta["duration"] = float(clip.duration) if clip.duration is not None else None
            try: meta["width"], meta["height"] = clip.size
            except Exception: pass
            try: meta["fps"] = float(clip.fps) if hasattr(clip, "fps") else None
            except Exception: pass
            try: clip.reader.close()
            except Exception: pass
            try: clip.close()
            except Exception: pass
        else:
            aclip = AudioFileClip(path)
            meta["duration"] = float(aclip.duration) if aclip.duration is not None else None
            try: aclip.close()
            except Exception: pass
    except Exception:
        meta = {}
    return meta


def _probe_metadata_cached(fpath, kind, fname):
    """Same as _probe_metadata but skips the ffmpeg probe entirely when the
    file's mtime+size match what's already cached on disk."""
    try:
        st = os.stat(fpath)
        stamp = f"{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        return _probe_metadata(fpath, kind)

    cached = _metadata_cache.get(fname)
    if cached and cached.get("stamp") == stamp:
        return cached.get("metadata", {})

    metadata = _probe_metadata(fpath, kind)
    _metadata_cache[fname] = {"stamp": stamp, "metadata": metadata}
    return metadata


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await server.handler(websocket)


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    stem, ext = os.path.splitext(file.filename)
    tag = hashlib.md5(f"{stem}{time.time()}".encode()).hexdigest()[:8]
    name = f"{stem}_{tag}{ext}"
    dest = os.path.join(UPLOAD_DIR, name)
    size = 0
    with open(dest, "wb") as f:
        while chunk := await file.read(_UPLOAD_CHUNK_SIZE):
            f.write(chunk)
            size += len(chunk)

    kind = _kind_of(ext)
    # ffmpeg probing blocks; run off the event loop so other requests (and
    # the collab websocket) aren't stalled while a big video is probed. Bound
    # by a timeout so a pathological file can't hang the request forever.
    try:
        metadata = await asyncio.wait_for(
            run_in_threadpool(_probe_metadata_cached, dest, kind, name), timeout=_PROBE_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        metadata = {}
    _save_metadata_cache(_metadata_cache)

    return {
        "name": name, "original": file.filename, "url": f"/media/{name}",
        "kind": kind, "mime": file.content_type, "size": size,
        **({"metadata": metadata} if metadata else {}),
    }

@app.delete("/media/{name}")
async def delete_media(name: str):
    # prevent path traversal â€” only allow deleting exactly what's in UPLOAD_DIR
    safe_name = os.path.basename(name)
    fpath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="File not found")
    os.remove(fpath)
    return {"status": "deleted", "name": safe_name}

@app.get("/projects-list")
async def list_projects():
    items = []
    for fname in os.listdir(PROJECTS_DIR):
        if fname.endswith(".vkit"):
            items.append({"name": fname})
    items.sort(key=lambda i: i["name"].lower())
    return items


def _list_media_sync():
    items = []
    dirty = False
    for fname in os.listdir(UPLOAD_DIR):
        if fname.startswith("."):
            continue  # skip the metadata cache file itself
        fpath = os.path.join(UPLOAD_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        ext = fname.rsplit(".", 1)[-1] if "." in fname else ""
        kind = _kind_of(ext)
        item = {"name": fname, "url": f"/media/{fname}", "kind": kind}
        before = _metadata_cache.get(fname)
        metadata = _probe_metadata_cached(fpath, kind, fname)
        if _metadata_cache.get(fname) is not before:
            dirty = True
        if metadata:
            item["metadata"] = metadata
        items.append(item)
    if dirty:
        _save_metadata_cache(_metadata_cache)
    return items


@app.get("/media-list")
async def list_media():
    # Only ever hits ffmpeg for files that are new or changed since the last
    # call (see _probe_metadata_cached); run off the event loop regardless
    # since even a cold cache over many files takes real time.
    return await run_in_threadpool(_list_media_sync)


@app.get("/sfx-list")
async def list_sfx():
    items = []
    for meta in list_sfx_meta():
        fpath = os.path.join(SFX_DIR, meta["name"])
        if not os.path.isfile(fpath):
            continue
        duration = None
        try:
            with wave.open(fpath, "rb") as wf:
                duration = wf.getnframes() / float(wf.getframerate())
        except Exception:
            pass
        items.append({
            "name": meta["name"], "original": meta["label"], "url": f"/sfx/{meta['name']}",
            "kind": "audio", "category": meta["category"],
            **({"metadata": {"duration": duration}} if duration else {}),
        })
    return items


app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
app.mount("/sfx", StaticFiles(directory=SFX_DIR), name="sfx")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)
