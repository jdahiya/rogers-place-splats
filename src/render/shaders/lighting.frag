#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp usampler2D;

// Progressive ray-traced lighting. Each fragment is one splat (same 1024-per-row layout as the
// splat data texture). Rays are marched through two voxel grids built from the splats: a fine
// grid around the arena and a coarse one for the city. RGBA = light / 2, blended over frames so
// the noise from a few rays per pass averages out.

uniform usampler2D u_tex;
uniform sampler3D u_gridIn;   // rgb = emitted light, a = occupancy
uniform sampler3D u_gridOut;
uniform vec3 u_inMin;
uniform vec3 u_inInv;         // 1 / grid extent
uniform vec3 u_outMin;
uniform vec3 u_outInv;
uniform float u_vIn;          // voxel size, metres
uniform float u_vOut;
uniform int u_n;
uniform int u_frame;
uniform int u_rays;           // ambient-occlusion rays per splat per pass
uniform int u_steps;          // march steps per ray
uniform int u_lights;
uniform int u_lightSamples;   // shadow rays per splat per pass
uniform vec3 u_sun;           // direction toward the sun
uniform vec3 u_sunCol;
uniform vec3 u_sky;           // outdoor ambient
uniform vec3 u_ambient;       // indoor ambient
uniform vec4 u_lightPos[16];  // xyz, w = intensity
uniform vec3 u_lightCol[16];
uniform vec4 u_lightDir[16];  // spot direction; w = cos of cone, below -1 for omni lights
uniform float u_lightCdf[16]; // running sum of intensities, for picking lights by brightness
uniform float u_lightTotal;
out vec4 o;

uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

float rand(inout uint s) {
  s = hash(s);
  return float(s) * (1.0 / 4294967296.0);
}

float sdArena(vec2 p, float d) {
  vec2 q = abs(p) - vec2(21.95, 4.42);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - (8.53 + d);
}

float roofY(vec2 p) {
  float t = clamp(-sdArena(p, 50.0) / 55.0, 0.0, 1.0);
  return 40.0 + 8.0 * (1.0 - (1.0 - t) * (1.0 - t));
}

bool inFine(vec3 p) {
  vec3 q = (p - u_inMin) * u_inInv;
  return all(greaterThanEqual(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)));
}

vec4 grid(vec3 p) {
  vec3 q = (p - u_inMin) * u_inInv;
  if (all(greaterThanEqual(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)))) return textureLod(u_gridIn, q, 0.0);
  vec3 r = (p - u_outMin) * u_outInv;
  if (any(lessThan(r, vec3(0.0))) || any(greaterThanEqual(r, vec3(1.0)))) return vec4(0.0);
  return textureLod(u_gridOut, r, 0.0);
}

// Transmittance along a ray. Emitted light met along the way is added to `gathered`.
float trace(vec3 p, vec3 dir, float tMax, float jitter, inout vec3 gathered, float gatherWeight) {
  float voxel = inFine(p) ? u_vIn : u_vOut;
  float stride = max(voxel, tMax / float(u_steps));
  float t = voxel * 1.5 + stride * jitter; // start outside the splat's own voxel
  float T = 1.0;
  vec3 met = vec3(0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= u_steps || t > tMax) break;
    vec4 g = grid(p + dir * t);
    met += g.rgb * T;
    T *= 1.0 - g.a;
    if (T < 0.03) { T = 0.0; break; }
    t += stride;
  }
  // Cap what one ray can bring back so a lucky hit on a bright screen doesn't make a firefly.
  gathered += min(met * gatherWeight, vec3(0.35));
  return T;
}

void main() {
  int col = int(gl_FragCoord.x), row = int(gl_FragCoord.y);
  int idx = row * 1024 + col;
  if (idx >= u_n) { o = vec4(0.5); return; }
  uvec4 t0 = texelFetch(u_tex, ivec2(col * 2, row), 0);
  uvec4 t1 = texelFetch(u_tex, ivec2(col * 2 + 1, row), 0);
  if (unpackHalf2x16(t1.w).x > 1.01) { o = vec4(0.5); return; } // emissive: not lit

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
  if (p.y < -0.02) { p.y = -p.y; n.y = -n.y; }

  uint seed = hash(uint(idx) * 747796405u + uint(u_frame) * 2891336453u);
  bool inside = sdArena(p.xz, 49.5) < 0.0 && p.y < roofY(p.xz) - 0.5;
  float voxel = inFine(p) ? u_vIn : u_vOut;

  // Ambient occlusion over the whole sphere (x2, since a surface sees at most half of it),
  // gathering light from emissive voxels on the way.
  vec3 gathered = vec3(0.0);
  float open = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_rays) break;
    float z = 1.0 - 2.0 * rand(seed), ph = 6.2831853 * rand(seed), r = sqrt(max(0.0, 1.0 - z * z));
    open += trace(p, vec3(r * cos(ph), z, r * sin(ph)), voxel * 8.0, rand(seed), gathered, 0.3);
  }
  float ao = min(1.0, 2.0 * open / float(u_rays));
  gathered /= float(u_rays);

  vec3 light;
  vec3 none = vec3(0.0);
  if (inside) {
    light = u_ambient * ao;
    // A few shadow rays per pass, each aimed at a light picked in proportion to its brightness
    // and weighted by 1/probability so the average stays unbiased.
    for (int k = 0; k < 4; k++) {
      if (k >= u_lightSamples || u_lights == 0) break;
      float pickAt = rand(seed) * u_lightTotal;
      int li = u_lights - 1;
      for (int j = 0; j < 16; j++) {
        if (j >= u_lights) break;
        if (pickAt <= u_lightCdf[j]) { li = j; break; }
      }
      vec3 to = u_lightPos[li].xyz - p;
      float dist = length(to);
      vec3 l = to / dist;
      float cone = 1.0;
      if (u_lightDir[li].w > -1.0) cone = smoothstep(u_lightDir[li].w, u_lightDir[li].w + 0.02, dot(-l, u_lightDir[li].xyz));
      if (cone <= 0.0) continue;
      float facing = hasNormal ? abs(dot(n, l)) : 0.75;
      float shadow = trace(p, l, dist - 1.0, rand(seed), none, 0.0);
      light += u_lightCol[li] * u_lightTotal * facing * cone * shadow / float(u_lightSamples);
    }
  } else {
    light = u_sky * ao;
    if (u_sun.y > -0.05) {
      float facing = hasNormal ? abs(dot(n, u_sun)) : 0.75;
      if (facing > 0.0) light += u_sunCol * facing * trace(p, u_sun, 400.0, rand(seed), none, 0.0);
    }
  }
  light += gathered * 1.5;
  o = vec4(clamp(light * 0.5, 0.0, 1.0), 1.0);
}
