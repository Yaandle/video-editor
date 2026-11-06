# Sketch notebook (draft)

A lab-book explainer page, modelled on the ESP32 sensor sheets: warm paper with a spiral
binding, ink rules splitting the page into six numbered panels, and a few coloured inks
(red, green, orange, blue). The drawings and their small annotations are in a hand and
drawn on with a pen. The type is formal and fades in.

`sketch.mlp_cue` (a scene) is the first page: Stage 3 of footy-ml, the MLP marking cue.

`sketch.tech_arch` (`arch.js`, project `projects/tech-arch.json`, 88 s) rebuilds the
"Technical Architecture Study" GIF from the sketchbook in that GIF's own look: a white
page, the The Seasons title and red Gotham part headings, 4 px charcoal boxes, blue
annotations and a purple side note. The content is the 2026-10 review of the Aussie
Rules 2 architecture (ragdolls, split state owners, Forward+ passes). The title, the
five headings and their digits are cut from the GIF's 1920×1080 frames by
`arch/make_crops.py`, so their letterforms are exact. Box text uses the `gotham` type
role.

## Type

| role | face | stand-in until the licensed file is added |
|---|---|---|
| headings, titles | The Seasons Bold, tracking −0.036 em | Georgia Bold (system) |
| kickers, red caps, stats | Gotham Bold | Jost (bundled, OFL) |
| body, table cells | Gotham Book | Jost |
| annotations on drawings | a hand (Patrick Hand, OFL) | Ink Free (Windows), copied in locally |
| `gotham`: architecture study box text | Gotham | Montserrat (OFL, variable), in `fonts/` |
| equations | Cambria (system) | Georgia |

The Seasons and Gotham are licensed fonts, so they aren't in the repo.
`styles/sketch/fonts/` is git-ignored. To use them:

1. Copy `TheSeasons-Bold.otf`, `Gotham-Bold.otf` and `Gotham-Book.otf` into
   `styles/sketch/fonts/`.
2. In `tokens.json` → `type`, set each role's `source` to its `licensed` path.

Each role loads exactly one source, because the render harness fails on any missing file.

## Motion

- **Page.** The title and kicker fade in. The rules are drawn, then each panel follows on
  its beat (every 2 s), and the camera pushes in on it (×1.9, soft spring, landing as the
  panel starts).
- **Pull-back.** On the mark beat the camera pulls back to the whole page. A highlighter
  swipes the press rule and the MLP row. The ball then flies the arc every bar, and
  pulses cross the network one layer per beat.
- **Swipe.** A fresh white sheet slides in from the right, with a soft shadow on its edge.
- **Summary**, after the summary gif: a centred serif title blurs in, then rises. Red
  caps follow, then stat lines one per step, then a sketch that wipes in beside them, then
  a flow line. On the split, the first column springs left while the second builds on the
  right. The closing line and a "next" kicker finish it.

Text arrives with opacity, a 10 px rise and a blur that clears. Strokes wobble by seeded
noise along their length, so there's no boil.

## Sound

`sound.py` has these voices:

- a pencil scratch on each panel;
- a pencil tick;
- a ruler stroke for the rules;
- a highlighter squeak;
- a paper swipe.

The bed is `lofi`: soft electric-piano chords (Am7 F C G7), a brushed off-beat and a sine
bass.

## Audit (2026-10-25), fixed in this version

- Everything was in the hand, so subscripts, ŷ and the table were hard to read. Type is
  now in three formal roles, plus a maths serif.
- Margins drifted (24/26/34 px), the bottom row ran into the page edge, and the code box
  touched the bottom. Now:
  - a 132 px left margin shared with the title;
  - 40 px panel padding;
  - one panel template (kicker, heading, one-line description, content box);
  - a footer band.
- The top-right legend repeated panel 2, so it's gone. The header is now title, kicker,
  and a right-aligned intro.
- The ellipse around the MLP row crossed the table rules. It's now a highlighter swash
  under the row.
- "W₁:8×5" and the floating "seconds" are now right-aligned notes on each equation's
  baseline.
- The bottom half sat empty for 10 s and there was no ending. Now there are 2 s panels, a
  camera on the active panel, and a swipe into the summary.
- Critique scored motion 0.00: 57 % of frames counted as frozen, and the scene declared no
  motion events. The camera moves, the swipe and the split are now declared as motion
  events.

## Known limits

- The page content is specific to Stage 3; the other ML stages need their own content
  functions. The next step is re-skins of `text`, `code`, `math`, `diagram` and `plot`, so
  that ordinary clips take on the sketch look.
- Rendering is slow: about 0.6 s a frame at 1080p, where most packs manage about 0.1 s.
  The cost is the canvas blur on each fading element and redrawing the whole page every
  frame. Caching the settled page layer would fix most of it.
- The layout is landscape only. Other aspect ratios scale the 1920×1080 page uniformly,
  so it gets letterboxed.
