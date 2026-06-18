# backend/main.py — FastAPI server replacing both http.server and the old WS server
import asyncio, json, mimetypes, shutil, uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

BASE     = Path(__file__).parent
FRONTEND = BASE.parent / 'frontend'
UPLOADS  = BASE / 'uploads'
PROJECTS = BASE / 'projects'

for d in (UPLOADS, PROJECTS):
    d.mkdir(exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'], allow_methods=['*'], allow_headers=['*'],
)

# ── Serve frontend ──────────────────────────────────────────────────────────────
app.mount('/static', StaticFiles(directory=FRONTEND / 'static'), name='static')

@app.get('/')
async def index():
    return FileResponse(FRONTEND / 'editor.html')

@app.get('/{filename:path}')
async def frontend_file(filename: str):
    path = FRONTEND / filename
    if path.exists() and path.is_file():
        return FileResponse(path)
    raise HTTPException(404)

# ── Media upload ────────────────────────────────────────────────────────────────
ALLOWED_TYPES = {
    # video
    'video/mp4', 'video/webm', 'video/quicktime',
    # audio
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
    # image / svg
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'image/svg+xml',
}

@app.post('/upload')
async def upload_file(file: UploadFile = File(...)):
    mime = file.content_type or mimetypes.guess_type(file.filename)[0] or ''
    if mime not in ALLOWED_TYPES:
        raise HTTPException(415, f'Unsupported type: {mime}')

    suffix  = Path(file.filename).suffix.lower()
    uid     = uuid.uuid4().hex[:8]
    name    = f'{Path(file.filename).stem}_{uid}{suffix}'
    dest    = UPLOADS / name

    with dest.open('wb') as f:
        shutil.copyfileobj(file.file, f)

    # Determine broad media kind for the frontend
    kind = (
        'video' if mime.startswith('video') else
        'audio' if mime.startswith('audio') else
        'svg'   if mime == 'image/svg+xml' else
        'image'
    )

    return JSONResponse({
        'name':     name,
        'original': file.filename,
        'url':      f'/media/{name}',
        'kind':     kind,
        'mime':     mime,
        'size':     dest.stat().st_size,
    })

@app.get('/media/{filename}')
async def serve_media(filename: str):
    path = UPLOADS / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)

@app.get('/media')
async def list_media():
    files = []
    for p in UPLOADS.iterdir():
        if p.is_file():
            mime = mimetypes.guess_type(p.name)[0] or ''
            kind = (
                'video' if mime.startswith('video') else
                'audio' if mime.startswith('audio') else
                'svg'   if mime == 'image/svg+xml' else
                'image'
            )
            files.append({
                'name': p.name, 'url': f'/media/{p.name}',
                'kind': kind,  'size': p.stat().st_size,
            })
    return files

# ── Project save/load ───────────────────────────────────────────────────────────
@app.post('/projects/{name}')
async def save_project(name: str, body: dict):
    dest = PROJECTS / f'{name}.vkit'
    dest.write_text(json.dumps(body, indent=2))
    return {'saved': dest.name}

@app.get('/projects/{name}')
async def load_project(name: str):
    path = PROJECTS / f'{name}.vkit'
    if not path.exists():
        raise HTTPException(404)
    return json.loads(path.read_text())

@app.get('/projects')
async def list_projects():
    return [p.stem for p in PROJECTS.glob('*.vkit')]

# ── WebSocket ───────────────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)
    async def broadcast(self, msg: dict):
        for ws in self.active:
            await ws.send_json(msg)

manager = ConnectionManager()

@app.websocket('/ws')
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get('type')

            if msg_type == 'render':
                await ws.send_json({'type': 'render_status', 'status': 'queued'})
                # TODO: hook into render pipeline

            elif msg_type == 'save_project':
                name = data.get('data', {}).get('name', 'untitled')
                path = PROJECTS / f'{name}.vkit'
                path.write_text(json.dumps(data['data'], indent=2))
                await ws.send_json({'type': 'saved', 'name': name})

    except WebSocketDisconnect:
        manager.disconnect(ws)

if __name__ == '__main__':
    uvicorn.run('main:app', host='0.0.0.0', port=8765, reload=True)