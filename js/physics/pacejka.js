/* ==========================================================================
   Pacejka "Magic Formula" tire model
     F = D · sin( C · atan( B·x − E·(B·x − atan(B·x)) ) )
   - Separate longitudinal (slip ratio κ) and lateral (slip angle α) curves.
   - Combined slip via normalised-slip friction ellipse: each slip is
     expressed relative to the slip at which its curve peaks, the resulting
     vector length ρ drives both curves, and the force is split along the
     slip direction. Spinning or locked tyres therefore lose lateral grip
     naturally (the heart of every drift technique).
   - Load sensitivity: μ falls as vertical load rises, so weight transfer
     matters (an overloaded outside tyre gives less than linear grip).
   ========================================================================== */

export function magicFormula(x, B, C, D, E) {
  const bx = B * x;
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/** Numerically find the slip where a curve peaks (done once per tire). */
function findPeak(B, C, E, maxX) {
  let best = 0, bestX = 0.1;
  for (let i = 1; i <= 2000; i++) {
    const x = (i / 2000) * maxX;
    const f = magicFormula(x, B, C, 1, E);
    if (f > best) { best = f; bestX = x; }
  }
  return bestX;
}

export class TireModel {
  /**
   * @param p  { long:{B,C,E}, lat:{B,C,E}, mu, loadSens, fz0 }
   */
  constructor(p) {
    this.p = p;
    this.kPeak = findPeak(p.long.B, p.long.C, p.long.E, 1);
    this.aPeak = findPeak(p.lat.B, p.lat.C, p.lat.E, 1.2);
    this._out = { fx: 0, fy: 0 };
  }

  /** Effective friction coefficient with load sensitivity. */
  mu(fz, scale) {
    const p = this.p;
    const m = p.mu * (1 - p.loadSens * (fz / p.fz0 - 1));
    return Math.max(0.35, m) * scale;
  }

  /**
   * Combined-slip forces.
   * @param kappa  slip ratio  (ωr − vx)/|vx|
   * @param alpha  slip angle in radians (positive = contact patch moving left)
   * @param fz     vertical load (N)
   * @param muLong / muLat  grip multipliers (surface, temperature, wear, setup)
   * @returns {fx, fy} — fx along the wheel's forward axis, fy has the SIGN OF
   *          alpha (caller applies it opposite to the lateral slip).
   */
  forces(kappa, alpha, fz, muLong, muLat) {
    const p = this.p, out = this._out;
    if (fz <= 0) { out.fx = 0; out.fy = 0; return out; }
    const sx = kappa / this.kPeak;
    const sy = alpha / this.aPeak;
    const rho = Math.hypot(sx, sy);
    const Dx = this.mu(fz, muLong) * fz;
    const Dy = this.mu(fz, muLat) * fz;
    if (rho < 1e-6) { out.fx = 0; out.fy = 0; return out; }
    const fxPure = magicFormula(rho * this.kPeak, p.long.B, p.long.C, Dx, p.long.E);
    const fyPure = magicFormula(rho * this.aPeak, p.lat.B, p.lat.C, Dy, p.lat.E);
    out.fx = (sx / rho) * fxPure;
    out.fy = (sy / rho) * fyPure;
    return out;
  }

  /** ∂Fx/∂κ (used for the implicit, unconditionally stable wheel-spin integration). */
  dFxdKappa(kappa, alpha, fz, muLong, muLat) {
    const h = 0.002;
    const a = this.forces(kappa + h, alpha, fz, muLong, muLat).fx;
    const b = this.forces(kappa - h, alpha, fz, muLong, muLat).fx;
    return Math.max(0, (a - b) / (2 * h));
  }
}
