/* ==========================================================================
   The three environments, defined as data (layout + gameplay). Visual
   building lives in trackBuilder.js; physics uses TrackData directly.
   ========================================================================== */
import { TrackData } from './trackData.js';

/* ------------------------------------------------------------ helpers */
function mulberry(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ 1. MOUNTAIN TOUGE */
function tougePoints() {
  // A Japanese-style switchback descent: long wobbling runs joined by hairpins.
  const pts = [[-260, -6], [-210, -2]];
  const runs = 5, gap = 66, R = gap / 2, half = 150;
  let z = 0, dir = 1;
  for (let r = 0; r < runs; r++) {
    const xs = -dir * half, xe = dir * half;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const x = xs + (xe - xs) * t;
      const wob = 10 * Math.sin(Math.PI * t) * Math.sin(3 * Math.PI * t + r * 1.7);
      if (r > 0 && k === 0) continue; // shares the hairpin's last point
      pts.push([x, z + wob]);
    }
    if (r < runs - 1) {
      for (let k = 1; k < 8; k++) {
        const a = -Math.PI / 2 + (k / 8) * Math.PI;
        pts.push([xe + dir * (R * 1.15) * Math.cos(a), z + R + R * Math.sin(a)]);
      }
      pts.push([xe, z + gap]);
      z += gap; dir = -dir;
    }
  }
  const last = pts[pts.length - 1];
  pts.push([last[0] + dir * 50, last[1] + 2], [last[0] + dir * 110, last[1] + 4]);
  return pts;
}

export function makeTouge() {
  return new TrackData({
    id: 'touge', name: 'Mountain Touge', subtitle: 'Night switchbacks · guardrails · streetlights',
    points: tougePoints(), closed: false, width: 8.5,
    elevation: (s) => 150 - 0.068 * s + 3.5 * Math.sin(s / 75),
    barrierOffset: 0.7, barrierKind: 'guardrail', runoffGrip: 0.7,
    defaultTime: 22.5, laps: 1, maxZones: 8,
    env: 'touge',
  });
}

/* ------------------------------------------------------------ 2. INDUSTRIAL DOCKS */
export function makeDocks() {
  const rng = mulberry(7);
  const obstacles = [];
  const visualStacks = [];
  const CW = 2.44, CL = 12.2, CH = 2.6;
  const addStack = (x, z, rot, levels, collide = true) => {
    const colors = ['#b7412e', '#2f6aa3', '#d5a021', '#3d7d4a', '#8b8f96', '#c9622a', '#21485f', '#7a2a3a'];
    for (let l = 0; l < levels; l++) visualStacks.push({ x, z, rot, y: l * CH, w: CW, l: CL, h: CH, color: colors[Math.floor(rng() * colors.length)] });
    if (collide) obstacles.push({ x, z, w: CW, l: CL, rot, kind: 'container' });
  };
  // infield block (inside the route)
  for (const zz of [-34, -12, 12, 34]) for (let x = -112; x <= 112; x += 16) if (rng() > 0.18) addStack(x, zz, Math.PI / 2, 1 + Math.floor(rng() * 3));
  // outer yard rows
  for (const zz of [-150, -132, 132, 150]) for (let x = -236; x <= 236; x += 15) if (rng() > 0.15) addStack(x, zz, Math.PI / 2, 1 + Math.floor(rng() * 4));
  // scattered stacks in the open east / west aprons
  for (let k = 0; k < 10; k++) {
    const side = k % 2 ? 1 : -1;
    addStack(side * (226 + rng() * 18), -100 + rng() * 200, rng() < 0.5 ? 0 : Math.PI / 2, 1 + Math.floor(rng() * 2));
  }
  // crane legs on the quay edge (south)
  const cranes = [];
  for (const cx of [-160, -40, 80, 200]) {
    cranes.push({ x: cx, z: -172 });
    for (const [lx, lz] of [[-9, -8], [9, -8], [-9, 8], [9, 8]]) obstacles.push({ x: cx + lx, z: -172 + lz, w: 1.4, l: 1.4, rot: 0, kind: 'concrete' });
  }
  const X = 262, Z = 190;
  const walls = [
    { ax: -X, az: -Z, bx: X, bz: -Z }, { ax: X, az: -Z, bx: X, bz: Z },
    { ax: X, az: Z, bx: -X, bz: Z }, { ax: -X, az: Z, bx: -X, bz: -Z },
  ];
  const wetPatches = [];
  for (let k = 0; k < 9; k++) wetPatches.push({ x: -200 + rng() * 400, z: -100 + rng() * 200, r: 7 + rng() * 9 });
  wetPatches.push({ x: 170, z: -88, r: 14 }, { x: -175, z: 88, r: 13 });
  return new TrackData({
    id: 'docks', name: 'Industrial Docks', subtitle: 'Open port · containers · cranes · wet patches',
    points: [[-150, -95], [-40, -100], [60, -96], [165, -92], [196, -40], [190, 30], [165, 90], [80, 98], [30, 72], [-20, 72], [-80, 98], [-165, 92], [-196, 30], [-198, -40]],
    closed: true, width: 16, flat: true, open: true, obstacles, walls, wetPatches,
    defaultTime: 18.0, laps: 2, startS: 30, maxZones: 8,
    env: 'docks', visualStacks, cranes, bounds: { X, Z },
  });
}

/* ------------------------------------------------------------ 3. DRIFT CIRCUIT */
export function makeCircuit() {
  return new TrackData({
    id: 'circuit', name: 'Drift Circuit', subtitle: 'Purpose-built · tyre walls · grandstands',
    points: [[0, -150], [0, -40], [0, 70], [14, 140], [58, 186], [120, 198], [172, 182], [196, 140], [184, 100],
      [150, 72], [140, 32], [166, -6], [212, -28], [240, -80], [226, -142], [182, -184], [120, -204], [56, -212], [16, -196]],
    closed: true, width: 13, flat: true, barrierOffset: 6, barrierKind: 'tire', runoffGrip: 0.93,
    defaultTime: 14.5, laps: 2, startS: 20, maxZones: 8,
    env: 'circuit',
  });
}

export const TRACKS = {
  touge: { make: makeTouge, name: 'Mountain Touge', subtitle: 'Night switchbacks · guardrails · streetlights', defaultTime: 22.5 },
  docks: { make: makeDocks, name: 'Industrial Docks', subtitle: 'Open port · containers · cranes · wet patches', defaultTime: 18.0 },
  circuit: { make: makeCircuit, name: 'Drift Circuit', subtitle: 'Purpose-built · tyre walls · grandstands', defaultTime: 14.5 },
};
export const TRACK_IDS = ['touge', 'docks', 'circuit'];
