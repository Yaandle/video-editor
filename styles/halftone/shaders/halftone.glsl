// Single-ink halftone. The dot grid is anchored in screen space (rotated by
// u_angle about the frame origin) and every dot samples the source once, at
// its cell centre — so a static image gives identical dots every frame and
// moving content steps from cell to cell instead of shimmering.
// Dot area tracks darkness × coverage; u_band holds a spring-driven growth
// value per vertical band of the frame (the reveal sweep), computed in JS.
uniform float u_cell;        // cell size px at 1080
uniform float u_angle;       // radians
uniform vec3 u_ink;
uniform vec3 u_paper;
uniform float u_ground;      // 1 = paper behind the dots, 0 = transparent (layer)
uniform float u_gamma;
uniform float u_band[32];
uniform float u_max;         // max coverage: < 1 keeps the screen visible in solids

float growAt(float x) {
  float f = clamp(x / u_res.x, 0.0, 0.9999) * 31.0;
  int i = int(floor(f));
  return mix(u_band[i], u_band[min(i + 1, 31)], fract(f));
}

void main() {
  vec2 p = pix();
  float c = u_cell * u_unit;
  float ca = cos(u_angle), sa = sin(u_angle);
  mat2 R = mat2(ca, -sa, sa, ca);      // screen -> screen-cell space
  vec2 q = R * p;
  vec2 cc = (floor(q / c) + 0.5) * c;
  vec2 centre = transpose(R) * cc;     // cell centre back in screen space
  vec4 s = at(u_src, centre);
  float cover = pow(clamp((1.0 - luma(s.rgb)) * s.a, 0.0, 1.0), u_gamma) * u_max;
  float r = sqrt(cover) * c * 0.74 * growAt(centre.x);
  float d = length(q - cc);
  float aa = 0.75 * u_unit;
  float ink = 1.0 - smoothstep(r - aa, r + aa, d);
  if (r < 0.35 * u_unit) ink = 0.0;   // no sub-pixel specks
  // Shapes keep their own outline: the screen fills them, the edge stays crisp.
  ink *= at(u_orig, p).a;
  vec3 col = mix(u_paper, u_ink, ink);
  float alpha = max(ink, u_ground);
  outColor = vec4(u_ground > 0.5 ? col : u_ink, alpha);
}
