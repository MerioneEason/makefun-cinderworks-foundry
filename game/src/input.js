// Cinderworks Foundry: keyboard, mouse and pointer lock. Keeps the pressed
// keys, the look delta since last read, and the firing/aiming state.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    lookX: 0, lookY: 0,
    firing: false, aiming: false, locked: false,
  };
  const pressed = new Set();

  function takeLook() {
    const r = { x: state.lookX, y: state.lookY };
    state.lookX = 0; state.lookY = 0;
    return r;
  }
  function consumePressed(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    state.keys.add(e.code);
    pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    state.keys.delete(e.code);
    pressed.delete(e.code);
  });
  window.addEventListener('blur', () => {
    state.keys.clear(); pressed.clear();
    state.firing = false; state.aiming = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(state.locked);
  });

  return {
    state, takeLook, consumePressed,
    lock() {
      // Pointer lock needs a user gesture and a focused document; headless or
      // background tabs refuse it. Never let that refusal surface as an error.
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* no pointer lock here; the game still runs */ }
    },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
  };
}
