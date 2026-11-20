/* ==========================================================================
   Replay recorder: a 45-second ring buffer of the car's full visual state
   at 60 Hz (pose, wheel steer / spin / suspension, slip for smoke, lights,
   rpm / throttle for audio). Playback is purely visual.
   ========================================================================== */
const STRIDE = 7 + 2 + 4 + 4 + 4 + 5; // pose, steer x2, spin x4, length x4, slip x4, rpm/thr/brake/hb/boost

export class Recorder {
  constructor(seconds = 45, hz = 60) {
    this.hz = hz;
    this.cap = seconds * hz;
    this.buf = new Float32Array(this.cap * STRIDE);
    this.head = 0; this.count = 0; this.acc = 0;
  }
  clear() { this.head = 0; this.count = 0; }

  push(dt, veh) {
    this.acc += dt;
    if (this.acc < 1 / this.hz) return;
    this.acc = 0;
    const o = this.head * STRIDE, b = this.buf, w = veh.wheels, T = veh.telemetry;
    b[o] = veh.p.x; b[o + 1] = veh.p.y; b[o + 2] = veh.p.z; b[o + 3] = veh.q.x; b[o + 4] = veh.q.y; b[o + 5] = veh.q.z; b[o + 6] = veh.q.w;
    b[o + 7] = w[0].steer; b[o + 8] = w[1].steer;
    for (let i = 0; i < 4; i++) { b[o + 9 + i] = w[i].spin; b[o + 13 + i] = w[i].length; b[o + 17 + i] = w[i].contact ? w[i].slipSpeed : 0; }
    b[o + 21] = T.rpm; b[o + 22] = T.throttle; b[o + 23] = veh.brakeIn; b[o + 24] = veh.handbrakeIn; b[o + 25] = T.boost;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
  }

  get duration() { return this.count / this.hz; }

  /** Write frame at time t (0 = oldest) into a fake-vehicle object for the visuals. */
  apply(t, fake) {
    const idx = Math.min(this.count - 1, Math.max(0, Math.floor(t * this.hz)));
    const start = (this.head - this.count + this.cap) % this.cap;
    const o = ((start + idx) % this.cap) * STRIDE, b = this.buf;
    fake.p.x = b[o]; fake.p.y = b[o + 1]; fake.p.z = b[o + 2];
    fake.q.x = b[o + 3]; fake.q.y = b[o + 4]; fake.q.z = b[o + 5]; fake.q.w = b[o + 6];
    fake.wheels[0].steer = b[o + 7]; fake.wheels[1].steer = b[o + 8];
    fake.wheels[2].steer = 0; fake.wheels[3].steer = 0;
    for (let i = 0; i < 4; i++) { fake.wheels[i].spin = b[o + 9 + i]; fake.wheels[i].length = b[o + 13 + i]; fake.wheels[i].slipSpeed = b[o + 17 + i]; fake.wheels[i].contact = b[o + 17 + i] > 0 || true; }
    fake.telemetry.rpm = b[o + 21]; fake.telemetry.throttle = b[o + 22]; fake.brakeIn = b[o + 23]; fake.handbrakeIn = b[o + 24]; fake.telemetry.boost = b[o + 25];
    return fake;
  }
}
