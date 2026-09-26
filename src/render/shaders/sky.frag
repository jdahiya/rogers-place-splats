#version 300 es
precision highp float;

in vec2 v_uv;
uniform vec3 u_r;      // camera right
uniform vec3 u_u;      // camera up
uniform vec3 u_f;      // camera forward
uniform vec3 u_sun;    // direction toward the sun
uniform float u_th;    // tan(fov / 2)
uniform float u_asp;
uniform float u_day;   // 0 night .. 1 full day
uniform float u_dusk;  // sunset glow amount
out vec4 o;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

void main() {
  vec3 d = normalize(u_f + v_uv.x * u_th * u_asp * u_r + v_uv.y * u_th * u_u);
  float h = d.y;
  vec3 zenith = mix(vec3(0.012, 0.018, 0.045), vec3(0.2, 0.4, 0.78), u_day);
  zenith = mix(zenith, vec3(0.035, 0.06, 0.15), u_dusk * 0.8);
  vec3 horizon = mix(vec3(0.05, 0.055, 0.09), vec3(0.7, 0.8, 0.92), u_day);
  horizon = mix(horizon, vec3(0.62, 0.4, 0.36), u_dusk);
  vec3 col = mix(zenith, horizon, pow(1.0 - clamp(h, 0.0, 1.0), 4.0));

  float s = max(dot(d, u_sun), 0.0);
  col += vec3(1.0, 0.5, 0.2) * (pow(s, 6.0) * 0.45 + pow(s, 80.0) * 0.8) * smoothstep(0.6, 0.0, h) * u_dusk;
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 6.0 + pow(s, 30.0) * 0.12) * u_day * step(-0.02, u_sun.y);

  if (h < 0.0) col = mix(horizon * 0.35, vec3(0.04, 0.04, 0.05), clamp(-h * 5.0, 0.0, 1.0));

  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0))) * 180.0;
  col += step(0.997, hash21(floor(sp))) * smoothstep(0.25, 0.7, h) * 0.6 * (1.0 - u_day);
  o = vec4(col, 1.0);
}
