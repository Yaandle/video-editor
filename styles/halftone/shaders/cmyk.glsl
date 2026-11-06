// Four-colour process halftone: C 15°, M 75°, Y 0°, K 45°, each screen anchored
// in screen space and sampled at its own cell centres. Inks multiply on the
// paper like overprinted ink. u_mis offsets each plate by a fixed few pixels
// (plate misregistration); u_band is the spring-driven reveal per band.
uniform float u_cell;
uniform vec3 u_paper;
uniform vec3 u_c;
uniform vec3 u_m;
uniform vec3 u_y;
uniform vec3 u_k;
uniform float u_ground;
uniform float u_gamma;
uniform float u_mis;
uniform float u_band[32];
uniform float u_max;

float growAt(float x) {
  float f = clamp(x / u_res.x, 0.0, 0.9999) * 31.0;
  int i = int(floor(f));
  return mix(u_band[i], u_band[min(i + 1, 31)], fract(f));
}

// Coverage of plate `ch` (0 C, 1 M, 2 Y, 3 K) at screen point p.
float plate(vec2 p, float ang, int ch, vec2 off) {
  float c = u_cell * u_unit;
  float ca = cos(ang), sa = sin(ang);
  mat2 R = mat2(ca, -sa, sa, ca);
  vec2 q = R * (p - off);
  vec2 cc = (floor(q / c) + 0.5) * c;
  vec2 centre = transpose(R) * cc + off;
  vec4 s = at(u_src, centre);
  vec3 rgb = mix(vec3(1.0), s.rgb, s.a);
  float k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  float v;
  if (ch == 3) v = k;
  else {
    float ch3 = ch == 0 ? rgb.r : ch == 1 ? rgb.g : rgb.b;
    v = (1.0 - ch3 - k) / max(1e-4, 1.0 - k);
  }
  v = pow(clamp(v, 0.0, 1.0), u_gamma) * s.a * u_max;
  float r = sqrt(v) * c * 0.72 * growAt(centre.x);
  float d = length(q - cc);
  float aa = 0.75 * u_unit;
  return r < 0.35 * u_unit ? 0.0 : 1.0 - smoothstep(r - aa, r + aa, d);
}

void main() {
  vec2 p = pix();
  float m = u_mis * u_unit;
  float C = plate(p, radians(15.0), 0, vec2(m, 0.0));
  float M = plate(p, radians(75.0), 1, vec2(0.0, m));
  float Y = plate(p, radians(0.0), 2, vec2(-m, 0.0));
  float K = plate(p, radians(45.0), 3, vec2(0.0));
  // Inks overprint multiplicatively; on a transparent layer the dots carry their own
  // colour and sit on whatever is underneath (usually the paper ground).
  vec3 inks = mix(vec3(1.0), u_c, C) * mix(vec3(1.0), u_m, M) * mix(vec3(1.0), u_y, Y) * mix(vec3(1.0), u_k, K);
  float edge = at(u_orig, p).a;   // the source outline clips every plate
  C *= edge; M *= edge; Y *= edge; K *= edge;
  float cover = max(max(C, M), max(Y, K));
  outColor = u_ground > 0.5 ? vec4(u_paper * inks, 1.0) : vec4(inks, cover);
}
