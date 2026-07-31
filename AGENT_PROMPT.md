# Vidkit — Coding Agent Handover Prompt

You are taking over active development of **vidkit**, a browser-based video editor built with vanilla JavaScript, HTML5 Canvas, and a Python/FastAPI/WebSocket backend. Your job is to **read the codebase, find weaknesses, and improve or rewrite anything that will make the product more robust, performant, or maintainable** — without changing public behaviour the user can already see working.

---

## Repo layout

```
E:\video-editor\video-editor\
  frontend/
    editor.html          — app shell, single-page layout
    styles.css           — all CSS, CSS vars for theming
    app.js               — state, CLIP_DEFAULTS, Clip/Project classes, keyboard, undo/redo (~1700 lines)
    canvas.js            — HTML5 Canvas renderer + interaction (~1650 lines)
    timeline.js          — timeline canvas widget (~560 lines)
    properties.js        — right-hand properties panel (~430 lines)
    mediaBin.js          — media browser / file upload panel (~190 lines)
    playback.js          — rAF-driven playback clock (~70 lines)
    colorPicker.js       — standalone colour picker widget
    animationwindow.html — Advanced Text animation modal (iframe, postMessage bridge)
  backend/
    main.py              — FastAPI app, /upload endpoint, serves frontend
    websocket_server.py  — WebSocket message handlers, MoviePy render pipeline (~700 lines)
    models.py            — Clip + Project dataclasses (single source of truth for fields)
    project_store.py     — JSON load/save to disk
    text_anim.py         — Pillow-based narration animation frame renderer (~600 lines)
    playback.py          — backend real-time preview (frame streaming over WS)
```

---

## Architecture — critical concepts

### Clip data model
`CLIP_DEFAULTS` in `app.js` is the **single source of truth** for every clip field and its default. `models.py` mirrors it exactly. Any new field must be added in both. `Clip.toDict()` / `Project.toDict()` serialize over WebSocket. `Project.from_dict` in Python filters unknown keys so old saves don't crash on load.

### Coordinate system
- Canvas position: `clip.x`, `clip.y` are **normalised 0–1** fractions of the canvas (`canvas_w` × `canvas_h`, default 1080×1920).
- Media sizing: `scale_x`, `scale_y` are multipliers on top of a `_place()` fit that constrains to 88% w / 80% h.
- Motion keyframes: `[{t, x, y}, {t, x, y}]` where `t` is a 0–1 fraction of clip duration (not absolute seconds).

### Canvas render loop
`canvas.js` is purely **snapshot-based** — every frame is drawn from scratch at the current `playhead`. There is no CSS animation or interpolation outside of this. The playhead is driven by `playback.js` via `requestAnimationFrame`. `_activeClips()` filters to clips whose `[start, start+duration)` window contains the current playhead, then each is drawn via `_drawClipWithTransition → _drawClip`.

### `ctx.globalAlpha` composition rule
**Always use `*=` not `=`** when touching `ctx.globalAlpha` inside any draw path. The transition wrapper (`_drawClipWithTransition`) may set an outer alpha, and overwriting it breaks fade/slide-out effects. This applies to narration text opacity, glow, linescan, and shape opacity.

### Transitions (#63)
Six types: `fade`, `slide_up`, `slide_down`, `slide_left`, `slide_right`, `scale_pop`. Fields on every clip: `transition_in`, `transition_in_ms`, `transition_out`, `transition_out_ms`. Canvas applies them in `_transitionState()` + `_drawClipWithTransition()`. Backend mirrors them in `_apply_transitions()` using MoviePy `crossfadein`/`crossfadeout` + `set_position(callable)` with the same ease-out-cubic. `scale_pop` falls back to fade at render (noted in code).

### Animation (text clips, #66)
`text_anim_style` selects the animation type (`typewriter`, `fade`, `slideup`, `scalepop`, `wordblur`, `charstagger`, `linescan`, `glitch`). `text_delay_ms` defers the animation start; `text_anim_easing` is passed to the canvas renderer. `text_anim.py` has the Python-side Pillow renderers. `wordblurin` and `wordblur` are aliased — always normalise to `wordblur` on the JS side.

### Advanced Text modal
`animationwindow.html` is loaded in an iframe. Communication is via `postMessage`. Flow: app.js calls `_clipToAdvancedState(clip)` → posts to iframe → user edits → iframe posts back `{type:'advancedtext:apply', animation:{...}, text:{...}}` → `_applyAdvancedTextToClip()` writes to clip → `_previewClipAnimation(clip)` auto-plays to show the effect. Tabs: Text / Animate / Effects (Style tab was removed in the previous session).

### Timeline
`timeline.js` uses a second `<canvas>` element. Multi-select via Ctrl/Cmd-click or marquee drag on empty track area. Group drag moves all selected clips simultaneously. Resize by dragging the right edge of a clip. Pan via Alt+drag or middle-mouse. Zoom via scroll.

### Undo / redo
`app.js` maintains a `_undoStack` (array of serialised project JSON strings, max 100 entries). Every committed edit pushes to the stack. Arrow-key nudges are debounced 400ms before committing.

### WebSocket protocol (abbreviated)
All messages are JSON `{type, ...}`. Important ones:
- `project:load` / `project:save` / `project:new`
- `clip:add`, `clip:update`, `clip:delete`
- `render:start` → streams `render:progress` → `render:done` / `render:error`
- `preview:frame` (real-time playback frames from backend)

---

## What was done in the last two sessions (already committed)

| Issue | What changed |
|-------|-------------|
| **#66** | `text_delay_ms` + `text_anim_easing` round-trip (CLIP_DEFAULTS → canvas → properties → modal → back). Canvas hides text during delay period. Auto-play on Apply. `wordblur` alias in `text_anim.py`. |
| **#66 UI** | Removed Style tab from Advanced Text modal. Colour moved to Text tab, Background Plate moved to Effects tab. |
| **#67a** | Timeline marquee multi-select on empty area. Ctrl/Cmd-click additive toggle. Group drag for all selected clips. |
| **#67b** | MediaBin panel-wide OS drag-drop. Document-level dragover/drop prevention. `dragDepth` counter for child-boundary safety. |
| **#67c** | Properties panel: W/H spinners for image/video/shape via `getClipProjectSize` / `setClipProjectSize` hooks on canvas. |
| **#67d** | Arrow-key nudge: plain = 0.5%, Ctrl = 2% of canvas. Debounced undo commit. Shift+Arrow preserved for frame-step. |
| **#64** | Motion path section in properties: start/end X/Y + t-fraction timing + Clear button. Ctrl-click bypass snap during capture. ▶ Preview clip button. |
| **#63** | Six transition types on all non-audio clips, properties UI, canvas draw, backend MoviePy render. |

---

## Known rough edges / improvement candidates

These are areas worth looking at for rewrites or improvements. Use your judgement — don't break working behaviour, but don't be afraid to refactor.

### `app.js`
- Very large (~1700 lines). No obvious split yet, but event wiring, undo management, and WebSocket handling could be extracted into separate modules.
- `_wireKeyboard()` handles many unrelated key bindings in one function — a dispatch table would be cleaner.
- `_applyAdvancedTextToClip()` and `_clipToAdvancedState()` should be the single source of truth for what the modal can touch; double-check for any field drift between those two functions and `CLIP_DEFAULTS`.
- Undo snapshot (`_undoStack`) serialises the entire project on every edit. For large projects this is wasteful — consider diffing or storing only the changed clip.
- `_selectedIds` is a `Set<string>` but `_selectionPrimaryId` and `_selectedId` are separate scalars that can drift out of sync. Consolidate into a single selection model.
- `_previewClipAnimation` uses a crude seek+play heuristic. If the playback is already playing at an unrelated position, calling this unexpectedly disrupts the user.

### `canvas.js`
- `_drawClip` is a massive switch on `clip_type`. Each branch could be a separate method (`_drawNarration`, `_drawCode`, `_drawGraph`, etc.) for readability.
- `_drawnRects` is populated during draw and consumed by hit-testing and `getClipProjectSize`. The map is never explicitly cleared on project change, which could cause stale hits if clip IDs are reused.
- `_layoutNarrationText` is duplicated between `canvas.js` and `text_anim.py` — the logic must stay in sync. A shared spec comment (or at minimum a warning) should make this explicit.
- Text animation styles `charstagger`, `glitch`, and `linescan` exist in canvas.js but may be missing or incomplete in `text_anim.py` (render path). Check parity.
- `_transitionState` is called every frame per clip. Cache the computed `{ alpha, dx, dy, scale }` per-frame if profiling shows it's hot.
- Rotation (`clip.rotation`) is parsed in the shape branch but not applied in image/video draw paths — clips with `rotation` set to non-zero on media would silently ignore it.
- `getClipProjectSize` / `setClipProjectSize` depend on `_drawnRects` being populated at the current playhead. If the clip is off-screen at the playhead they return null. The properties panel handles this with a fallback message, but it's fragile.

### `timeline.js`
- Marquee selection currently hit-tests clip rects against the drag rect using canvas-space coordinates. Verify that the content-space → canvas-space transform (pan + zoom) is applied consistently in both the draw and hit-test paths.
- Layer drag: when dragging a group of clips across tracks, only the primary clip changes layer by the delta — other clips in the group should too. Verify the group-drag layer logic is correct.
- Clip labels truncate at hardcoded pixel widths. At high zoom levels short clips can overflow their labels. Add a clip-width-aware truncation.
- `_reflowLayers` recomputes per-track row heights. If this is called on every redraw it may be slow for large projects. Cache the result and only recompute on structural changes.
- No snap-to-clips during drag. Snapping dragged clip edges to existing clip edges (with a ~4px tolerance) is a standard timeline UX improvement.

### `properties.js`
- `_rebuild()` destroys and recreates the entire panel DOM on every selection change. For a panel with many sections this causes layout thrash. Consider caching section elements and updating values in place.
- Duplicate controls: `font_size`, `font_color`, `font_bold`, `font_italic`, `text_anim_style` exist in both the properties panel and the Advanced Text modal. This was deferred — the plan is to remove the duplicates from properties and make the modal the single source of truth after animation-apply is confirmed working.
- Motion path section only appears when `clip.motion_keyframes` has ≥ 2 entries. There's no way to *start* a motion path from properties alone — you must use the canvas tools first. A "Add motion path" button that sets two default keyframes would close this gap.
- The "▶ Preview clip" button dispatches `props:previewclip` — app.js handles this. Ensure the handler cleans up properly if the clip changes before playback ends.

### `mediaBin.js`
- Drag-from-bin onto the **timeline** at a specific time position is not yet wired. `card.dragstart` sets `application/vidkit-media` data. The timeline needs a `drop` handler that reads this and adds the clip at the dropped time.
- `_removeItem` only removes from the local `_items` array — it doesn't delete the file from the server. Either add a backend delete endpoint or make the remove button clearly labelled "Remove from list" (not "Delete file").

### `text_anim.py`
- `load_narration_font` silently falls back to the default PIL font if Consolas isn't found. The default font ignores the size argument — frames rendered on Linux/Mac will have tiny unreadable text. Add a warning log and try more system fonts.
- `layout_narration_text` mirrors `canvas.js`'s layout logic but the two can drift. Add a comment block at the top of each function explicitly naming the other as the reference and listing which parameters must match.
- Missing render parity: `charstagger`, `glitch`, `linescan`, `scalepop` animations are in canvas.js but the Python renderers in `ANIM_RENDERERS` may not cover all of them — any missing ones fall back to a static frame. Audit and implement or document each gap.

### `websocket_server.py`
- The render pipeline builds a MoviePy `CompositeVideoClip` entirely in one function. For long projects this holds everything in memory. Consider chunked rendering or streaming progress with partial clips.
- `_apply_transitions` with `scale_pop` falls back to crossfade without warning. Log a note so developers know it's intentional.
- Error handling in render is a broad `except Exception` — add structured error types so the frontend can show meaningful render failure messages rather than just "render error".

### `styles.css`
- CSS variables are defined but not all components use them consistently — some hardcode hex colours. Audit for hardcoded colour values and replace with vars.
- No responsive layout below ~900px width. The editor is desktop-only, which is fine, but a minimum-width constraint + overflow warning would avoid silent layout breaks.

### `editor.html`
- ARIA attributes are partial. Timeline canvas has `role` and `aria-label` but the canvas clip handles and modal lack keyboard accessibility.
- `<title>` is static ("vidkit"). It could reflect the current project name.

---

## How to work

1. **Read before editing.** Use `Read` on any file before touching it. The files are large.
2. **Edit in place.** Use `Edit` for targeted changes, `Write` only for full rewrites.
3. **One concern per edit.** Don't mix refactors with bug fixes in the same `Edit` call — keep diffs reviewable.
4. **Preserve the `ctx.globalAlpha *= value` rule** everywhere in `canvas.js`. Changing any of those to `=` will break transition compositing.
5. **Mirror frontend ↔ backend for any new clip field.** `CLIP_DEFAULTS` in `app.js` and the `Clip` dataclass in `models.py` must stay in sync.
6. **Don't add dependencies.** Frontend is zero-dependency vanilla JS. Backend uses only `fastapi`, `moviepy`, `pillow`, `websockets`. No npm, no bundler.
7. All files are in `E:\video-editor\video-editor\`.

Start by reading the files you plan to change, identify the highest-value improvements, and work through them systematically. Prioritise correctness over new features.
