// Keyboard + mouse + gamepad. Actions are buffered so presses during animations are not lost.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Map();    // action -> time pressed (buffer)
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.canvas = canvas;
    this.locked = false;
    this.anyKey = false;
    this.padPrev = {};
    this.time = 0;
    this.enabled = true;

    const bindings = {
      KeyJ: 'attack', KeyK: 'dodge', Space: 'dodge', KeyR: 'heal', KeyE: 'heal', Tab: 'lock', KeyQ: 'lock',
      ShiftLeft: 'dodge',
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) {
        this.anyKey = true;
        const a = bindings[e.code];
        if (a) this.press(a);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.anyKey = true;
      if (!this.locked && this.wantLock) this.requestLock();
      if (e.button === 0) this.press('attack');
      if (e.button === 2) this.press('dodge');
      if (e.button === 1) { this.press('lock'); e.preventDefault(); }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});   // embedded frames may refuse pointer lock; lock-on camera still works
    } catch (e) { /* ignore */ }
  }

  press(action) { if (this.enabled) this.pressed.set(action, this.time); }

  /** consume an action pressed within `buffer` seconds */
  take(action, buffer = 0.25) {
    const t = this.pressed.get(action);
    if (t !== undefined && this.time - t <= buffer) { this.pressed.delete(action); return true; }
    return false;
  }
  peek(action, buffer = 0.25) {
    const t = this.pressed.get(action);
    return t !== undefined && this.time - t <= buffer;
  }

  update(dt) {
    this.time += dt;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (this.pad) {
      const b = (i) => this.pad.buttons[i] && this.pad.buttons[i].pressed;
      const map = { 0: 'dodge', 2: 'attack', 3: 'heal', 5: 'lock', 7: 'attack', 1: 'dodge' };
      for (const [i, a] of Object.entries(map)) {
        const now = b(+i);
        if (now && !this.padPrev[i]) { this.press(a); this.anyKey = true; }
        this.padPrev[i] = now;
      }
    }
  }

  /** movement vector in input space (x right, y forward), length <= 1 */
  move() {
    let x = 0, y = 0;
    if (!this.enabled) return { x, y };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.pad) {
      const ax = this.pad.axes[0] || 0, ay = this.pad.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.18) { x += ax; y -= ay; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  look() {
    let x = this.mouseDX, y = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    if (this.pad) {
      const ax = this.pad.axes[2] || 0, ay = this.pad.axes[3] || 0;
      if (Math.abs(ax) > 0.15) x += ax * 14;
      if (Math.abs(ay) > 0.15) y += ay * 10;
    }
    return { x, y };
  }

  consumeAnyKey() { const a = this.anyKey; this.anyKey = false; return a; }
}
