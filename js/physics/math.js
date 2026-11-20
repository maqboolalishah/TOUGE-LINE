/* ==========================================================================
   Minimal allocation-light vector / quaternion helpers for the physics.
   Kept independent of Three.js so the simulation can run (and be tested)
   in plain Node.  Convention: +Y up, car forward = +Z, car left = +X.
   ========================================================================== */

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const set = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };
export const copy = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (o, a, b) => { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; };
export const sub = (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; };
export const scale = (o, a, s) => { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; };
export const addScaled = (o, a, b, s) => { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o; };
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export function cross(o, a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
}
export function normalize(o, a) {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
export const moveTowards = (cur, target, maxDelta) => (Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta);

/* ---------------------------------------------------------------- quaternions */
export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
export function quatFromYaw(q, yaw) { q.x = 0; q.y = Math.sin(yaw / 2); q.z = 0; q.w = Math.cos(yaw / 2); return q; }
export function quatNormalize(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l; q.y /= l; q.z /= l; q.w /= l; return q;
}
/** q += 0.5 * (w ⊗ q) * dt   (w = world angular velocity) */
export function quatIntegrate(q, w, dt) {
  const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
  const x = q.x, y = q.y, z = q.z, qw = q.w;
  q.x += hx * qw + hy * z - hz * y;
  q.y += hy * qw + hz * x - hx * z;
  q.z += hz * qw + hx * y - hy * x;
  q.w += -hx * x - hy * y - hz * z;
  return quatNormalize(q);
}
/** 3x3 rotation matrix, row-major m[0..8] */
export function quatToMat3(q, m) {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}
/** world = R * local */
export function toWorld(o, m, v) {
  const x = m[0] * v.x + m[1] * v.y + m[2] * v.z;
  const y = m[3] * v.x + m[4] * v.y + m[5] * v.z;
  const z = m[6] * v.x + m[7] * v.y + m[8] * v.z;
  o.x = x; o.y = y; o.z = z; return o;
}
/** local = Rᵀ * world */
export function toLocal(o, m, v) {
  const x = m[0] * v.x + m[3] * v.y + m[6] * v.z;
  const y = m[1] * v.x + m[4] * v.y + m[7] * v.z;
  const z = m[2] * v.x + m[5] * v.y + m[8] * v.z;
  o.x = x; o.y = y; o.z = z; return o;
}
/** Catmull-Rom (uniform) interpolation helper */
export function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
