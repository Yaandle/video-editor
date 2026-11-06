// Ordered dither at the native low resolution (one fragment = one dither
// pixel; the core upscales the result by an integer with nearest sampling).
// The threshold comes from a Bayer matrix computed from the pixel's integer
// coordinates, or from a tiling blue-noise map — both fixed in screen space,
// so the pattern never crawls when the picture holds.
//
// Inks: up to 4. Each pixel's colour is projected onto the nearest segment
// between two inks; the threshold decides which end it takes. So a grey edge
// dithers ink↔paper (never through orange), warm tones reach for orange, and a
// flat fill that already is an ink stays exactly that ink.
uniform int u_matrix;          // 1, 2, 3 = Bayer 2/4/8; 0 = blue noise
uniform sampler2D u_noise;     // 64×64 blue-noise ranks
uniform vec3 u_pal[4];         // sorted dark → light
uniform int u_n;               // inks in use (2–4)
uniform float u_bias;          // 0 = picture, 1 = blank (lightest ink) — spring-driven reveal
uniform float u_contrast;
uniform float u_ground;        // 1 = opaque (lightest ink behind), 0 = dithered alpha

float bayer(ivec2 p, int k) {
  int v = 0;
  for (int i = 0; i < 3; i++) {
    if (i >= k) break;
    int xb = (p.x >> i) & 1, yb = (p.y >> i) & 1;
    v += (2 * (xb ^ yb) + yb) << (2 * (k - 1 - i));
  }
  return (float(v) + 0.5) / float(1 << (2 * k));
}

float threshold(ivec2 p) {
  if (u_matrix == 0) return (texelFetch(u_noise, ivec2(p.x & 63, p.y & 63), 0).r * 255.0 + 0.5) / 256.0;
  return bayer(p, u_matrix);
}

void main() {
  ivec2 p = ivec2(floor(pix()));
  float th = threshold(p);
  vec4 s = at(u_src, vec2(p) + 0.5);
  vec3 light = u_pal[u_n - 1];
  float a = s.a * (1.0 - u_bias);
  if (u_ground < 0.5 && a <= th) { outColor = vec4(0.0); return; }
  vec3 c = u_ground > 0.5 ? mix(light, s.rgb, s.a) : s.rgb;
  // A flat fill that already is an ink stays that ink (contrast must not push it off).
  if (u_bias < 1e-3) {
    for (int i = 0; i < 4; i++) {
      if (i >= u_n) break;
      if (distance(c, u_pal[i]) < 0.03) { outColor = vec4(u_pal[i], 1.0); return; }
    }
  }
  c = clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  c = mix(c, light, u_bias);                       // develop from blank
  // Nearest ink pair (segment) in RGB.
  float best = 1e9;
  vec3 col = light;
  for (int i = 0; i < 4; i++) {
    if (i >= u_n) break;
    for (int j = 0; j < 4; j++) {
      if (j <= i || j >= u_n) continue;
      vec3 ab = u_pal[j] - u_pal[i];
      float t = clamp(dot(c - u_pal[i], ab) / max(1e-6, dot(ab, ab)), 0.0, 1.0);
      float d = distance(c, u_pal[i] + ab * t);
      if (d < best) { best = d; col = t > th ? u_pal[j] : u_pal[i]; }
    }
  }
  outColor = vec4(col, 1.0);
}
