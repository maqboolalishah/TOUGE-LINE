/* ==========================================================================
   Car visuals.
   - buildProceduralCar(): detailed placeholder built from each car's real
     proportions (side-profile extrusion with wheel arches, greenhouse,
     clear-coat paint, lights, spoiler, mirrors, exhausts, interior).
   - loadCar(): tries models/<car>.glb first; falls back to procedural.
   Local frame = physics body frame: origin at the centre of gravity,
   +Z forward, +Y up, +X left.
   ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ------------------------------------------------------------ silhouettes */
// Side-profile parameters (metres, ground frame, z = 0 at wheelbase centre).
const PROFILES = {
  gtr: { ohF: 1.00, ohR: 0.93, nose: 0.60, cowl: 0.88, belt: 0.92, deck: 1.02, tail: 0.80, zCowl: 0.95, zRoofF: 0.22, zRoofR: -0.78, zDeck: -1.42, wing: 'gtr', head: 'boomerang', tailL: 'quad', side: 'RHD' },
  m4: { ohF: 0.93, ohR: 1.02, nose: 0.66, cowl: 0.90, belt: 0.88, deck: 0.96, tail: 0.78, zCowl: 0.66, zRoofF: 0.02, zRoofR: -0.98, zDeck: -1.62, wing: 'lip', head: 'slim', tailL: 'bar', side: 'LHD' },
  supra: { ohF: 1.06, ohR: 0.91, nose: 0.50, cowl: 0.78, belt: 0.79, deck: 0.88, tail: 0.74, zCowl: 0.78, zRoofF: 0.12, zRoofR: -0.62, zDeck: -1.32, wing: 'hoop', head: 'oval', tailL: 'round', side: 'RHD' },
};

function mats(paintColor) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06090d, metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.2, roughness: 0.55 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.5, roughness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 }),
    head: new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xe6efff, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0306, emissive: 0xff1a1a, emissiveIntensity: 0.6, roughness: 0.25 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }),
  };
}

function bodyShape(spec, P, part) {
  const wb = spec.wheelbase, rF = spec.wheel.rF, rR = spec.wheel.rR;
  const zF = wb / 2 + P.ohF, zR = -(wb / 2 + P.ohR), H = spec.dims.height;
  const s = new THREE.Shape();
  if (part === 'lower') {
    const yb = 0.17, arF = rF + 0.07, arR = rR + 0.07;
    s.moveTo(zF - 0.12, yb + 0.03);
    s.lineTo(wb / 2 + arF + 0.02, yb);
    s.lineTo(wb / 2 + arF, rF);
    s.absarc(wb / 2, rF, arF, 0, Math.PI, false);
    s.lineTo(wb / 2 - arF, yb);
    s.lineTo(-wb / 2 + arR + 0.02, yb);
    s.lineTo(-wb / 2 + arR, rR);
    s.absarc(-wb / 2, rR, arR, 0, Math.PI, false);
    s.lineTo(-wb / 2 - arR, yb);
    s.lineTo(zR + 0.18, yb + 0.04);
    s.quadraticCurveTo(zR - 0.02, yb + 0.06, zR, yb + 0.26);
    s.lineTo(zR + 0.02, P.tail);
    s.quadraticCurveTo(zR + 0.06, P.deck, zR + 0.32, P.deck);
    s.lineTo(P.zDeck, P.belt + 0.04);
    s.lineTo(P.zCowl, P.cowl);
    s.quadraticCurveTo(zF - 0.45, P.nose + 0.08, zF - 0.1, P.nose);
    s.quadraticCurveTo(zF + 0.02, P.nose - 0.05, zF, P.nose - 0.22);
    s.quadraticCurveTo(zF + 0.01, yb + 0.06, zF - 0.12, yb + 0.03);
  } else {
    // greenhouse (windows + pillars)
    s.moveTo(P.zCowl - 0.05, P.cowl - 0.02);
    s.quadraticCurveTo(P.zRoofF + 0.25, H - 0.08, P.zRoofF, H);
    s.lineTo(P.zRoofR, H - 0.015);
    s.quadraticCurveTo(P.zDeck + 0.25, H - 0.12, P.zDeck + 0.02, P.belt + 0.06);
    s.lineTo(P.zCowl - 0.05, P.cowl - 0.02);
  }
  return s;
}

function extrudeSide(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 5, curveSegments: 22 });
  g.rotateY(-Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------ wheels */
function makeWheel(r, width, style, m, isLeft) {
  const root = new THREE.Group();   // steer pivot (positioned at hub)
  const spin = new THREE.Group();   // rotates about X
  root.add(spin);
  // tyre: lathe a rounded section, axis → X
  const pts = [];
  const sw = width / 2, rIn = r * 0.68;
  pts.push(new THREE.Vector2(rIn, -sw));
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push(new THREE.Vector2(r - 0.03 + Math.cos(a) * 0.03, Math.sin(a) * sw)); }
  pts.push(new THREE.Vector2(rIn, sw));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), m.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spin.add(tire);
  // rim
  const rimMat = style === 'mesh' ? new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 1, roughness: 0.28 })
    : style === 'dish' ? new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.3 })
      : new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.35 });
  const face = new THREE.Group();
  const rr = r * 0.66;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, width * 0.9, 28, 1, true), rimMat);
  barrel.rotation.z = Math.PI / 2;
  face.add(barrel);
  const lipW = style === 'dish' ? 0.05 : 0.02;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rr, lipW / 2 + 0.008, 8, 32), m.chrome);
  lip.rotation.y = Math.PI / 2; lip.position.x = width * 0.42;
  face.add(lip);
  const spokes = style === 'mesh' ? 14 : style === 'dish' ? 8 : 5;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = rr - 0.06 - (style === 'dish' ? 0.08 : 0);
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, len, style === 'mesh' ? 0.018 : style === 'dish' ? 0.04 : 0.065), rimMat);
    sp.position.set(width * 0.36 - (style === 'dish' ? 0.07 : 0), Math.cos(a) * (len / 2 + 0.05), Math.sin(a) * (len / 2 + 0.05));
    sp.rotation.x = -a;
    if (style === 'mesh') sp.rotation.y = 0.35 * (i % 2 ? 1 : -1);
    face.add(sp);
  }
  if (style === 'dish') { const dish = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 0.82, 0.08, 28, 1, true), rimMat); dish.rotation.z = Math.PI / 2; dish.position.x = width * 0.38; face.add(dish); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12), m.chrome);
  hub.rotation.z = Math.PI / 2; hub.position.x = width * 0.38;
  face.add(hub);
  // brake disc (glows when hot)
  const discMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.45, emissive: 0xff4a0a, emissiveIntensity: 0 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.86, rr * 0.86, 0.028, 32), discMat);
  disc.rotation.z = Math.PI / 2; disc.position.x = -0.02;
  face.add(disc);
  if (!isLeft) face.rotation.y = Math.PI;
  spin.add(face);
  // caliper (does not spin)
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.2), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.4, metalness: 0.3 }));
  cal.position.set(isLeft ? 0.02 : -0.02, rr * 0.55, -rr * 0.45);
  root.add(cal);
  return { root, spin, discMat };
}

/* ------------------------------------------------------------ procedural car */
export function buildProceduralCar(spec, look, opts = {}) {
  const P = PROFILES[spec.id];
  const m = mats(look.paint || spec.look.defaultPaint);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // ground frame → CG frame: ground is at y = -cgHeight, wheelbase centre at z = (a-b)/2
  const b = spec.wheelbase * spec.frontWeight, a = spec.wheelbase - b;
  body.position.set(0, -spec.cgHeight, (a - b) / 2);
  const W = spec.dims.width;

  const lower = new THREE.Mesh(extrudeSide(bodyShape(spec, P, 'lower'), W, 0.14), m.paint);
  lower.castShadow = true; lower.receiveShadow = true;
  body.add(lower);
  const gh = new THREE.Mesh(extrudeSide(bodyShape(spec, P, 'upper'), W * 0.8, 0.1), m.glass);
  gh.castShadow = true;
  body.add(gh);
  // painted roof panel over the glass
  const roofShape = new THREE.Shape();
  const H = spec.dims.height;
  roofShape.moveTo(P.zRoofF - 0.05, H - 0.035); roofShape.lineTo(P.zRoofR + 0.1, H - 0.05); roofShape.lineTo(P.zRoofR + 0.1, H + 0.012); roofShape.lineTo(P.zRoofF - 0.05, H + 0.008);
  const roof = new THREE.Mesh(extrudeSide(roofShape, W * 0.76, 0.03), m.paint);
  body.add(roof);
  // inner wheel-arch liners
  const zF = spec.wheelbase / 2 + P.ohF, zR = -(spec.wheelbase / 2 + P.ohR);
  for (const [z, r] of [[spec.wheelbase / 2, spec.wheel.rF], [-spec.wheelbase / 2, spec.wheel.rR]]) {
    const liner = new THREE.Mesh(new THREE.BoxGeometry(W - 0.62, r * 1.6, r * 2.1), m.trim);
    liner.position.set(0, r + 0.05, z);
    body.add(liner);
  }
  // underside
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.15, 0.06, zF - zR - 0.3), m.trim);
  floor.position.set(0, 0.2, (zF + zR) / 2);
  body.add(floor);

  // front fascia: grille + splitter
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * (spec.id === 'm4' ? 0.28 : 0.5), 0.16, 0.06), m.trim);
  grille.position.set(0, P.nose - 0.32, zF - 0.06);
  body.add(grille);
  if (spec.id === 'm4') for (const sx of [0.17, -0.17]) { const k = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.05), m.trim); k.position.set(sx, P.nose - 0.22, zF - 0.05); body.add(k); }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.03, 0.18), m.carbon);
  splitter.position.set(0, 0.2, zF - 0.1);
  body.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.1, 0.22), m.carbon);
  diffuser.position.set(0, 0.24, zR + 0.12);
  body.add(diffuser);
  for (const sx of [1, -1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, spec.wheelbase - 0.9), m.carbon);
    skirt.position.set(sx * (W / 2 - 0.01), 0.2, 0);
    body.add(skirt);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.12), m.paint);
    mirror.position.set(sx * (W * 0.41 + 0.1), P.belt + 0.08, P.zCowl - 0.2);
    body.add(mirror);
    const mglass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.01), m.glass);
    mglass.position.set(sx * (W * 0.41 + 0.1), P.belt + 0.08, P.zCowl - 0.265);
    body.add(mglass);
  }

  // headlights
  const headMat = m.head;
  const heads = [];
  for (const sx of [1, -1]) {
    let g;
    if (P.head === 'oval') g = new THREE.SphereGeometry(0.17, 18, 10);
    else if (P.head === 'boomerang') g = new THREE.BoxGeometry(0.42, 0.1, 0.12);
    else g = new THREE.BoxGeometry(0.38, 0.07, 0.1);
    const h = new THREE.Mesh(g, headMat);
    if (P.head === 'oval') h.scale.set(1.35, 0.42, 0.45);
    h.position.set(sx * (W / 2 - 0.3), P.nose - 0.02, zF - 0.2);
    h.rotation.y = sx * 0.25; h.rotation.x = -0.15;
    body.add(h);
    heads.push(h);
  }
  // taillights
  const tailMat = m.tail;
  for (const sx of [1, -1]) {
    if (P.tailL === 'quad') for (const o of [0.17, 0.42]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20), tailMat); t.rotation.x = Math.PI / 2; t.position.set(sx * (W / 2 - o - 0.04), P.tail + 0.02, zR - 0.005); body.add(t); }
    else if (P.tailL === 'round') { const t = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 24), tailMat); t.position.set(sx * (W / 2 - 0.28), P.tail - 0.02, zR - 0.005); body.add(t); }
    else { const t = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 0.05), tailMat); t.position.set(sx * (W / 2 - 0.3), P.tail + 0.04, zR + 0.01); body.add(t); }
  }
  // spoilers
  if (P.wing === 'gtr') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.025, 0.26), m.paint);
    blade.position.set(0, P.deck + 0.14, zR + 0.32); blade.rotation.x = 0.08; body.add(blade);
    for (const sx of [0.42, -0.42]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.1), m.carbon); post.position.set(sx, P.deck + 0.07, zR + 0.34); body.add(post); }
  } else if (P.wing === 'hoop') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.03, 0.24), m.paint);
    blade.position.set(0, P.deck + 0.3, zR + 0.36); blade.rotation.x = 0.06; body.add(blade);
    for (const sx of [1, -1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.2), m.paint);
      up.position.set(sx * W * 0.4, P.deck + 0.14, zR + 0.4); up.rotation.x = -0.25; body.add(up);
    }
  } else {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.03, 0.12), m.carbon);
    lip.position.set(0, P.deck + 0.02, zR + 0.28); lip.rotation.x = -0.2; body.add(lip);
  }

  // exhaust tips (in CG frame directly)
  const exhaust = [];
  for (const [x, y, z] of spec.look.exhaust) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.16, 16, 1, true), m.chrome);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(x, y, z);
    root.add(tip);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), m.trim);
    hole.position.set(x, y, z - 0.07); hole.rotation.y = Math.PI;
    root.add(hole);
    exhaust.push(new THREE.Vector3(x, y, z - 0.09));
  }

  // interior (visible in the cockpit camera)
  const interior = new THREE.Group();
  const dSide = P.side === 'RHD' ? -1 : 1;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.18, 0.45), m.interior);
  dash.position.set(0, P.belt + 0.02, P.zCowl - 0.42);
  interior.add(dash);
  const seatX = dSide * 0.37;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), m.interior);
  seat.position.set(seatX, P.belt - 0.05, P.zRoofR + 0.25); seat.rotation.x = -0.25;
  interior.add(seat);
  const wheelG = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 32), m.interior);
  wheelG.add(rim);
  for (const ang of [0, Math.PI * 0.75, -Math.PI * 0.75]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.17, 0.02), m.carbon); sp.position.set(Math.sin(ang) * 0.085, Math.cos(ang) * -0.085, 0); sp.rotation.z = ang; wheelG.add(sp); }
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.025), new THREE.MeshStandardMaterial({ color: 0xff3b2f }));
  mark.position.set(0, 0.18, 0); wheelG.add(mark);
  wheelG.position.set(seatX, P.belt + 0.12, P.zCowl - 0.68);
  wheelG.rotation.x = -0.35;
  interior.add(wheelG);
  // gauge glow
  const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.08), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  gauge.position.set(seatX, P.belt + 0.115, P.zCowl - 0.6); gauge.rotation.x = -0.6; gauge.rotation.y = Math.PI;
  interior.add(gauge);
  interior.visible = false;
  body.add(interior);

  // wheels
  const wheels = [];
  const ids = ['fl', 'fr', 'rl', 'rr'];
  for (let i = 0; i < 4; i++) {
    const front = i < 2, left = i % 2 === 0;
    const r = front ? spec.wheel.rF : spec.wheel.rR, w = front ? spec.wheel.widthF : spec.wheel.widthR;
    const wh = makeWheel(r, w, look.wheelStyle || 'fivespoke', m, left);
    wh.id = ids[i];
    root.add(wh.root);
    wheels.push(wh);
  }

  // headlight beams
  const beams = [];
  for (const sx of [1, -1]) {
    const sl = new THREE.SpotLight(0xfff1dc, 0, 140, 0.42, 0.55, 1.4);
    sl.position.set(sx * (W / 2 - 0.3), P.nose - 0.02 - spec.cgHeight, zF - 0.2 + (a - b) / 2);
    sl.target.position.set(sx * 1.5, -spec.cgHeight - 0.5, 30);
    root.add(sl, sl.target);
    beams.push(sl);
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow || o.geometry.boundingSphere?.radius > 0.2; } });

  if (opts.ghost) {
    const gm = new THREE.MeshBasicMaterial({ color: 0x47e0ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    root.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
    beams.forEach((b2) => b2.removeFromParent());
    return { root, wheels, paint: gm, headMat: gm, tailMat: gm, interior, exhaust, beams: [], steeringWheel: wheelG, ghost: true };
  }
  return { root, wheels, paint: m.paint, headMat, tailMat, interior, exhaust, beams, steeringWheel: wheelG, heads };
}

/* ------------------------------------------------------------ GLB loader */
const loader = new GLTFLoader();
/**
 * Load models/<file>.glb if present. The model is scaled to the car's real
 * length, centred on the wheelbase, sat on the ground, and its wheels (found
 * by node name) are re-parented onto the physics wheel pivots.
 */
export async function loadCar(spec, look) {
  const proc = buildProceduralCar(spec, look);
  let gltf;
  try {
    const head = await fetch(spec.model.file, { method: 'HEAD' });
    if (!head.ok) return proc;
    gltf = await loader.loadAsync(spec.model.file);
  } catch (_) { return proc; }
  const model = gltf.scene;
  model.rotation.y = spec.model.rotationY || 0;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = spec.dims.length / Math.max(size.z, size.x);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  const b = spec.wheelbase * spec.frontWeight, a = spec.wheelbase - b;
  model.position.x -= c.x;
  model.position.z -= c.z - (a - b) / 2;
  model.position.y -= box.min.y + spec.cgHeight;
  // optional manual fine-tuning from carSpecs.js → model.scale / model.offset [x, y, z]
  if (spec.model.scale) model.scale.multiplyScalar(spec.model.scale);
  if (spec.model.offset) model.position.add(new THREE.Vector3(...spec.model.offset));
  // paint + shadows
  const paintNames = spec.model.paintMaterials.map((n) => n.toLowerCase());
  let paint = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mn = (o.material && o.material.name || '').toLowerCase();
    if (paintNames.some((n) => mn.includes(n))) {
      if (!paint) paint = new THREE.MeshPhysicalMaterial({ color: look.paint, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.035 });
      o.material = paint;
    }
  });
  // wheels by name → re-centre on our pivots
  const found = {};
  for (const id of ['fl', 'fr', 'rl', 'rr']) {
    const want = spec.model.wheelNames[id].toLowerCase();
    model.traverse((o) => { if (!found[id] && o.name && o.name.toLowerCase().includes(want)) found[id] = o; });
  }
  const root = new THREE.Group();
  root.add(model);
  const allWheels = Object.keys(found).length === 4;
  if (allWheels) {
    proc.wheels.forEach((w) => { w.spin.clear(); });
    for (const w of proc.wheels) {
      const node = found[w.id];
      node.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(node);
      const wc = wb.getCenter(new THREE.Vector3());
      w.spin.attach(node);                // keeps world transform
      node.position.sub(w.spin.worldToLocal(wc.clone()));
      root.add(w.root);
    }
  } else {
    console.info(`[APEX] ${spec.model.file}: wheel nodes not all found (${JSON.stringify(spec.model.wheelNames)}), using procedural wheels.`);
    proc.wheels.forEach((w) => root.add(w.root));
  }
  proc.beams.forEach((bm) => root.add(bm, bm.target));
  proc.exhaust.forEach(() => {});
  return { ...proc, root, paint: paint || proc.paint, interior: proc.interior, fromModel: true };
}

/** Per-frame visual update from the physics vehicle. */
export function updateCarVisual(vis, veh, dt, lightsOn) {
  vis.root.position.set(veh.p.x, veh.p.y, veh.p.z);
  vis.root.quaternion.set(veh.q.x, veh.q.y, veh.q.z, veh.q.w);
  for (let i = 0; i < 4; i++) {
    const w = veh.wheels[i], v = vis.wheels[i];
    v.root.position.set(w.mount.x, w.mount.y - w.length, w.mount.z);
    v.root.rotation.y = w.steer;
    v.spin.rotation.x = w.spin;
    if (v.discMat) v.discMat.emissiveIntensity = Math.max(0, Math.min(3, (w.brakeTemp - 260) / 160));
  }
  const braking = veh.brakeIn > 0.05 || veh.handbrakeIn > 0.5;
  if (vis.tailMat && !vis.ghost) vis.tailMat.emissiveIntensity = braking ? 4.5 : lightsOn ? 1.1 : 0.4;
  if (vis.headMat && !vis.ghost) vis.headMat.emissiveIntensity = lightsOn ? 6 : 0.35;
  for (const b of vis.beams) b.intensity = lightsOn ? 140 : 0;
  if (vis.steeringWheel) vis.steeringWheel.rotation.z = -veh.delta * 12;
}
