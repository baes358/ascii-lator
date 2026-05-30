/**
 * Wires the right-side panel inputs to callbacks. Stateless — main.js
 * owns the source of truth and just reacts to the callbacks below.
 *
 * createControls({
 *   initialDensity, initialColorMode, initialRamp, initialAccent,
 *   onDensity(int), onColorMode(0|1|2), onAccent('#hex'),
 *   onRamp(str), onUpload(File),
 * })
 *   → { setCount, setFps, getRamp, getDensity }
 */
export function createControls(opts) {
  const density = document.getElementById('ctl-density');
  const densityVal = document.getElementById('ctl-density-val');
  const brightness = document.getElementById('ctl-brightness');
  const brightnessVal = document.getElementById('ctl-brightness-val');
  const colorSel = document.getElementById('ctl-color');
  const accent = document.getElementById('ctl-accent');
  const accentWrap = document.getElementById('ctl-accent-wrap');
  const rampSel = document.getElementById('ctl-ramp');
  const uploadBtn = document.getElementById('ctl-upload');
  const cycleBtn = document.getElementById('ctl-cycle');
  const fileInput = document.getElementById('file-input');
  const countOut = document.getElementById('ctl-count');
  const fpsOut = document.getElementById('ctl-fps');
  const toggle = document.getElementById('panel-toggle');
  const panel = document.getElementById('panel');

  // initial values
  density.value = opts.initialDensity;
  densityVal.textContent = formatDensity(+density.value);
  brightness.value = opts.initialBrightness;
  brightnessVal.textContent = formatBrightness(+brightness.value);
  colorSel.value = colorModeName(opts.initialColorMode);
  accent.value = opts.initialAccent;
  setAccentVisible(opts.initialColorMode === 3);
  // initial ramp may or may not match an option; if not, leave default
  for (const o of rampSel.options) {
    if (o.value === opts.initialRamp) { rampSel.value = opts.initialRamp; break; }
  }

  // debounce density slider since it triggers a re-sample
  let densityTimer = 0;
  density.addEventListener('input', () => {
    densityVal.textContent = formatDensity(+density.value);
    clearTimeout(densityTimer);
    densityTimer = setTimeout(() => opts.onDensity(+density.value), 90);
  });

  // brightness re-samples glyph indices in place (no scatter)
  let brightnessTimer = 0;
  brightness.addEventListener('input', () => {
    brightnessVal.textContent = formatBrightness(+brightness.value);
    clearTimeout(brightnessTimer);
    brightnessTimer = setTimeout(() => opts.onBrightness(+brightness.value), 40);
  });

  colorSel.addEventListener('change', () => {
    const mode = colorModeIndex(colorSel.value);
    setAccentVisible(mode === 3);
    opts.onColorMode(mode);
  });

  accent.addEventListener('input', () => {
    opts.onAccent(accent.value);
  });

  rampSel.addEventListener('change', () => {
    opts.onRamp(rampSel.value);
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) opts.onUpload(f);
    fileInput.value = '';
  });

  let cycleOn = !!opts.initialCycle;
  setCycle(cycleOn);
  cycleBtn.addEventListener('click', () => setCycle(!cycleOn));
  function setCycle(v) {
    cycleOn = v;
    cycleBtn.textContent = v ? 'on' : 'off';
    cycleBtn.setAttribute('aria-pressed', v ? 'true' : 'false');
    opts.onCycle(v);
  }

  const rawBtn = document.getElementById('ctl-raw');
  let rawOn = !!opts.initialRaw;
  setRaw(rawOn);
  rawBtn.addEventListener('click', () => setRaw(!rawOn));
  function setRaw(v) {
    rawOn = v;
    rawBtn.textContent = v ? 'on' : 'off';
    rawBtn.setAttribute('aria-pressed', v ? 'true' : 'false');
    opts.onRaw(v);
  }

  toggle.addEventListener('click', () => {
    panel.classList.toggle('is-collapsed');
    toggle.textContent = panel.classList.contains('is-collapsed') ? '+' : '_';
  });

  setupPanelDrag(panel);

  function setAccentVisible(on) {
    accentWrap.classList.toggle('is-hidden', !on);
  }

  function formatDensity(n) {
    return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
  }
  function formatBrightness(n) {
    return n.toFixed(2);
  }

  return {
    setCount(n) { countOut.textContent = formatDensity(n); },
    setFps(n) { fpsOut.textContent = `${Math.round(n)}`; },
    getRamp() { return rampSel.value; },
    getDensity() { return +density.value; },
    getColorMode() { return colorModeIndex(colorSel.value); },
    getAccent() { return accent.value; },
  };
}

// --- draggable panel ---
// Pointer Events unify mouse + touch + pen. `touch-action: none` on the
// header (in CSS) stops mobile browsers from interpreting the drag as a
// scroll or pull-to-refresh.
const PANEL_POS_KEY = 'ascii-lator:panel-pos';
const PANEL_MARGIN = 6;

function setupPanelDrag(panel) {
  const head = panel.querySelector('.panel__head');
  let pid = null;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let moved = false;

  function clampInViewport(left, top) {
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const m = PANEL_MARGIN;
    return {
      left: Math.max(m, Math.min(window.innerWidth - w - m, left)),
      top: Math.max(m, Math.min(window.innerHeight - h - m, top)),
    };
  }

  function applyPosition(left, top) {
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
  }

  function onDown(e) {
    // let the collapse toggle handle its own click cleanly
    if (e.target.closest('.panel__toggle')) return;
    pid = e.pointerId;
    try { head.setPointerCapture(pid); } catch {}
    const r = panel.getBoundingClientRect();
    startLeft = r.left;
    startTop = r.top;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    // pin to left/top so subsequent moves have a single positioning origin
    applyPosition(startLeft, startTop);
    panel.classList.add('is-dragging');
  }

  function onMove(e) {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (dx * dx + dy * dy) > 4) moved = true;
    const { left, top } = clampInViewport(startLeft + dx, startTop + dy);
    applyPosition(left, top);
  }

  function onUp(e) {
    if (e.pointerId !== pid) return;
    try { head.releasePointerCapture(pid); } catch {}
    pid = null;
    panel.classList.remove('is-dragging');
    if (moved) {
      try {
        localStorage.setItem(PANEL_POS_KEY, JSON.stringify({
          left: parseFloat(panel.style.left),
          top: parseFloat(panel.style.top),
        }));
      } catch {}
    }
  }

  head.addEventListener('pointerdown', onDown);
  head.addEventListener('pointermove', onMove);
  head.addEventListener('pointerup', onUp);
  head.addEventListener('pointercancel', onUp);

  // restore last saved position
  try {
    const saved = localStorage.getItem(PANEL_POS_KEY);
    if (saved) {
      const { left, top } = JSON.parse(saved);
      const clamped = clampInViewport(left, top);
      applyPosition(clamped.left, clamped.top);
    }
  } catch {}

  // keep panel inside the viewport on resize / orientation change
  window.addEventListener('resize', () => {
    if (!panel.style.left) return;
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    const clamped = clampInViewport(left, top);
    if (clamped.left !== left || clamped.top !== top) {
      applyPosition(clamped.left, clamped.top);
    }
  });
}

function colorModeIndex(name) {
  if (name === 'mono-light' || name === 'mono') return 1;
  if (name === 'mono-dark') return 2;
  if (name === 'accent') return 3;
  return 0;
}

function colorModeName(idx) {
  if (idx === 1) return 'mono-light';
  if (idx === 2) return 'mono-dark';
  if (idx === 3) return 'accent';
  return 'original';
}
