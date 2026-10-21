# Kinetic typography

Words land one per beat. Each word has its own springs: position and scale
(`slam`), the two variable-font axes, weight and width (`snappy`), and a small
seeded tilt. Glyphs inside a word are staggered by 14 ms. Lines are fitted to
the type frame at oversized scale, so a short line ("lands") sets huge and a
long one sets smaller. The hierarchy comes from the copy, not from a size
menu. Emphasis (`{{word}}`) rests heavy and expanded in the emphasis colour;
`[[word]]` gets a lime slab that grows from the left.

## Use it

- **Component** `kinetic.type`, with three modes:
  - `stack`: fitted lines. Up to four lines share one page and scale down together to fit the frame; longer copy pages, and the old page clears before the next one lands.
  - `path`: text on an `arc`, `wave`, `circle`, `spiral` or `line`. Each glyph drops onto the curve along its normal on its own spring and rotates to the tangent.
  - `caption`: `captions` takes `word@seconds …` (for example from a transcript). Each word snaps to the nearest free grid line; chunks of up to `chunk` words (a comma or full stop also ends a chunk) show with the active word heavy and coloured.
- **Re-skin**: any `text` clip with style `kinetic` (or in a kinetic project) renders through the same engine. It is framed by the clip's anchor and wrap width, and its words land per beat with per-word hit sounds (`eventOverrides.text`).
- **Any other content** (images, shapes, scenes) in the kinetic look gets a beat punch: a scale hit on every beat (`punch`) and a tilt that flips each bar (`tilt`).

Text Studio opens `kinetic.type` clips. With the local model running, its
"Kinetic copy" section rewrites copy into beat-sized lines (JSON only,
validated, emphasis marked).

## Parameters

| Pack param | Default | |
|---|---|---|
| `punch` | 0.045 | scale added on each beat for non-type content |
| `tilt` | 1.5° | rotation that flips every bar |

Component props: `text`, `mode`, `path`, `captions`, `chunk`, `box_*` (the
type frame as a share of the video frame), `align` (left or right; there is no
centred default), `start_beat`, `beats_per_word`, `color`, `emphasis`, `slab`,
`exit_len`, `sfx`.

## How it works

- `frontend/renderer/glyphs.js` provides the per-glyph layout (kerning folded into
  advances), `fitSize`, `pathFor` and `pointAt`, and `drawGlyphRun`.
- Continuous width: canvas only takes keyword `font-stretch` values, so the pack
  registers Archivo once per whole wdth percent (62–125). Each face is one
  `FontFace` whose single-value `stretch` descriptor pins the axis
  (`assets.loadWidthInstances`), and `widthFamily()` picks the face for a given
  width. Weight is continuous through `ctx.font`.
- Schedule: word *k* hits `start_beat + k × beats_per_word` beats after the clip
  start, snapped to the grid. The spring starts `arrival` frames earlier, so
  the landing frame is the beat frame. Hits feed the beat validator and the
  mixer.
- Sound (`sound.py`): a tight click per word, a low thud for emphasis, a riser
  into every line change, a swish for entrances, and the sparse `pulse` bed
  (kick, rim, sub, ghost hats).

## Known limits

- Width instances cost one font parse per percent (64 faces from a single
  660 KB file) the first time the pack loads.
- The beat punch keeps non-type content moving on every beat, so a kinetic
  scene has no static frames for the temporal-stability check to test.
- Path mode fits one line along the curve; very long copy gets small, so
  use stack mode for it.
