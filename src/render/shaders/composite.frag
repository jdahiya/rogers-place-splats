#version 300 es
precision highp float;

// Final image. The generated arena gets bloom, a soft highlight shoulder, vignette and grain.
// Loaded captures are shown neutrally, as the reference renderer does: blended colour, clamped,
// with a sRGB encode only when the capture's colours are linear (glTF lin_rec709_display).
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomK;
uniform float u_seed;
uniform float u_look;     // 1 for the arena's look, 0 for neutral
uniform float u_encode;   // 1 when blended colours are linear and need the sRGB transfer
out vec4 o;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = v_uv * 0.5 + 0.5;
  vec3 c = texture(u_scene, uv).rgb + texture(u_bloom, uv).rgb * u_bloomK;
  if (u_encode > 0.5) c = toSrgb(c);
  if (u_look > 0.5) {
    // Leave everything under 0.75 exactly as authored; roll brighter values off toward 1.
    vec3 shoulder = 0.75 + 0.25 * (1.0 - exp(-(c - 0.75) / 0.25));
    c = mix(c, shoulder, step(vec3(0.75), c));
    float vignette = smoothstep(1.35, 0.4, length(v_uv * vec2(1.0, 0.9)));
    c *= mix(0.8, 1.0, vignette);
    float grain = fract(sin(dot(gl_FragCoord.xy + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
    c += (grain - 0.5) * (1.5 / 255.0);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}
