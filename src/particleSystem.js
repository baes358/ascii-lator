import * as THREE from 'three';
import vertSrc from './shaders/particle.vert?raw';
import fragSrc from './shaders/particle.frag?raw';

/**
 * Tunable physics constants — exposed for README docs. All distances are in
 * normalized image-space units (image's longer axis spans 2 units).
 */
export const PHYSICS = {
  stiffness: 55,         // spring pull toward home
  damping: 6.5,          // velocity damping
  repelRadius: 0.22,     // mouse push radius (normalized)
  repelStrength: 2.2,    // mouse push force
  rippleSpeed: 1.55,     // pulse-ring expansion (normalized units / sec)
  rippleWidth: 0.10,     // ring band thickness (Gaussian sigma)
  rippleStrength: 2.5,   // outward nudge at the ring crest (small — glyph swap carries the read)
  rippleLifetime: 1.6,   // seconds before a ripple fades & is recycled
  ripplePerClick: 2,     // staggered concentric pulses per click
  rippleStagger: 0.14,   // delay between concentric pulses (sec)
  pulseDecayRate: 3.2,   // per-particle excitation half-life ≈ 0.22s
  flickerRate: 0.18,     // flicker starts per particle per second (only when fully revealed)
  flickerMin: 0.06,      // shortest flicker duration (sec)
  flickerMax: 0.22,      // longest flicker duration (sec)
  scatterMin: 1.6,       // fly-in scatter inner radius
  scatterMax: 3.2,       // fly-in scatter outer radius
  maxSpeed: 12.0,        // velocity clamp
};

export const MAX_RIPPLES = 8;

/**
 * createSystem({ atlas, maxParticles, viewport })
 *
 *   .setImage(gridData)        replace particles in place from sampleImage()
 *   .setAtlas(atlas)           swap the glyph texture (ramp change)
 *   .setColorMode(mode, accent) 0|1|2 + THREE.Color
 *   .resize(viewport)          recompute world scaling
 *   .update(dt, mouse)         CPU physics tick; writes aOffset
 *   .pulse(x, y)               emit a ring ripple at normalized (x,y)
 *   .getActiveRipples(out)     fills `out` (Vector4[]) with (cx, cy, radius, intensity)
 *   .getScale()                normalized → world-pixel scalar (for overlays)
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
  const glyphs = new Float32Array(maxParticles);        // current glyph (live)
  const glyphsBase = new Float32Array(maxParticles);    // glyph from image sample
  const pulses = new Float32Array(maxParticles);        // 0..1 excitation per particle
  const phases = new Float32Array(maxParticles);        // per-particle morph reveal phase
  const flickerTTL = new Float32Array(maxParticles);    // seconds remaining in current flicker (0 = idle)
  const flickerGlyph = new Float32Array(maxParticles);  // glyph to display during flicker

  const aHome = new THREE.InstancedBufferAttribute(homes, 2);
  const aOffset = new THREE.InstancedBufferAttribute(offsets, 2);
  aOffset.setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(colors, 3);
  const aGlyph = new THREE.InstancedBufferAttribute(glyphs, 1);
  aGlyph.setUsage(THREE.DynamicDrawUsage);
  const aPulse = new THREE.InstancedBufferAttribute(pulses, 1);
  aPulse.setUsage(THREE.DynamicDrawUsage);
  const aPhase = new THREE.InstancedBufferAttribute(phases, 1);

  geometry.setAttribute('aHome', aHome);
  geometry.setAttribute('aOffset', aOffset);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aGlyph', aGlyph);
  geometry.setAttribute('aPulse', aPulse);
  geometry.setAttribute('aPhase', aPhase);

  // --- material ---
  const uniforms = {
    uAtlas:     { value: atlas.texture },
    uCols:      { value: atlas.cols },
    uRows:      { value: atlas.rows },
    uQuadSize:  { value: 6.0 },
    uScale:     { value: 1.0 },
    uColorMode:   { value: 0.0 },
    uAccent:      { value: new THREE.Color('#7CFFB2') },
    uIntensity:   { value: 1.05 },
    uMorph:       { value: 1.0 },   // 0 = nothing revealed, 1 = full ASCII
    uRevealBand:  { value: 0.4 },   // per-particle smoothstep width
    uInvertRamp:  { value: 0.0 },   // 1 in mono-dark (bright photo → sparse glyph)
    uGlyphMax:    { value: atlas.glyphCount - 1 },
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
  let atlasGlyphCount = atlas.glyphCount;
  let pulseDirty = false; // true while any aPulse/aGlyph is non-default

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

  function setImage(gridData, { keepMotion = false } = {}) {
    const n = Math.min(gridData.count, maxParticles);
    const prevCount = count;
    count = n;
    aspect = gridData.aspect;
    gridW = gridData.gridW;
    gridH = gridData.gridH;

    homes.set(gridData.homes.subarray(0, n * 2));
    colors.set(gridData.colors.subarray(0, n * 3));
    glyphs.set(gridData.glyphs.subarray(0, n));
    glyphsBase.set(gridData.glyphs.subarray(0, n));

    // morph reveal phase per particle: bright pixels crystallize into
    // ASCII first, dark ones last, with random jitter for organic feel
    const src = gridData.colors;
    for (let i = 0; i < n; i++) {
      const r = src[i * 3];
      const g = src[i * 3 + 1];
      const b = src[i * 3 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      phases[i] = (1 - lum) * 0.4 + Math.random() * 0.2;
    }
    aPhase.needsUpdate = true;

    // re-scatter for fly-in unless the caller asks us to preserve motion
    // (e.g. brightness slider — only glyph indices changed)
    if (!keepMotion || n !== prevCount) {
      const { scatterMin, scatterMax } = PHYSICS;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = scatterMin + Math.random() * (scatterMax - scatterMin);
        offsets[i * 2] = Math.cos(a) * r;
        offsets[i * 2 + 1] = Math.sin(a) * r;
        velocities[i * 2] = 0;
        velocities[i * 2 + 1] = 0;
        pulses[i] = 0;
        flickerTTL[i] = 0;
      }
      aOffset.needsUpdate = true;
      aPulse.needsUpdate = true;
    }

    geometry.instanceCount = n;
    aHome.needsUpdate = true;
    aColor.needsUpdate = true;
    aGlyph.needsUpdate = true;

    applyScale();
  }

  function setAtlas(newAtlas) {
    uniforms.uAtlas.value = newAtlas.texture;
    uniforms.uCols.value = newAtlas.cols;
    uniforms.uRows.value = newAtlas.rows;
    uniforms.uGlyphMax.value = newAtlas.glyphCount - 1;
    atlasGlyphCount = newAtlas.glyphCount;
  }

  // 0 original · 1 mono-light · 2 mono-dark · 3 accent
  // mono-dark swaps to MultiplyBlending so glyphs ink the white framebuffer
  // toward black, and inverts the ramp so bright photo pixels map to sparse
  // glyphs (= less ink = stays white). Other modes keep AdditiveBlending.
  const MODE_MONO_DARK = 2;
  function setColorMode(mode, accentColor) {
    uniforms.uColorMode.value = mode;
    if (accentColor) uniforms.uAccent.value.set(accentColor);
    const isDark = mode === MODE_MONO_DARK;
    uniforms.uInvertRamp.value = isDark ? 1.0 : 0.0;
    const nextBlending = isDark ? THREE.MultiplyBlending : THREE.AdditiveBlending;
    if (material.blending !== nextBlending) {
      material.blending = nextBlending;
      material.needsUpdate = true;
    }
  }

  function setIntensity(v) {
    uniforms.uIntensity.value = v;
  }

  function setMorph(v) {
    uniforms.uMorph.value = v;
  }

  function resize(v) {
    viewW = v.width;
    viewH = v.height;
    applyScale();
  }

  // --- ripple pool (pre-allocated, no per-frame alloc) ---
  const ripples = new Array(MAX_RIPPLES);
  for (let i = 0; i < MAX_RIPPLES; i++) {
    ripples[i] = { active: false, cx: 0, cy: 0, age: 0 };
  }
  // flat scratch buffer: per active ripple → cx, cy, radius, intensity
  const rippleScratch = new Float32Array(MAX_RIPPLES * 4);
  let activeRippleCount = 0;

  function emitOne(cx, cy, age) {
    let slot = null;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (!ripples[i].active) { slot = ripples[i]; break; }
    }
    if (!slot) {
      // recycle the ripple closest to death (largest age)
      slot = ripples[0];
      for (let i = 1; i < MAX_RIPPLES; i++) {
        if (ripples[i].age > slot.age) slot = ripples[i];
      }
    }
    slot.active = true;
    slot.cx = cx;
    slot.cy = cy;
    slot.age = age; // negative age = waiting (staggered concentric pulses)
  }

  function pulse(cx, cy) {
    const n = PHYSICS.ripplePerClick;
    const stagger = PHYSICS.rippleStagger;
    for (let i = 0; i < n; i++) emitOne(cx, cy, -i * stagger);
  }

  function update(dt, mouse) {
    if (count === 0) return;
    const {
      stiffness, damping, repelRadius, repelStrength, maxSpeed,
      rippleSpeed, rippleWidth, rippleStrength, rippleLifetime,
      pulseDecayRate,
      flickerRate, flickerMin, flickerMax,
    } = PHYSICS;
    const repelR2 = repelRadius * repelRadius;
    const mActive = mouse && mouse.active;
    const mx = mActive ? mouse.x : 0;
    const my = mActive ? mouse.y : 0;
    const dtClamped = Math.min(dt, 1 / 30); // avoid huge steps after tab-hide
    const maxSpeed2 = maxSpeed * maxSpeed;
    const invRippleWidth = 1 / rippleWidth;
    const pulseDecay = Math.exp(-pulseDecayRate * dtClamped);
    const glyphMax = atlasGlyphCount - 1;
    const glyphCount = atlasGlyphCount;
    let frameMaxPulse = 0;
    let anyFlicker = false;

    // flicker only fires when the ASCII field is essentially fully revealed —
    // mid-morph particles aren't supposed to be alive yet
    const flickerChance = (uniforms.uMorph.value >= 0.99)
      ? flickerRate * dtClamped
      : 0;
    const flickerSpan = flickerMax - flickerMin;

    // advance ripples & snapshot active ones into the flat scratch buffer
    activeRippleCount = 0;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = ripples[i];
      if (!r.active) continue;
      r.age += dtClamped;
      if (r.age < 0) continue;                              // still delayed
      if (r.age >= rippleLifetime) { r.active = false; continue; }
      const off = activeRippleCount * 4;
      rippleScratch[off]     = r.cx;
      rippleScratch[off + 1] = r.cy;
      rippleScratch[off + 2] = r.age * rippleSpeed;         // radius
      const t = r.age / rippleLifetime;                     // 0..1
      rippleScratch[off + 3] = (1 - t) * (1 - t);           // intensity (ease-out)
      activeRippleCount++;
    }

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

      const px = homes[ix] + ox;
      const py = homes[iy] + oy;

      // mouse repel — distance from current world pos to cursor pos
      if (mActive) {
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

      // ripple pulses — Gaussian band centered on the expanding ring crest.
      // Particles in the band (a) get a small outward nudge so the ring has
      // motion, and (b) accumulate excitation so they brighten & swap to
      // denser glyphs — making the pulse itself visible *as ASCII*.
      let particlePulse = pulses[i] * pulseDecay;
      for (let k = 0; k < activeRippleCount; k++) {
        const ko = k * 4;
        const dx = px - rippleScratch[ko];
        const dy = py - rippleScratch[ko + 1];
        const radius = rippleScratch[ko + 2];
        const intensity = rippleScratch[ko + 3];
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const offN = (d - radius) * invRippleWidth;
        if (offN > 3 || offN < -3) continue;                // outside Gaussian tail
        const band = Math.exp(-offN * offN);
        const exc = band * intensity;
        if (exc > particlePulse) particlePulse = exc;
        const f = rippleStrength * band * intensity;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      pulses[i] = particlePulse;
      if (particlePulse > frameMaxPulse) frameMaxPulse = particlePulse;

      // --- flicker: brief swap to a random glyph; gives the static field
      // a live-terminal feel. Only ~flickerRate per particle per second
      // when the ASCII is fully revealed. ---
      let ttl = flickerTTL[i];
      let flickering = ttl > 0;
      if (flickering) {
        ttl -= dtClamped;
        if (ttl <= 0) { ttl = 0; flickering = false; }
        flickerTTL[i] = ttl;
      }
      if (!flickering && flickerChance > 0 && Math.random() < flickerChance) {
        flickerTTL[i] = flickerMin + Math.random() * flickerSpan;
        flickerGlyph[i] = Math.floor(Math.random() * glyphCount);
        flickering = true;
      }
      if (flickering) anyFlicker = true;

      // glyph = flicker override > pulse-driven dense swap > base
      if (flickering) {
        glyphs[i] = flickerGlyph[i];
      } else {
        const base = glyphsBase[i];
        const headroom = glyphMax - base;
        glyphs[i] = base + Math.round(particlePulse * headroom);
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

    // upload glyph/pulse changes while the field is excited OR flickering
    // (and one extra frame after activity dies to flush the resting state)
    const nowActive = frameMaxPulse > 0.005 || anyFlicker;
    if (nowActive || pulseDirty) {
      aGlyph.needsUpdate = true;
      aPulse.needsUpdate = true;
    }
    pulseDirty = nowActive;
  }

  /** Fill a pre-allocated array of THREE.Vector4 with active ripple state.
   *  Inactive slots are zeroed (w=0). Used by the ring overlay shader. */
  function getActiveRipples(out) {
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const v = out[i];
      if (i < activeRippleCount) {
        const off = i * 4;
        v.set(
          rippleScratch[off],
          rippleScratch[off + 1],
          rippleScratch[off + 2],
          rippleScratch[off + 3],
        );
      } else {
        v.set(0, 0, 0, 0);
      }
    }
  }

  function getScale() {
    return uniforms.uScale.value;
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
    setMorph,
    resize,
    update,
    pulse,
    getActiveRipples,
    getScale,
    dispose,
    getNormalizedMouse,
    get count() { return count; },
  };
}
