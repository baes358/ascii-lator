precision highp float;

uniform sampler2D uAtlas;
uniform float uIntensity;

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlphaBoost;
varying float vReveal;   // per-particle morph reveal (0..1)

void main() {
  vec4 tex = texture2D(uAtlas, vAtlasUv);
  // white text on transparent — alpha is the coverage mask
  float a = tex.a;
  if (a < 0.04) discard;

  // dark bg + additive blend → emit color * coverage. vReveal staggers
  // the per-particle morph so the field crystallizes into ASCII as a
  // dissolve rather than a uniform opacity fade.
  vec3 col = vColor * (uIntensity + vAlphaBoost);
  gl_FragColor = vec4(col * a * vReveal, a * vReveal);
}
