# ASCII art

Any layer (type, photo, video, shapes, a 3D render) is re-drawn as characters
from a real monospace font (JetBrains Mono, OFL, already in
`assets/fonts`) on a fixed cell grid.

## How it works

1. **Cells** (`shaders/cells.glsl`): renders at cols × rows, one texel per
   cell holding the cell's average colour and coverage (16 samples).
2. **Glyphs** (`shaders/glyphs.glsl`): full resolution. Density
   (darkness relative to the paper ground, × coverage, with `gamma`) picks a
   character on the set's ramp. The glyph comes from an atlas drawn at load
   from the font (block characters are filled exactly). Paper is a space and
   ink is the densest glyph.

The grid is anchored in screen space and every glyph in a cell reads the same
texel, so held frames are bit-identical (lossless `max_static_diff` 0.0).

## Motion

- **Reveal**: each cell has its own spring. Its delay is the column sweep
  (`reveal_beats`) plus a seeded per-cell offset. The spring is the
  closed-form oscillator from `motion.js`, ported to GLSL with the same
  parameters (`snappy`). Past its analytic settle time it is exactly 1, so
  quantised glyphs never flicker on a 0.4 % tail.
- **Set swap**: from `switch_beat`, a second character set takes over cell by
  cell along the same sweep, each cell growing in on its spring.

## Parameters

| param | |
|---|---|
| `set`, `switch_to`, `switch_beat` | `letters` ` .:-=+*#%@`, `blocks` ` ░▒▓█`, `dots` ` .·•●`, `code` ` .,;<{[#@` |
| `cell` | cell height in px at 1080 (width = 0.6 × height). 16 keeps display type legible in every set. |
| `mode` | `ink`, `duotone` (saturated cells take the `accent`), or `source` (each cell in its source colour) |
| `gamma`, `reveal_beats`, `ground` | |

## Legibility

The subject must read at 1080p, so keep type at display or hero size: about
ten or more cells tall. Body copy turns into texture. Use a clip styled
`neo-brutal` (it opts out and draws on top) for anything that must stay
readable at small size, such as photo credits.

## Sound

`sound.py`: typewriter key, carriage return (ratchet and bell), FM data chirp,
a data-stream riser into cuts, and the `terminal` bed (keys as hats, a soft
kick, a chirp arpeggio and a low square bass).

## Known limits

- The atlas is drawn once at 40×64 px per glyph and sampled down. Cells larger
  than about 64 px start to soften.
- Thin strokes inside a cell average into a mid density, so very fine detail
  (an e's crossbar at large cells) can close up. Use a smaller `cell`.
