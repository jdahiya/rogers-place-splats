#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

// Splat data: two RGBA32UI texels per splat, 1024 splats per row.
//   texel 0: position xyz (float bits), colour RGBA8 (the degree-0 colour, 0.5 + C0 · f_dc)
//   texel 1: covariance as three half2 pairs, then gain (half) | octahedral normal << 16
// Rendering follows Kerbl et al. 2023 (3D Gaussian Splatting) and KHR_gaussian_splatting:
// EWA projection with a 0.3 px dilation, alpha = min(0.99, o·G), skip alpha < 1/255, 3σ extent.
uniform usampler2D u_tex;
uniform usampler2D u_sh;     // higher-order spherical harmonics, 512 splats per row
uniform sampler2D u_light;   // ray-traced lighting per splat, RGB = light / 2
uniform mat4 u_proj;
uniform mat4 u_view;
uniform vec2 u_focal;
uniform vec2 u_vp;
uniform vec2 u_tanFov;       // tan(fovx / 2), tan(fovy / 2)
uniform vec3 u_camPos;
uniform mat3 u_shRot;        // world directions into the capture's own axes
uniform int u_shDegree;
uniform int u_shTexels;
uniform int u_aa;            // 0 none, 1 anti-aliased (0.3 dilation), 2 Mip-Splatting (0.1 dilation)
uniform float u_useLight;
uniform float u_minPx;       // splats smaller than this many pixels are skipped
uniform float u_fogD;
uniform float u_nightGlow;   // 1 at night, 0 at noon: outdoor lights fade in daylight
uniform vec3 u_fogC;

in vec2 a_pos;               // quad corner in [-1, 1]
in uint a_idx;               // splat index, sorted far to near
out vec4 v_col;
out vec2 v_p;

const float SQRT_4_5 = 2.1213203; // 3σ in units of sqrt(2)σ

// Real spherical-harmonic basis constants (graphdeco-inria/gaussian-splatting, sh_utils.py).
const float SH_C1 = 0.4886025119029199;
const float SH_C2_0 = 1.0925484305920792;
const float SH_C2_1 = -1.0925484305920792;
const float SH_C2_2 = 0.31539156525252005;
const float SH_C2_3 = -1.0925484305920792;
const float SH_C2_4 = 0.5462742152960396;
const float SH_C3_0 = -0.5900435899266435;
const float SH_C3_1 = 2.890611442640554;
const float SH_C3_2 = -0.4570457994644658;
const float SH_C3_3 = 0.3731763325901154;
const float SH_C3_4 = -0.4570457994644658;
const float SH_C3_5 = 1.445305721320277;
const float SH_C3_6 = -0.5900435899266435;

float sdArena(vec2 p, float d) {
  vec2 q = abs(p) - vec2(21.95, 4.42);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - (8.53 + d);
}

#define SH(k) vec3(h[3 * (k)], h[3 * (k) + 1], h[3 * (k) + 2])

/** View-dependent colour beyond the base colour, for the direction from the camera to the splat. */
vec3 shColor(uint idx, vec3 worldPos) {
  float h[48];
  int base = int(idx & 511u) * u_shTexels, row = int(idx >> 9);
  for (int t = 0; t < 6; t++) {
    if (t >= u_shTexels) break;
    uvec4 v = texelFetch(u_sh, ivec2(base + t, row), 0);
    vec2 a = unpackHalf2x16(v.x), b = unpackHalf2x16(v.y), c = unpackHalf2x16(v.z), d = unpackHalf2x16(v.w);
    h[t * 8] = a.x; h[t * 8 + 1] = a.y; h[t * 8 + 2] = b.x; h[t * 8 + 3] = b.y;
    h[t * 8 + 4] = c.x; h[t * 8 + 5] = c.y; h[t * 8 + 6] = d.x; h[t * 8 + 7] = d.y;
  }
  vec3 dir = normalize(u_shRot * (worldPos - u_camPos));
  float x = dir.x, y = dir.y, z = dir.z;
  vec3 c = -SH_C1 * y * SH(0) + SH_C1 * z * SH(1) - SH_C1 * x * SH(2);
  if (u_shDegree > 1) {
    float xx = x * x, yy = y * y, zz = z * z, xy = x * y, yz = y * z, xz = x * z;
    c += SH_C2_0 * xy * SH(3) + SH_C2_1 * yz * SH(4) + SH_C2_2 * (2.0 * zz - xx - yy) * SH(5)
       + SH_C2_3 * xz * SH(6) + SH_C2_4 * (xx - yy) * SH(7);
    if (u_shDegree > 2) {
      c += SH_C3_0 * y * (3.0 * xx - yy) * SH(8) + SH_C3_1 * xy * z * SH(9)
         + SH_C3_2 * y * (4.0 * zz - xx - yy) * SH(10) + SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * SH(11)
         + SH_C3_4 * x * (4.0 * zz - xx - yy) * SH(12) + SH_C3_5 * z * (xx - yy) * SH(13)
         + SH_C3_6 * x * (xx - 3.0 * yy) * SH(14);
    }
  }
  return c;
}

void cull() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }

void main() {
  ivec2 tc = ivec2(int((a_idx & 1023u) << 1), int(a_idx >> 10));
  uvec4 c = texelFetch(u_tex, tc, 0);
  float opacity = float(c.w >> 24) / 255.0;
  if (opacity < 1.0 / 255.0) { cull(); return; }
  vec3 wp = uintBitsToFloat(c.xyz);
  vec4 cam = u_view * vec4(wp, 1.0);
  vec4 clip = u_proj * cam;
  float lim = 1.2 * clip.w;
  // Near plane at 0.2 m, as in the reference rasteriser.
  if (cam.z > -0.2 || clip.x < -lim || clip.x > lim || clip.y < -lim || clip.y > lim) { cull(); return; }

  uvec4 h = texelFetch(u_tex, tc + ivec2(1, 0), 0);
  vec2 u1 = unpackHalf2x16(h.x), u2 = unpackHalf2x16(h.y), u3 = unpackHalf2x16(h.z);
  mat3 V = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y);
  mat3 W = mat3(u_view);
  mat3 C = W * V * transpose(W);

  // EWA splatting: project the 3D covariance with the Jacobian of the perspective divide at the
  // splat centre. As in the reference, the centre is clamped to 1.3× the field of view first so
  // splats far off-screen don't get extreme Jacobians. The camera looks down -z.
  float tz = -cam.z, iz = 1.0 / cam.z;
  vec2 fovLim = 1.3 * u_tanFov;
  float tx = clamp(cam.x / tz, -fovLim.x, fovLim.x) * tz;
  float ty = clamp(cam.y / tz, -fovLim.y, fovLim.y) * tz;
  vec3 j1 = vec3(-u_focal.x * iz, 0.0, u_focal.x * tx * iz * iz);
  vec3 j2 = vec3(0.0, -u_focal.y * iz, u_focal.y * ty * iz * iz);
  vec3 Cj1 = C * j1, Cj2 = C * j2;
  float a0 = dot(j1, Cj1), b = dot(j1, Cj2), d0 = dot(j2, Cj2);
  // Low-pass dilation: 0.3 px² normally, 0.1 for Mip-Splatting captures. Anti-aliased captures
  // compensate opacity for it by sqrt(det before / det after).
  float dilation = u_aa == 2 ? 0.1 : 0.3;
  float a = a0 + dilation, d = d0 + dilation;
  if (u_aa > 0) opacity *= sqrt(max(2.5e-5, (a0 * d0 - b * b) / (a * d - b * b)));

  float mid = 0.5 * (a + d), rad = length(vec2(0.5 * (a - d), b));
  float l1 = mid + rad, l2 = mid - rad;
  if (l2 < 0.0) { cull(); return; }
  float extent = sqrt(2.0 * l1);
  if (extent < u_minPx) { cull(); return; }
  vec2 e1 = abs(b) > 1e-8 ? normalize(vec2(b, l1 - a)) : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 major = min(extent, 1024.0) * e1;
  vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(e1.y, -e1.x);

  vec3 col = vec3(c.w & 0xffu, (c.w >> 8) & 0xffu, (c.w >> 16) & 0xffu) / 255.0;
  if (u_shDegree > 0) col = max(col + shColor(a_idx, wp), 0.0);
  float gain = unpackHalf2x16(h.w).x;
  if (gain > 1.01) {
    // Emissive: screens, lamps, windows. Outdoor ones dim in daylight.
    bool inside = sdArena(wp.xz, 49.5) < 0.0 && abs(wp.y) < 48.0;
    col *= inside ? gain : mix(0.35, gain, u_nightGlow);
  } else if (u_useLight > 0.5) {
    col *= texelFetch(u_light, ivec2(int(a_idx & 1023u), int(a_idx >> 10)), 0).rgb * 2.0;
  }
  col = mix(col, u_fogC, 1.0 - exp(-length(cam.xyz) * u_fogD));

  // Only cover pixels where alpha can reach 1/255: |p|² ≤ ln(255·opacity), and never beyond 3σ.
  float reach = min(SQRT_4_5, sqrt(max(log(255.0 * opacity), 0.0)));
  vec2 corner = a_pos * reach;
  v_col = vec4(col, opacity);
  v_p = corner;
  gl_Position = vec4(clip.xy / clip.w + (corner.x * major + corner.y * minor) * 2.0 / u_vp, 0.0, 1.0);
}
