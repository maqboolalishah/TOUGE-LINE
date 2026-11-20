/* ==========================================================================
   Barrier collisions: the car's footprint (oriented box) against 2D wall
   segments (guardrails, tyre walls, concrete, containers). Contacts are
   resolved with a restitution + friction impulse at the contact point, so
   hitting a wall at an angle spins the car realistically. Every contact is
   reported for sparks, sounds and combo-breaking.
   ========================================================================== */
import * as M from './math.js';

const _r = M.v3(), _t = M.v3(), _vp = M.v3(), _imp = M.v3(), _cr = M.v3();

export class BarrierSet {
  constructor(segments, cell = 20) {
    this.segs = segments; // {ax,az,bx,bz,thick,kind,h}
    this.cell = cell;
    this.grid = new Map();
    segments.forEach((s, i) => {
      const x0 = Math.floor((Math.min(s.ax, s.bx) - 3) / cell), x1 = Math.floor((Math.max(s.ax, s.bx) + 3) / cell);
      const z0 = Math.floor((Math.min(s.az, s.bz) - 3) / cell), z1 = Math.floor((Math.max(s.az, s.bz) + 3) / cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z;
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(i);
      }
    });
  }

  query(x, z, rad, out) {
    out.length = 0;
    const c = this.cell, seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let gx = Math.floor((x - rad) / c); gx <= Math.floor((x + rad) / c); gx++)
      for (let gz = Math.floor((z - rad) / c); gz <= Math.floor((z + rad) / c); gz++) {
        const a = this.grid.get(gx * 100003 + gz);
        if (a) for (const i of a) if (!seen.has(i)) { seen.add(i); out.push(this.segs[i]); }
      }
    return out;
  }

  /** Signed distance from car centre side for the nearest point on a segment. */
  static closest(s, x, z) {
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const l2 = ex * ex + ez * ez || 1;
    const t = M.clamp(((x - s.ax) * ex + (z - s.az) * ez) / l2, 0, 1);
    return { x: s.ax + ex * t, z: s.az + ez * t, t };
  }

  /** Resolve car vs barriers. Returns impacts [{x,y,z,nx,nz,speed,slide,kind}] */
  collide(car, dt) {
    const spec = car.spec, R = car.R;
    const hw = spec.dims.width / 2, hl = spec.dims.length / 2;
    const p = car.p;
    const near = this.query(p.x, p.z, hl + 3, this._near || (this._near = []));
    const impacts = [];
    if (!near.length) return impacts;
    // car axes on the ground plane
    const fx = R[2], fz = R[8], lx = R[0], lz = R[6];
    const fl = Math.hypot(fx, fz) || 1, ll = Math.hypot(lx, lz) || 1;
    const F = { x: fx / fl, z: fz / fl }, L = { x: lx / ll, z: lz / ll };
    const corners = [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [hw, 0], [-hw, 0], [0, hl], [0, -hl]];

    for (const s of near) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, sl = Math.hypot(ex, ez) || 1;
      let nx = -ez / sl, nz = ex / sl;
      // orient the wall normal toward the car centre
      const c0 = BarrierSet.closest(s, p.x, p.z);
      if ((p.x - c0.x) * nx + (p.z - c0.z) * nz < 0) { nx = -nx; nz = -nz; }
      const th = s.thick || 0.25;
      let worst = null;
      // car corners against the wall
      for (const [cx, cz] of corners) {
        const wx = p.x + L.x * cx + F.x * cz, wz = p.z + L.z * cx + F.z * cz;
        const ex2 = wx - s.ax, ez2 = wz - s.az;
        const t = (ex2 * ex + ez2 * ez) / (sl * sl);
        if (t < -0.02 || t > 1.02) continue;
        const sd = ex2 * nx + ez2 * nz;
        const pen = th - sd;
        if (pen > 0 && pen < hw * 2 + th && (!worst || pen > worst.pen)) worst = { x: wx, z: wz, pen, nx, nz };
      }
      // wall end-points poking into the car (container corners, posts)
      for (const [qx, qz] of [[s.ax, s.az], [s.bx, s.bz]]) {
        const dx = qx - p.x, dz = qz - p.z;
        const lxv = dx * L.x + dz * L.z, lzv = dx * F.x + dz * F.z;
        const px = hw + 0.05 - Math.abs(lxv), pz = hl + 0.05 - Math.abs(lzv);
        if (px > 0 && pz > 0) {
          let n;
          if (px < pz) n = { x: -L.x * Math.sign(lxv), z: -L.z * Math.sign(lxv), pen: px };
          else n = { x: -F.x * Math.sign(lzv), z: -F.z * Math.sign(lzv), pen: pz };
          if (!worst || n.pen > worst.pen) worst = { x: qx, z: qz, pen: n.pen, nx: n.x, nz: n.z };
        }
      }
      if (worst) {
        const imp = this.resolve(car, worst, s);
        if (imp) impacts.push(imp);
      }
    }
    return impacts;
  }

  resolve(car, c, seg) {
    const p = car.p, v = car.v, w = car.w, m = car.mass;
    // positional correction
    const corr = Math.min(c.pen, 0.6);
    p.x += c.nx * corr; p.z += c.nz * corr;
    M.set(_r, c.x - p.x, 0.05, c.z - p.z);
    M.cross(_vp, w, _r); M.add(_vp, _vp, v);
    const n = { x: c.nx, y: 0, z: c.nz };
    const vn = M.dot(_vp, n);
    if (vn >= 0) return { x: c.x, y: p.y, z: c.z, nx: c.nx, nz: c.nz, speed: 0, slide: Math.hypot(_vp.x - n.x * vn, _vp.z - n.z * vn), kind: seg.kind };
    // effective mass at the contact (includes rotation)
    const R = car.R, I = car.inertia;
    const invEff = (dir) => {
      M.cross(_cr, _r, dir);
      M.toLocal(_t, R, _cr); _t.x /= I.x; _t.y /= I.y; _t.z /= I.z; M.toWorld(_t, R, _t);
      M.cross(_t, _t, _r);
      return 1 / m + M.dot(_t, dir);
    };
    const e = seg.kind === 'tire' ? 0.35 : seg.kind === 'guardrail' ? 0.18 : 0.12;
    const j = (-(1 + e) * vn) / invEff(n);
    // friction along the wall
    const tv = { x: _vp.x - n.x * vn, y: 0, z: _vp.z - n.z * vn };
    const tl = Math.hypot(tv.x, tv.z);
    const mu = seg.kind === 'tire' ? 0.7 : 0.35;
    let jt = 0, tdir = { x: 0, y: 0, z: 0 };
    if (tl > 0.01) {
      tdir = { x: -tv.x / tl, y: 0, z: -tv.z / tl };
      jt = Math.min(mu * j, tl / invEff(tdir));
    }
    M.set(_imp, n.x * j + tdir.x * jt, 0, n.z * j + tdir.z * jt);
    M.addScaled(v, v, _imp, 1 / m);
    M.cross(_cr, _r, _imp);
    M.toLocal(_t, R, _cr); _t.x /= I.x; _t.y /= I.y; _t.z /= I.z; M.toWorld(_t, R, _t);
    M.add(w, w, _t);
    return { x: c.x, y: p.y, z: c.z, nx: c.nx, nz: c.nz, speed: -vn, slide: tl, kind: seg.kind };
  }
}
