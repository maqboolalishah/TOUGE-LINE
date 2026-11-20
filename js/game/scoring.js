/* ==========================================================================
   Drift scoring + competition-style zone judging.
   ========================================================================== */

/** Points for angle × speed × duration, with a chaining combo multiplier. */
export class DriftScorer {
  constructor() { this.reset(); }
  reset() {
    this.total = 0; this.current = 0; this.multiplier = 1; this.drifting = false;
    this.grace = 99; this.dir = 0; this.dirTime = 0; this.holdTime = 0; this.driftTime = 0;
    this.angleSum = 0; this.speedSum = 0; this.crashes = 0; this.bestDrift = 0; this.maxAngle = 0;
    this.events = [];
  }

  /**
   * @param s { kmh, angle (deg, signed), offroad, crash (bool) }
   * @returns events [{type, ...}]
   */
  update(dt, s) {
    const ev = (this.events = []);
    const a = Math.abs(s.angle);
    const active = a >= 12 && s.kmh >= 25 && !s.offroad && a < 110;
    if (s.crash && (this.drifting || this.current > 0)) {
      ev.push({ type: 'crash', lost: Math.round(this.current * this.multiplier) });
      this.current = 0; this.multiplier = 1; this.crashes++; this.drifting = false; this.grace = 99;
      return ev;
    }
    if (active) {
      if (!this.drifting) {
        // chained drift? keep (and grow) the multiplier
        if (this.grace < 2.6 && this.current === 0 && this.multiplier > 1) ev.push({ type: 'chain', mult: this.multiplier });
        this.drifting = true; this.holdTime = 0;
      }
      this.grace = 0;
      const angleF = Math.min(1.6, (a - 10) / 30);
      const speedF = Math.min(3, s.kmh / 40);
      this.current += angleF * speedF * 60 * dt;
      this.driftTime += dt; this.holdTime += dt;
      this.angleSum += a * dt; this.speedSum += s.kmh * dt;
      this.maxAngle = Math.max(this.maxAngle, a);
      const d = Math.sign(s.angle);
      if (d !== this.dir) {
        if (this.dir !== 0 && this.dirTime > 0.45) { this.multiplier = Math.min(5, this.multiplier + 0.5); ev.push({ type: 'transition', mult: this.multiplier }); }
        this.dir = d; this.dirTime = 0;
      }
      this.dirTime += dt;
      if (this.holdTime > 3) { this.holdTime = 0; this.multiplier = Math.min(5, this.multiplier + 0.25); ev.push({ type: 'combo', mult: this.multiplier }); }
    } else {
      this.grace += dt;
      if (this.drifting && this.grace > 1.4) {
        this.drifting = false;
        const banked = Math.round(this.current * this.multiplier);
        if (banked > 0) { this.total += banked; this.bestDrift = Math.max(this.bestDrift, banked); ev.push({ type: 'banked', points: banked, mult: this.multiplier }); }
        this.current = 0; this.dir = 0;
      }
      if (!this.drifting && this.grace > 2.6 && this.multiplier > 1) { this.multiplier = 1; ev.push({ type: 'chainEnd' }); }
    }
    return ev;
  }

  /** Bank whatever is pending (end of run). */
  flush() { if (this.current > 0) { this.total += Math.round(this.current * this.multiplier); this.current = 0; } }
  get live() { return this.total + Math.round(this.current * this.multiplier); }
}

/** Judges clip points and outer zones like a drift competition. */
export class ZoneJudge {
  constructor(track) {
    this.track = track;
    this.results = new Map();
    this.active = new Map();
    this.near = {};
    this.events = [];
  }
  reset() { this.results.clear(); this.active.clear(); }

  update(dt, veh, sNow, driftAngle) {
    const ev = (this.events = []);
    const tr = this.track, spec = veh.spec, R = veh.R;
    const hw = spec.dims.width / 2, hl = spec.dims.length / 2;
    const corner = (lx, lz) => ({ x: veh.p.x + R[0] * lx + R[2] * lz, z: veh.p.z + R[6] * lx + R[8] * lz });
    for (const z of tr.zones) {
      const inside = sNow >= z.s0 && sNow <= z.s1;
      let st = this.active.get(z.id);
      if (inside) {
        if (!st) { st = { best: 0, angle: 0, t: 0, over: false }; this.active.set(z.id, st); ev.push({ type: 'zoneEnter', zone: z }); }
        // the relevant car corner: front bumper for clips, rear bumper for outer zones
        const lz = z.type === 'clip' ? hl : -hl;
        let lat = -Infinity;
        for (const lx of [hw, -hw]) {
          const c = corner(lx, lz);
          const n = tr.nearest(c.x, c.z, this.near);
          lat = Math.max(lat, n.lat * z.side);
        }
        const dist = tr.width / 2 - lat;                 // metres from the zone line
        if (dist < -0.6) st.over = true;                  // put a wheel past the line
        if (Math.abs(driftAngle) >= 15 && dist <= z.target && dist > -0.6) {
          const qual = Math.max(0, Math.min(1, 1 - dist / z.target));
          if (qual > st.best) st.best = qual;
        }
        st.angle += Math.abs(driftAngle) * dt; st.t += dt;
      } else if (st) {
        // left the zone: grade it
        this.active.delete(z.id);
        const q = st.over ? st.best * 0.5 : st.best;
        const grade = q >= 0.8 ? 'PERFECT' : q >= 0.5 ? 'GREAT' : q > 0.05 ? 'GOOD' : 'MISS';
        const res = { zone: z, quality: q, grade, angle: st.t ? st.angle / st.t : 0 };
        this.results.set(z.id, res);
        ev.push({ type: 'zone', ...res });
      }
    }
    return ev;
  }

  /** Competition-style breakdown (0-100). */
  verdict(scorer, runTime) {
    const zones = this.track.zones;
    let line = 0;
    for (const z of zones) { const r = this.results.get(z.id); line += r ? r.quality : 0; }
    line = zones.length ? (line / zones.length) * 100 : 0;
    const avgAngle = scorer.driftTime ? scorer.angleSum / scorer.driftTime : 0;
    const angle = Math.min(1, avgAngle / 45) * 100;
    const avgSpeed = scorer.driftTime ? scorer.speedSum / scorer.driftTime : 0;
    const commitment = runTime ? Math.min(1, scorer.driftTime / (runTime * 0.7)) : 0;
    const style = Math.max(0, Math.min(1, avgSpeed / 75) * (0.4 + 0.6 * commitment) * (1 - Math.min(0.8, scorer.crashes * 0.2))) * 100;
    const total = line * 0.4 + angle * 0.3 + style * 0.3;
    return { line: Math.round(line), angle: Math.round(angle), style: Math.round(style), total: Math.round(total * 10) / 10, avgAngle: Math.round(avgAngle), avgSpeed: Math.round(avgSpeed) };
  }
}
