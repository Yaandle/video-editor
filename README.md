# vidkit

A video compositor with a configurable canvas (9:16, 16:9, 1:1, or custom), toolbar, multi-track timeline, and properties editor.

```
┌──────────────────────────────────────────────────────────────┐
│ toolbar                                                      │
├───────────────┬────────────────────────┬─────────────────────┤
│               │                        │                     │
│               │                        │                     │
│   Media Bin   │      Canvas            │    Properties       │
│               │      (9:16 / 16:9)     │                     │
│               │                        │                     │
│               │                        │                     │
├───────────────┴────────────────────────┴─────────────────────┤
│ timeline     [audio] [text] [visual] (stackable sub-layers)  │
└──────────────────────────────────────────────────────────────┘
```

## Stack

- **Backend** — Python 3.11+, `websockets`, `moviepy`, `Pillow`, FastAPI, uvicorn
- **Frontend** — Vanilla JS ES modules, HTML5 Canvas, no build step
- **Protocol** — JSON over WebSocket at `ws://localhost:8765`

## Install

​```cmd
python -m venv videoeditor_venv

# Windows
videoeditor_venv\Scripts\activate

# macOS/Linux
source videoeditor_venv/bin/activate

pip install -r requirements.txt
​```

> Tested on Windows only. Should work cross-platform since the backend/frontend have no OS-specific dependencies, but not yet verified.


## Run

```cmd
python backend/main.py
```

Visit `http://localhost:8765/editor.html`. The backend serves frontend, WebSocket, upload, and render in one process — no second terminal needed.

The WS status dot turns green when connected. Editing, timeline, and save/load work offline; the backend is only required for upload and render.

## Project files

Saved as `.vkit` (JSON):

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

## App Directory

| File | Responsibility |
|------|---------------|
| `frontend/editor.html` | App shell, toolbar, layout, entrypoint |
| `frontend/app.js` | State management, WebSocket client, UI wiring |
| `frontend/canvas.js` | Canvas renderer, clip preview, selection, drag |
| `frontend/timeline.js` | Timeline widget, clip layout, zoom/pan, scrub bar |
| `frontend/properties.js` | Properties panel, clip property controls, dispatching |
| `frontend/playback.js` | Local play/pause/seek/tick loop, frame stepping |
| `frontend/mediaBin.js` | Media upload browser, add media to project clips |
| `frontend/colourPicker.js` | Color picker component for clip properties |
| `frontend/styles.css` | Editor styling, panel layout, theme |
| `frontend/static/` | Static assets served alongside the editor UI |
| `backend/main.py` | FastAPI entrypoint, static serving, `/upload`, `/media-list`, WS route |
| `backend/models.py` | Project/clip data models, serialization, defaults |
| `backend/project_store.py` | `.vkit` save/load |
| `backend/playback.py` | Shared playback state/controls |
| `backend/websocket_server.py` | Client registration, message handling, broadcasts, render orchestration |
| `backend/text_anim.py` | Python port of canvas.js narration animation math, used at render/export time |
| `backend/uploads/` | Uploaded media + render output |
| `backend/projects/` | Saved `.vkit` files |

### Message flow

Frontend sends an action:
```json
{ "action": "add_clip", "clip_type": "narration", "start": 10.5 }
```

Backend mutates project state and broadcasts full state to all clients:
```json
{ "type": "project", "data": { "name": "...", "clips": [...] } }
```

### Actions

| Action | Payload fields |
|--------|---------------|
| `add_clip` | `clip_type`, `start` |
| `delete_clip` | `id` |
| `duplicate_clip` | `id` |
| `update_clip` | `id`, + fields to patch |
| `select_clip` | `id` |
| `play` / `pause` | — |
| `seek` | `t` |
| `new_project` | — |
| `load_project` | `path` |
| `save_project` | `path` (optional) |
| `render` | — |

### Clip types

`narration`, `code`, `graph`, `image`, `video` — via `clip_type` on `add_clip`.

### Animation sync requirement

`canvas.js` (preview) and `text_anim.py` (render) must match exactly, or preview ≠ export. Keep identical: easing functions, timing math (msPerChar, popMs, stagger, duration), scale/alpha/blur transforms, and all `render_narration_*` logic. Shared params (`text_chars_per_second`, `text_duration_ms`, etc.) already pass through the clip object — no code change needed there when users adjust values. **When editing any animation effect: update both files.**

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


