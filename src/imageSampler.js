/**
 * Downscales the source image into a (gridW x gridH) cell grid, computes
 * luminance per cell, and packs three flat typed arrays the particle
 * system can copy into instanced attributes.
 *
 *   sampleImage(htmlImage, { gridW, gridH, ramp })
 *     → { homes, colors, glyphs, count, gridW, gridH, aspect }
 *
 * Note: bright cells get dense glyphs (end of ramp) — the ramp is treated
 * as ordered light → heavy. This matches the spec's "dark bg, reversed ramp,
 * bright = dense glyphs".
 */
export function sampleImage(image, { gridW, gridH, ramp, brightness = 1.0 }) {
  const w = Math.max(1, Math.floor(gridW));
  const h = Math.max(1, Math.floor(gridH));
  const glyphCount = ramp.length;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // smooth downscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);

  const pixels = ctx.getImageData(0, 0, w, h).data;
  const count = w * h;

  const homes = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const glyphs = new Float32Array(count);
  const lums = new Float32Array(count); // cached for the second pass

  // --- pass 1: compute per-cell luminance and mean for auto-exposure ---
  let sumLum = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const r = pixels[p] / 255;
    const g = pixels[p + 1] / 255;
    const b = pixels[p + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lums[i] = lum;
    sumLum += lum;
  }
  const meanLum = sumLum / count;

  // Auto-exposure via gamma — solve pow(meanLum, autoGamma) = TARGET_MEAN
  // so the photo's mean tone lands at a readable mid-density on the ramp.
  // Clamped so flat / blown-out photos don't get crushed or over-cooked.
  const TARGET_MEAN = 0.5;
  let autoGamma = Math.log(TARGET_MEAN) / Math.log(Math.max(0.02, meanLum));
  if (autoGamma < 0.4) autoGamma = 0.4;
  if (autoGamma > 1.4) autoGamma = 1.4;

  // User brightness slider rides ON TOP of auto-exposure (multiplicative
  // on the exponent). brightness=1 → auto baseline; >1 → lift further; <1 → darken.
  const exp = autoGamma / Math.max(0.01, brightness);

  // Build per-cell positions in a centered, aspect-preserving coordinate
  // space ranging roughly [-1, 1] on the longer axis. The particle system
  // will scale this to world units that fit the viewport.
  const aspect = w / h;
  const halfW = aspect >= 1 ? 1 : aspect;
  const halfH = aspect >= 1 ? 1 / aspect : 1;

  // --- pass 2: position + color + glyph index ---
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r = pixels[p] / 255;
      const g = pixels[p + 1] / 255;
      const b = pixels[p + 2] / 255;
      const lumAdj = Math.pow(lums[i], exp);

      // brightness bucket — bright → dense glyph (high index)
      let gi = Math.floor(lumAdj * glyphCount);
      if (gi >= glyphCount) gi = glyphCount - 1;
      if (gi < 0) gi = 0;

      // grid (x,y) → centered position; flip Y so image top is up
      const nx = ((x + 0.5) / w) * 2 - 1; // [-1, 1]
      const ny = 1 - ((y + 0.5) / h) * 2; // [-1, 1], top positive

      homes[i * 2] = nx * halfW;
      homes[i * 2 + 1] = ny * halfH;

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      glyphs[i] = gi;
    }
  }

  return { homes, colors, glyphs, count, gridW: w, gridH: h, aspect };
}

/**
 * Given a target particle count and the image aspect ratio, pick a grid
 * (gridW, gridH) whose product is roughly target and whose proportions
 * match the image. Capped to keep things sane.
 */
export function gridForTarget(target, aspect) {
  const a = aspect || 1;
  // target = w * h ; w/h = a → h = sqrt(target / a) ; w = a * h
  const h = Math.max(1, Math.round(Math.sqrt(target / a)));
  const w = Math.max(1, Math.round(a * h));
  return { gridW: w, gridH: h };
}
