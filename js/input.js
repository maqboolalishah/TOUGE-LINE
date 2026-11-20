/* ==========================================================================
   Input: remappable keyboard + gamepad (standard mapping).
   Keyboard throttle / brake / clutch ramp in smoothly instead of snapping
   on/off; steering is passed digitally to the vehicle, which applies its
   own speed-sensitive smoothing. Gamepads give true analog control.
   ========================================================================== */
import { settings } from './config.js';

const RATES = { throttleUp: 3.2, throttleDown: 6, brakeUp: 5, brakeDown: 8, clutchUp: 14, clutchDown: 9 };

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();      // edges this frame
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, analogSteer: false, shiftUp: false, shiftDown: false };
    this.edges = { camera: false, reset: false, toggleTrans: false, pause: false };
    this.capture = null;           // remap callback
    this.gamepadIndex = null;
    this.prevPad = [];
    this.enabled = true;
    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); return; }
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code !== 'Escape') return;
      if (this.isBound(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; this.onPad && this.onPad(e.gamepad.id); });
    addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  isBound(code) { for (const k in settings.keys) if (settings.keys[k].includes(code)) return true; return false; }
  held(action) { return settings.keys[action].some((c) => this.down.has(c)); }
  hit(action) { return settings.keys[action].some((c) => this.pressed.has(c)); }

  /** Call once per rendered frame. */
  update(dt) {
    const s = this.state;
    let thrT = this.held('throttle') ? 1 : 0;
    let brkT = this.held('brake') ? 1 : 0;
    let steer = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    let hb = this.held('handbrake') ? 1 : 0;
    let clT = this.held('clutch') ? 1 : 0;
    let up = this.hit('shiftUp'), dn = this.hit('shiftDown');
    const e = this.edges;
    e.camera = this.hit('camera'); e.reset = this.hit('reset'); e.toggleTrans = this.hit('toggleTrans'); e.pause = this.hit('pause');
    s.analogSteer = false;

    // ------------------------------------------------ gamepad (standard layout)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : [...pads].find((p) => p);
    let padThr = null, padBrk = null;
    if (pad && pad.mapping === 'standard') {
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const edge = (i) => b(i) > 0.5 && !(this.prevPad[i] > 0.5);
      const ax = pad.axes[0] || 0;
      const dz = 0.08;
      const sx = Math.abs(ax) < dz ? 0 : Math.sign(ax) * Math.pow((Math.abs(ax) - dz) / (1 - dz), 1.35);
      if (Math.abs(sx) > 0.001 && steer === 0) { steer = -sx; s.analogSteer = true; }
      padThr = b(7); padBrk = b(6);
      if (b(0) > 0.5) hb = 1;               // A: handbrake
      if (b(1) > 0.5) clT = 1;              // B: clutch
      if (edge(5)) up = true;               // RB
      if (edge(4)) dn = true;               // LB
      if (edge(3)) e.camera = true;         // Y
      if (edge(8)) e.reset = true;          // Back / View
      if (edge(2)) e.toggleTrans = true;    // X
      if (edge(9)) e.pause = true;          // Start / Menu
      this.prevPad = pad.buttons.map((x) => x.value);
    }

    // ------------------------------------------------ smoothing
    const ramp = (cur, target, upR, downR) => (target > cur ? Math.min(target, cur + upR * dt) : Math.max(target, cur - downR * dt));
    if (padThr != null && padThr > 0.02 && !thrT) s.throttle = padThr;
    else s.throttle = ramp(s.throttle, thrT, RATES.throttleUp, RATES.throttleDown);
    if (padBrk != null && padBrk > 0.02 && !brkT) s.brake = padBrk;
    else s.brake = ramp(s.brake, brkT, RATES.brakeUp, RATES.brakeDown);
    s.clutch = ramp(s.clutch, clT, RATES.clutchUp, RATES.clutchDown);
    s.handbrake = hb;
    s.steer = steer;
    s.shiftUp = up; s.shiftDown = dn;
    if (!this.enabled) { s.throttle = 0; s.brake = 0; s.steer = 0; s.handbrake = 0; }
    this.pressed.clear();
    return s;
  }

  /** Wait for the next key press (used by the remapping UI). */
  captureNext(cb) { this.capture = cb; }
}
