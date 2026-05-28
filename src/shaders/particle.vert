// per-instance attributes
attribute vec2 aHome;
attribute vec2 aOffset;
attribute vec3 aColor;
attribute float aGlyph;

uniform float uQuadSize;   // world units per glyph quad
uniform float uScale;      // normalized → world units
uniform float uCols;       // atlas columns
uniform float uRows;       // atlas rows
uniform float uColorMode;  // 0 original · 1 mono · 2 accent
uniform vec3  uAccent;

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlphaBoost;

void main() {
  vec2 homePx = (aHome + aOffset) * uScale;
  vec2 worldPos = homePx + position.xy * uQuadSize;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 0.0, 1.0);

  // atlas UV — flipY=true on texture, so invert row direction
  float col = mod(aGlyph, uCols);
  float row = floor(aGlyph / uCols);
  float rowFromBottom = (uRows - 1.0) - row;
  vAtlasUv = vec2(
    (col + uv.x) / uCols,
    (rowFromBottom + uv.y) / uRows
  );

  // brightness for color modulation
  float lum = dot(aColor, vec3(0.299, 0.587, 0.114));

  vec3 c;
  if (uColorMode < 0.5) {
    c = aColor;
  } else if (uColorMode < 1.5) {
    c = vec3(0.55 + 0.45 * lum);
  } else {
    c = uAccent * (0.35 + 0.85 * lum);
  }
  vColor = c;

  // particles displaced from home glow slightly brighter
  float disp = length(aOffset);
  vAlphaBoost = clamp(disp * 0.6, 0.0, 0.5);
}
