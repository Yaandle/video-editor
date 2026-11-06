// Pass 2: draw a glyph per cell from the atlas. Density (darkness × coverage)
// picks a character on the set's ramp. Each cell reveals on its own spring
// (closed form, same maths as motion.js) with a column sweep plus a seeded
// per-cell offset; a second set can take over cell by cell from u_switch on.
uniform vec2 u_cellpx;
uniform vec2 u_grid;          // cols, rows
uniform sampler2D u_atlas;
uniform float u_atlasCols;    // glyph slots per atlas row
uniform float u_atlasRows;    // character sets in the atlas
uniform float u_count[4];     // characters in each set
uniform float u_setA;
uniform float u_setB;
uniform float u_lt;           // clip-local time
uniform float u_sweep;        // seconds for the reveal front to cross the frame
uniform float u_switch;       // clip-local time the set B takeover starts (< 0: never)
uniform vec3 u_spring;        // stiffness, damping, mass
uniform float u_settle;       // seconds until the spring stays within 0.5 % — from then on it is exactly 1
uniform int u_mode;           // 0 ink, 1 duotone, 2 source colour
uniform vec3 u_ink;
uniform vec3 u_paper;
uniform vec3 u_accent;
uniform float u_ground;
uniform float u_gamma;
uniform uint u_seed;

float spring(float t) {
  if (t <= 0.0) return 0.0;
  float k = u_spring.x, c = u_spring.y, m = u_spring.z;
  float w0 = sqrt(k / m), z = c / (2.0 * sqrt(k * m));
  if (abs(z - 1.0) < 1e-6) return 1.0 - exp(-w0 * t) * (1.0 + w0 * t);
  if (z < 1.0) {
    float wd = w0 * sqrt(1.0 - z * z);
    return 1.0 - exp(-z * w0 * t) * (cos(wd * t) + (z * w0 / wd) * sin(wd * t));
  }
  float s = sqrt(z * z - 1.0);
  float r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  float c2 = r1 / (r1 - r2), c1 = 1.0 - c2;
  return 1.0 - (c1 * exp(r1 * t) + c2 * exp(r2 * t));
}

void main() {
  vec2 p = pix();
  vec2 cell = floor(p / u_cellpx);
  vec2 inCell = fract(p / u_cellpx);
  vec4 s = texture(u_src, vec2((cell.x + 0.5) / u_grid.x, 1.0 - (cell.y + 0.5) / u_grid.y));
  float rnd = cellRand(ivec2(cell), u_seed);
  float delay = (cell.x / u_grid.x) * u_sweep + rnd * 0.12;
  // Characters are quantised: a 0.4 % tail would still flip glyphs, so a settled spring is exactly 1.
  float reveal = u_lt - delay > u_settle ? 1.0 : clamp(spring(u_lt - delay), 0.0, 1.25);
  // Density relative to the paper ground: paper is a space, ink is the densest glyph.
  float lp = luma(u_paper);
  float dens = pow(clamp((lp - luma(s.rgb)) / lp * s.a, 0.0, 1.0), u_gamma) * reveal;
  float set = u_setA;
  if (u_switch >= 0.0) {
    float te = u_lt - u_switch - (cell.x / u_grid.x) * u_sweep - rnd * 0.12;
    float sw = te > u_settle ? 1.0 : spring(te);
    if (sw > 0.0) { set = u_setB; dens *= clamp(sw, 0.0, 1.2); }
  }
  int si = int(set);
  float n = u_count[si];
  float idx = clamp(floor(min(dens, 0.999) * n), 0.0, n - 1.0);
  vec2 uv = vec2((idx + inCell.x) / u_atlasCols, 1.0 - (set + inCell.y) / u_atlasRows);
  float g = texture(u_atlas, uv).a;
  vec3 fg = u_ink;
  if (u_mode == 1) {
    float sat = max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b));
    fg = sat > 0.32 ? u_accent : u_ink;
  } else if (u_mode == 2) {
    fg = s.rgb * 0.8;
  }
  outColor = u_ground > 0.5 ? vec4(mix(u_paper, fg, g), 1.0) : vec4(fg, g);
}
