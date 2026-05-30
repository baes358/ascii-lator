// per-instance attributes
attribute vec2 aHome;
attribute vec2 aOffset;
attribute vec3 aColor;
attribute float aGlyph;
attribute float aPulse;    // 0..1 ring-pulse excitation
attribute float aPhase;    // 0..1 morph reveal phase (low = reveals early)

uniform float uQuadSize;   // world units per glyph quad
uniform float uScale;      // normalized → world units
uniform float uCols;       // atlas columns
uniform float uRows;       // atlas rows
uniform float uColorMode;  // 0 original · 1 mono-light · 2 mono-dark · 3 accent
uniform vec3  uAccent;
uniform float uMorph;      // 0 = no ASCII, 1 = full ASCII (cycle drives this)
uniform float uRevealBand; // per-particle smoothstep width during morph
uniform float uInvertRamp; // 1 in mono-dark — invert glyph index so bright photo = sparse glyph
uniform float uGlyphMax;   // atlasGlyphCount - 1, needed for ramp inversion

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlphaBoost;
varying float vReveal;     // per-particle morph reveal 0..1

void main() {
  // per-particle morph reveal — each particle has its own activation
  // point so the field crystallizes as a dissolve, not a uniform fade
  float reveal = smoothstep(aPhase, aPhase + uRevealBand, uMorph);
  vReveal = reveal;

  // scale the quad with both morph reveal and pulse excitation
  float morphScale = mix(0.08, 1.0, reveal);
  float quadScale = uQuadSize * morphScale * (1.0 + aPulse * 0.25);
  vec2 homePx = (aHome + aOffset) * uScale;
  vec2 worldPos = homePx + position.xy * quadScale;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 0.0, 1.0);

  // mono-dark inverts the ramp so bright photo regions render as SPARSE
  // glyphs (mostly white) and dark regions as DENSE glyphs (lots of black
  // ink). Light/original/accent modes keep aGlyph as-is.
  float effectiveGlyph = mix(aGlyph, uGlyphMax - aGlyph, uInvertRamp);

  // atlas UV — flipY=true on texture, so invert row direction
  float col = mod(effectiveGlyph, uCols);
  float row = floor(effectiveGlyph / uCols);
  float rowFromBottom = (uRows - 1.0) - row;
  vAtlasUv = vec2(
    (col + uv.x) / uCols,
    (rowFromBottom + uv.y) / uRows
  );

  // brightness for color modulation
  float lum = dot(aColor, vec3(0.299, 0.587, 0.114));

  vec3 c;
  if (uColorMode < 0.5) {
    c = aColor;                                  // 0 original
  } else if (uColorMode < 2.5) {
    c = vec3(0.55 + 0.45 * lum);                 // 1 mono-light / 2 mono-dark (frag overrides for dark)
  } else {
    c = uAccent * (0.35 + 0.85 * lum);           // 3 accent
  }

  // ring-pulse: brighten + push toward accent so the band lights up as
  // a clearly-readable arc of dense ASCII
  c = c * (1.0 + aPulse * 1.4) + uAccent * (aPulse * 0.9);

  // mid-morph particles glow a bit hotter while they're spawning in
  float spawn = reveal * (1.0 - reveal) * 4.0; // peaks at reveal=0.5
  c += uAccent * spawn * 0.45;
  vColor = c;

  // displaced or excited particles glow brighter
  float disp = length(aOffset);
  vAlphaBoost = clamp(disp * 0.4 + aPulse * 0.7 + spawn * 0.4, 0.0, 1.0);
}
