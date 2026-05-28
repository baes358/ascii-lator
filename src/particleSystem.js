import * as THREE from 'three';
import vertSrc from './shaders/particle.vert?raw';
import fragSrc from './shaders/particle.frag?raw';

/**
 * Tunable physics constants — exposed for README docs. All distances are in
 * normalized image-space units (image's longer axis spans 2 units).
 */
export const PHYSICS = {
  stiffness: 55,        // spring pull toward home
  damping: 6.5,         // velocity damping
  repelRadius: 0.22,    // mouse push radius (normalized)
  repelStrength: 2.2,   // mouse push force
  burstRadius: 1.6,     // click burst radius (normalized; large = global)
  burstStrength: 6.0,   // click burst force
  scatterMin: 1.6,      // fly-in scatter inner radius
  scatterMax: 3.2,      // fly-in scatter outer radius
  maxSpeed: 12.0,       // velocity clamp
};

/**
 * createSystem({ atlas, maxParticles, viewport })
 *
 *   .setImage(gridData)        replace particles in place from sampleImage()
 *   .setAtlas(atlas)           swap the glyph texture (ramp change)
 *   .setColorMode(mode, accent) 0|1|2 + THREE.Color
 *   .resize(viewport)          recompute world scaling
 *   .update(dt, mouse)         CPU physics tick; writes aOffset
 *   .burst(x, y)               radial impulse at normalized (x,y)
 *   .mesh                      the InstancedMesh-equivalent to add to scene
 */
export function createSystem({ atlas, maxParticles = 30000, viewport }) {
  // --- base quad: a single unit plane, instanced ---
  const baseGeom = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = baseGeom.index;
  geometry.attributes.position = baseGeom.attributes.position;
  geometry.attributes.uv = baseGeom.attributes.uv;

  // --- per-instance flat typed arrays (allocate once at MAX) ---
  const homes = new Float32Array(maxParticles * 2);
  const offsets = new Float32Array(maxParticles * 2);
  const velocities = new Float32Array(maxParticles * 2);
  const colors = new Float32Array(maxParticles * 3);
  const glyphs = new Float32Array(maxParticles);

  const aHome = new THREE.InstancedBufferAttribute(homes, 2);
  const aOffset = new THREE.InstancedBufferAttribute(offsets, 2);
  aOffset.setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(colors, 3);
  const aGlyph = new THREE.InstancedBufferAttribute(glyphs, 1);

  geometry.setAttribute('aHome', aHome);
  geometry.setAttribute('aOffset', aOffset);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aGlyph', aGlyph);

  // --- material ---
  const uniforms = {
    uAtlas:     { value: atlas.texture },
    uCols:      { value: atlas.cols },
    uRows:      { value: atlas.rows },
    uQuadSize:  { value: 6.0 },
    uScale:     { value: 1.0 },
    uColorMode: { value: 0.0 },
    uAccent:    { value: new THREE.Color('#7CFFB2') },
    uIntensity: { value: 1.05 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  geometry.instanceCount = 0;

  let count = 0;
  let aspect = 1;
  let gridW = 1;
  let gridH = 1;
  let viewW = viewport.width;
  let viewH = viewport.height;

  function applyScale() {
    // longer axis of normalized space (±1) → fit into viewport keeping aspect
    const fitW = Math.min(viewW, viewH * aspect);
    const fitH = fitW / aspect;
    const halfW = aspect >= 1 ? 1 : aspect;
    uniforms.uScale.value = (fitW / 2) / halfW;
    // one cell in pixels, with a small overlap factor so glyphs touch
    const cellPx = fitW / Math.max(1, gridW);
    uniforms.uQuadSize.value = cellPx * 1.05;
  }

  function setImage(gridData) {
    const n = Math.min(gridData.count, maxParticles);
    count = n;
    aspect = gridData.aspect;
    gridW = gridData.gridW;
    gridH = gridData.gridH;

    homes.set(gridData.homes.subarray(0, n * 2));
    colors.set(gridData.colors.subarray(0, n * 3));
    glyphs.set(gridData.glyphs.subarray(0, n));

    // scatter initial offsets so particles fly in
    const { scatterMin, scatterMax } = PHYSICS;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = scatterMin + Math.random() * (scatterMax - scatterMin);
      offsets[i * 2] = Math.cos(a) * r;
      offsets[i * 2 + 1] = Math.sin(a) * r;
      velocities[i * 2] = 0;
      velocities[i * 2 + 1] = 0;
    }

    geometry.instanceCount = n;
    aHome.needsUpdate = true;
    aColor.needsUpdate = true;
    aGlyph.needsUpdate = true;
    aOffset.needsUpdate = true;

    applyScale();
  }

  function setAtlas(newAtlas) {
    uniforms.uAtlas.value = newAtlas.texture;
    uniforms.uCols.value = newAtlas.cols;
    uniforms.uRows.value = newAtlas.rows;
  }

  function setColorMode(mode, accentColor) {
    uniforms.uColorMode.value = mode;
    if (accentColor) uniforms.uAccent.value.set(accentColor);
  }

  function setIntensity(v) {
    uniforms.uIntensity.value = v;
  }

  function resize(v) {
    viewW = v.width;
    viewH = v.height;
    applyScale();
  }

  function burst(bx, by, strength = PHYSICS.burstStrength) {
    const r = PHYSICS.burstRadius;
    const r2 = r * r;
    for (let i = 0; i < count; i++) {
      const ix = i * 2, iy = ix + 1;
      const px = homes[ix] + offsets[ix];
      const py = homes[iy] + offsets[iy];
      const dx = px - bx;
      const dy = py - by;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const d = Math.sqrt(d2) || 0.0001;
        const f = strength * (1 - d / r);
        velocities[ix] += (dx / d) * f;
        velocities[iy] += (dy / d) * f;
      }
    }
  }

  function update(dt, mouse) {
    if (count === 0) return;
    const { stiffness, damping, repelRadius, repelStrength, maxSpeed } = PHYSICS;
    const repelR2 = repelRadius * repelRadius;
    const mActive = mouse && mouse.active;
    const mx = mActive ? mouse.x : 0;
    const my = mActive ? mouse.y : 0;
    const dtClamped = Math.min(dt, 1 / 30); // avoid huge steps after tab-hide
    const maxSpeed2 = maxSpeed * maxSpeed;

    for (let i = 0; i < count; i++) {
      const ix = i * 2;
      const iy = ix + 1;

      const ox = offsets[ix];
      const oy = offsets[iy];
      let vx = velocities[ix];
      let vy = velocities[iy];

      // spring toward home (offset → 0)
      let fx = -stiffness * ox;
      let fy = -stiffness * oy;

      // damping (force = -k * v)
      fx -= damping * vx;
      fy -= damping * vy;

      // mouse repel — distance from current world pos to cursor pos
      if (mActive) {
        const px = homes[ix] + ox;
        const py = homes[iy] + oy;
        const dx = px - mx;
        const dy = py - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < repelR2 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const falloff = 1 - d / repelRadius;
          const f = repelStrength * falloff * falloff;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
      }

      // integrate
      vx += fx * dtClamped;
      vy += fy * dtClamped;

      // clamp velocity
      const v2 = vx * vx + vy * vy;
      if (v2 > maxSpeed2) {
        const s = maxSpeed / Math.sqrt(v2);
        vx *= s;
        vy *= s;
      }

      offsets[ix] = ox + vx * dtClamped;
      offsets[iy] = oy + vy * dtClamped;
      velocities[ix] = vx;
      velocities[iy] = vy;
    }

    aOffset.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  function getNormalizedMouse(px, py) {
    // px/py: pixel coords with origin at viewport center, y up
    const s = uniforms.uScale.value || 1;
    return { x: px / s, y: py / s };
  }

  return {
    mesh,
    setImage,
    setAtlas,
    setColorMode,
    setIntensity,
    resize,
    update,
    burst,
    dispose,
    getNormalizedMouse,
    get count() { return count; },
  };
}
