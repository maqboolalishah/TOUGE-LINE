/* ==========================================================================
   Pure track data (no rendering): a centripetal Catmull-Rom centreline
   resampled every 2 m, elevation, fast nearest-point queries, surface grip,
   barrier segments, drift zones and the run definition (start / finish).
   The physics world interface (heightAt / normalAt / surfaceAt / collide)
   lives here so the simulation can run headless.
   ========================================================================== */
import { BarrierSet } from '../physics/collision.js';
import { clamp } from '../physics/math.js';

const STEP = 2; // metres between centreline samples

/** Centripetal Catmull-Rom (no loops / overshoot with uneven spacing). */
function crPoint(p0, p1, p2, p3, t) {
  const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => [((tb - tt) / (tb - ta)) * a[0] + ((tt - ta) / (tb - ta)) * b[0], ((tb - tt) / (tb - ta)) * a[1] + ((tt - ta) / (tb - ta)) * b[1]];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

export class TrackData {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.closed = !!def.closed;
    this.width = def.width;
    this.flat = !!def.flat;
    this.groundY = def.groundY || 0;
    this.rain = false;
    this.buildCentreline();
    this.buildGrid();
    this.buildBarriers();
    this.buildZones();
    this.startS = def.startS != null ? def.startS : this.closed ? 0 : 40;
    this.finishS = this.closed ? null : this.length - 45;
    this.laps = def.laps || 1;
  }

  /* ------------------------------------------------------------ centreline */
  buildCentreline() {
    const P = this.def.points;
    const n = P.length;
    const get = (i) => (this.closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
    const dense = [];
    const segs = this.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      // guard degenerate end tangents for open curves
      const q0 = p0 === p1 ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : p0;
      const q3 = p3 === p2 ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : p3;
      for (let k = 0; k < 60; k++) dense.push(crPoint(q0, p1, p2, q3, k / 60));
    }
    dense.push(this.closed ? dense[0] : P[n - 1]);
    // arc-length resample
    const out = [];
    let acc = 0, s = 0;
    out.push({ x: dense[0][0], z: dense[0][1], s: 0 });
    for (let i = 1; i < dense.length; i++) {
      const ax = dense[i - 1][0], az = dense[i - 1][1], bx = dense[i][0], bz = dense[i][1];
      const d = Math.hypot(bx - ax, bz - az);
      let used = 0;
      while (acc + (d - used) >= STEP) {
        const need = STEP - acc;
        used += need;
        const t = used / d;
        s += STEP;
        out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s });
        acc = 0;
      }
      acc += d - used;
    }
    if (this.closed) { const l = out[out.length - 1]; if (Math.hypot(l.x - out[0].x, l.z - out[0].z) < STEP * 0.6) out.pop(); }
    const N = out.length;
    this.length = this.closed ? out.length * STEP : out[N - 1].s;
    for (let i = 0; i < N; i++) {
      const a = out[this.closed ? (i - 1 + N) % N : Math.max(0, i - 1)], b = out[this.closed ? (i + 1) % N : Math.min(N - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const o = out[i];
      o.tx = tx; o.tz = tz; o.nx = tz; o.nz = -tx; // left normal
      o.y = this.flat ? this.groundY : (this.def.elevation ? this.def.elevation(o.s, this) : 0);
      o.heading = Math.atan2(tx, tz);
    }
    // signed curvature (heading change per metre), smoothed
    for (let i = 0; i < N; i++) {
      const a = out[this.closed ? (i - 4 + N) % N : Math.max(0, i - 4)], b = out[this.closed ? (i + 4) % N : Math.min(N - 1, i + 4)];
      let d = b.heading - a.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      out[i].curv = d / (8 * STEP);
    }
    this.samples = out;
  }

  buildGrid() {
    this.cell = 16;
    this.grid = new Map();
    this.samples.forEach((p, i) => {
      const k = Math.floor(p.x / this.cell) * 100003 + Math.floor(p.z / this.cell);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    });
  }

  sample(i) {
    const N = this.samples.length;
    return this.samples[this.closed ? ((i % N) + N) % N : Math.max(0, Math.min(N - 1, i))];
  }

  /** Nearest point on the centreline: {i, s, x, z, y, lat, tx, tz, nx, nz, dist} */
  nearest(x, z, out) {
    out = out || {};
    const c = this.cell, gx = Math.floor(x / c), gz = Math.floor(z / c);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && best < 0; r += r === 1 ? 1 : 2) {
      for (let ix = gx - r; ix <= gx + r; ix++) for (let iz = gz - r; iz <= gz + r; iz++) {
        const a = this.grid.get(ix * 100003 + iz);
        if (!a) continue;
        for (const i of a) {
          const p = this.samples[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0) {
      this.samples.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
    }
    // project onto the neighbouring segment for a continuous result
    const p = this.samples[best];
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    const j = along >= 0 ? best : best - 1;
    const a = this.sample(j), b = this.sample(j + 1);
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1);
    const px = a.x + ex * t, pz = a.z + ez * t;
    out.i = best;
    out.s = (this.closed ? ((j % this.samples.length) + this.samples.length) % this.samples.length : Math.max(0, j)) * STEP + t * STEP;
    out.x = px; out.z = pz;
    out.y = a.y + (b.y - a.y) * t;
    out.tx = p.tx; out.tz = p.tz; out.nx = p.nx; out.nz = p.nz;
    out.lat = (x - px) * p.nx + (z - pz) * p.nz;
    out.dist = Math.abs(out.lat);
    return out;
  }

  /* ------------------------------------------------------------ physics world API */
  heightAt(x, z) {
    if (this.flat) return this.groundY;
    return this.nearest(x, z, this._hq || (this._hq = {})).y;
  }
  normalAt(x, z, out) {
    if (this.flat) { out.x = 0; out.y = 1; out.z = 0; return out; }
    const e = 0.75;
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hz);
    out.x = -hx / l; out.y = 1 / l; out.z = -hz / l;
    return out;
  }
  surfaceAt(x, z) {
    const o = this._surf || (this._surf = {});
    let grip = 1, wet = this.rain ? 1 : 0, offroad = false;
    if (this.def.open) {
      grip = 0.97;
    } else {
      const n = this.nearest(x, z, this._sq || (this._sq = {}));
      const edge = this.width / 2;
      if (n.dist > edge + 0.4) { offroad = true; grip = this.def.runoffGrip != null ? this.def.runoffGrip : 0.72; }
    }
    for (const w of this.def.wetPatches || []) {
      const d = Math.hypot(x - w.x, z - w.z);
      if (d < w.r) { wet = Math.max(wet, 1 - Math.max(0, d - w.r * 0.75) / (w.r * 0.25)); }
    }
    if (wet > 0) grip *= 1 - 0.32 * wet;
    o.grip = grip; o.wet = wet; o.offroad = offroad;
    return o;
  }
  collide(car, dt) { return this.barriers.collide(car, dt); }

  /* ------------------------------------------------------------ barriers */
  buildBarriers() {
    const def = this.def, segs = [];
    if (def.barrierOffset != null) {
      const N = this.samples.length;
      for (const side of [1, -1]) {
        const off = this.width / 2 + def.barrierOffset;
        const pts = this.samples.map((p) => [p.x + p.nx * off * side, p.z + p.nz * off * side]);
        const count = this.closed ? N : N - 1;
        for (let i = 0; i < count; i++) {
          const a = pts[i], b = pts[(i + 1) % N];
          segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], thick: 0.25, kind: def.barrierKind, side });
        }
      }
      if (!this.closed) {
        for (const i of [0, N - 1]) {
          const p = this.samples[i], off = this.width / 2 + def.barrierOffset;
          segs.push({ ax: p.x + p.nx * off, az: p.z + p.nz * off, bx: p.x - p.nx * off, bz: p.z - p.nz * off, thick: 0.4, kind: 'concrete', cap: true });
        }
      }
    }
    for (const o of def.obstacles || []) {
      const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
      const hw = o.w / 2, hl = o.l / 2;
      const pts = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([lx, lz]) => [o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
      for (let i = 0; i < 4; i++) segs.push({ ax: pts[i][0], az: pts[i][1], bx: pts[(i + 1) % 4][0], bz: pts[(i + 1) % 4][1], thick: 0.1, kind: o.kind || 'container' });
    }
    for (const s of def.walls || []) segs.push({ thick: 0.3, kind: 'concrete', ...s });
    this.barrierSegs = segs;
    this.barriers = new BarrierSet(segs);
  }

  /* ------------------------------------------------------------ zones */
  buildZones() {
    if (this.def.zones) { this.zones = this.def.zones; return; }
    const S = this.samples, N = S.length;
    const th = 1 / 70;
    const corners = [];
    let i = 0;
    while (i < N) {
      if (Math.abs(S[i].curv) > th) {
        let j = i, apex = i;
        while (j < N && Math.abs(S[j].curv) > th * 0.7 && Math.sign(S[j].curv) === Math.sign(S[i].curv)) { if (Math.abs(S[j].curv) > Math.abs(S[apex].curv)) apex = j; j++; }
        if (j - i >= 6) corners.push({ apex, dir: Math.sign(S[apex].curv), mag: Math.abs(S[apex].curv), len: (j - i) * STEP });
        i = j + 1;
      } else i++;
    }
    corners.sort((a, b) => b.mag * b.len - a.mag * a.len);
    const picked = corners.slice(0, this.def.maxZones || 8).sort((a, b) => a.apex - b.apex);
    const zones = [];
    picked.forEach((c, k) => {
      const apexS = c.apex * STEP;
      zones.push({ id: 'c' + k, type: 'clip', s0: apexS - 10, s1: apexS + 10, side: c.dir, target: 1.6, label: 'CLIP ' + (k + 1) });
      zones.push({ id: 'z' + k, type: 'zone', s0: apexS + 6, s1: Math.min(this.length - 5, apexS + 38), side: -c.dir, target: 1.8, label: 'OUTER ZONE ' + (k + 1) });
    });
    this.zones = zones.filter((z) => z.s0 > 5 && (this.closed || z.s1 < this.length - 50));
  }

  /** Spawn transform {x,z,heading} at distance s along the centreline. */
  spawnAt(s) {
    const i = Math.round(s / STEP);
    const p = this.sample(i);
    return { x: p.x, z: p.z, heading: p.heading };
  }
}
export { STEP as TRACK_STEP };
