# Audit — video-editor (vidkit) + text_to_video

Date: 2026-10-19. Scope: every source file in `F:\dev\video-editor\video-editor`
(base) and `F:\dev\video-editor\text_to_video` (donor). Venvs, caches, uploads
and rendered media were inventoried, not read.

---

## 1. What each system does

### 1.1 video-editor ("vidkit") — the base

A browser editor served by a Python process.

| Part | Files | What it does |
|---|---|---|
| Server | `backend/main.py` | FastAPI + uvicorn on :8765. Serves `frontend/`, `/upload`, `/media-list`, `/sfx-list`, `/projects-list`, a `/ws` WebSocket. |
| Project protocol | `backend/websocket_server.py` | Save / load / delete `.vkit` over WS, and **the export renderer** (moviepy composite). |
| Model | `backend/models.py`, `frontend/app.js` (`CLIP_DEFAULTS`) | One flat `Clip` with ~80 fields (text, code, graph, shape, crop, motion, transitions…), duplicated in Python and JS. |
| Text render (export) | `backend/text_anim.py` | PIL port of canvas.js's narration animations ("must stay identical" contract). |
| SFX | `backend/sfx_gen.py` | Pure-stdlib synthesis of 9 UI sounds into `backend/sfx/*.wav`. |
| Preview renderer | `frontend/canvas.js` (2,353 lines) | Canvas 2D preview *and* all on-canvas editing (drag, resize, group resize, crop, motion path, snapping guides). |
| Timeline | `frontend/timeline.js` | Canvas timeline, global layers with hide/eye, virtualized painting, razor, snapping to clip edges/playhead. |
| Properties | `frontend/properties.js` | Hand-built per-type property panel. |
| Advanced Text | `frontend/animationwindow.html` (1,415 lines) | Iframe modal ("Narration Studio") with its own **CSS-keyframe** preview, posting a JSON payload back to app.js. |
| Transport | `frontend/playback.js` | rAF-driven playhead. |
| Media bin | `frontend/mediaBin.js` | Upload grid + SFX list. |
| Tests | `backend/tests/*`, `frontend/tests/*` | Easing golden values, layer reorder math, timeline culling, upload, heavy/long-form render. |
| Misc | `app.py` (root) | A fake "Runtime Diagnostic Console" that prints random status lines. Not part of the product. |

### 1.2 text_to_video — the donor

A CLI / PyQt pipeline: prompt text with markers → ElevenLabs TTS → MoviePy video.

| Part | Files | What it does |
|---|---|---|
| Pipeline | `main.py` | Parses `[VisualiseCode]` / `[VisualiseGraph]` markers, times sections by character share of the TTS duration, renders narrative text via Playwright screenshots of `static/narrative_visualiser.html`, composites with MoviePy. |
| Narrative scene | `static/narrative_visualiser.html` | "Active line + two aged lines" layout, h1/h2/body hierarchy, `01 / 06` line counter, three styles (wordblurin / typewriter / linescan). |
| Code scene | `code_visualiser.py`, `static/master.css` | Carbon-style window, regex Python highlighter, captured with **Playwright `record_video_dir`** (real-time recording). |
| Graph scene | `graph_visualiser.py` | PIL frame-by-frame bar/line charts with easing, nice-tick axes. |
| Desktop UIs | `video_ui.py`, `video_compositor.py` | PyQt5 prompt editor, and a PyQt three-panel compositor that is the ancestor of vidkit's browser editor. |
| Archive | `archive/*` | Older generators, a React/Puppeteer chart pipeline (`animation_visualiser.py`, `component_catalogue.json` — "agent picks a component" catalogue), history HTML previews. |
| Secrets | `.env` | ElevenLabs + OpenAI keys (left untouched, not copied). |

---

## 2. What is duplicated

1. **Two renderers for one picture.** `canvas.js` (preview) and `text_anim.py` + moviepy (export)
   re-implement layout, easing, text styles, shapes, crop, motion keyframes and transitions.
   The README makes keeping them identical a manual rule ("update both files").
2. **The clip model three times.** `models.py` dataclass, `app.js` `CLIP_DEFAULTS`, and
   `video_compositor.py` `Clip` (PyQt). Fields drift (`text_shadow` vs `text_shadow_color`, see §3).
3. **The editor twice.** `video_compositor.py` (PyQt canvas/timeline/properties) and the browser
   editor. Same layout, same `CLIP_TYPE_TRACK`, same track colours.
4. **Themes four times.** `app.js THEMES`, `text_to_video/config.py THEMES`, `graph_visualiser.py THEMES`,
   `narrative_visualiser.html` / `renderglyphs.html` CSS themes — all different values for "dark".
5. **Easing tables twice** (`canvas.js Easing`, `text_anim.Easing`) plus a golden-value test that
   exists only to stop them drifting.
6. **Python syntax highlighters three times** (`canvas.js tokenizeCode`, `code_visualiser._highlight_python`,
   `video_ui._colorize_code`).
7. **SFX synthesis** exists only in vidkit; text_to_video has none — no overlap, but nothing beat-aware either.

---

## 3. What is broken (verified on this machine)

| # | Problem | Evidence | Impact |
|---|---|---|---|
| B1 | **Backend does not start.** `websocket_server.py` imports `from moviepy.video.fx import Resize, Rotate, …` (moviepy 2.x API) at module level; the venv has **moviepy 1.0.3** (`requirements.txt` pins it). | `ImportError: cannot import name 'Resize' from 'moviepy.video.fx'` | Editor loads only as static files; save/load/render all dead. |
| B2 | `requirements.txt` lists PyQt5/moviepy but not FastAPI/uvicorn/multipart; `requirements-dev.txt` and `pytest.ini` are deleted in the working tree. | `git status` | Fresh install cannot run the server. |
| B3 | **Preview ≠ export by design.** `scale_pop` falls back to a crossfade at export; `code` and `graph` clips are *skipped* at export; motion keyframes + rotation unsupported at export; glow/plate/underline/letter-spacing/font family ignored by PIL (always Consolas). | `websocket_server._run_render`, `text_anim.load_narration_font` | What you see is not what you get. |
| B4 | **Advanced Text preview is a third renderer.** CSS `@keyframes` + `setTimeout` typewriter; its "Easing" menu (`ease-in-out`, `cubic-bezier`, `steps`) is stored on the clip but read by neither canvas.js nor text_anim.py. | `animationwindow.html` L423-445, L817-820 | The modal previews motion that never reaches the timeline or the file. |
| B5 | **text_to_video's "deterministic" capture is not deterministic.** `narrative_visualiser.html` animates with CSS `animation` + `setTimeout`; Playwright screenshots catch whatever wall-clock state the page is in. `code_visualiser` records video in real time (`record_video_dir`, `wait_for_timeout(duration+2s)`). | `narrative_visualiser.html` `renderActiveLine`, `code_visualiser._capture_video_with_browser` | Frame content depends on machine load; re-renders differ. |
| B6 | **text_to_video `main.py` cannot run.** `config.py` was overwritten with the editor's config; `main.py`/`graph_visualiser.py` need `VIDEO_WIDTH`, `FPS`, `OUTPUT_DIR`, `ELEVENLABS_API_KEY`, `GRAPH_VIS_*`, `FONT_PATH_ARIAL`… | `config.py` (55 lines, none of those names) | AttributeError on import. |
| B7 | **Encoding damage in the working tree.** Uncommitted `frontend/app.js` and `canvas.js` were re-saved as UTF-8-with-BOM after being decoded as cp1252: `—` → `â€”`, `×` → `Ã—`, `·` → `Â·`, `…` → `â€¦`. Several of these are user-visible strings (crop badge, zoom badge, clip labels, canvas-size presets). Backend `.py` files have the same damage in comments. | `git diff frontend/canvas.js` | Garbled UI text. |
| B8 | **ffmpeg/ffprobe not on PATH.** PATH points at `<user>\Downloads\ffmpeg-8.0.1-essentials_build\…\bin`, which no longer exists; the build now lives at `<elsewhere>\ffmpeg-8.0.1-essentials_build\…\bin`. | `which ffmpeg` fails | Anything shelling out to ffmpeg fails. |
| B9 | **The venv was moved from E:.** `videoeditor_venv\Scripts\activate.bat` sets `VIRTUAL_ENV=E:\video-editor\…`; the `.exe` launchers (`pip.exe`, `uvicorn.exe`, `pytest.exe`) point at E:. `python.exe -m …` still works. | `pyvenv.cfg`, `activate.bat` | `uvicorn main:app` / `pytest` as documented fail. |
| B10 | Hard-coded separators and drive assumptions: `text_anim` font list (`C:/Windows/Fonts/consola.ttf`), `main.py` builds `file:///` URLs by string replace. | — | Fragile on other machines/drives. |
| B11 | Offline-first violated: `editor.html` and `animationwindow.html` load 7 families from `fonts.googleapis.com` at runtime; export (PIL) can't use them at all. | `<link href="https://fonts.googleapis.com/…">` | No fonts offline; preview/export mismatch. |
| B12 | Timing is not frame-quantized or beat-aware: clips start at arbitrary floats, there is no BPM/grid, SFX are placed by hand. | models | Cuts drift off the music. |
| B13 | Error handling swallows failures: export skips missing files / failed clips with a `print` and keeps going, producing a "successful" video with holes. | `_run_render` `continue` paths | Silent bad renders. |
| B14 | `app.py` at the repo root is a fake console that prints random "GPU 87%" lines — misleading next to real tooling. | file content | Confusing; retire. |
| B15 | Advanced Text **visual design** fights itself: neumorphic inset shadows and blur glass over a "brutalist" frame, all-caps headings, centred text by default, glow effect. See `docs/DESIGN_AUDIT.md`. | CSS | Off-brand, reads as generated. |

Not broken but weak: playback audio is scheduled with `setTimeout` per clip; `PlaybackController` advances by rAF deltas (fine for a transport, but nothing anchors it to an audio clock); the timeline has no beat grid; `_fitDuration` adds an arbitrary 2 s.

---

## 4. What is worth keeping

From **vidkit** (kept, refactored onto the new renderer):

- The **editor shell and interaction work**: global layers with hide/eye (#71), marquee + multi-select, group resize (#74), crop tool (#28), Animate Position/Zoom keyframes, equal-margin snapping guides (#61), razor, layer reorder math (`computeLayerReorder`, tested), timeline virtualization (`clipsInRange`, tested), undo/redo snapshots, keyboard shortcuts, media bin + upload, colour picker component.
- **The text layout engine idea** (`_layoutNarrationText`: words → chars with global indices) — becomes the core of the new text component, now with kerning-aware measurement and left alignment by default.
- **Code terminal** clip and tokenizer, **bar graph** clip, **shape** clip — ported as registry components.
- **SFX synthesis approach** (generate locally, no binaries) — rewritten in numpy, extended to a beat-locked kit and a music bed.
- Upload hygiene in `main.py` (chunked writes, metadata cache keyed by mtime+size, path-traversal guard).

From **text_to_video** (ported):

- **Text-to-scene logic**: marker parsing (`[VisualiseCode]`, `[VisualiseGraph]`), the h1/h2/body hierarchy heuristic, and section timing — becomes the deterministic `script → storyboard` converter (works with no LLM; the optional local LLM improves on it).
- **Narrative "active line + aged lines" scene** and the `01 / 06` **index counter** — reborn as the `narrative` scene and the `index-counter` component.
- **Nice-tick axis math** from `graph_visualiser._nice_tick`.
- **Component catalogue idea** (`component_catalogue.json`: id, best_for, data schema) — becomes the registry's per-component `meta` + JSON Schema, which is also what the LLM is constrained to.

Retired to `/legacy` (moved, not deleted): moviepy export path (`websocket_server.py` render, `text_anim.py`, `playback.py`), `models.py`/`project_store.py`, old `sfx_gen.py`, `animationwindow.html`, root `app.py`, all of `text_to_video`'s Python/HTML is left in place in its own folder (it is a separate repo) with the ported pieces credited in code comments.

---

## 5. Environment found

| Item | State |
|---|---|
| Python | 3.14.1 (`<user>\AppData\Local\Programs\Python\Python314`) |
| venv | `videoeditor_venv` (moved from E:, `python.exe -m` works); has fastapi, uvicorn, playwright 1.62, numpy 2.5, pillow 12.2, pydantic 2.13 |
| Node | 24.14.0 |
| Playwright browsers | `chromium-1248`, `chromium_headless_shell-1248`, `ffmpeg-1013` in `%LOCALAPPDATA%\ms-playwright` |
| ffmpeg | 8.0.1 essentials (gyan.dev) at `D:\Downloads\…\bin` — not on PATH |
| GPU | GeForce GTX 1660 SUPER, 6 GB (NVENC capable) |
| Local LLM | `llama-server.exe` via winget on PATH; model `<models dir>\Qwen2.5-7B-Instruct\qwen2.5-7b-instruct-q4_k_m-0000{1,2}-of-00002.gguf` present. `<llama.cpp dir>` and `env` are empty, and **no existing scripts that load a model were found** anywhere on the machine — so the integration uses the llama.cpp server that is actually installed. |
| Reference board image | **Not attached** to the prompt. Palette values in `design/tokens.json` are hand-set to the named colours and marked `unsampled`; `design/sample_palette.py` re-samples them from the board once it is dropped into `design/reference/`. |
