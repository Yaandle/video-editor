# Bauhaus shapes

Circle, square, triangle, quarter circle, semicircle and bar, in primary red,
yellow and blue plus black, white and a warm paper, on a strict **16×9
modular grid** (one module is the frame width ÷ 16). Every shape has a grid
position and a role. Nothing is scattered.

## Motion

`bauhaus.composition` (a scene) assembles beat by beat. Each primitive
springs in from off-canvas (`slam`) and rotates into place from its `spin`
angle, landing exactly on its beat. Overlaps use **multiply** blending, like
overprinted ink: blue over yellow gives dark green, black over red stays black.
The hold keeps the asymmetric balance alive with grid-step moves that land on
the grid:

- the small black bead hops one module along the bar on every beat
  (0 1 2 3 2 1 …);
- the quarter circle turns 90° on every bar.

Each step's spring starts one arrival time early, so the move *lands* on the
grid line.

Presets: `construct` (red circle, blue square, yellow triangle, black bar,
quarter, bead) and `balance` (blue semicircle, bar, tilted red square, yellow
circle, small triangle, bead).

## Type

Type is set small and precise against the large shapes: **Jost** (OFL, a
geometric sans after Futura), 30 px title and 18 px caption at 1080. Text clips
in this look are re-set in Jost at a step below their role, never heavier than
600. Shape clips become flat primaries (nearest ink) with multiply. Neither gets
borders or shadows.

## Sound

`sound.py`:

- a modal-synthesis **marimba** (partials at 1×, 3.9× and 9.2× with their own
  decays, plus a mallet tick), pitched by shape: circle low, quarter high;
- a wood block for the bar and the bead's steps;
- a soft air whoosh;
- a marimba-roll riser;
- the `marimba` bed: a C-pentatonic ostinato over a low marimba bass, with
  claves and blocks.

## Known limits

- Compositions are presets (data in `index.js`). Add one by listing items
  with grid coordinates. There is no free-form editor for them yet.
- Multiply needs a light ground. On a black background the shapes would vanish,
  so keep `background` paper or white.
