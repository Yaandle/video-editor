// Pass 1: one texel per character cell — the cell's average colour and
// coverage (16 samples). Runs at (cols × rows); the next pass reads it with
// nearest sampling, so every glyph in a cell sees the same value.
uniform vec2 u_cellpx;   // cell size in source pixels
uniform vec2 u_srcres;

void main() {
  vec2 cell = floor(pix());
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 sp = (cell + (vec2(float(i), float(j)) + 0.5) / 4.0) * u_cellpx;
      acc += texture(u_src, vec2(sp.x, u_srcres.y - sp.y) / u_srcres);
    }
  }
  outColor = acc / 16.0;
}
