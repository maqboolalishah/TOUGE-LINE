/* ==========================================================================
   Drivetrain: engine → clutch → gearbox → (centre diff) → LSD → wheels.

   - Engine: rotating inertia with a full-boost torque curve, friction /
     engine braking, idle controller, rev limiter with fuel-cut bounce.
   - Turbo: boost state spools with exhaust flow above a threshold rpm
     (lag!), then multiplies torque; lifting dumps it through the BOV.
   - Clutch: torque-limited coupling solved at the velocity level each step
     (computes the torque that would lock engine and driveline, then clamps
     it to clutch capacity). Stable for any gear and allows real clutch-kicks.
   - LSD: clutch-type, preload + ramp lock (separate power / coast lock).
   - AWD: planetary centre diff with adjustable rear bias.
   ========================================================================== */
import { clamp, lerp, smoothstep } from './math.js';

const RPM2RAD = (2 * Math.PI) / 60;

export class Drivetrain {
  constructor(spec, tuning) {
    this.spec = spec;
    this.events = [];
    this.setTuning(tuning);
    this.reset();
  }

  setTuning(t) {
    const s = this.spec, gb = s.gearbox;
    this.tuning = t;
    const last = gb.ratios[gb.ratios.length - 1];
    this.ratios = gb.ratios.map((r) => last * Math.pow(r / last, t.gearSpread));
    this.final = t.finalDrive;
    this.reverse = gb.reverse;
    this.split = s.layout === 'AWD' ? t.awdSplit / 100 : 1;
    const lock = t.diffLock / 100;
    this.powerLock = lock;
    this.coastLock = lock * (s.diff.coastLock / Math.max(0.05, s.diff.powerLock));
    this.boostMul = t.boost;
  }

  reset() {
    const e = this.spec.engine;
    this.omega = e.idle * RPM2RAD;
    this.gear = 1;
    this.boost = 0;
    this.shiftTimer = 0;
    this.shiftDir = 0;
    this.sinceShift = 10;
    this.cutTimer = 0;
    this.clutchPedal = 0;
    this.engagement = 1;
    this.throttleEff = 0;
    this.lastThrottle = 0;
    this.popTimer = 0;
    this.load = 0;
    this.torqueOut = 0;
    this.clutchSlip = 0;
  }

  get rpm() { return this.omega / RPM2RAD; }
  get numGears() { return this.ratios.length; }

  ratio(g = this.gear) {
    if (g === 0) return 0;
    if (g < 0) return -this.reverse * this.final;
    return this.ratios[g - 1] * this.final;
  }

  curve(rpm) {
    const c = this.spec.engine.torque;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return lerp(c[i - 1][1], c[i][1], t);
      }
    }
    return c[c.length - 1][1];
  }

  shiftUp() {
    if (this.shiftTimer > 0 || this.gear >= this.numGears) return false;
    this.gear = this.gear === -1 ? 0 : this.gear + 1;
    this.beginShift(1);
    return true;
  }
  shiftDown() {
    if (this.shiftTimer > 0 || this.gear <= -1) return false;
    this.gear -= 1;
    this.beginShift(-1);
    return true;
  }
  setGear(g) { this.gear = g; this.beginShift(0); }
  beginShift(dir) {
    this.shiftTimer = this.spec.gearbox.shiftTime;
    this.sinceShift = 0;
    this.shiftDir = dir;
    this.events.push({ type: 'shift', dir, gear: this.gear });
    if (dir < 0 && this.rpm > 3000) this.events.push({ type: 'backfire', strength: 1, flame: true });
  }

  /**
   * One physics sub-step.
   * @param ctl     { throttle, clutch, automatic, speed, handbrake, tcCut }
   * @param wheels  physics wheels; uses .omega, .Ieff, .tireTorque, .driveW, .axle
   *                and writes .driveTorque
   */
  step(dt, ctl, wheels) {
    const s = this.spec, e = s.engine;
    let rpm = this.rpm;

    // ---------------------------------------------------- automatic gearbox
    const G = this.ratio();
    let shaft = 0;
    for (const w of wheels) if (w.driveW) shaft += w.driveW * w.omega;
    const wheelSideRpm = Math.abs(shaft * this.ratio(this.gear === 0 ? 1 : this.gear)) / RPM2RAD;
    this.sinceShift += dt;
    if (ctl.automatic && this.shiftTimer <= 0 && this.gear >= 1 && this.sinceShift > 0.9) {
      const up = e.redline * 0.965;
      const down = lerp(0.33, 0.56, ctl.throttle) * e.redline;
      if (wheelSideRpm > up && ctl.throttle > 0.3 && this.gear < this.numGears && !ctl.handbrake) this.shiftUp();
      else if (this.gear > 1 && wheelSideRpm < down) {
        const next = Math.abs(shaft * this.ratio(this.gear - 1)) / RPM2RAD;
        if (next < e.redline * 0.86 && this.sinceShift > 1.6) this.shiftDown();
      }
    }

    // ---------------------------------------------------- throttle & limiter
    let thr = ctl.throttle;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftDir > 0) thr = 0;                     // ignition cut on upshift
      else if (this.shiftDir < 0) thr = Math.max(thr, 0.55); // rev-match blip on downshift
    }
    if (ctl.tcCut) thr *= ctl.tcCut;
    if (this.cutTimer > 0) { this.cutTimer -= dt; thr = 0; }
    if (rpm >= e.limiter) { this.cutTimer = 0.055; thr = 0; this.events.push({ type: 'limiter' }); }
    const idleThr = clamp((e.idle - rpm) / 250, 0, 0.35);
    thr = Math.max(thr, idleThr);
    this.throttleEff = thr;

    // ---------------------------------------------------- turbo
    const t = e.turbo;
    const flow = (rpm / e.redline) * (0.25 + 0.75 * thr);
    const target = thr > 0.15 ? smoothstep(t.spoolStart, t.spoolFull, rpm) * Math.min(1, thr * 1.25) : 0;
    if (target > this.boost) this.boost += (target - this.boost) * Math.min(1, t.spoolRate * flow * 2.2 * dt);
    else this.boost += (target - this.boost) * Math.min(1, 6 * dt);
    if (this.lastThrottle > 0.55 && ctl.throttle < 0.2 && this.boost > 0.45) {
      this.events.push({ type: 'bov', amount: this.boost });
      this.boost *= 0.35;
    }
    // over-run pops after lifting at high rpm
    if (this.lastThrottle > 0.5 && ctl.throttle < 0.1 && rpm > e.redline * 0.55) this.popTimer = 0.7;
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      if (Math.random() < dt * 14 * s.sound.pops) this.events.push({ type: 'backfire', strength: 0.4 + Math.random() * 0.5, flame: Math.random() < 0.35 });
    }
    this.lastThrottle = ctl.throttle;

    // ---------------------------------------------------- engine torque
    const boostFactor = e.offBoost + (1 - e.offBoost) * this.boost;
    const full = this.curve(rpm) * boostFactor * lerp(1, this.boostMul, this.boost);
    const fric = e.friction[0] + e.friction[1] * this.omega;
    const Te = thr * full - fric * (1 - thr * 0.9);
    this.load = clamp(thr * (full / 600), 0, 1.4);

    // ---------------------------------------------------- clutch engagement
    this.clutchPedal = ctl.clutch;
    let eng = 1 - ctl.clutch;
    if (this.gear === 0 || this.shiftTimer > 0) eng = 0;
    // auto-clutch for launches (prevents stalling; keeps revs in a drift-launch band)
    if (this.gear !== 0 && wheelSideRpm < 1700) {
      const launchRpm = 1100 + 3000 * ctl.throttle;
      const autoEng = Math.pow(clamp((rpm - 950) / (launchRpm - 950), 0, 1), 1.5);
      eng *= lerp(autoEng, 1, smoothstep(1200, 1700, wheelSideRpm));
    }
    if (ctl.automatic && ctl.handbrake) eng = 0; // auto boxes clutch-in on handbrake
    this.engagement = eng;
    const cap = s.clutchTorque * eng;

    // ---------------------------------------------------- clutch lock solve
    let Tc = 0;
    if (G !== 0 && cap > 0) {
      let wFree = 0, invJ = 0;
      for (const w of wheels) {
        if (!w.driveW) continue;
        wFree += w.driveW * (w.omega + (w.tireTorque / w.Ieff) * dt);
        invJ += (w.driveW * w.driveW) / w.Ieff;
      }
      const shaftFree = wFree * G;
      const engFree = this.omega + (Te / e.inertia) * dt;
      const Tlock = (engFree - shaftFree) / (dt * (1 / e.inertia + G * G * invJ));
      Tc = clamp(Tlock, -cap, cap);
      this.clutchSlip = Math.abs(Tlock) > cap ? 1 : 0;
    } else this.clutchSlip = 1;
    this.torqueOut = Tc;

    // ---------------------------------------------------- engine integrate
    this.omega += ((Te - Tc) / e.inertia) * dt;
    const minOmega = 600 * RPM2RAD;
    if (this.omega < minOmega) this.omega = minOmega; // never stalls (anti-stall)

    // ---------------------------------------------------- distribute to axles
    const shaftT = Tc * G;
    for (const w of wheels) w.driveTorque = shaftT * (w.driveW || 0);

    // ---------------------------------------------------- rear LSD
    this.applyLSD(wheels[2], wheels[3], shaftT * (this.split), dt, this.powerLock, this.coastLock, s.diff.preload);
    if (this.split < 1) this.applyLSD(wheels[0], wheels[1], shaftT * (1 - this.split), dt, s.diff.frontLock || 0, 0, 30);
  }

  applyLSD(L, R, axleT, dt, powerLock, coastLock, preload) {
    const wl = L.omega + ((L.driveTorque + L.tireTorque) / L.Ieff) * dt;
    const wr = R.omega + ((R.driveTorque + R.tireTorque) / R.Ieff) * dt;
    const need = (wl - wr) / (dt * (1 / L.Ieff + 1 / R.Ieff));
    const lock = axleT >= 0 ? powerLock : coastLock;
    const cap = preload + lock * Math.abs(axleT) * 4 + (lock >= 0.98 ? 1e6 : 0);
    const dT = clamp(need, -cap, cap);
    L.driveTorque -= dT;
    R.driveTorque += dT;
  }
}
