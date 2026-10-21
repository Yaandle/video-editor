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

## In progress: code, graph and maths visuals

Requested by the session working on the Aussie-rules ML video. Plan and
progress are tracked below. Each milestone is committed when done.

- [ ] Code: beat-locked line reveal, focus/highlight of line ranges, diff
  (+/−) styling, ported and upgraded from `legacy/` and `components/code.js`.
- [ ] Graph: animated line and bar charts, a function plot (y = f(x) drawn
  on), node/arrow diagrams (neural-net layers, flow of stages).
- [ ] Maths: equation templates (fractions, Σ, σ(x) = 1/(1+e^−x), w·x+b, sub-
  and superscripts, Greek), term-by-term reveal and highlight.
- [ ] Registry entries with schema defaults, `projects/math-code-demo.json`,
  unit tests, `npm test`.
