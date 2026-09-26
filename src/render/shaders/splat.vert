#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

// Splat data: two RGBA32UI texels per splat, 1024 splats per row.
//   texel 0: position xyz (float bits), colour RGBA8
//   texel 1: covariance as three half2 pairs, then gain (half) | octahedral normal << 16
uniform usampler2D u_tex;
uniform sampler2D u_light;   // ray-traced lighting per splat, RGB = light / 2
uniform mat4 u_proj;
uniform mat4 u_view;
uniform vec2 u_focal;
uniform vec2 u_vp;
uniform float u_useLight;
uniform float u_minPx;       // splats smaller than this many pixels are skipped
uniform float u_fogD;
uniform float u_nightGlow;   // 1 at night, 0 at noon: outdoor lights fade in daylight
uniform vec3 u_fogC;

in vec2 a_pos;               // quad corner in [-2, 2]
in uint a_idx;               // splat index, sorted far to near
out vec4 v_col;
out vec2 v_p;

float sdArena(vec2 p, float d) {
  vec2 q = abs(p) - vec2(21.95, 4.42);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - (8.53 + d);
}

void cull() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }

void main() {
  ivec2 tc = ivec2(int((a_idx & 1023u) << 1), int(a_idx >> 10));
  uvec4 c = texelFetch(u_tex, tc, 0);
  vec3 wp = uintBitsToFloat(c.xyz);
  vec4 cam = u_view * vec4(wp, 1.0);
  vec4 clip = u_proj * cam;
  float lim = 1.2 * clip.w;
  if (cam.z > -0.05 || clip.x < -lim || clip.x > lim || clip.y < -lim || clip.y > lim) { cull(); return; }

  uvec4 h = texelFetch(u_tex, tc + ivec2(1, 0), 0);
  vec2 u1 = unpackHalf2x16(h.x), u2 = unpackHalf2x16(h.y), u3 = unpackHalf2x16(h.z);
  mat3 V = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y);
  mat3 W = mat3(u_view);
  mat3 C = W * V * transpose(W);

  // EWA splatting: project the 3D covariance with the Jacobian of the perspective
  // divide at this point (the camera looks down -z).
  float iz = 1.0 / cam.z;
  vec3 j1 = vec3(-u_focal.x * iz, 0.0, u_focal.x * cam.x * iz * iz);
  vec3 j2 = vec3(0.0, -u_focal.y * iz, u_focal.y * cam.y * iz * iz);
  vec3 Cj1 = C * j1, Cj2 = C * j2;
  float a = dot(j1, Cj1) + 0.3, b = dot(j1, Cj2), d = dot(j2, Cj2) + 0.3;
  float mid = 0.5 * (a + d), rad = length(vec2(0.5 * (a - d), b));
  float l1 = mid + rad, l2 = mid - rad;
  if (l2 < 0.0) { cull(); return; }
  float extent = sqrt(2.0 * l1);
  if (extent < u_minPx) { cull(); return; }
  vec2 e1 = abs(b) > 1e-8 ? normalize(vec2(b, l1 - a)) : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 major = min(extent, 1024.0) * e1;
  vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(e1.y, -e1.x);

  vec3 col = vec3(c.w & 0xffu, (c.w >> 8) & 0xffu, (c.w >> 16) & 0xffu) / 255.0;
  float gain = unpackHalf2x16(h.w).x;
  if (gain > 1.01) {
    // Emissive: screens, lamps, windows. Outdoor ones dim in daylight.
    bool inside = sdArena(wp.xz, 49.5) < 0.0 && abs(wp.y) < 48.0;
    col *= inside ? gain : mix(0.35, gain, u_nightGlow);
  } else if (u_useLight > 0.5) {
    col *= texelFetch(u_light, ivec2(int(a_idx & 1023u), int(a_idx >> 10)), 0).rgb * 2.0;
  }
  col = mix(col, u_fogC, 1.0 - exp(-length(cam.xyz) * u_fogD));

  v_col = vec4(col, float(c.w >> 24) / 255.0);
  v_p = a_pos;
  gl_Position = vec4(clip.xy / clip.w + (a_pos.x * major + a_pos.y * minor) * 2.0 / u_vp, 0.0, 1.0);
}
