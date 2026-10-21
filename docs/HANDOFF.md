# Handoff — vidkit studio

Running note so work can resume cleanly in a new session. Newest section first.

## Status (2026-10-21)

Branch `dev`, nothing pushed. `npm test` 37/37, motion lint clean.
Left alone on purpose: `projects/footy-ml.json` and `renders/` (another session
uses them; both are git-ignored).

### Done

Audit and clean-up (details in [CODE_AUDIT.md](CODE_AUDIT.md)):
- Editor works again: new `frontend/app.js`, `inspector.js`, `library.js`,
  `forms.js`, `transport.js`. Four dead duplicates of `legacy/` removed.
- Text Studio (`frontend/textstudio.html`), the Advanced Text option: live
  preview through the export renderer, with the Style selector.
- Critique tool (`studio/critique/`; `critique.bat` was broken): 10-point
  rubric, lossless re-captures, per-pack checks, contact sheets.
- Bugs fixed: text markup spacing; text clips failing their own schema
  (weight); audio true peak on hard-edged sounds; stale browser cache in the
  editor; server crash on non-UTF-8 consoles; a click on the timeline making an
  undo step; a WebGL texture-unit bug flashing noise on each worker's first
  frame.
- Duplicated helpers merged (`setFont`, `exitProgress`, `collectAssets`,
  `_exe`).

Style-pack infrastructure:
- `gl.js`: WebGL2 pass pipeline.
- `raster.js`: low-res buffers, quantize, integer upscale.
- `glyphs.js`: per-glyph text engine, continuous variable weight and width,
  text on a path, fit-to-box.
- `styles.js` and `prng.js`: one folder per pack; seeded PRNG.
- `style` and `style_params` on the project and on clips; at most 2 packs on
  screen at once.
- Pack voices and beds discovered from `styles/<id>/sound.py`.
- `python -m studio.styles list|render|critique|check|thumbs`.
- `frontend/preview.js` behind every `styles/<id>/preview.html`.
- Optional LLM tools: suggest a style; kinetic copy rewrite.

Packs finished (README, preview, sound, 8 s 1080p demo, critique ≥ 8):

| pack | score |
|---|---|
| kinetic | 9.82 |
| halftone | 9.89 |
| dither | 9.95 |
| ascii | 9.92 |
| pixel | 9.95 |
| bauhaus | 9.95 |

Anti-slop and style-fidelity scores are a visual review by Claude (stored as
`reports/critique_<id>_1080p30/review.json`). Reports and renders are
git-ignored.

### Yet to do (style packs)

1. **Paper cutout.** Only the core support exists (`treatment.perClip`, one
   layer per clip even as the project style). Still needed:
   - a shader with rough seeded edges, a light edge core, procedural fibre and
     a soft layered shadow;
   - on-twos timing plus jitter;
   - torn and scissor reveals;
   - sound, demo, README and critique.
2. **Liquid morph, holographic foil, clay 3D**: not started. Clay needs
   Three.js vendored into `frontend/vendor/`. Blender is at `F:\blender`, for
   the optional hero path.
3. Gallery page (`styles/gallery.html`) with thumbnails.
4. Showcase reel (40–60 s, cutting between packs on the beat).
5. `docs/STYLE_PACKS.md`, and updates to `ARCHITECTURE.md` and the README.
6. doctor:
   - WebGL probe across ANGLE and SwiftShader flags, saving the fastest
     deterministic one to `config.json` (`render.gl`);
   - a per-pack one-frame check (already exists as `studio.styles check`);
   - a Blender probe.
7. `assets/MANIFEST.json`:
   - log the fonts (including Jost), the icons, the PICO-8 palette and the
     generated blue noise;
   - add a doctor check that every one is listed.
8. Python tests (`tests/`): schema, beat grid, synth determinism, critique
   metrics.
9. Final pass: re-render and re-critique all demos on the final code (kinetic
   and halftone were scored before later renderer fixes), then write the score
   table.

## Done: code, graph and maths visuals (2026-10-21)

Requested by the session working on the Aussie-rules ML video. All on `dev`,
`npm test` 47/47, motion lint clean. New tests are in
`frontend/tests/visuals.test.mjs`.

| type | what it does | key props |
|---|---|---|
| `code` (upgraded) | Lines land one per beat (or type in); line ranges come into focus while the rest dims; `+`/`-` diff bars with gutter markers; `$ prompt` line; operator colouring from the legacy tokenizer | `reveal` lines/type/none, `start_beat`, `beats_per_line`, `focus` "3-5, 8", `focus_beat`, `diff`, `prompt` |
| `plot` (new) | y = f(x) drawn on: the pen starts and arrives on grid lines; up to two curves; a marker on the pen; points land on beats | `fn`, `fn2` (safe parser `expr.js`: sigmoid, relu, exp, sin…, implicit products), `x_min..y_max`, `points`, `draw_beat`, `draw_beats` |
| `diagram` (new) | `network`: layers land per beat, edges grow, then activation pulses travel input → output. `flow`: stage boxes land per beat with arrows drawing on, and a focus steps along | `mode`, `layers` "4, 6, 6, 2", `layer_labels`, `in_labels`, `out_labels`, `stages`, `start_beat`, `beats_per_step`, `pulses`, `highlight` |
| `math` (new) | Equations in a small TeX-like language (`rac`, `\sum_{}^{}`, `^`/`_`, Greek, `\cdot`, `\leftarrow`, `\partial`, `\hat`, `\hl`). `\|` splits terms, which land one per beat; highlight plates on chosen terms | `template` (sigmoid, neuron, weighted-sum, mse, gradient-step, softmax) or `tex`, `size`, `start_beat`, `beats_per_term`, `highlight` "3", `highlight_beat`, `caption` |
| `graph` (unchanged) | Animated bar and line charts | `data` "label:value, …", `chart` bar/line |

- Helper: `kit.landOnBeat(clipStart, n, preset, beat, fps)` lands a spring
  exactly on beat *n* from the clip start.
- Demo: `projects/math-code-demo.json` (24 s, all 35 hits on the grid; it has
  a `.gitignore` exception).
- Render it with `render.bat projects\math-code-demo.json --preset 1080p30`.
  It was checked with harness frame captures, not rendered to mp4, because
  `renders/` was being used by another session.
- Known limits:
  - the maths layout has no `\sqrt` or matrices yet;
  - flow mode is a single row (fine up to about 6 stages);
  - curve labels can collide when two curves end at the same point.
