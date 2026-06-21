import os
import hashlib
import time
import uvicorn

from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.staticfiles import StaticFiles
from websocket_server import VideoEditorServer

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
    return {
        "name":     name,
        "original": file.filename,
        "url":      f"/media/{name}",
        "kind":     kind,
        "mime":     file.content_type,
        "size":     len(content),
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
        items.append({
            "name": fname,
            "url":  f"/media/{fname}",
            "kind": kind,
        })
    return items

# ── Static mounts (specific before catch-all) ─────────────────────────────────
app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
app.mount("/",      StaticFiles(directory=STATIC_DIR, html=True), name="static")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)