/* ==========================================================================
   Vehicle simulation (custom raycast vehicle, fixed 240 Hz sub-steps)

   Rigid body (6 DOF) + 4 suspension rays against the track surface.
   Weight transfer is not faked: it emerges from spring/damper/anti-roll
   forces reacting to the body's pitch and roll, which change each tyre's
   vertical load, which (through Pacejka + load sensitivity) changes grip.

   Each tyre: slip ratio from its own spin speed, slip angle from contact-
   patch velocity (with relaxation length), combined-slip Pacejka forces,
   temperature & wear.  Wheel spin is integrated implicitly using ∂Fx/∂ω
   so it is stable at any speed (no low-speed jitter, no explosions).
   ========================================================================== */
import * as M from './math.js';
import { TireModel } from './pacejka.js';
import { Drivetrain } from './drivetrain.js';

const GRAV = 9.81;
const DEG = Math.PI / 180;
export const WHEEL_IDS = ['fl', 'fr', 'rl', 'rr'];

// scratch vectors (no per-step allocation)
const _a = M.v3(), _b = M.v3(), _c = M.v3(), _d = M.v3(), _e = M.v3(), _n = M.v3(), _f = M.v3(), _s = M.v3();

export class Vehicle {
  /**
   * @param world  { heightAt(x,z), normalAt(x,z,out), surfaceAt(x,z), collide(vehicle,dt) }
   */
  constructor(spec, tuning, world) {
    this.spec = spec;
    this.world = world;
    this.p = M.v3(); this.q = M.quat(); this.v = M.v3(); this.w = M.v3();
    this.R = new Float64Array(9);
    this.mass = spec.mass;
    const L = spec.dims.length * 0.82, H = spec.dims.height * 0.9, W = spec.dims.width * 0.95;
    this.inertia = M.v3((this.mass / 12) * (H * H + L * L), (this.mass / 12) * (W * W + L * L), (this.mass / 12) * (W * W + H * H));
    this.drivetrain = new Drivetrain(spec, tuning);
    this.F = M.v3(); this.T = M.v3();
    this.assists = { counterSteer: false, tc: false, abs: false };
    this.automatic = true;
    this.impacts = [];
    this.steerIn = 0; this.delta = 0; this.reverseTimer = 0;
    this.clutch = 0; this.brakeIn = 0; this.throttleIn = 0; this.handbrakeIn = 0;
    this.telemetry = { speed: 0, kmh: 0, fwdSpeed: 0, driftAngle: 0, rpm: 0, gear: 1, boost: 0, throttle: 0, brake: 0, wheels: [] };
    this.buildWheels();
    this.setTuning(tuning);
  }

  buildWheels() {
    const s = this.spec;
    const b = s.wheelbase * s.frontWeight;  // CG → rear axle
    const a = s.wheelbase - b;              // CG → front axle
    this.a = a; this.b = b;
    this.wheels = WHEEL_IDS.map((id, i) => {
      const front = i < 2, left = i % 2 === 0;
      return {
        id, i, front, left, axle: front ? 'F' : 'R',
        mount: M.v3((left ? 1 : -1) * (front ? s.trackF : s.trackR) / 2, 0, front ? a : -b),
        r: front ? s.wheel.rF : s.wheel.rR,
        width: front ? s.wheel.widthF : s.wheel.widthR,
        I: s.wheel.inertia,
        L0: s.susp.restLength, travel: s.susp.travel,
        comp: 0, prevComp: 0, length: s.susp.restLength, contact: false,
        Fz: 0, omega: 0, spin: 0, steer: 0,
        kappa: 0, alpha: 0, alphaRel: 0, Fx: 0, Fy: 0, dFdw: 0, Ieff: s.wheel.inertia,
        tireTorque: 0, driveTorque: 0, brakeTorque: 0, driveW: 0,
        temp: 60, wear: 0, brakeTemp: 40,
        slipSpeed: 0, slipLat: 0, slipLong: 0, cp: M.v3(), grip: 1, wet: 0, offroad: false,
      };
    });
  }

  setTuning(t) {
    const s = this.spec;
    this.tuning = t;
    this.drivetrain.setTuning(t);
    const split = s.layout === 'AWD' ? t.awdSplit / 100 : 1;
    // per-axle tyre models (pressure changes stiffness and peak grip)
    const mk = (pressure) => {
      const dp = pressure - 2.1;
      return new TireModel({ ...s.tire, lat: { ...s.tire.lat, B: s.tire.lat.B * (1 + 0.16 * dp) }, long: { ...s.tire.long, B: s.tire.long.B * (1 + 0.12 * dp) } });
    };
    this.tireF = mk(t.pressureF);
    this.tireR = mk(t.pressureR);
    const pressureGrip = (p) => 1 - 0.13 * Math.pow(Math.abs(p - 2.05), 1.5);
    const camberLat = (c) => { c = Math.abs(c); return 1 + 0.032 * Math.min(c, 4) - 0.03 * Math.max(0, c - 4); };
    const camberLong = (c) => 1 - 0.014 * Math.abs(c);
    for (const w of this.wheels) {
      const front = w.front;
      const k = (front ? s.susp.springF * t.springF : s.susp.springR * t.springR);
      w.k = k;
      w.cBump = s.susp.bump * Math.sqrt(front ? t.springF : t.springR);
      w.cReb = s.susp.rebound * Math.sqrt(front ? t.springF : t.springR);
      const fzStatic = (this.mass * GRAV * (front ? s.frontWeight : 1 - s.frontWeight)) / 2;
      const compStatic = fzStatic / k;
      w.mount.y = -s.cgHeight + w.r + w.L0 - compStatic;
      w.tire = front ? this.tireF : this.tireR;
      const cam = front ? t.camberF : t.camberR;
      const pr = front ? t.pressureF : t.pressureR;
      w.muLat = camberLat(cam) * pressureGrip(pr);
      w.muLong = camberLong(cam) * pressureGrip(pr);
      // drive torque weights (planetary split; kinematic weights = torque fractions)
      w.driveW = front ? (1 - split) / 2 : split / 2;
      if (s.layout === 'RWD' && front) w.driveW = 0;
    }
    this.arbF = s.susp.arbF * t.springF;
    this.arbR = s.susp.arbR * t.springR;
    this.maxLock = t.steerLock * DEG;
    this.brakeBias = t.brakeBias / 100;
  }

  /** Place the car at (x, z) facing `heading` (radians, 0 = +Z). */
  reset(x, z, heading) {
    const gy = this.world.heightAt(x, z);
    M.set(this.p, x, gy + this.spec.cgHeight + 0.05, z);
    M.quatFromYaw(this.q, heading);
    M.set(this.v, 0, 0, 0); M.set(this.w, 0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.comp = w.prevComp = 0; w.alphaRel = 0; w.brakeTemp = 40; }
    this.drivetrain.reset();
    this.steerIn = 0; this.delta = 0;
  }

  get heading() { M.quatToMat3(this.q, this.R); return Math.atan2(this.R[2], this.R[8]); }

  /* ------------------------------------------------------------ controls */
  updateControls(dt, input) {
    const R = M.quatToMat3(this.q, this.R);
    const vl = M.toLocal(_a, R, this.v);
    const speed = M.len(this.v), fwd = vl.z;
    const beta = fwd > 1.5 ? Math.atan2(vl.x, fwd) : 0;
    this.beta = beta;
    const dtn = this.drivetrain;

    // --- gear logic ----------------------------------------------------
    let throttle = input.throttle, brake = input.brake;
    if (this.automatic) {
      if (dtn.gear === 0) dtn.setGear(1);
      if (dtn.gear === -1) {
        throttle = input.brake; brake = input.throttle;
        if (input.throttle > 0.1 && fwd > -1.0) dtn.setGear(1);
      } else if (input.brake > 0.2 && input.throttle < 0.05 && fwd < 0.8) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) { dtn.setGear(-1); this.reverseTimer = 0; }
      } else this.reverseTimer = 0;
    } else {
      if (input.shiftUp) dtn.shiftUp();
      if (input.shiftDown) dtn.shiftDown();
    }
    this.throttleIn = throttle; this.brakeIn = brake;
    this.handbrakeIn = M.moveTowards(this.handbrakeIn, input.handbrake, dt * 12);
    this.clutch = M.moveTowards(this.clutch, input.clutch, dt * 10);

    // --- steering ------------------------------------------------------
    const raw = input.steer;
    if (input.analogSteer) this.steerIn = raw;
    else {
      const active = Math.abs(raw) > 0.01;
      let rate = active ? M.lerp(3.8, 1.9, M.clamp(speed / 45, 0, 1)) : 5.5;
      if (active && Math.sign(raw) !== Math.sign(this.steerIn) && Math.abs(this.steerIn) > 0.05) rate *= 1.8;
      this.steerIn = M.moveTowards(this.steerIn, raw, rate * dt);
    }
    const slideness = M.smoothstep(0.06, 0.3, Math.abs(beta));
    const gripLimit = input.analogSteer ? M.lerp(1, 0.55, M.clamp((speed - 8) / 40, 0, 1)) : M.lerp(1, 0.3, M.clamp((speed - 6) / 38, 0, 1));
    const limit = M.lerp(gripLimit, 1, slideness);
    let cmd = this.steerIn * this.maxLock * limit;
    // caster self-steer: with no input the front wheels trail the direction of travel,
    // exactly like a real car when a drifter lets the wheel spin through their hands.
    if (Math.abs(raw) < 0.05 && Math.abs(this.steerIn) < 0.05 && fwd > 3) cmd = M.clamp(beta * 0.9, -this.maxLock, this.maxLock);
    if (this.assists.counterSteer && fwd > 4) cmd = M.clamp(M.lerp(cmd, beta + this.steerIn * this.maxLock * 0.5, slideness * 0.85), -this.maxLock, this.maxLock);
    this.delta = M.moveTowards(this.delta, cmd, this.spec.steering.rate * dt);

    // Ackermann split (left-positive steering)
    const s = this.spec, L = s.wheelbase, t = s.trackF, ack = s.steering.ackermann;
    const d = this.delta;
    if (Math.abs(d) > 1e-4) {
      const Rt = L / Math.tan(Math.abs(d));
      const inner = Math.atan(L / Math.max(0.5, Rt - t / 2)), outer = Math.atan(L / (Rt + t / 2));
      const di = M.lerp(Math.abs(d), inner, ack), dout = M.lerp(Math.abs(d), outer, ack);
      const sg = Math.sign(d);
      this.wheels[0].steer = sg * (d > 0 ? di : dout);
      this.wheels[1].steer = sg * (d > 0 ? dout : di);
    } else { this.wheels[0].steer = 0; this.wheels[1].steer = 0; }
  }

  /* ------------------------------------------------------------ physics */
  addForceAt(f, pt) {
    M.add(this.F, this.F, f);
    M.sub(_e, pt, this.p);
    M.cross(_d, _e, f);
    M.add(this.T, this.T, _d);
  }

  step(dt, input) {
    this.updateControls(dt, input);
    this.scraping = false;
    const R = M.quatToMat3(this.q, this.R);
    const world = this.world, s = this.spec, wheels = this.wheels;
    M.set(this.F, 0, -this.mass * GRAV, 0);
    M.set(this.T, 0, 0, 0);
    const up = M.toWorld(M.v3(), R, { x: 0, y: 1, z: 0 });

    // ---------------------------------------------------- suspension
    for (const w of wheels) {
      const mw = M.add(w.mw || (w.mw = M.v3()), this.p, M.toWorld(_a, R, w.mount));
      const gy = world.heightAt(mw.x, mw.z);
      const dist = (mw.y - gy) / Math.max(up.y, 0.25);
      const len = dist - w.r;
      w.prevComp = w.comp;
      if (len >= w.L0) { w.contact = false; w.comp = 0; w.length = w.L0; }
      else { w.contact = true; w.comp = Math.min(w.L0 - len, w.travel + 0.08); w.length = w.L0 - w.comp; }
      const cv = (w.comp - w.prevComp) / dt;
      let f = w.k * w.comp + (cv > 0 ? w.cBump : w.cReb) * cv;
      if (w.comp > w.travel) f += (w.comp - w.travel) * w.k * 12; // bump stop
      w.Fspring = w.contact ? f : 0;
    }
    // anti-roll bars
    const arb = (l, r, k) => {
      const d = (l.comp - r.comp) * k;
      if (l.contact) l.Fspring += d;
      if (r.contact) r.Fspring -= d;
    };
    arb(wheels[0], wheels[1], this.arbF);
    arb(wheels[2], wheels[3], this.arbR);

    // ---------------------------------------------------- tyre forces
    const speed = M.len(this.v);
    let maxDrivenKappa = 0;
    for (const w of wheels) {
      w.Fz = w.contact ? Math.max(0, w.Fspring) : 0;
      // contact point & its velocity
      M.addScaled(w.cp, w.mw, up, -(w.length + w.r));
      M.sub(_b, w.cp, this.p);
      M.cross(_c, this.w, _b);
      M.add(_c, _c, this.v); // contact-patch velocity
      world.normalAt(w.cp.x, w.cp.z, _n);
      // wheel heading projected onto the ground plane
      const sd = Math.sin(w.steer), cd = Math.cos(w.steer);
      M.toWorld(_f, R, { x: sd, y: 0, z: cd });
      M.addScaled(_f, _f, _n, -M.dot(_f, _n)); M.normalize(_f, _f);
      M.cross(_s, _n, _f); // left
      const vx = M.dot(_c, _f), vy = M.dot(_c, _s);
      w.vx = vx; w.vy = vy;
      M.copy(w.fwd || (w.fwd = M.v3()), _f); M.copy(w.side || (w.side = M.v3()), _s);
      M.copy(w.normal || (w.normal = M.v3()), _n);

      const denom = Math.max(Math.abs(vx), 3);
      w.kappa = M.clamp((w.omega * w.r - vx) / denom, -1.2, 6);
      const alphaT = Math.atan(vy / denom);
      // relaxation length → transient lateral response
      const relax = Math.min(1, ((Math.abs(vx) + 2) * dt) / 0.32);
      w.alphaRel += (alphaT - w.alphaRel) * relax;
      w.alpha = w.alphaRel;

      const surf = world.surfaceAt(w.cp.x, w.cp.z);
      w.wet = surf.wet; w.offroad = surf.offroad;
      const tempGrip = M.clamp(1 - 0.18 * Math.pow((w.temp - 90) / 70, 2), 0.76, 1);
      const wearGrip = 1 - 0.25 * w.wear;
      w.grip = surf.grip * tempGrip * wearGrip;
      const muL = w.grip * w.muLong, muY = w.grip * w.muLat;

      if (w.contact) {
        const tm = w.tire;
        const fo = tm.forces(w.kappa, w.alpha, w.Fz, muL, muY);
        w.Fx = fo.fx; w.Fy = fo.fy;
        w.dFdw = (tm.dFxdKappa(w.kappa, w.alpha, w.Fz, muL, muY) * w.r) / denom;
        // low-speed lateral "parking" damping (static friction at a standstill)
        const lowK = M.clamp(1 - speed / 2.5, 0, 1);
        if (lowK > 0) {
          const lim = w.Fz * muY;
          w.Fy = M.clamp(w.Fy + vy * (w.Fz / GRAV) * 10 * lowK, -lim, lim);
        }
      } else { w.Fx = 0; w.Fy = 0; w.dFdw = 0; }
      w.Ieff = w.I + dt * w.r * w.dFdw;
      // Predict the force at the END of the step: the contact patch speed keeps
      // changing (the car accelerates), so compensate the linearisation for it.
      // Without this the implicit solve behaves like extra wheel inertia and
      // drags the car / sluggishly revs the engine.
      const dvx = w.prevVx != null ? vx - w.prevVx : 0;
      w.prevVx = vx;
      w.tireTorque = -(w.Fx - (w.dFdw / w.r) * dvx) * w.r;
      if (w.driveW) maxDrivenKappa = Math.max(maxDrivenKappa, w.kappa);
    }

    // ---------------------------------------------------- drivetrain
    const tcCut = this.assists.tc ? M.clamp(1 - (maxDrivenKappa - 0.12) * 4, 0.15, 1) : 1;
    this.drivetrain.step(dt, {
      throttle: this.throttleIn, clutch: this.clutch, automatic: this.automatic,
      handbrake: this.handbrakeIn > 0.5, tcCut,
    }, wheels);

    // ---------------------------------------------------- wheel spin + brakes
    const bt = s.brakes.torque * 2;
    for (const w of wheels) {
      let Tb = this.brakeIn * bt * (w.front ? this.brakeBias : 1 - this.brakeBias);
      if (!w.front) Tb += this.handbrakeIn * s.brakes.handbrake;
      if (this.assists.abs && this.brakeIn > 0.1 && w.kappa < -0.13 && speed > 3) Tb *= 0.35;
      w.brakeTorque = Tb;
      w.omega += (dt * (w.driveTorque + w.tireTorque)) / w.Ieff;
      const dB = (Tb * dt) / w.Ieff;
      if (Math.abs(w.omega) <= dB) w.omega = 0; else w.omega -= Math.sign(w.omega) * dB;
      w.spin = (w.spin + w.omega * dt) % (Math.PI * 2);
      // brake heat
      w.brakeTemp += (Tb * Math.abs(w.omega) * dt) / 2600 - (w.brakeTemp - 35) * 0.06 * (1 + speed / 25) * dt;
    }

    // ---------------------------------------------------- apply forces to body
    for (const w of wheels) {
      if (!w.contact) continue;
      // suspension along body up at the contact patch
      M.scale(_a, up, w.Fz);
      this.addForceAt(_a, w.cp);
      // tyre forces slightly above the patch (pseudo roll-centre)
      M.scale(_a, w.fwd, w.Fx);
      M.addScaled(_a, _a, w.side, -w.Fy);
      // rolling resistance
      M.addScaled(_a, _a, w.fwd, -0.013 * w.Fz * M.clamp(w.vx, -1, 1));
      M.addScaled(_b, w.cp, up, w.r * 0.55);
      this.addForceAt(_a, _b);
      // tyre heat & wear from slip power
      const slipLong = w.omega * w.r - w.vx;
      w.slipLong = slipLong; w.slipLat = w.vy;
      w.slipSpeed = Math.hypot(slipLong, w.vy);
      const pw = Math.abs(w.Fx * slipLong) + Math.abs(w.Fy * w.vy);
      w.temp += (pw * 1.6e-4 - (w.temp - 25) * 0.05 * (1 + speed / 30)) * dt;
      w.wear = Math.min(1, w.wear + pw * 1.2e-8 * dt);
    }
    for (const w of wheels) if (!w.contact) { w.slipSpeed = 0; }

    // aerodynamics
    const v = this.v;
    const drag = 0.5 * 1.225 * s.aero.cdA * speed;
    M.addScaled(this.F, this.F, v, -drag);
    const fwdSpeed = M.dot(v, M.toWorld(_a, R, { x: 0, y: 0, z: 1 }));
    M.addScaled(this.F, this.F, up, -0.5 * 1.225 * s.aero.clA * fwdSpeed * fwdSpeed);

    // body-ground contacts (bottoming out / rollovers)
    this.bodyGround(R, up);

    // ---------------------------------------------------- integrate
    M.addScaled(this.v, this.v, this.F, dt / this.mass);
    M.toLocal(_a, R, this.T);
    _a.x /= this.inertia.x; _a.y /= this.inertia.y; _a.z /= this.inertia.z;
    M.toWorld(_b, R, _a);
    M.addScaled(this.w, this.w, _b, dt);
    // tiny angular damping for numerical hygiene
    M.scale(this.w, this.w, 1 - 0.02 * dt);
    M.addScaled(this.p, this.p, this.v, dt);
    M.quatIntegrate(this.q, this.w, dt);

    // ---------------------------------------------------- barriers
    this.impacts = world.collide(this, dt) || [];

    this.updateTelemetry();
  }

  bodyGround(R, up) {
    const s = this.spec;
    const hw = s.dims.width * 0.45, hl = s.dims.length * 0.45;
    const yb = -s.cgHeight + 0.14, yt = s.dims.height - s.cgHeight - 0.08;
    for (let i = 0; i < 8; i++) {
      _a.x = i & 1 ? hw : -hw; _a.y = i & 2 ? yt : yb; _a.z = i & 4 ? hl : -hl;
      M.toWorld(_b, R, _a); M.add(_b, _b, this.p);
      const gy = this.world.heightAt(_b.x, _b.z);
      const pen = gy - _b.y;
      if (pen <= 0) continue;
      this.world.normalAt(_b.x, _b.z, _n);
      M.sub(_c, _b, this.p); M.cross(_d, this.w, _c); M.add(_d, _d, this.v);
      const vn = M.dot(_d, _n);
      const fn = Math.max(0, 300000 * pen - 9000 * vn);
      M.scale(_f, _n, fn);
      M.addScaled(_d, _d, _n, -vn); // tangential velocity
      const vt = M.len(_d);
      if (vt > 0.01) M.addScaled(_f, _f, _d, -Math.min(fn * 0.5, vt * this.mass * 4) / vt);
      this.addForceAt(_f, _b);
      this.scraping = true;
    }
  }

  updateTelemetry() {
    const R = M.quatToMat3(this.q, this.R);
    const vl = M.toLocal(_a, R, this.v);
    const t = this.telemetry;
    t.speed = M.len(this.v);
    t.kmh = t.speed * 3.6;
    t.fwdSpeed = vl.z;
    const lat = Math.hypot(vl.x, vl.z);
    t.driftAngle = lat > 2.5 && vl.z > -0.5 ? Math.atan2(vl.x, Math.max(0.01, vl.z)) / DEG : 0;
    const d = this.drivetrain;
    t.rpm = d.rpm; t.gear = d.gear; t.boost = d.boost; t.throttle = this.throttleIn; t.brake = this.brakeIn;
    t.handbrake = this.handbrakeIn; t.clutch = this.clutch; t.steer = this.delta; t.load = d.load;
    t.wheels = this.wheels;
  }
}
