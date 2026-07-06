# vidkit

A three-panel video compositor with a configurable canvas (9:16, 16:9, 1:1, or custom), multi-track timeline, and properties editor.

```
┌─────────────────────────────────────────┐
│  toolbar                                │
├───────────────────────┬─────────────────┤
│                       │                 │
│  canvas (9:16/16:9…)  │   properties    │
│                       │                 │
├───────────────────────┴─────────────────┤
│  timeline  [audio] [text] [visual]      │
│            (stackable sub-layers)       │
└─────────────────────────────────────────┘
```

## Stack

- **Backend** — Python 3.11+, `websockets`, `moviepy`, `Pillow`, FastAPI, uvicorn
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
├── styles.css
└── static/
```

## Backend

```
backend/
├── main.py
├── models.py
├── project_store.py
├── playback.py
├── websocket_server.py
├── uploads/
└── projects/
```

| File | Responsibility |
|------|---------------|
| `frontend/editor.html` | App shell, toolbar, layout, and entrypoint for the editor UI |
| `frontend/app.js` | Main application controller, state management, WebSocket client, and UI wiring |
| `frontend/canvas.js` | HTML5 canvas renderer, clip preview, selection, drag, and canvas positioning |
| `frontend/timeline.js` | Timeline widget, clip layout, zoom/pan, scrub bar, and clip editing interactions |
| `frontend/properties.js` | Properties panel UI, clip property controls, and change dispatching |
| `frontend/playback.js` | Local playback state, play/pause/seek/tick loop, and frame stepping |
| `frontend/mediaBin.js` | Media upload browser, media list, and adding uploaded files to project clips |
| `frontend/styles.css` | Editor styling, panel layout, and theme visuals |
| `frontend/static/` | Static assets served by the backend alongside the editor UI |
| `backend/main.py` | FastAPI entrypoint, static file serving, `/upload`, `/media-list`, and WebSocket route registration |
| `backend/models.py` | Project and clip data models, serialization, and clip defaults |
| `backend/project_store.py` | `.vkit` save/load functionality for project persistence |
| `backend/playback.py` | Shared playback-related state and controls used by the backend server |
| `backend/websocket_server.py` | Server state, client registration, message handling, project broadcasts, and render task orchestration |
| `backend/uploads/` | Uploaded media assets and generated render output files |
| `backend/projects/` | Saved `.vkit` project files |

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


### Clip types

`narration`, `code`, `graph`, `image`, `video` — set via `clip_type` on `add_clip`.

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
