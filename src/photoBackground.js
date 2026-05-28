import * as THREE from 'three';

/**
 * Background plane that displays the original photo behind the ASCII
 * particles. During the morph cycle each pixel reveals/un-reveals based
 * on its own luminance — bright pixels of the photo burn out FIRST,
 * matching the order in which the corresponding ASCII glyphs crystallize
 * in. The two transitions stay locked in step (same phase formula, same
 * reveal band) so the photo doesn't just fade — it dissolves into the
 * ASCII field, pixel for pixel.
 *
 *   .mesh                        add to scene (renderOrder = -1)
 *   .setImage(htmlImageOrCanvas) swap the source
 *   .resize(viewW, viewH)        re-fit to viewport
 *   .setOpacity(0..1)            master kill (0 = hide; 1 = let pixel reveal drive alpha)
 *   .setMorph(0..1)              cycle progress (drives the per-pixel reveal)
 *   .dispose()
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform float uMorph;       // 0 = photo, 1 = ASCII (matches particle uMorph)
  uniform float uRevealBand;  // smoothstep width per pixel (matches particles)
  uniform float uOpacity;     // master multiplier; 0 when cycle is off
  uniform vec3  uFlareTint;   // colour of the burn-out flare (= accent)

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec4 src = texture2D(uMap, vUv);
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Same phase formula as the particle aPhase computed in setImage:
    //   phase = (1 - lum) * 0.4 + random * 0.2
    // — bright pixels reveal early (low threshold), dark pixels late.
    // Per-pixel hash replaces the random() jitter for visual variance.
    float threshold = (1.0 - lum) * 0.4 + hash(vUv * 1731.0) * 0.2;
    float reveal = smoothstep(threshold, threshold + uRevealBand, uMorph);

    // brief brightness flare at the moment of transition — peaks at
    // reveal = 0.5, fades to 0 at both ends; tinted toward the accent
    // colour so the burn-out matches the ASCII spawn glow
    float flare = reveal * (1.0 - reveal) * 4.0;
    vec3  col = src.rgb + uFlareTint * flare * 0.9 + vec3(flare * 0.35);

    // pixel alpha decays as the pixel is "consumed" by the ASCII reveal
    float alpha = (1.0 - reveal) * uOpacity;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createPhotoBackground() {
  const geom = new THREE.PlaneGeometry(1, 1);

  const uniforms = {
    uMap:        { value: null },
    uMorph:      { value: 0.0 },
    uRevealBand: { value: 0.4 },
    uOpacity:    { value: 0.0 },
    uFlareTint:  { value: new THREE.Color('#7CFFB2') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // before the particle field
  mesh.visible = false;

  let currentTexture = null;
  let aspect = 1;
  let viewW = 1;
  let viewH = 1;

  function fit() {
    const fitW = Math.min(viewW, viewH * aspect);
    const fitH = fitW / aspect;
    mesh.scale.set(fitW, fitH, 1);
  }

  function setImage(image) {
    if (currentTexture) currentTexture.dispose();
    const tex = new THREE.Texture(image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    uniforms.uMap.value = tex;
    currentTexture = tex;
    aspect = (image.width || image.naturalWidth) / (image.height || image.naturalHeight);
    fit();
  }

  function resize(w, h) {
    viewW = w;
    viewH = h;
    fit();
  }

  function setOpacity(o) {
    uniforms.uOpacity.value = o;
    mesh.visible = o > 0.001;
  }

  function setMorph(m) {
    uniforms.uMorph.value = m;
  }

  function setAccent(hex) {
    uniforms.uFlareTint.value.set(hex);
  }

  function dispose() {
    geom.dispose();
    material.dispose();
    if (currentTexture) currentTexture.dispose();
  }

  return { mesh, setImage, resize, setOpacity, setMorph, setAccent, dispose };
}
