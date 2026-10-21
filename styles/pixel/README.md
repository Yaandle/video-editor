# Pixel art

The frame (or a single clip) renders into a **native low-res buffer**:
320×180 (×6 at 1080p) or 480×270 (×4), rotated for portrait. The buffer is
quantised to a **fixed palette** on the CPU and upscaled by an exact integer
with smoothing off, so every source pixel becomes a k×k block.

- **Palette:** PICO-8, 16 colours (colour values as published by Lexaloffle
  Games, listed on lospec.com). Only the values are used, no PICO-8 code or
  assets; this is logged in `assets/MANIFEST.json`. Photos get an optional
  Bayer 4×4 dither before the nearest-colour lookup (`dither`), anchored to
  buffer pixels.
- **Whole-pixel motion:** for any native-resolution look, the core snaps the
  clip envelope, anchor and pack transforms to whole native pixels after the
  springs are evaluated (`env.snap`, `env.px`). Motion steps one pixel at a
  time and never sub-pixel blurs.
- **Bitmap font:** `font.js`, "VK Pixel 5×7", drawn for this pack. It is
  proportional, has lowercase with descenders (sentence case, not all caps)
  and digits and punctuation. Any `text` clip in this look is re-drawn in it
  at an integer scale per role (hero ×4, display/h1 ×3, h2 ×2, body ×1), with
  line drops on springs or an 18 cps typewriter.
- **Sprites and tiles:** `sprites.js`. Coin (4-frame spin), heart, star, and a
  player with a 2-frame walk, all drawn as palette-index grids. Tiles are
  brick, grass, dirt and cloud.
  - `pixel.sprite`: drops in on a spring onto its landing beat, then bounces on the beat, spins or walks.
  - `pixel.tiles`: sky, ground strip, and parallax clouds at two depths (`cloud_tone: night` for subdued clouds behind type).
- **Beat effects:** every bar downbeat after the first shakes the screen by up
  to `shake` whole pixels for 0.2 s (seeded per frame) and swaps the palette one
  step brighter for two frames (`flash`).

## Checks

The critique captures frames losslessly and requires:

- every 6×6 block to be uniform (no non-integer scaling, no blur);
- every pixel to be an exact palette colour, excluding clips that opt out
  with style `neo-brutal` (photo credits);
- deterministic frames.

All three pass at 1.0.

## Sound

`sound.py` uses chip channels synthesised sample-exact:

- pulse: a square with duty 12.5–50 %;
- triangle: a 4-bit stepped triangle;
- noise: a 15-bit LFSR, long and short modes.

Volume moves in 16 steps. Voices are jump, coin, hit, blip and a power-up
riser. The `chiptune` bed has a 25 % pulse lead in A-minor pentatonic, a
triangle bass and LFSR drums.

## Known limits

- Canvas text that is not re-skinned (scene templates' own type) is drawn at
  native resolution and quantised, so it looks rough. Use `text` clips (bitmap
  font) for copy in this look.
- The clouds scroll continuously in the demo, so it has no static span for the
  temporal check. Pixel integrity is the stronger test here.
