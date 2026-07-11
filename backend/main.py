# main.py
import os, hashlib, time, uvicorn
from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.staticfiles import StaticFiles
from websocket_server import VideoEditorServer

try:
    from moviepy.editor import VideoFileClip, AudioFileClip
    _HAS_MOVIEPY = True
except Exception:
    VideoFileClip = AudioFileClip = None
    _HAS_MOVIEPY = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(ROOT_DIR, "frontend")
os.makedirs(UPLOAD_DIR, exist_ok=True)

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


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await server.handler(websocket)


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    stem, ext = os.path.splitext(file.filename)
    tag = hashlib.md5(f"{stem}{time.time()}".encode()).hexdigest()[:8]
    name = f"{stem}_{tag}{ext}"
    dest = os.path.join(UPLOAD_DIR, name)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    kind = _kind_of(ext)
    metadata = _probe_metadata(dest, kind)

    return {
        "name": name, "original": file.filename, "url": f"/media/{name}",
        "kind": kind, "mime": file.content_type, "size": len(content),
        **({"metadata": metadata} if metadata else {}),
    }


@app.get("/media-list")
async def list_media():
    items = []
    for fname in os.listdir(UPLOAD_DIR):
        fpath = os.path.join(UPLOAD_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        ext = fname.rsplit(".", 1)[-1] if "." in fname else ""
        kind = _kind_of(ext)
        item = {"name": fname, "url": f"/media/{fname}", "kind": kind}
        metadata = _probe_metadata(fpath, kind)
        if metadata:
            item["metadata"] = metadata
        items.append(item)
    return items


app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)