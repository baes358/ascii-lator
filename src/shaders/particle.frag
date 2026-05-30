precision highp float;

uniform sampler2D uAtlas;
uniform float uIntensity;
uniform float uColorMode; // 2 = mono-dark (multiply-blend ink on white)

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlphaBoost;
varying float vReveal;   // per-particle morph reveal (0..1)

void main() {
  vec4 tex = texture2D(uAtlas, vAtlasUv);
  // white text on transparent — alpha is the coverage mask
  float a = tex.a;
  if (a < 0.04) discard;

  if (uColorMode > 1.5 && uColorMode < 2.5) {
    // mono-dark: material.blending is MultiplyBlending, so the fragment
    // output is the per-channel multiplier applied to the framebuffer.
    // ink = 1 → output (0,0,0) → dst becomes black.
    // ink = 0 → output (1,1,1) → dst unchanged.
    float ink = a * vReveal;
    gl_FragColor = vec4(vec3(1.0 - ink), 1.0);
    return;
  }

  // additive blend → emit color * coverage. vReveal staggers
  // the per-particle morph so the field crystallizes into ASCII as a
  // dissolve rather than a uniform opacity fade.
  vec3 col = vColor * (uIntensity + vAlphaBoost);
  gl_FragColor = vec4(col * a * vReveal, a * vReveal);
}
