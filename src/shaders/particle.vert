// per-instance attributes
attribute vec2 aHome;
attribute vec2 aOffset;
attribute vec3 aColor;
attribute float aGlyph;
attribute float aPulse;   // 0..1 ring-pulse excitation

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
  // scale up the quad a touch while excited so the lit ring reads sharper
  float quadScale = uQuadSize * (1.0 + aPulse * 0.25);
  vec2 homePx = (aHome + aOffset) * uScale;
  vec2 worldPos = homePx + position.xy * quadScale;

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

  // ring-pulse: brighten + push toward accent so the band lights up as
  // a clearly-readable arc of dense ASCII
  c = c * (1.0 + aPulse * 1.4) + uAccent * (aPulse * 0.9);
  vColor = c;

  // displaced or excited particles glow brighter
  float disp = length(aOffset);
  vAlphaBoost = clamp(disp * 0.4 + aPulse * 0.7, 0.0, 0.9);
}
