# Architecture — unified vidkit studio

```
project.json ─► scene graph ─► deterministic renderer ─► frames + audio ─► ffmpeg ─► mp4
 (schema v1)     (registry)     render(t), Canvas 2D       (Playwright)    (pipe)
                                       ▲
                       editor preview ─┘  same module, same tokens, same fonts
```

One project format, one renderer, one motion library, one audio engine. The
editor preview and the export both call the same `renderFrame(ctx, t)`.

## 1. Stack decision

Kept: **Python + FastAPI** server, **vanilla ES-module frontend, no build step**,
**Canvas 2D** for the picture, **Playwright + Chromium** for headless capture
(already installed and used by text_to_video), **ffmpeg** for encode/mux.

Changed, with reasons:

| Change | Why |
|---|---|
| moviepy and PIL export removed (to `/legacy`) | It is a second renderer (B3), cannot import on this machine (B1), and holds whole projects in memory. The browser renderer the editor already uses becomes the only renderer; export captures it frame by frame. |
| WebSocket save/load protocol → REST (`/api/projects/*`) + one WS for render progress | Save/load are request/response; the broadcast-everything WS made errors invisible. |
| Flat 80-field clip → v1 envelope (`type`, timing, transform, `enter`/`exit`, `props`) | Each clip type owns its `props` schema in one registry file; the envelope is what the editor manipulates generically. Old `.vkit` files migrate on load. |
| CSS-keyframe Advanced Text → **Text Studio** rendering through the real renderer | Kills the third renderer (B4). |
| PyQt5 dropped from requirements | Only the legacy text_to_video UIs used it. |

Canvas 2D over DOM: the editor's interaction layer (drag/resize/crop/motion
paths) is already canvas-based, Canvas gives pixel-identical output in preview
and headless, and per-frame cost is predictable. The renderer reports every
element's box per frame (the role DOM bounding boxes would play), which the
quality gate uses for overflow, safe-margin, grid and contrast checks.

## 2. Folder layout

```
start.bat doctor.bat render.bat critique.bat   one-command entry points (Windows)
config.json                                     machine config (ffmpeg dir, LLM, ports)
studio/                     Python package
  paths.py config.py        pathlib roots, config + env overrides
  doctor.py                 python -m studio.doctor
  schema.py                 pydantic project model v1, .vkit migration, JSON Schema export
  beatgrid.py               snap(t), grid validator
  lint_motion.py            motion-rule lint (run by doctor and before every render)
  jsbridge.py               runs node over the renderer's pure modules (events, cues, schemas)
  server.py                 FastAPI editor backend
  render/                   engine, presets, cache, ffmpeg helpers, CLI (python -m studio.render)
  audio/                    numpy synth voices, generative music bed, mixer + loudness
  critique/                 automated frame pass, still extraction, contact sheets, report
  llm/                      optional local LLM (llama.cpp server), storyboard
  storyboard.py             deterministic script → storyboard (ported text_to_video logic)
frontend/
  editor.html app.js canvas.js timeline.js properties.js mediaBin.js colorPicker.js playback.js styles.css
  textstudio.html           redesigned Advanced Text
  render.html               headless harness (exposes window.__seek etc.)
  renderer/                 SCENE CODE — motion-linted
    core.js                 createRenderer: load, prepare(t), renderFrame(ctx, t), events
    motion.js               closed-form springs + presets, stagger, arrival/peak/settle
    beat.js                 grid math + snap() (shared by timeline and validator)
    registry.js             registerComponent / registerScene / style packs / passes
    tokens.js text.js draw.js assets.js
    components/*.js         one file per component type
    scenes/*.js             one file per scene type
    index.js                imports every component/scene (the only list to edit)
design/tokens.json          design tokens (palette, type ramp, spacing, borders, shadows, grid, motion)
design/packs/<id>/pack.json style-pack descriptor (tokens, pass pipeline, sound profile)
assets/{fonts,icons,images}/ + MANIFEST.json   self-hosted, licence-logged
projects/                   *.json projects, autosave/, recent.json
media/uploads/              user uploads (moved from backend/uploads)
renders/                    outputs + .cache/ (per-chunk segments)
reports/                    critique_<render>.json, stills/, contact sheets
legacy/                     retired code (moved, never deleted)
```

## 3. Project schema (v1)

`studio/schema.py` is the source of truth (pydantic, `extra="forbid"`), with
`python -m studio.schema --json-schema` exporting JSON Schema.

```jsonc
{
  "schema": "vidkit.project", "version": 1, "name": "showcase",
  "settings": { "width": 1920, "height": 1080, "fps": 30,
                "bpm": 120, "subdivision": 1, "beat_offset": 0, "beat_lock": true,
                "duration": 24.0, "background": "#F3F0E8", "style_pack": "neo-brutal" },
  "tracks": [ { "index": 0, "name": "Scenes", "hidden": false, "muted": false } ],
  "clips": [ {
      "id": "s1", "type": "scene.title-slam", "layer": 1, "start": 0.0, "duration": 4.0,
      "x": 0.5, "y": 0.5, "scale_x": 1, "scale_y": 1, "rotation": 0, "opacity": 1,
      "crop": null, "keyframes": [], "src": null,
      "enter": { "preset": "slam", "from": "rise" }, "exit": { "preset": "quick", "to": "drop" },
      "props": { "headline": "Motion that keeps time.", "kicker": "Studio build 2.0" } } ],
  "audio": { "music": { "preset": "brutal-bounce", "seed": 7, "gain_db": -3 },
             "auto_sfx": true, "sfx_gain_db": -2, "target_lufs": -14, "cues": [] },
  "meta": { "created": "…", "migrated_from": null }
}
```

- `layer`: lower draws on top (kept from vidkit #71). `tracks[]` holds per-layer
  metadata (hidden, muted, name).
- `props` is validated by the clip type's schema in the registry (JS), exported
  for Python/LLM use through `studio/jsbridge.py`.
- `.vkit` (v0) migrates automatically (`schema.migrate_v0`): narration → `text`,
  code/graph/shape/image/video/audio → same-named components, transitions →
  `enter`/`exit`, `text_glow` dropped (logged), blurred shadows → hard offsets.

## 4. Renderer

`frontend/renderer/core.js`:

```js
const r = await createRenderer({ mode: 'export' | 'preview', base: '/' });
await r.load(project);            // tokens, fonts (FontFace from /assets/fonts), images, validation
await r.prepare(t);               // decode media needed at t (video frames come from /api/vframe)
const report = r.renderFrame(ctx, t, { width, height });   // synchronous, pure
r.events();                        // cuts, hits, cues, motion events — pure function of project
```

Rules: `renderFrame` reads only (project, t, size, tokens, loaded assets). No
wall clock, no `Date.now`, no rAF timing, no CSS animation, no stateful tweens.
Memo caches are allowed only when keyed by their full inputs.

Per frame: active clips sorted by layer → local time `lt = t - start` →
transform from keyframes and the `enter`/`exit` springs → component `render(ctx, clip, lt, env)`.
Components draw with `draw.js` primitives (bordered box, hard shadow, sticker,
ticker, boxed arrow…) and call `env.box(...)` to report what they drew:
`{clipId, role, kind: text|box|image, x, y, w, h, fg, bg, size, text, overflow, bleed, gridBreak, settled}`.

**Pass pipeline** (for style packs): the frame is drawn into an offscreen layer,
then each pass in the active pack's `passes[]` runs `(src, dst, t, params)`.
The default pack ships with the identity pass; a later agent adds shader/post
passes and sound profiles by registering a pack — no core changes.

**Registry**: `registerComponent({ type, kind: 'component'|'scene', label, category,
schema, defaults, duration, render, cues, editor })`. Adding a scene type is one
file plus one import line in `renderer/index.js`.

## 5. Motion

`renderer/motion.js` holds the closed-form damped spring (under/critical/over-damped)
and the only presets scenes may use:

| preset | stiffness | damping | use |
|---|---|---|---|
| `snappy` | 380 | 26 | UI, labels, small things |
| `slam` | 520 | 22 | headlines, cards landing on a hit (small overshoot) |
| `soft` | 120 | 20 | images, large surfaces settling |
| `quick` | 600 | 49 | exits (critically damped, no overshoot) |
| `wobble` | 260 | 9 | stickers only |

Helpers: `arrival(preset)` (first t reaching target → impact sound frame),
`peak(preset)`, `settle(preset)`, `stagger(i, step)`, `enterExit(lt, dur, enter, exit)`.
Entrances that "hit" are scheduled backwards so their **arrival** lands on a
grid line. Only transforms animate (translate/scale/rotate) plus opacity-adjacent
values; layout is computed once per clip from props.

`studio/lint_motion.py` fails the build on `transition`, `animation`, `@keyframes`,
`cubic-bezier`, `ease-…`, `setTimeout`, `setInterval`, `requestAnimationFrame`,
`Date.now`, `performance.now` inside `frontend/renderer/**` and `frontend/render.html`
(comments stripped). Runs in `doctor` and before every render.

## 6. Beat lock

`settings.bpm`, `subdivision`, `fps`. A grid step is `60 / bpm / subdivision`
seconds; the schema rejects settings where a step is not a whole number of frames
(e.g. 120 BPM at 30 fps → 15 frames per beat). `snap(t)` lives in
`renderer/beat.js` (timeline snapping, scene scheduling) and `studio/beatgrid.py`
(validator). The validator collects cuts (scene-clip boundaries), hits (spring
arrivals flagged `hit`) and manual cues and fails if any is more than one frame
from a grid line.

## 7. Audio

`studio/audio/` synthesizes everything in numpy at 48 kHz stereo: kick, snare,
clap, hats, click, tick, pop, whoosh, riser, impact, sub drop, plus a generative
bed (drums, sidechained bass, chord stabs) from `audio.music`. Cues come from the
renderer's `events()` (run in Node over the pure modules): whoosh on entrances,
impact on the exact arrival frame of `hit` springs, ticks on counters, risers
ending on cuts. Uploaded audio/video clips are decoded with ffmpeg and mixed in.
Master: bus sum → ffmpeg two-pass `loudnorm` (I=-14, TP=-1) → `alimiter` →
ebur128/astats measurement written to the render report.

## 8. Render engine

`python -m studio.render projects/showcase.json --range 2.0-4.5 --preset 1080p30 --draft`

1. Validate schema, motion lint, assets (fonts in tokens, images, media), beat grid.
2. Split the range into fixed 1-second **chunks aligned to absolute frame numbers**.
3. Cache key per chunk = sha256(renderer source hash, tokens, preset, size, fps,
   draft, chunk index, every clip overlapping the chunk, referenced asset hashes).
4. Missing chunks are distributed over N Chromium workers. Each frame:
   `await __seek(frame)` (waits fonts, images, one paint) → PNG screenshot →
   streamed into an ffmpeg pipe (no PNG files on disk). Renderer reports go to
   `frames.jsonl`.
5. Hard failures: console/page errors, failed requests, missing fonts/assets,
   chunk frame-count mismatch, A/V duration drift > 1 frame. Never silently continue.
6. Chunks concat (stream copy), audio mixed for the range, muxed, ffprobe-validated.
7. Outputs: `renders/<name>/<name>_<preset>[_draft].mp4`, `report.json`
   (validation, loudness, cache hits, timings), `render.log`, `frames.jsonl`.

Presets: `1080p30`, `1080p60`, `vertical` (1080×1920@30), `draft` modifier (½ size, ultrafast).
Re-rendering a bad range only re-renders the chunks it touches; a killed render
resumes from cache.

## 9. Editor

The editor keeps vidkit's shell (layers, selection, crop, motion paths,
snapping, undo/redo) but its canvas now calls the renderer and draws only
editing overlays. New: schema-driven properties for every registry type, beat
grid on the timeline with snapping, scene templates + text style presets,
render queue (progress, cancel), draft preview of an in/out range, autosave,
recent projects, error toasts with codes, one synthesized audio preview track.
`start.bat` starts the server and opens the editor.

## 10. Quality gate

`python -m studio.critique renders/showcase/…mp4` runs the automated pass on
every frame (diff, entropy/edge density, frozen spans, overflow, safe margin,
WCAG contrast, off-grid), extracts review stills (spring start/peak/settle,
±2 frames around cuts, every 0.25 s, all flagged frames) into contact sheets,
and writes `reports/critique_<render>.json` with per-frame scores. Fixed ranges
re-render through the chunk cache.

## 11. Optional local LLM

`studio/llm/` talks to llama.cpp's `llama-server` (the runtime installed on this
machine) over HTTP, starting it on demand with the model from `config.json`
(`llm.model_path`, env `VIDKIT_LLM_MODEL`). Outputs are JSON constrained by the
storyboard schema (`response_format: json_schema`, temperature 0.2), validated
with pydantic; nothing the model returns is executed. When the model or runtime
is missing the editor falls back to the deterministic storyboarder and `doctor`
reports `LLM: skipped`.
