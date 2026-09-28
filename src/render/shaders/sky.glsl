// Sky radiance for a direction: shared by the sky background (sky.frag) and by reflections on
// glass and metal splats (splat.vert), so reflections always match the sky you see.

uniform vec3 u_sun;    // direction toward the sun
uniform float u_day;   // 0 night .. 1 full day
uniform float u_dusk;  // sunset glow amount

float skyHash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec3 skyHorizon() {
  vec3 horizon = mix(vec3(0.05, 0.055, 0.09), vec3(0.7, 0.8, 0.92), u_day);
  return mix(horizon, vec3(0.62, 0.4, 0.36), u_dusk);
}

/** Light arriving from direction d (unit). Below the horizon it's the dim ground. stars adds the star field. */
vec3 skyRadiance(vec3 d, bool stars) {
  float h = d.y;
  vec3 zenith = mix(vec3(0.012, 0.018, 0.045), vec3(0.2, 0.4, 0.78), u_day);
  zenith = mix(zenith, vec3(0.035, 0.06, 0.15), u_dusk * 0.8);
  vec3 horizon = skyHorizon();
  vec3 col = mix(zenith, horizon, pow(1.0 - clamp(h, 0.0, 1.0), 4.0));
  float s = max(dot(d, u_sun), 0.0);
  col += vec3(1.0, 0.5, 0.2) * (pow(s, 6.0) * 0.45 + pow(s, 80.0) * 0.8) * smoothstep(0.6, 0.0, h) * u_dusk;
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 6.0 + pow(s, 30.0) * 0.12) * u_day * step(-0.02, u_sun.y);
  if (h < 0.0) col = mix(horizon * 0.35, vec3(0.04, 0.04, 0.05), clamp(-h * 5.0, 0.0, 1.0));
  if (stars) {
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0))) * 180.0;
    col += step(0.997, skyHash(floor(sp))) * smoothstep(0.25, 0.7, h) * 0.6 * (1.0 - u_day);
  }
  return col;
}
