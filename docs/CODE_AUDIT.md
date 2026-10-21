# Code audit — vidkit studio 2.0

Date: 2026-10-20. Scope: every tracked source file outside `legacy/` (≈12.4k lines:
`studio/` Python, `frontend/` editor + renderer, `design/`, `projects/`, entry-point
`.bat` files, docs). Toolchain state at the start: `npm test` 32/32 pass,
`doctor --quick` all PASS, showcase renders at ~19 fps (1080p30, 4 workers).

`docs/AUDIT.md` covers the *previous* version (moviepy era). This file covers the
unified studio that replaced it, and records what was fixed in this pass.

Status column: **fixed** (changed in this pass), **open** (left, with reason).

---

## 1. Blocking: the unification was not finished

The unification commit (`15ed72d`) says so itself: *"editor app.js/inspector/Text
Studio not yet ported to the new renderer, so editor.html does not load; critique
loop pending."* Verified:

| # | Problem | Evidence | Status |
|---|---|---|---|
| A1 | **The editor does not load.** `editor.html`, `canvas.js` (StageWidget), `timeline.js` and `styles.css` are the new v1 editor; `app.js` is the old v0 app. It imports `CanvasWidget` (no longer exported — the class is `StageWidget`), builds the old 80-field `CLIP_DEFAULTS` model, talks to the removed `/ws` save protocol, and queries DOM ids that `editor.html` no longer has. | `app.js:1`, `app.js:67`, `app.js:281` | fixed — new `app.js`, `inspector.js`, `library.js` on `model.js` |
| A2 | **Four dead duplicates.** `frontend/app.js`, `properties.js`, `mediaBin.js` and `playback.js` are byte-identical to the copies already in `legacy/frontend/`. `colorPicker.js` is only used by them. `app.js` still carries the cp1252→UTF-8 mojibake from the old audit (B7: `â€”`, `Â§`) and a BOM. | `diff -q` | fixed — removed from `frontend/` (legacy copies kept; `colorPicker.js` moved there) |
| A3 | **Text Studio does not exist.** `editor.html` opens `#textstudio-frame`, ARCHITECTURE §2 lists `frontend/textstudio.html`, `components/text.js` says "Text Studio edits exactly these props". | no file | fixed — `frontend/textstudio.html` |
| A4 | **`critique.bat` is broken.** It runs `python -m studio.critique`; there is no `studio/critique/`. ARCHITECTURE §10 describes it in detail. | `ls studio` | fixed — `studio/critique/` |
| A5 | **Docs describe files that are not there**: `docs/DESIGN_AUDIT.md`, `design/sample_palette.py` (named in `tokens.json` notes and AUDIT §5), `design/packs/<id>/pack.json` (folder exists, empty), `frontend/textstudio.html`, `studio/critique/`. | `ls` | open — style packs live in `styles/`; ARCHITECTURE.md still to be updated |

## 2. Redundant code

| # | Where | What | Status |
|---|---|---|---|
| R1 | `components/brutal.js`, `scenes/brutal.js`, `text.js` | Three private copies of `setFont(ctx, role)`. | fixed — one `setFont` in `kit.js` |
| R2 | `components/brutal.js` `exitP(lt, dur)` vs `scenes/helpers.js` `exitP(env, clip)` | Same quick-spring exit curve, two signatures. | fixed — one `exitProgress()` in `motion.js`; both call sites use it |
| R3 | `core.js` `load()` and `update()` | Identical "collect images + icons from every clip" loop. | fixed — `collectAssets()` |
| R4 | `kit.landing()` vs `scenes/helpers.clock().land()` vs `graph.schedule()` vs `text.scheduleText()` | Four implementations of "start = grid line − spring arrival". | partly fixed — graph and text keep their stagger rules but call `kit.landing()`; `clock().land()` stays (it lands on *absolute* beat n of a scene, a different rule) |
| R5 | `studio/config._exe` and `studio/tooling._exe` | Same helper twice. | fixed — `tooling` imports it |
| R6 | `paths.PACKS` (`design/packs`) | Unused constant pointing at an empty folder. | fixed — replaced by `paths.STYLES` |
| R7 | `studio/llm/storyboard.suggest_order` | No caller, no endpoint. | open — kept, now exposed as `/api/llm/order` for the storyboard dialog |
| R8 | `reports/gen_sched.py` | One-off script in an ignored output folder. | open — untracked and ignored; left for the owner |

## 3. Bugs and weak spots

| # | Where | Problem | Status |
|---|---|---|---|
| B1 | `core.js` pass pipeline | Allocates a full-size `OffscreenCanvas` **every frame**, and in the editor it reads back the *whole editor canvas* (overlays, other UI), not the frame rect. | fixed — replaced by the WebGL pass pipeline with cached targets and a frame-rect source |
| B2 | `components/brutal.js` `pressTimes()` | Uses `beat.beat` without checking `beat.valid`; the fallback is a hard-coded 0.5 s. | fixed — uses `onBeat()` |
| B3 | `components/text.js` `events()` | Typewriter branch: dead `if (!words || !chars) return out;` after building the list. Word count ignores `\n`-joined words with markup inside. | fixed |
| B4 | `assets/MANIFEST.json` | `fonts` and `icons` arrays are empty — fonts and icons are not licence-logged, although doctor says "with OFL licences". | open — Jost added to `assets/fonts/jost/` (OFL) but the manifest entries and doctor coverage check are still to do |
| B5 | `studio/render/engine.py` chunk key | Hashes `frontend/renderer/**` and tokens only; anything a style pack adds (shaders, textures, pack code) would hit a stale cache. GL backend not in the key. | fixed — key includes `styles/**` and the GL backend |
| B6 | `schema.Cue.sound` / `Music.preset` | Hard `Literal` lists, so no new voice or bed can exist without editing the schema. | fixed — validated against the voices/beds actually registered |
| B7 | `engine.py` range trim | Always re-encodes with libx264 even when the job asked for NVENC. | open — trim only runs for partial-chunk ranges; harmless |
| B8 | `server.py` | `@app.on_event("startup")` is deprecated in current FastAPI. | fixed — lifespan handler |
| B9 | `motion.js` `hash1()` | `sin()`-based hash: fine for jitter, but its output depends on the platform's `Math.sin` at large arguments (seed × 127.1). Style packs need a seeded PRNG keyed by `(seed, id, t)`. | fixed — added `prng.js` (integer hash, platform-independent); `hash1` kept for old scenes |
| B10 | Python tests | `pytest` is pinned in requirements but there are no Python tests. | open — JS tests added (registry defaults, style limit, text markup); Python tests still to do |

## 4. Improvements made in this pass (beyond fixes)

- **Style packs** (`styles/<name>/`, see `docs/STYLE_PACKS.md`): pack registry with
  dynamic loading (one folder, nothing else changes), WebGL post-process pipeline,
  low-res raster pipeline, text engine upgrade (per-glyph springs, text on a path,
  continuous variable-font weight *and* width, fit-to-box), `style` on the project
  and on clips (max two packs per scene), pack sound profiles and music beds,
  six of ten packs so far (kinetic, halftone, dither, ascii, pixel, bauhaus), each with a
  preview, README, sound and a demo that passes the critique.
- **Critique loop** (`studio/critique/`): per-frame metrics, review stills, contact
  sheets, the 10-point rubric plus per-pack checks.
- **doctor** (not done yet): WebGL probe across ANGLE/SwiftShader flags, the per-pack
  one-frame render (exists as `python -m studio.styles check`), Blender probe.

## 5. Features worth adding next (not done here)

1. Audio clock in the editor: playback still advances on rAF deltas (`playback.js`);
   scheduling the preview WAV from an `AudioContext` clock would make preview A/V exact.
2. Persisted render queue (jobs are in-memory and vanish with the server).
3. Waveform of the synthesized bed on the timeline (the preview WAV is already built).
4. Re-sample the palette from the reference board (`design/reference/` is still empty;
   tokens are hand-set and marked `"sampled": false`).
5. Proxy media for long uploaded videos (vframes are decoded per 30-frame block on demand).
