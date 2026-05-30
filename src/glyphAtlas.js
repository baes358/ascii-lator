import * as THREE from 'three';

/**
 * Renders the character ramp to an offscreen canvas as a packed atlas.
 * Returns a NearestFilter texture plus the grid dimensions the shader
 * needs to compute per-glyph UV offsets.
 *
 *   buildAtlas(' .:-=+*#%@', { cellSize: 16, dpr: 2 })
 *     → { texture, cols, rows, glyphCount, cellSize, dpr }
 */
export function buildAtlas(
  ramp,
  {
    cellSize = 16,
    dpr = 2,
    padding = 2,
    fontWeight = '800',
    fontFamily = '"Switzer", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  } = {},
) {
  const glyphCount = ramp.length;
  const cols = Math.ceil(Math.sqrt(glyphCount));
  const rows = Math.ceil(glyphCount / cols);

  const px = Math.floor(cellSize * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = cols * px;
  canvas.height = rows * px;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fontSize = Math.max(8, (cellSize - padding) * dpr);
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  for (let i = 0; i < glyphCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * px + px / 2;
    const cy = row * px + px / 2;
    const ch = ramp[i];
    if (ch !== ' ') ctx.fillText(ch, cx, cy);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.premultipliedAlpha = false;
  texture.flipY = true; // default; row is inverted in shader
  texture.needsUpdate = true;

  return { texture, cols, rows, glyphCount, cellSize, dpr };
}
