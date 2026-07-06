import os
import hashlib
import time
import uvicorn

from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.staticfiles import StaticFiles
from websocket_server import VideoEditorServer

# Try to import moviepy for media inspection. If unavailable, we'll still
# accept uploads but won't return rich metadata.
try:
    from moviepy.editor import VideoFileClip, AudioFileClip
    _HAS_MOVIEPY = True
except Exception:
    VideoFileClip = None
    AudioFileClip = None
    _HAS_MOVIEPY = False

# ── Paths (always correct regardless of launch directory) ─────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))  # .../backend
ROOT_DIR   = os.path.dirname(BASE_DIR)                    # .../video-editor
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")            # .../backend/uploads
STATIC_DIR = os.path.join(ROOT_DIR, "frontend")           # serves editor.html, app.js etc

os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────────
app    = FastAPI()
server = VideoEditorServer()

# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await server.handler(websocket)

# ── Upload ────────────────────────────────────────────────────────────────────
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    stem, ext  = os.path.splitext(file.filename)
    tag        = hashlib.md5(f"{stem}{time.time()}".encode()).hexdigest()[:8]
    name       = f"{stem}_{tag}{ext}"
    dest       = os.path.join(UPLOAD_DIR, name)
    content    = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    ext_lower = ext.lstrip(".").lower()
    kind = (
        "video" if ext_lower in ("mp4", "mov", "webm") else
        "audio" if ext_lower in ("mp3", "wav", "ogg")  else
        "image"
    )
    # Try to probe media metadata (duration, and for video width/height/fps)
    metadata = {}
    if _HAS_MOVIEPY and kind in ("audio", "video"):
        try:
            if kind == "video":
                clip = VideoFileClip(dest)
                metadata["duration"] = float(clip.duration) if clip.duration is not None else None
                # clip.size is (w, h)
                try:
                    metadata["width"], metadata["height"] = clip.size
                except Exception:
                    pass
                try:
                    metadata["fps"] = float(clip.fps) if hasattr(clip, "fps") else None
                except Exception:
                    pass
                try:
                    clip.reader.close()
                except Exception:
                    pass
                try:
                    clip.close()
                except Exception:
                    pass
            else:
                aclip = AudioFileClip(dest)
                metadata["duration"] = float(aclip.duration) if aclip.duration is not None else None
                try:
                    aclip.close()
                except Exception:
                    pass
        except Exception:
            # If probing fails, we leave metadata empty
            metadata = {}

    return {
        "name":     name,
        "original": file.filename,
        "url":      f"/media/{name}",
        "kind":     kind,
        "mime":     file.content_type,
        "size":     len(content),
        **({} if not metadata else {"metadata": metadata}),
    }

# ── Media list ────────────────────────────────────────────────────────────────
@app.get("/media-list")
async def list_media():
    items = []
    for fname in os.listdir(UPLOAD_DIR):
        fpath = os.path.join(UPLOAD_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        ext  = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        kind = (
            "video" if ext in ("mp4", "mov", "webm") else
            "audio" if ext in ("mp3", "wav", "ogg")  else
            "image"
        )
        item = {"name": fname, "url": f"/media/{fname}", "kind": kind}
        # Probe and attach metadata when possible
        if _HAS_MOVIEPY and kind in ("audio", "video"):
            try:
                if kind == "video":
                    clip = VideoFileClip(fpath)
                    item.setdefault("metadata", {})["duration"] = float(clip.duration) if clip.duration is not None else None
                    try:
                        item["metadata"]["width"], item["metadata"]["height"] = clip.size
                    except Exception:
                        pass
                    try:
                        item["metadata"]["fps"] = float(clip.fps) if hasattr(clip, "fps") else None
                    except Exception:
                        pass
                    try:
                        clip.reader.close()
                    except Exception:
                        pass
                    try:
                        clip.close()
                    except Exception:
                        pass
                else:
                    aclip = AudioFileClip(fpath)
                    item.setdefault("metadata", {})["duration"] = float(aclip.duration) if aclip.duration is not None else None
                    try:
                        aclip.close()
                    except Exception:
                        pass
            except Exception:
                # ignore probe failures
                pass

        items.append(item)
    return items

# ── Static mounts (specific before catch-all) ─────────────────────────────────
app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
app.mount("/",      StaticFiles(directory=STATIC_DIR, html=True), name="static")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)