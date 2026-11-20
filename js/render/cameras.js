/* ==========================================================================
   Cameras: chase (critically-damped spring that swings out to show the
   slide during drifts), hood, cockpit, bumper, and cinematic trackside
   cameras for replays (+ an orbit for menus).
   ========================================================================== */
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'far', 'hood', 'cockpit', 'bumper'];
const CAMERA_LABELS = { chase: 'Chase', far: 'Chase (far)', hood: 'Hood', cockpit: 'Cockpit', bumper: 'Bumper' };

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.fov = 62;
    this.shake = 0;
    this.cine = { idx: -1, pos: new THREE.Vector3(), timer: 0 };
    this.orbitAngle = 0;
    this.cut = false;
  }
  get name() { return CAMERA_MODES[this.mode]; }
  get label() { return CAMERA_LABELS[this.name]; }
  next() { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.cut = true; return this.label; }
  snap() { this.cut = true; }

  /** car: { pos(Vector3), quat(Quaternion), vel(Vector3), speed, height(fn) } */
  update(dt, car, vis, impact) {
    this.cut = false;
    const name = this.name;
    const fwd = _f.set(0, 0, 1).applyQuaternion(car.quat);
    const up = _u.set(0, 1, 0).applyQuaternion(car.quat);
    if (vis && vis.interior) vis.interior.visible = name === 'cockpit';
    if (name === 'chase' || name === 'far') {
      const dist = name === 'far' ? 8.5 : 5.6, height = name === 'far' ? 2.8 : 1.85;
      // blend toward the direction of travel → camera swings out during a slide
      const vflat = _v.set(car.vel.x, 0, car.vel.z);
      const sp = vflat.length();
      const heading = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      let target = heading.clone();
      if (sp > 4) target.lerp(vflat.normalize(), Math.min(0.55, (sp - 4) / 20));
      target.normalize();
      this.dir.lerp(target, 1 - Math.exp(-dt * 3.2)).normalize();
      const desired = new THREE.Vector3().copy(car.pos).addScaledVector(this.dir, -dist).add(new THREE.Vector3(0, height, 0));
      const gy = car.height(desired.x, desired.z) + 0.6;
      if (desired.y < gy) desired.y = gy;
      if (this.pos.lengthSq() === 0 || this.pos.distanceTo(desired) > 40) { this.pos.copy(desired); this.vel.set(0, 0, 0); }
      // critically damped spring
      const k = 38, c = 2 * Math.sqrt(k);
      const acc = desired.clone().sub(this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(acc, dt);
      this.pos.addScaledVector(this.vel, dt);
      this.cam.position.copy(this.pos);
      this.look.copy(car.pos).addScaledVector(heading, 1.6).add(new THREE.Vector3(0, 0.75, 0));
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this.look);
      this.fov += (Math.min(82, 60 + car.speed * 0.32) - this.fov) * (1 - Math.exp(-dt * 2));
    } else {
      // attached cameras
      const spec = car.spec;
      let local;
      if (name === 'hood') local = new THREE.Vector3(0, spec.dims.height - spec.cgHeight - 0.18, 0.55);
      else if (name === 'bumper') local = new THREE.Vector3(0, 0.55 - spec.cgHeight, spec.dims.length / 2 - 0.25);
      else local = new THREE.Vector3((spec.id === 'm4' ? 1 : -1) * 0.37, spec.dims.height - spec.cgHeight - 0.32, -0.32);
      this.cam.position.copy(local).applyQuaternion(car.quat).add(car.pos);
      _q.copy(car.quat);
      this.cam.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
      if (name === 'cockpit') this.cam.rotateX(-0.05);
      this.fov += ((name === 'cockpit' ? 68 : 72) + car.speed * 0.12 - this.fov) * (1 - Math.exp(-dt * 3));
      this.pos.copy(this.cam.position);
    }
    // impact / speed shake
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), impact || 0);
    const sh = this.shake * 0.06 + Math.min(1, car.speed / 70) * 0.004 * (name === 'chase' ? 1 : 2);
    if (sh > 0.0005) this.cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();
  }

  /** Trackside cinematic camera for replays. Returns focus distance for DOF. */
  cinematic(dt, carPos, spots) {
    const c = this.cine;
    c.timer -= dt;
    const d = c.idx >= 0 ? spots[c.idx].distanceTo(carPos) : Infinity;
    if (c.idx < 0 || d > 70 || c.timer < -9) {
      let best = 0, bd = Infinity;
      spots.forEach((s, i) => { const dd = s.distanceTo(carPos); if (dd < bd && i !== c.idx) { bd = dd; best = i; } });
      c.idx = best; c.timer = 0; this.cut = true;
    } else this.cut = false;
    const p = spots[c.idx];
    this.cam.position.copy(p);
    this.look.lerp(carPos, this.cut ? 1 : 1 - Math.exp(-dt * 6));
    this.cam.lookAt(this.look);
    const dist = p.distanceTo(carPos);
    this.cam.fov = THREE.MathUtils.clamp(2 * Math.atan(5 / dist) * (180 / Math.PI), 12, 55);
    this.cam.updateProjectionMatrix();
    return dist;
  }

  /** Slow orbit around the car (menus / garage). */
  orbit(dt, center, radius = 6.2, height = 1.6) {
    this.orbitAngle += dt * 0.18;
    this.cam.position.set(center.x + Math.sin(this.orbitAngle) * radius, center.y + height, center.z + Math.cos(this.orbitAngle) * radius);
    this.cam.lookAt(center.x, center.y + 0.3, center.z);
    this.cam.fov = 45; this.cam.updateProjectionMatrix();
  }
}
