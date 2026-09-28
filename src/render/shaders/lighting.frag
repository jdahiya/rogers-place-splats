#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp usampler2D;

// Final gather: lights every splat from the radiance cache. Each fragment is one splat, in the
// interleaved layout described in lighting.ts, so a row of fragments holds splats from all over
// the scene. Direct light comes from shadow rays; indirect light (sky and every bounce) from rays
// read against the cache. RGBA = light / 2, blended over frames so the noise from a few rays per
// pass averages out.

#include "trace.glsl"

uniform usampler2D u_tex;
uniform ivec4 u_layout;   // interior count, total count, interior rows, exterior rows
uniform int u_rays;
out vec4 o;

void main() {
  int col = int(gl_FragCoord.x), row = int(gl_FragCoord.y);
  bool interior = row < u_layout.z;
  int j = interior ? col * u_layout.z + row : col * u_layout.w + (row - u_layout.z);
  if (j >= (interior ? u_layout.x : u_layout.y - u_layout.x)) {
    o = vec4(0.5);
    return;
  }
  int idx = interior ? j : u_layout.x + j;
  ivec2 at = ivec2((idx & 1023) * 2, idx >> 10);
  uvec4 t0 = texelFetch(u_tex, at, 0);
  uvec4 t1 = texelFetch(u_tex, at + ivec2(1, 0), 0);
  if (unpackHalf2x16(t1.w).x > 1.01) {
    o = vec4(0.5); // emissive: not lit
    return;
  }

  vec3 p = uintBitsToFloat(t0.xyz);
  uint nc = t1.w >> 16;
  bool hasNormal = nc != 0u;
  vec3 n = vec3(0.0, 1.0, 0.0);
  if (hasNormal) {
    vec2 e = (vec2(float(nc & 255u), float(nc >> 8)) - 1.0) / 254.0 * 2.0 - 1.0;
    vec3 m = vec3(e, 1.0 - abs(e.x) - abs(e.y));
    if (m.z < 0.0) m.xy = (1.0 - abs(m.yx)) * sign(m.xy);
    n = normalize(m);
  }
  // Ice reflections share the lighting of what they reflect.
  if (p.y < -0.02) {
    p.y = -p.y;
    n.y = -n.y;
  }

  uint seed = hash(uint(idx) * 747796405u + uint(u_frame) * 2891336453u);
  bool inside = isInside(p);
  vec3 light = direct(p, n, hasNormal, inside, seed) + indirect(p, inside, u_rays, 24, seed);
  o = vec4(clamp(light * 0.5, 0.0, 1.0), 1.0);
}
