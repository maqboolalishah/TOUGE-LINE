/* ==========================================================================
   Car definitions. Physics units: metres, kilograms, newtons, N·m, seconds.
   Each car has its own mass / distribution, engine curve, turbo behaviour,
   gearing, diff, steering, tyres and engine-sound character.
   ========================================================================== */

/** Shared tyre baseline (semi-slick street tyre). Cars scale it slightly. */
const TIRE = {
  long: { B: 11.5, C: 1.55, E: 0.1 },
  lat: { B: 11.0, C: 1.33, E: -0.45 },
  mu: 1.08, loadSens: 0.11, fz0: 4200,
};
const tire = (mu, latB) => ({ ...TIRE, mu, lat: { ...TIRE.lat, B: latB } });

export const CARS = {
  /* ------------------------------------------------------------------ GT-R */
  gtr: {
    id: 'gtr', name: 'Nissan GT-R', chassis: 'R35', tagline: 'AWD · twin-turbo V6 · drift-mode rear bias',
    layout: 'AWD',
    mass: 1752, frontWeight: 0.54, cgHeight: 0.50,
    wheelbase: 2.78, trackF: 1.59, trackR: 1.60,
    dims: { length: 4.71, width: 1.895, height: 1.37 },
    wheel: { rF: 0.352, rR: 0.360, widthF: 0.255, widthR: 0.285, inertia: 1.55 },
    tire: tire(1.10, 11.0),
    susp: { restLength: 0.30, travel: 0.17, springF: 82000, springR: 74000, bump: 5200, rebound: 7600, arbF: 26000, arbR: 18000 },
    steering: { lock: 38, maxLock: 52, ackermann: 0.55, rate: 6.5 },
    brakes: { torque: 3600, bias: 0.62, handbrake: 3400 },
    engine: {
      idle: 900, redline: 7100, limiter: 7100, inertia: 0.24,
      // full-boost torque curve (rpm, N·m)
      torque: [[800, 330], [2000, 470], [3000, 610], [3300, 633], [5800, 633], [6500, 590], [7100, 520], [7500, 420]],
      offBoost: 0.52,
      turbo: { spoolStart: 2100, spoolFull: 3400, spoolRate: 3.8, bov: 0.8 },
      friction: [28, 0.045],
      cylinders: 6,
    },
    gearbox: { ratios: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], reverse: 3.383, final: 3.70, shiftTime: 0.12 },
    clutchTorque: 1150,
    diff: { preload: 120, powerLock: 0.35, coastLock: 0.2, awdRearSplit: 0.78, frontLock: 0.0 },
    aero: { cdA: 0.70, clA: 0.32 },
    sound: { kind: 'v6', res: 175, tau: 0.0042, noise: 0.42, harm2: 0.25, rough: 0.12, turboVol: 0.65, turboPitch: 1.0, bovVol: 0.6, pops: 0.6 },
    look: { defaultPaint: '#c7cbd1', exhaust: [[0.38, -0.33, -2.33], [-0.38, -0.33, -2.33], [0.52, -0.33, -2.31], [-0.52, -0.33, -2.31]] },
    model: { file: 'models/gtr.glb', wheelNames: { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }, paintMaterials: ['paint', 'body', 'carpaint'], rotationY: 0 },
  },

  /* ------------------------------------------------------------------ M4 */
  m4: {
    id: 'm4', name: 'BMW M4', chassis: 'G82', tagline: 'RWD · inline-6 turbo · sharp and balanced',
    layout: 'RWD',
    mass: 1725, frontWeight: 0.525, cgHeight: 0.48,
    wheelbase: 2.857, trackF: 1.617, trackR: 1.605,
    dims: { length: 4.80, width: 1.887, height: 1.39 },
    wheel: { rF: 0.338, rR: 0.348, widthF: 0.275, widthR: 0.285, inertia: 1.4 },
    tire: tire(1.08, 11.4),
    susp: { restLength: 0.30, travel: 0.16, springF: 76000, springR: 72000, bump: 4800, rebound: 7000, arbF: 24000, arbR: 15000 },
    steering: { lock: 44, maxLock: 58, ackermann: 0.45, rate: 7 },
    brakes: { torque: 3400, bias: 0.60, handbrake: 3200 },
    engine: {
      idle: 850, redline: 7200, limiter: 7300, inertia: 0.20,
      torque: [[800, 300], [1800, 480], [2750, 650], [5500, 650], [6250, 600], [7000, 520], [7300, 480], [7600, 380]],
      offBoost: 0.56,
      turbo: { spoolStart: 1800, spoolFull: 2900, spoolRate: 4.5, bov: 0.5 },
      friction: [24, 0.04],
      cylinders: 6,
    },
    gearbox: { ratios: [4.110, 2.315, 1.542, 1.179, 1.000, 0.846], reverse: 3.727, final: 3.46, shiftTime: 0.11 },
    clutchTorque: 1100,
    diff: { preload: 150, powerLock: 0.55, coastLock: 0.35 },
    aero: { cdA: 0.68, clA: 0.18 },
    sound: { kind: 'i6', res: 245, tau: 0.0032, noise: 0.28, harm2: 0.55, rough: 0.05, turboVol: 0.4, turboPitch: 1.25, bovVol: 0.3, pops: 0.9 },
    look: { defaultPaint: '#1f6fd6', exhaust: [[0.42, -0.34, -2.40], [0.30, -0.34, -2.41], [-0.30, -0.34, -2.41], [-0.42, -0.34, -2.40]] },
    model: { file: 'models/bmw.glb', wheelNames: { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }, paintMaterials: ['paint', 'body', 'carpaint'], rotationY: 0 },
  },

  /* ------------------------------------------------------------------ SUPRA */
  supra: {
    id: 'supra', name: 'Toyota Supra', chassis: 'A80 MK4', tagline: 'RWD · 2JZ big single turbo · the drift king',
    layout: 'RWD',
    mass: 1560, frontWeight: 0.53, cgHeight: 0.46,
    wheelbase: 2.55, trackF: 1.52, trackR: 1.525,
    dims: { length: 4.52, width: 1.81, height: 1.275 },
    wheel: { rF: 0.322, rR: 0.330, widthF: 0.235, widthR: 0.265, inertia: 1.2 },
    tire: tire(1.04, 11.0),
    susp: { restLength: 0.29, travel: 0.17, springF: 70000, springR: 64000, bump: 4300, rebound: 6400, arbF: 22000, arbR: 12000 },
    steering: { lock: 52, maxLock: 64, ackermann: 0.25, rate: 7.5 },
    brakes: { torque: 3000, bias: 0.62, handbrake: 3000 },
    engine: {
      idle: 850, redline: 7500, limiter: 7600, inertia: 0.17,
      // big single-turbo 2JZ: lazy off boost, then a huge surge
      torque: [[800, 290], [2500, 360], [3800, 450], [4800, 640], [5500, 690], [6500, 650], [7200, 590], [7700, 470]],
      offBoost: 0.44,
      turbo: { spoolStart: 3700, spoolFull: 5100, spoolRate: 1.9, bov: 1.0 },
      friction: [22, 0.038],
      cylinders: 6,
    },
    gearbox: { ratios: [3.827, 2.360, 1.685, 1.312, 1.000, 0.793], reverse: 3.280, final: 3.58, shiftTime: 0.13 },
    clutchTorque: 1250,
    diff: { preload: 200, powerLock: 0.7, coastLock: 0.45 },
    aero: { cdA: 0.64, clA: 0.26 },
    sound: { kind: '2jz', res: 132, tau: 0.0058, noise: 0.22, harm2: 0.35, rough: 0.07, turboVol: 1.0, turboPitch: 0.8, bovVol: 1.0, pops: 1.0 },
    look: { defaultPaint: '#d9241f', exhaust: [[-0.45, -0.32, -2.30]] },
    model: { file: 'models/supra.glb', wheelNames: { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }, paintMaterials: ['paint', 'body', 'carpaint'], rotationY: 0 },
  },
};
export const CAR_IDS = ['gtr', 'm4', 'supra'];

/* ==========================================================================
   Tuning: what the garage sliders control, with plain-language help.
   ========================================================================== */
export const TUNING_FIELDS = [
  { key: 'steerLock', label: 'Steering angle', unit: '°', min: 30, max: 64, step: 1,
    help: 'Maximum front-wheel lock. More angle lets you hold deeper drifts and catch big slides, but the car feels twitchier at speed.' },
  { key: 'camberF', label: 'Front camber', unit: '°', min: -6, max: 0, step: 0.1,
    help: 'Negative camber tilts the top of the tyre inward. Around −3° to −4° gives more front bite at big steering angles, at the cost of braking grip.' },
  { key: 'camberR', label: 'Rear camber', unit: '°', min: -4, max: 0, step: 0.1,
    help: 'Less rear camber (closer to 0°) reduces rear grip, so the car breaks into a drift more easily. More camber adds grip but makes it harder to slide.' },
  { key: 'pressureF', label: 'Front tyre pressure', unit: ' bar', min: 1.4, max: 3.0, step: 0.05,
    help: 'Lower pressure gives a bigger, grippier contact patch but slower response. Higher pressure is sharper but less grippy.' },
  { key: 'pressureR', label: 'Rear tyre pressure', unit: ' bar', min: 1.4, max: 3.4, step: 0.05,
    help: 'Drifters often run high rear pressure: less rear grip means easier, smoother, smokier slides.' },
  { key: 'springF', label: 'Front stiffness', unit: '×', min: 0.6, max: 1.6, step: 0.05,
    help: 'Front spring and anti-roll stiffness. Stiffer front = more front weight transfer = more understeer, but quicker turn-in reactions.' },
  { key: 'springR', label: 'Rear stiffness', unit: '×', min: 0.6, max: 1.6, step: 0.05,
    help: 'Stiffer rear makes the rear step out more readily. Softer rear puts power down better.' },
  { key: 'diffLock', label: 'Diff lock', unit: '%', min: 0, max: 100, step: 5,
    help: 'How strongly the limited-slip diff ties the rear wheels together. High lock (≈ welded) keeps both tyres spinning for consistent, controllable drifts.' },
  { key: 'finalDrive', label: 'Final drive', unit: ':1', min: 2.8, max: 4.8, step: 0.02,
    help: 'Overall gearing. Shorter (higher number) gives punchier acceleration and keeps you in the power band mid-drift, but runs out of top speed.' },
  { key: 'gearSpread', label: 'Gear spacing', unit: '×', min: 0.8, max: 1.2, step: 0.01,
    help: 'Squeezes or stretches the gaps between gears. Closer gears keep the turbo on boost between shifts.' },
  { key: 'brakeBias', label: 'Brake bias (front)', unit: '%', min: 45, max: 75, step: 1,
    help: 'Share of braking on the front axle. More rear bias helps weight-transfer and braking-drift entries, but can spin the car.' },
  { key: 'boost', label: 'Turbo boost', unit: '×', min: 0.6, max: 1.25, step: 0.01,
    help: 'Boost pressure multiplier. More boost = more power, more wheelspin and more surge when the turbo comes on.' },
  { key: 'awdSplit', label: 'AWD rear bias', unit: '%', min: 50, max: 100, step: 1, only: 'AWD',
    help: 'GT-R only. Share of drive sent to the rear axle. 100% turns it into a RWD car; ~75–85% is a classic "drift mode".' },
];

export function defaultTuning(spec) {
  return {
    steerLock: spec.steering.lock,
    camberF: -3.0, camberR: -1.2,
    pressureF: 2.2, pressureR: 2.5,
    springF: 1, springR: 1,
    diffLock: Math.round(spec.diff.powerLock * 100),
    finalDrive: spec.gearbox.final,
    gearSpread: 1,
    brakeBias: Math.round(spec.brakes.bias * 100),
    boost: 1,
    awdSplit: spec.layout === 'AWD' ? Math.round(spec.diff.awdRearSplit * 100) : 100,
  };
}
