#version 300 es
precision highp float;

in vec4 v_col;
in vec2 v_p;
out vec4 o;

void main() {
  // Gaussian falloff; v_p is in units of sqrt(2) sigma, so the quad edge at 2 is ~2.8 sigma.
  float A = -dot(v_p, v_p);
  if (A < -4.0) discard;
  float B = exp(A) * v_col.a;
  o = vec4(v_col.rgb * B, B); // premultiplied, blended back to front
}
