precision highp float;

uniform sampler2D uAtlas;
uniform float uIntensity;
uniform float uOpacity;   // global fade for cycle mode

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlphaBoost;

void main() {
  vec4 tex = texture2D(uAtlas, vAtlasUv);
  // white text on transparent — alpha is the coverage mask
  float a = tex.a;
  if (a < 0.04) discard;

  // dark bg + additive blend → emit color * coverage. uOpacity scales the
  // emitted RGB so the ASCII can fade out behind the original photo.
  vec3 col = vColor * (uIntensity + vAlphaBoost);
  gl_FragColor = vec4(col * a * uOpacity, a * uOpacity);
}
