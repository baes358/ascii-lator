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
  const colorSel = document.getElementById('ctl-color');
  const accent = document.getElementById('ctl-accent');
  const accentWrap = document.getElementById('ctl-accent-wrap');
  const rampSel = document.getElementById('ctl-ramp');
  const uploadBtn = document.getElementById('ctl-upload');
  const fileInput = document.getElementById('file-input');
  const countOut = document.getElementById('ctl-count');
  const fpsOut = document.getElementById('ctl-fps');
  const toggle = document.getElementById('panel-toggle');
  const panel = document.getElementById('panel');

  // initial values
  density.value = opts.initialDensity;
  densityVal.textContent = formatDensity(+density.value);
  colorSel.value = colorModeName(opts.initialColorMode);
  accent.value = opts.initialAccent;
  setAccentVisible(opts.initialColorMode === 2);
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

  colorSel.addEventListener('change', () => {
    const mode = colorModeIndex(colorSel.value);
    setAccentVisible(mode === 2);
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

  toggle.addEventListener('click', () => {
    panel.classList.toggle('is-collapsed');
    toggle.textContent = panel.classList.contains('is-collapsed') ? '+' : '_';
  });

  function setAccentVisible(on) {
    accentWrap.classList.toggle('is-hidden', !on);
  }

  function formatDensity(n) {
    return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
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

function colorModeIndex(name) {
  if (name === 'mono') return 1;
  if (name === 'accent') return 2;
  return 0;
}

function colorModeName(idx) {
  if (idx === 1) return 'mono';
  if (idx === 2) return 'accent';
  return 'original';
}
