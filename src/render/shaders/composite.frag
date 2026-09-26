#version 300 es
precision highp float;

// Final image: scene + bloom, a soft highlight shoulder, vignette and a touch of grain.
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomK;
uniform float u_seed;
out vec4 o;

void main() {
  vec2 uv = v_uv * 0.5 + 0.5;
  vec3 c = texture(u_scene, uv).rgb + texture(u_bloom, uv).rgb * u_bloomK;
  // Leave everything under 0.75 exactly as authored; roll brighter values off toward 1.
  vec3 shoulder = 0.75 + 0.25 * (1.0 - exp(-(c - 0.75) / 0.25));
  c = mix(c, shoulder, step(vec3(0.75), c));
  float vignette = smoothstep(1.35, 0.4, length(v_uv * vec2(1.0, 0.9)));
  c *= mix(0.8, 1.0, vignette);
  float grain = fract(sin(dot(gl_FragCoord.xy + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
  c += (grain - 0.5) * (1.5 / 255.0);
  o = vec4(c, 1.0);
}
