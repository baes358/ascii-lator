import * as THREE from 'three';

/**
 * Background plane that displays the original photo behind the ASCII
 * particles. Its opacity is driven by the cycle-mode animation; when
 * cycle mode is off it stays at 0 so only the ASCII field is visible.
 *
 *   createPhotoBackground()
 *     .mesh                       add to scene (renderOrder = -1)
 *     .setImage(htmlImageOrCanvas) swap the source
 *     .resize(viewW, viewH)        re-fit to viewport
 *     .setOpacity(0..1)            drive the cross-fade
 *     .dispose()
 */
export function createPhotoBackground() {
  const geom = new THREE.PlaneGeometry(1, 1);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
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
    material.map = tex;
    material.needsUpdate = true;
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
    material.opacity = o;
    mesh.visible = o > 0.001;
  }

  function dispose() {
    geom.dispose();
    material.dispose();
    if (currentTexture) currentTexture.dispose();
  }

  return { mesh, setImage, resize, setOpacity, dispose };
}
