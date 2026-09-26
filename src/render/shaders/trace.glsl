// Shared ray-marching code for the lighting passes (included by lighting.frag and cache.frag).
//
// Two voxel grids describe the scene: a fine one around the arena and a coarse one for the city.
// Each grid has a geometry texture (rgb = emitted light, a = how much of the voxel the splats
// cover) and a radiance cache (rgb = light leaving the voxel's surfaces, premultiplied by
// coverage). Tracing a ray through the cache is what makes light bounce: whatever a ray hits
// contributes the light that surface is itself sending out.

uniform highp sampler3D u_geoIn;
uniform highp sampler3D u_geoOut;
uniform highp sampler3D u_radIn;
uniform highp sampler3D u_radOut;
uniform vec3 u_inMin;
uniform vec3 u_inInv;         // 1 / grid extent in metres
uniform vec3 u_outMin;
uniform vec3 u_outInv;
uniform float u_vIn;          // voxel size in metres
uniform float u_vOut;
uniform float u_radScale;     // radiance stored / u_radScale (1 for half-float, 4 for 8-bit)
uniform int u_frame;
uniform int u_steps;          // march steps for shadow rays
uniform int u_lights;
uniform int u_lightSamples;
uniform vec3 u_sun;           // direction toward the sun
uniform vec3 u_sunCol;
uniform vec3 u_sky;           // sky radiance for rays that escape outdoors
uniform vec3 u_ambient;       // faint fill for rays that escape indoors
uniform vec4 u_lightPos[16];  // xyz, w = intensity
uniform vec3 u_lightCol[16];
uniform vec4 u_lightDir[16];  // spot direction; w = cos of cone, below -1 for omni lights
uniform float u_lightCdf[16]; // running sum of intensities, for picking lights by brightness
uniform float u_lightTotal;

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

vec3 uniformSphere(inout uint s) {
  float z = 1.0 - 2.0 * rand(s), ph = 6.2831853 * rand(s), r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(ph), z, r * sin(ph));
}

float sdArena(vec2 p, float d) {
  vec2 q = abs(p) - vec2(21.95, 4.42);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - (8.53 + d);
}

float roofY(vec2 p) {
  float t = clamp(-sdArena(p, 50.0) / 55.0, 0.0, 1.0);
  return 40.0 + 8.0 * (1.0 - (1.0 - t) * (1.0 - t));
}

bool isInside(vec3 p) {
  return sdArena(p.xz, 49.5) < 0.0 && p.y < roofY(p.xz) - 0.5;
}

bool inFordHall(vec3 p) {
  return p.x > 66.0 && p.x < 108.0 && p.z > -42.0 && p.z < 30.0 && p.y < 27.5;
}

bool inFine(vec3 p) {
  vec3 q = (p - u_inMin) * u_inInv;
  return all(greaterThanEqual(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)));
}

float voxelAt(vec3 p) {
  return inFine(p) ? u_vIn : u_vOut;
}

float occupancy(vec3 p) {
  vec3 q = (p - u_inMin) * u_inInv;
  if (all(greaterThanEqual(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)))) return textureLod(u_geoIn, q, 0.0).a;
  vec3 r = (p - u_outMin) * u_outInv;
  if (any(lessThan(r, vec3(0.0))) || any(greaterThanEqual(r, vec3(1.0)))) return 0.0;
  return textureLod(u_geoOut, r, 0.0).a;
}

void sampleScene(vec3 p, out float occ, out vec3 radiance) {
  vec3 q = (p - u_inMin) * u_inInv;
  if (all(greaterThanEqual(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)))) {
    occ = textureLod(u_geoIn, q, 0.0).a;
    radiance = textureLod(u_radIn, q, 0.0).rgb * u_radScale;
    return;
  }
  vec3 r = (p - u_outMin) * u_outInv;
  if (any(lessThan(r, vec3(0.0))) || any(greaterThanEqual(r, vec3(1.0)))) {
    occ = 0.0;
    radiance = vec3(0.0);
    return;
  }
  occ = textureLod(u_geoOut, r, 0.0).a;
  radiance = textureLod(u_radOut, r, 0.0).rgb * u_radScale;
}

// Floors live in the voxel layer just under y = 0. Rays from points on or near a floor start
// half a voxel up so the floor they sit on doesn't shadow them.
vec3 rayOrigin(vec3 p, float voxel) {
  return vec3(p.x, max(p.y, 0.5 * voxel), p.z);
}

// Fraction of light that reaches p along dir from tMax metres away (shadow rays).
float visibility(vec3 p, vec3 dir, float tMax, float jitter) {
  float voxel = voxelAt(p), stride = max(voxel, tMax / float(u_steps));
  float t = voxel * 1.5 + stride * jitter, T = 1.0; // start outside the point's own voxel
  vec3 o = rayOrigin(p, voxel);
  for (int i = 0; i < 128; i++) {
    if (i >= u_steps || t > tMax) break;
    T *= 1.0 - occupancy(o + dir * t);
    if (T < 0.03) return 0.0;
    t += stride;
  }
  return T;
}

// Light arriving at p from direction dir: the cached light of every surface the ray meets,
// weighted by how much of it is still visible, plus whatever escapes (sky outdoors, faint fill indoors).
vec3 incoming(vec3 p, vec3 dir, float tMax, int steps, float jitter, bool inside) {
  float voxel = voxelAt(p), stride = max(voxel, tMax / float(steps));
  float t = voxel * 1.5 + stride * jitter, T = 1.0;
  vec3 o = rayOrigin(p, voxel), L = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= steps || t > tMax) break;
    float occ;
    vec3 rad;
    sampleScene(o + dir * t, occ, rad);
    L += rad * T;
    T *= 1.0 - occ;
    if (T < 0.03) {
      T = 0.0;
      break;
    }
    t += stride;
  }
  return L + T * (inside ? u_ambient : u_sky);
}

// Direct light with shadow rays: the arena's light rig indoors, the sun outdoors.
vec3 direct(vec3 p, vec3 n, bool hasNormal, bool inside, inout uint seed) {
  vec3 L = vec3(0.0);
  if (inside) {
    // Each shadow ray aims at a light picked in proportion to its brightness and is weighted
    // by 1/probability, so the average stays unbiased.
    for (int k = 0; k < 4; k++) {
      if (k >= u_lightSamples || u_lights == 0) break;
      float pickAt = rand(seed) * u_lightTotal;
      int li = u_lights - 1;
      for (int j = 0; j < 16; j++) {
        if (j >= u_lights) break;
        if (pickAt <= u_lightCdf[j]) {
          li = j;
          break;
        }
      }
      vec3 to = u_lightPos[li].xyz - p;
      float dist = length(to);
      vec3 l = to / dist;
      float cone = 1.0;
      if (u_lightDir[li].w > -1.0) cone = smoothstep(u_lightDir[li].w, u_lightDir[li].w + 0.02, dot(-l, u_lightDir[li].xyz));
      if (cone <= 0.0) continue;
      float facing = hasNormal ? abs(dot(n, l)) : 0.7;
      L += u_lightCol[li] * u_lightTotal * facing * cone * visibility(p, l, dist - 1.0, rand(seed)) / float(u_lightSamples);
    }
  } else {
    if (u_sun.y > -0.05) {
      float facing = hasNormal ? abs(dot(n, u_sun)) : 0.6;
      L += u_sunCol * facing * visibility(p, u_sun, 400.0, rand(seed));
    }
    // Ford Hall's white ceiling holds hundreds of downlights; treat them as an even fill.
    if (inFordHall(p)) L += vec3(0.45, 0.45, 0.47);
  }
  return L;
}

// Indirect light: the average light arriving over the whole sphere, doubled because a surface
// only sees one hemisphere of it. Sky light and every bounce come in through here.
vec3 indirect(vec3 p, bool inside, int rays, int steps, inout uint seed) {
  // Indoors, rays need to reach across the bowl to the ice and the far stands.
  float reach = inside ? 40.0 : voxelAt(p) * 12.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= rays) break;
    vec3 dir = uniformSphere(seed);
    sum += min(incoming(p, dir, reach, steps, rand(seed), inside), vec3(2.0)); // clamp fireflies
  }
  return 2.0 * sum / float(max(rays, 1));
}
