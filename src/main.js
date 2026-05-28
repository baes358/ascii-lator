import * as THREE from 'three';
import { buildAtlas } from './glyphAtlas.js';
import { sampleImage, gridForTarget } from './imageSampler.js';
import { createSystem, PHYSICS } from './particleSystem.js';
import { createPhotoBackground } from './photoBackground.js';
import { createInteraction } from './interaction.js';
import { createControls } from './controls.js';

const DEFAULT_RAMP = ' .:-=+*#%@';
const MAX_PARTICLES = 30000;
const MAX_DPR = 1.5;
const COLOR_MODES = { original: 0, mono: 1, accent: 2 };

// --- state ---
let currentImage = null;     // last decoded HTMLImageElement/Canvas
let currentRamp = DEFAULT_RAMP;
let currentDensity = 20000;
let currentBrightness = 1.0;
let currentColorMode = COLOR_MODES.original;
let currentAccent = '#7CFFB2';
let atlas = null;

// --- morph cycle (photo ↔ ASCII per-particle reveal loop) ---
let morphCycle = false;
let morphClock = 0; // seconds since morph cycle started
const MORPH = {
  hold: 1.0,         // time held at each end (photo only / ascii only)
  transition: 2.4,   // morph duration each direction (per-particle staggers internally)
};

// --- three.js setup ---
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
camera.position.z = 1;

function applyCameraSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.updateProjectionMatrix();
}
applyCameraSize();

// --- atlas + particle system ---
atlas = buildAtlas(currentRamp, { cellSize: 18, dpr: 2 });
const system = createSystem({
  atlas,
  maxParticles: MAX_PARTICLES,
  viewport: { width: window.innerWidth, height: window.innerHeight },
});
system.setColorMode(currentColorMode, currentAccent);
scene.add(system.mesh);

// --- background photo plane (only visible during cycle mode) ---
const background = createPhotoBackground();
background.resize(window.innerWidth, window.innerHeight);
scene.add(background.mesh);

// --- interaction ---
const interaction = createInteraction(canvas, system);

// --- controls ---
const controls = createControls({
  initialDensity: currentDensity,
  initialBrightness: currentBrightness,
  initialColorMode: currentColorMode,
  initialAccent: currentAccent,
  initialRamp: currentRamp,
  initialCycle: morphCycle,
  onCycle: (on) => {
    morphCycle = on;
    morphClock = 0;
    if (!on) {
      background.setOpacity(0);
      system.setMorph(1);
    } else {
      // start the cycle from the photo side
      background.setOpacity(1);
      system.setMorph(0);
    }
  },
  onDensity: (n) => { currentDensity = n; resampleCurrent(); },
  onBrightness: (b) => {
    currentBrightness = b;
    resampleCurrent({ keepMotion: true });
  },
  onColorMode: (mode) => {
    currentColorMode = mode;
    system.setColorMode(mode, currentAccent);
  },
  onAccent: (hex) => {
    currentAccent = hex;
    if (currentColorMode === COLOR_MODES.accent) {
      system.setColorMode(currentColorMode, hex);
    }
  },
  onRamp: (ramp) => {
    currentRamp = ramp;
    // dispose old atlas texture before swapping
    const old = atlas;
    atlas = buildAtlas(ramp, { cellSize: 18, dpr: 2 });
    system.setAtlas(atlas);
    if (old?.texture) old.texture.dispose();
    resampleCurrent();
  },
  onUpload: loadFile,
});

// --- file loading ---
const dropHint = document.getElementById('drop-hint');
const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) loadFile(f);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) => {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    dropHint.classList.add('is-drag');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && e.target !== document.documentElement) return;
    dropHint.classList.remove('is-drag');
  });
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && /^image\//.test(f.type)) loadFile(f);
});

function loadFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    currentImage = img;
    background.setImage(img);
    dropHint.classList.add('is-hidden');
    resampleCurrent();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    console.error('failed to decode image');
  };
  img.src = url;
}

function resampleCurrent({ keepMotion = false } = {}) {
  if (!currentImage) return;
  const aspect = currentImage.width / currentImage.height;
  const { gridW, gridH } = gridForTarget(currentDensity, aspect);
  const data = sampleImage(currentImage, {
    gridW,
    gridH,
    ramp: currentRamp,
    brightness: currentBrightness,
  });
  system.setImage(data, { keepMotion });
  controls.setCount(data.count);
}

// --- initial demo image so visitors see the effect immediately ---
function buildDemoImage() {
  const w = 720, h = 480;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // dark base + soft radial light
  const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.6);
  g.addColorStop(0, '#cfd9e0');
  g.addColorStop(0.6, '#42566a');
  g.addColorStop(1, '#0a0d10');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.45, 0, Math.PI * 2); ctx.fill();

  // title text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 160px ui-monospace, "JetBrains Mono", monospace';
  ctx.fillText('ascii', w / 2, h / 2 - 20);
  ctx.font = '36px ui-monospace, monospace';
  ctx.fillStyle = '#9aa8b4';
  ctx.fillText('drop a photo', w / 2, h / 2 + 80);
  return c;
}
currentImage = buildDemoImage();
background.setImage(currentImage);
resampleCurrent();

// --- resize ---
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    applyCameraSize();
    system.resize({ width: window.innerWidth, height: window.innerHeight });
    background.resize(window.innerWidth, window.innerHeight);
  }, 60);
});

// --- morph envelope: photo (0) → ASCII (1) → photo (0) → ... ---
// segments: [hold-photo, morph-up, hold-ascii, morph-down], smoothstep ease
function morphValue(t) {
  const { hold, transition } = MORPH;
  const period = (hold + transition) * 2;
  const phase = t % period;
  if (phase < hold) return 0;
  if (phase < hold + transition) return ease((phase - hold) / transition);
  if (phase < hold * 2 + transition) return 1;
  return 1 - ease((phase - hold * 2 - transition) / transition);
}
function ease(x) {
  // smoothstep-ish ease in/out
  return x * x * (3 - 2 * x);
}

// --- raf loop with visibility pause ---
let last = performance.now();
let running = true;
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0;

function frame(now) {
  if (!running) return;
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (morphCycle) {
    morphClock += dt;
    const m = morphValue(morphClock);
    system.setMorph(m);
    // photo dims faster than the morph progresses so the late-revealing
    // (dark) particles light up against a near-black background
    background.setOpacity(1 - Math.min(1, m * 1.25));
  }

  system.update(dt, interaction.mouse);
  renderer.render(scene, camera);

  // fps readout (every ~0.5s)
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    controls.setFps(fpsFrames / fpsAcc);
    fpsAcc = 0; fpsFrames = 0;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
  } else if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
});

// expose tunables for debugging
if (import.meta.env?.DEV) {
  window.__ascii = { system, atlas: () => atlas, PHYSICS, renderer };
}
