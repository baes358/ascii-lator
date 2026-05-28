/**
 * Translates pointer events on the canvas into the particle system's
 * normalized image-space coordinates, and emits click bursts. The
 * physics loop reads `mouse` directly each frame — no allocations.
 */
export function createInteraction(canvas, system) {
  const mouse = { x: 0, y: 0, active: false };

  function toNormalized(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // pixel coords with origin at viewport center, y up
    const px = clientX - rect.left - rect.width / 2;
    const py = -(clientY - rect.top - rect.height / 2);
    return system.getNormalizedMouse(px, py);
  }

  function onMove(e) {
    const m = toNormalized(e.clientX, e.clientY);
    mouse.x = m.x;
    mouse.y = m.y;
    mouse.active = true;
  }

  function onLeave() {
    mouse.active = false;
  }

  function onDown(e) {
    // ignore right-clicks etc
    if (e.button !== undefined && e.button !== 0) return;
    const m = toNormalized(e.clientX, e.clientY);
    system.pulse(m.x, m.y);
  }

  function onTouch(e) {
    if (e.touches && e.touches.length) {
      const t = e.touches[0];
      const m = toNormalized(t.clientX, t.clientY);
      mouse.x = m.x;
      mouse.y = m.y;
      mouse.active = true;
    } else {
      mouse.active = false;
    }
  }

  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  // touch fallback for environments where pointer events don't quite cover
  canvas.addEventListener('touchstart', onTouch, { passive: true });
  canvas.addEventListener('touchmove', onTouch, { passive: true });
  canvas.addEventListener('touchend', onTouch, { passive: true });

  return { mouse };
}
