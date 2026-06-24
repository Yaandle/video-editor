# vidkit

A three-panel video compositor with a 9:16 portrait canvas, multi-track timeline, and properties editor. Runs as a Python WebSocket backend with a vanilla JS browser frontend.

```
┌─────────────────────────────────────────┐
│  toolbar                                │
├───────────────────────┬─────────────────┤
│                       │                 │
│   canvas (9:16)       │   properties    │
│                       │                 │
├───────────────────────┴─────────────────┤
│  timeline  [audio] [text] [visual]      │
└─────────────────────────────────────────┘
```

## Stack

- **Backend** — Python 3.11+, `websockets`, PyQt5 (desktop mode) or headless WS server
- **Frontend** — Vanilla JS ES modules, HTML5 Canvas, no build step
- **Protocol** — JSON over WebSocket at `ws://localhost:8765`

## Install

```cmd
python -m venv videoeditor_venv
videoeditor_venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```cmd
python backend/main.py
```

Then visit `http://localhost:8765/editor.html`.

The backend serves the frontend, WebSocket, media upload, and render pipeline in one process. No second terminal needed.

The WS status dot in the toolbar turns green when the connection is live. Editing, timeline, and save/load work offline — the backend is only required for media upload and render.

## Project files

Save/load projects as `.vkit` (JSON). Example:

```json
{
  "name": "my-video",
  "canvas_w": 1080,
  "canvas_h": 1920,
  "fps": 30,
  "duration": 30.0,
  "clips": [...]
}
```

## Frontend

```
frontend/
├── editor.html
├── app.js
├── canvas.js
├── timeline.js
├── properties.js
├── playback.js
├── mediaBin.js
└── static/
```
## Backend

```
backend/
├── main.py
├── models.py
├── project_store.py
├── playback.py
└── websocket_server.py
```

| File | Responsibility |
|------|---------------|
| `main.py` | Entry point — starts the WS server |
| `models.py` | `Clip`, `Project`, `new_clip()`, `CLIP_TYPE_TRACK` |
| `project_store.py` | `save_project()`, `load_project()` — reads/writes `.vkit` JSON |
| `playback.py` | `PlaybackController` — tick loop, seek, play/pause state |
| `websocket_server.py` | `VideoEditorServer` — handles all client messages, broadcasts project state |

### Message flow

Frontend sends an action:
```json
{ "action": "add_clip", "clip_type": "narration", "start": 10.5 }
```

Backend mutates the project and broadcasts the full updated state to all connected clients:
```json
{ "type": "project", "data": { "name": "...", "clips": [...] } }
```

### Actions

| Action | Payload fields |
|--------|---------------|
| `add_clip` | `clip_type`, `start` |
| `delete_clip` | `id` |
| `duplicate_clip` | `id` |
| `update_clip` | `id`, + any clip fields to patch |
| `select_clip` | `id` |
| `play` | — |
| `pause` | — |
| `seek` | `t` |
| `new_project` | — |
| `load_project` | `path` |
| `save_project` | `path` (optional) |
| `render` | — |

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Delete` | Delete selected clip |
| `Ctrl+D` | Duplicate selected clip |
| `Ctrl+X / C / V` | Cut / Copy / Paste |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+N / O` | New / Open |
| `Ctrl+R` | Render |
