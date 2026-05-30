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

// Monospace character cells are ~0.6 wide × 1 tall in CSS units. The
// visual canvas uses square per-glyph quads, but the raw text view stacks
// rectangular character cells, so the same gridW × gridH would render as
// a horizontally-squished block. Compensate by sampling the raw text with
// a wider grid: rawW = gridW / MONO_CELL_RATIO.
const MONO_CELL_RATIO = 0.6;

// --- state ---
let currentImage = null;     // last decoded HTMLImageElement/Canvas
let currentRamp = DEFAULT_RAMP;
let currentDensity = 20000;
let currentBrightness = 1.0;
let currentColorMode = COLOR_MODES.original;
let currentAccent = '#7CFFB2';
let atlas = null;
let rawMode = false;
let currentRawText = '';
let currentRawGridW = 1;
let currentRawGridH = 1;

// --- morph cycle (photo ↔ ASCII per-particle reveal loop) ---
let morphCycle = false;
let morphClock = 0; // seconds since morph cycle started
const MORPH = {
  hold: 1.0,         // time held at each end (photo only / ascii only)
  transition: 2.4,   // morph duration each direction (per-particle staggers internally)
};

// --- DOM lookups (need these in scope before createControls fires
// initial-state callbacks like onRaw / onCycle that touch them) ---
const canvas = document.getElementById('stage');
const rawView = document.getElementById('raw-view');
const rawPre = document.getElementById('raw-ascii');
const rawCopyBtn = document.getElementById('raw-copy');
const dropHint = document.getElementById('drop-hint');
const fileInput = document.getElementById('file-input');

// --- three.js setup ---
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

function rebuildAtlas() {
  const old = atlas;
  atlas = buildAtlas(currentRamp, { cellSize: 18, dpr: 2 });
  system.setAtlas(atlas);
  if (old?.texture) old.texture.dispose();
}

if (document.fonts && typeof document.fonts.load === 'function') {
  document.fonts.load('800 32px "Switzer"').then(() => rebuildAtlas()).catch(() => {});
}

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
      // start cycle on the photo side — both photo and particles share uMorph
      background.setMorph(0);
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
    background.setAccent(hex);
    if (currentColorMode === COLOR_MODES.accent) {
      system.setColorMode(currentColorMode, hex);
    }
  },
  onRamp: (ramp) => {
    currentRamp = ramp;
    rebuildAtlas();
    resampleCurrent();
  },
  onRaw: (on) => setRawMode(on),
  initialRaw: rawMode,
  onUpload: loadFile,
});

// --- file loading ---
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

  // Raw text uses a separate, horizontally-wider sample so the resulting
  // text block — laid out in rectangular monospace cells — keeps the
  // photo's true aspect ratio (both on screen here and when pasted).
  const rawGrid = gridForRawText(currentDensity, aspect);
  const rawData = sampleImage(currentImage, {
    gridW: rawGrid.gridW,
    gridH: rawGrid.gridH,
    ramp: currentRamp,
    brightness: currentBrightness,
  });
  currentRawText = buildRawText(rawData, currentRamp);
  currentRawGridW = rawGrid.gridW;
  currentRawGridH = rawGrid.gridH;
  if (rawMode) renderRawText();
}

function gridForRawText(target, aspect) {
  // Solve for w,h such that w*h ≈ target AND (w * MONO_CELL_RATIO)/h == aspect.
  // → h = sqrt(target * MONO_CELL_RATIO / aspect); w = aspect * h / MONO_CELL_RATIO.
  const h = Math.max(1, Math.round(Math.sqrt((target * MONO_CELL_RATIO) / aspect)));
  const w = Math.max(1, Math.round((aspect * h) / MONO_CELL_RATIO));
  return { gridW: w, gridH: h };
}

// --- raw ASCII text mode (selectable, copy-pastable) ---
function buildRawText(gridData, ramp) {
  const { gridW, gridH, glyphs } = gridData;
  const rows = new Array(gridH);
  for (let y = 0; y < gridH; y++) {
    const line = new Array(gridW);
    const rowBase = y * gridW;
    for (let x = 0; x < gridW; x++) {
      const gi = glyphs[rowBase + x] | 0;
      line[x] = ramp[gi] || ' ';
    }
    rows[y] = line.join('');
  }
  return rows.join('\n');
}

function fitRawSize(gridW, gridH) {
  // Departure Mono cell ≈ MONO_CELL_RATIO em wide × 1em tall (line-height: 1).
  // Fit the whole grid in the viewport with a small margin.
  const padding = 48; // matches .raw-view padding (24 each side)
  const w = window.innerWidth - padding;
  const h = window.innerHeight - padding;
  const byW = w / (gridW * MONO_CELL_RATIO);
  const byH = h / gridH;
  return Math.max(4, Math.floor(Math.min(byW, byH) * 0.98));
}

function renderRawText() {
  if (!currentImage || !currentRawText) {
    rawPre.textContent = '';
    return;
  }
  const fs = fitRawSize(currentRawGridW, currentRawGridH);
  rawPre.style.fontSize = `${fs}px`;
  rawPre.style.lineHeight = '1';
  rawPre.textContent = currentRawText;
}

function setRawMode(on) {
  rawMode = on;
  rawView.classList.toggle('is-active', on);
  rawView.setAttribute('aria-hidden', on ? 'false' : 'true');
  canvas.style.visibility = on ? 'hidden' : '';
  if (on) renderRawText();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Lightweight HTML payload — a single <pre> with inline monospace + tight
// line-height. Total size ≈ text size + ~200 bytes overhead, so apps that
// scan the clipboard (Messages, Mail) don't hang on the paste.
//
// For rich-text destinations that respect the inline styles (Slack code,
// Notion, Discord code, GitHub, Bear, terminal pastebins) the figure renders
// with the right proportions. Destinations that override line-height will
// stretch the figure vertically — that's a known limitation of monospace
// ASCII art, not something a heavier HTML payload reliably solves.
function buildClipboardHtml(text) {
  const styles = [
    'font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Courier New", monospace',
    'font-size: 11px',
    'line-height: 1',
    'letter-spacing: 0',
    'white-space: pre',
    'margin: 0',
    'padding: 0',
  ].join('; ');
  return `<pre style="${styles}">${escapeHtml(text)}</pre>`;
}

rawCopyBtn.addEventListener('click', async () => {
  const text = currentRawText || rawPre.textContent || '';
  if (!text) return;

  let copied = false;

  // 1. Try rich-format clipboard so destination keeps mono + line-height: 1
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html':  new Blob([buildClipboardHtml(text)], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      copied = true;
    }
  } catch {}

  // 2. Plain text fallback
  if (!copied) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {}
  }

  // 3. Last resort — select in the DOM so the user can ⌘C
  if (!copied) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(rawPre);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  rawCopyBtn.textContent = 'copied';
  rawCopyBtn.classList.add('is-copied');
  setTimeout(() => {
    rawCopyBtn.textContent = 'copy';
    rawCopyBtn.classList.remove('is-copied');
  }, 1200);
});

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
    if (rawMode) renderRawText();
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
    // photo + particles share the SAME morph progress and SAME phase
    // formula — each photo pixel burns out at the same instant its
    // counterpart glyph crystallizes in, so the two transitions stay
    // pixel-aligned instead of just cross-fading
    system.setMorph(m);
    background.setMorph(m);
  }

  // skip particle physics + render when raw text mode is active — the
  // canvas is hidden anyway and the raw view is pure DOM
  if (!rawMode) {
    system.update(dt, interaction.mouse);
    renderer.render(scene, camera);
  }

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
