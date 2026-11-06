# Halftone dots

A dot-screen print look for any content: photos, video, type and shapes. Two
screens are available:

- **single**: one ink (any palette colour) at any screen angle (45° by default);
- **cmyk**: four-colour process at the classic angles (C 15°, M 75°, Y 0°, K 45°),
  inks overprinting multiplicatively on the paper, with a fixed few pixels of
  plate **misregistration**.

Dot area follows darkness × coverage. `max_cover` (0.82) keeps the screen
visible inside solids, so a black headline is filled with dots instead of
turning into a blob. The source's own outline clips the dots, so glyphs and
shapes keep crisp edges and only their fill is screened.

## Motion

Dots grow from zero on a `slam` spring, with a little overshoot so they swell
past size and settle:

- `reveal: sweep`: a front crosses the frame over `reveal_beats`, 32 vertical bands each on its own spring;
- `reveal: grow`: every dot at once;
- `reveal: none`: no reveal.

The growth per band is computed in JS (closed-form springs) and sent to the
shader as a uniform array. After the reveal the screen holds perfectly
still.

## Stability

The grid is anchored in screen space. Every dot samples the source once, at
its cell centre, so a static image gives identical dots on every frame: no
flicker and no crawl. Moving content steps from cell to cell. Checked by the
critique's temporal-stability test (`max_static_diff` must stay under 0.5/255).

## Parameters

`mode`, `ink`, `cell` (px at 1080), `angle`, `gamma` (dot gain), `max_cover`,
`misregister`, `reveal`, `reveal_beats`, `ground` (`auto`: paper behind the
dots for a whole frame, transparent for a clip layer).

## Files

- `shaders/halftone.glsl`: single-ink screen
- `shaders/cmyk.glsl`: four plates, overprint, misregistration
- `sound.py`: press thunk, type clack, paper slide, paper-feed riser, and the `press` bed (a letterpress running at tempo with a bowed drone)
- `tokens.json`: process inks tuned to the neo-brutal paper, with their overprints listed for the cohesion check

## Known limits

- Thin hairlines finer than a cell disappear; that is how screens behave. Use
  a bigger stroke or a smaller `cell`.
- Dots are antialiased over about one pixel, so edge pixels blend ink and paper.
  The exact-palette check is not applied to this pack; cohesion uses a ΔE
  tolerance instead.
