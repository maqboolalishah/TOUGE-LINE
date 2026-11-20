/* ==========================================================================
   Track visuals built procedurally from TrackData: PBR textures generated on
   canvas (asphalt + normal map + markings, concrete, grass, containers),
   road ribbons, terrain, trees, guardrails, tyre walls, kerbs, grandstands,
   cranes, water, street / flood lights (with a pool of real point lights),
   zone markers and start / finish gantries.
   ========================================================================== */
import * as THREE from 'three';
import { TRACK_STEP } from './trackData.js';

/* ------------------------------------------------------------ textures */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function noiseFill(g, w, h, base, spread, dots, dotSize) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < dots; i++) {
    const v = Math.floor(spread[0] + Math.random() * (spread[1] - spread[0]));
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.5})`;
    const s = Math.random() * dotSize + 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}
/** Normal map from a canvas' luminance (Sobel). */
function normalFrom(src, strength) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), og = out.getContext('2d'), od = og.createImageData(w, h);
  const L = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength, dy = (L(x, y + 1) - L(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    od.data[i] = (-dx / l * 0.5 + 0.5) * 255; od.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; od.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
  }
  og.putImageData(od, 0, 0);
  return out;
}
function tex(c, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texCache = {};
function asphaltSet(markings) {
  const key = 'asphalt' + markings;
  if (texCache[key]) return texCache[key];
  const W = 512, H = 1024;
  const height = canvas(W, H), hg = height.getContext('2d');
  noiseFill(hg, W, H, '#8a8a8a', [40, 215], 90000, 2.2);
  // a few cracks / patches
  for (let i = 0; i < 14; i++) { hg.strokeStyle = 'rgba(40,40,40,0.5)'; hg.lineWidth = 1 + Math.random() * 1.5; hg.beginPath(); let x = Math.random() * W, y = Math.random() * H; hg.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; hg.lineTo(x, y); } hg.stroke(); }
  const col = canvas(W, H), cg = col.getContext('2d');
  cg.drawImage(height, 0, 0);
  cg.globalCompositeOperation = 'multiply'; cg.fillStyle = '#a2a3a8'; cg.fillRect(0, 0, W, H);
  cg.globalCompositeOperation = 'source-over';
  // tyre-polished racing line and dark oil drips
  for (let i = 0; i < 40; i++) { cg.fillStyle = 'rgba(10,10,12,0.08)'; cg.beginPath(); cg.ellipse(W * (0.3 + Math.random() * 0.4), Math.random() * H, 8 + Math.random() * 20, 20 + Math.random() * 60, 0, 0, Math.PI * 2); cg.fill(); }
  const paint = (x0, x1, y0, y1, c) => { cg.fillStyle = c; cg.fillRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); hg.fillStyle = '#9a9a9a'; hg.fillRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); };
  if (markings === 'touge') {
    paint(0.035, 0.055, 0, 1, '#d8d8d2'); paint(0.945, 0.965, 0, 1, '#d8d8d2');
    paint(0.488, 0.497, 0, 1, '#d8a52a'); paint(0.503, 0.512, 0, 1, '#d8a52a');
  } else if (markings === 'circuit') {
    paint(0.02, 0.045, 0, 1, '#e8e8e2'); paint(0.955, 0.98, 0, 1, '#e8e8e2');
  }
  const rough = canvas(W, H), rg = rough.getContext('2d');
  rg.drawImage(height, 0, 0);
  rg.globalCompositeOperation = 'source-over'; rg.fillStyle = 'rgba(210,210,210,0.55)'; rg.fillRect(0, 0, W, H);
  const set = { map: tex(col), normalMap: tex(normalFrom(height, 2.2), 1, 1, false), roughnessMap: tex(rough, 1, 1, false) };
  texCache[key] = set;
  return set;
}
function simpleSet(kind) {
  if (texCache[kind]) return texCache[kind];
  const S = 512, h = canvas(S, S), hg = h.getContext('2d');
  let tint;
  if (kind === 'concrete') { noiseFill(hg, S, S, '#8a8a86', [60, 200], 50000, 2); tint = '#9d9b94'; for (let i = 0; i < 5; i++) { hg.fillStyle = 'rgba(70,70,70,0.4)'; hg.fillRect(0, (i / 5) * S, S, 2); hg.fillRect((i / 5) * S, 0, 2, S); } }
  else if (kind === 'grass') { noiseFill(hg, S, S, '#5b5b5b', [20, 230], 120000, 2.5); tint = '#3e5a2a'; }
  else if (kind === 'gravel') { noiseFill(hg, S, S, '#777', [40, 230], 60000, 4); tint = '#7d756a'; }
  else if (kind === 'rock') { noiseFill(hg, S, S, '#666', [20, 220], 40000, 6); tint = '#5f5c57'; }
  const col = canvas(S, S), cg = col.getContext('2d');
  cg.drawImage(h, 0, 0); cg.globalCompositeOperation = 'multiply'; cg.fillStyle = tint; cg.fillRect(0, 0, S, S);
  const set = { map: tex(col), normalMap: tex(normalFrom(h, 2.5), 1, 1, false) };
  texCache[kind] = set;
  return set;
}
function containerTexture() {
  if (texCache.container) return texCache.container;
  const c = canvas(256, 64), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 8) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 3, 64); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 4, 0, 1, 64); }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 61, 256, 3);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,50,20,${Math.random() * 0.15})`; g.fillRect(Math.random() * 256, Math.random() * 64, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  const t = tex(c);
  texCache.container = t;
  return t;
}
function poolTexture(color) {
  const c = canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, color); gr.addColorStop(0.5, color.replace('1)', '0.35)')); gr.addColorStop(1, color.replace('1)', '0)'));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function checkerTexture() {
  const c = canvas(64, 16), g = c.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 4, y * 4, 4, 4); }
  const t = tex(c); t.magFilter = THREE.NearestFilter; return t;
}
function kerbTexture() {
  const c = canvas(16, 64), g = c.getContext('2d');
  for (let y = 0; y < 4; y++) { g.fillStyle = y % 2 ? '#e8e8e8' : '#c4161c'; g.fillRect(0, y * 16, 16, 16); }
  return tex(c);
}

/** Make sure ribbon triangles face up (offset order may flip the winding). */
function faceUp(pos, idx) {
  if (idx.length < 3) return idx;
  const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
  const ux = pos[b] - pos[a], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vz = pos[c + 2] - pos[a + 2];
  const ny = uz * vx - ux * vz;
  if (ny >= 0) return idx;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return idx;
}

/* ------------------------------------------------------------ ribbons */
/** Build a strip following the centreline between lateral offsets a..b. */
function ribbon(track, offA, offB, yOff, uvLen, closedOverride) {
  const S = track.samples, N = S.length, closed = closedOverride != null ? closedOverride : track.closed;
  const count = closed ? N + 1 : N;
  const pos = new Float32Array(count * 2 * 3), uv = new Float32Array(count * 2 * 2);
  for (let k = 0; k < count; k++) {
    const p = S[k % N];
    const yA = p.y + yOff, yB = p.y + yOff;
    pos.set([p.x + p.nx * offA, yA, p.z + p.nz * offA, p.x + p.nx * offB, yB, p.z + p.nz * offB], k * 6);
    const v = (k * TRACK_STEP) / uvLen;
    uv.set([0, v, 1, v], k * 4);
  }
  const idx = [];
  for (let k = 0; k < count - 1; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(faceUp(pos, idx));
  g.computeVertexNormals();
  return g;
}
/** Ribbon for a sub-range of the centreline (s0..s1). */
function ribbonRange(track, s0, s1, offA, offB, yOff) {
  const pos = [], uv = [], idx = [];
  let k = 0;
  for (let s = s0; s <= s1; s += TRACK_STEP) {
    const p = track.sample(Math.round(s / TRACK_STEP));
    pos.push(p.x + p.nx * offA, p.y + yOff, p.z + p.nz * offA, p.x + p.nx * offB, p.y + yOff, p.z + p.nz * offB);
    uv.push(0, (s - s0) / 4, 1, (s - s0) / 4);
    if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(faceUp(pos, idx)); g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------ builder */
export function buildTrack(stage, track, q) {
  const group = new THREE.Group();
  const def = track.def;
  const wetMats = [];
  const lamps = [];
  const camSpots = [];
  const result = { group, lamps, wetMats, puddles: def.wetPatches || [], zoneMeshes: [], camSpots };

  const addWet = (m, dry) => { wetMats.push({ m, color: m.color.clone(), rough: dry.rough, env: m.envMapIntensity }); };

  /* ---------------- road surface */
  if (def.env !== 'docks') {
    const set = asphaltSet(def.env === 'touge' ? 'touge' : 'circuit');
    const roadMat = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 0.92, metalness: 0, envMapIntensity: 0.7 });
    roadMat.normalScale.set(0.8, 0.8);
    const road = new THREE.Mesh(ribbon(track, track.width / 2, -track.width / 2, 0.0, 16), roadMat);
    road.receiveShadow = true;
    group.add(road);
    addWet(roadMat, { rough: 0.92 });
  }

  /* ---------------- environment specific */
  if (def.env === 'touge') buildTouge(stage, track, q, group, result, addWet);
  if (def.env === 'docks') buildDocks(stage, track, q, group, result, addWet);
  if (def.env === 'circuit') buildCircuit(stage, track, q, group, result, addWet);

  /* ---------------- start / finish gantries */
  const chk = checkerTexture();
  const gantry = (s, label) => {
    const p = track.sample(Math.round(s / TRACK_STEP));
    const off = track.width / 2 + 1.2;
    const line = new THREE.Mesh(ribbonRange(track, s, s + 2, track.width / 2, -track.width / 2, 0.012), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6 }));
    group.add(line);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.6, roughness: 0.4 });
    for (const sd of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), postMat);
      post.position.set(p.x + p.nx * off * sd, p.y + 3, p.z + p.nz * off * sd);
      group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(off * 2 + 0.4, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x0c0d10, emissive: label === 'FINISH' ? 0xff2244 : 0x22ccff, emissiveIntensity: 0.6 }));
    beam.position.set(p.x, p.y + 6, p.z);
    beam.rotation.y = Math.atan2(p.nx, p.nz) + Math.PI / 2;
    group.add(beam);
  };
  gantry(track.startS, 'START');
  if (!track.closed) gantry(track.finishS, 'FINISH');

  /* ---------------- zone markers */
  for (const z of track.zones) {
    const edge = track.width / 2;
    const color = z.type === 'clip' ? 0xffc21a : 0x2fd8ff;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    let mesh;
    if (z.type === 'zone') mesh = new THREE.Mesh(ribbonRange(track, z.s0, z.s1, z.side * edge, z.side * (edge - z.target), 0.02), mat);
    else mesh = new THREE.Mesh(ribbonRange(track, z.s0, z.s1, z.side * edge, z.side * (edge - z.target * 0.6), 0.02), mat);
    group.add(mesh);
    // clipping-point pole
    if (z.type === 'clip') {
      const p = track.sample(Math.round((z.s0 + z.s1) / 2 / TRACK_STEP));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 1.2 }));
      pole.position.set(p.x + p.nx * z.side * (edge + 0.35), p.y + 0.8, p.z + p.nz * z.side * (edge + 0.35));
      group.add(pole);
    }
    result.zoneMeshes.push({ zone: z, mat, base: 0.32 });
  }

  /* ---------------- cinematic replay camera spots */
  for (let s = 20; s < track.length - 20; s += 55) {
    const p = track.sample(Math.round(s / TRACK_STEP));
    const side = (Math.round(s / 55) % 2 ? 1 : -1) * (track.width / 2 + 6 + Math.random() * 6);
    camSpots.push(new THREE.Vector3(p.x + p.nx * side, p.y + 1.5 + Math.random() * 4, p.z + p.nz * side));
  }

  /* ---------------- dynamic lights pool (nearest lamps get real lights) */
  result.pool = [];
  for (let i = 0; i < q.lights; i++) {
    const L = new THREE.PointLight(def.env === 'touge' ? 0xffb46b : 0xdfe8ff, 0, 34, 1.6);
    group.add(L);
    result.pool.push(L);
  }
  result.update = (camPos, night) => {
    if (!lamps.length) return;
    lamps.forEach((l) => { l.d = l.pos.distanceToSquared(camPos); });
    const near = lamps.slice().sort((a, b) => a.d - b.d).slice(0, result.pool.length);
    result.pool.forEach((L, i) => {
      const l = near[i];
      if (!l) { L.intensity = 0; return; }
      L.position.copy(l.pos);
      L.intensity = night > 0.2 ? l.power * night : 0;
    });
  };
  result.setNight = (night) => {
    for (const p of result.poolDecals || []) p.material.opacity = night * 0.85;
    for (const m of result.lampHeads || []) m.emissiveIntensity = 0.2 + night * 7;
  };
  result.setWet = (w) => {
    for (const e of wetMats) {
      e.m.roughness = THREE.MathUtils.lerp(e.rough, 0.18, w);
      e.m.color.copy(e.color).multiplyScalar(1 - 0.42 * w);
      e.m.envMapIntensity = THREE.MathUtils.lerp(e.env, 1.6, w);
    }
  };
  result.highlightZone = (id, on) => {
    for (const z of result.zoneMeshes) if (z.zone.id === id) z.mat.opacity = on ? 0.75 : z.base;
  };
  return result;
}

/* ------------------------------------------------------------ helpers shared */
function addLampsAlong(stage, track, group, result, spacing, offset, color, height, poleMat) {
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff3dd, emissive: color, emissiveIntensity: 4 });
  result.lampHeads = (result.lampHeads || []).concat([headMat]);
  const poolTex = poolTexture(color === 0xffb46b ? 'rgba(255,180,107,1)' : 'rgba(220,232,255,1)');
  result.poolDecals = result.poolDecals || [];
  const poleG = new THREE.CylinderGeometry(0.09, 0.13, height, 8);
  const armG = new THREE.BoxGeometry(0.12, 0.12, 2.4);
  const headG = new THREE.BoxGeometry(0.45, 0.12, 0.75);
  const n = Math.floor(track.length / spacing);
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    const s = 10 + k * spacing;
    const p = track.sample(Math.round(s / TRACK_STEP));
    const side = k % 2 ? 1 : -1;
    const off = track.width / 2 + offset;
    const bx = p.x + p.nx * off * side, bz = p.z + p.nz * off * side;
    const pole = new THREE.Mesh(poleG, poleMat);
    pole.position.set(bx, p.y + height / 2, bz);
    group.add(pole);
    const ax = -p.nx * side, az = -p.nz * side;
    const arm = new THREE.Mesh(armG, poleMat);
    arm.position.set(bx + ax * 1.1, p.y + height - 0.1, bz + az * 1.1);
    arm.rotation.y = Math.atan2(ax, az);
    group.add(arm);
    const head = new THREE.Mesh(headG, headMat);
    head.position.set(bx + ax * 2.2, p.y + height - 0.2, bz + az * 2.2);
    head.rotation.y = arm.rotation.y;
    group.add(head);
    const lp = new THREE.Vector3(bx + ax * 2.2, p.y + height - 0.6, bz + az * 2.2);
    result.lamps.push({ pos: lp, power: 260 });
    // light pool decal aligned to the road
    const n2 = new THREE.Vector3();
    track.normalAt(lp.x, lp.z, n2);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    decal.position.set(lp.x, track.heightAt(lp.x, lp.z) + 0.04, lp.z);
    decal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n2);
    group.add(decal);
    result.poolDecals.push(decal);
    void up;
  }
}

/* ------------------------------------------------------------ TOUGE */
function buildTouge(stage, track, q, group, result, addWet) {
  const S = track.samples;
  // gravel shoulders
  const gset = simpleSet('gravel');
  const gm = new THREE.MeshStandardMaterial({ map: gset.map, normalMap: gset.normalMap, roughness: 1 });
  gm.map.repeat.set(1, 1);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(ribbon(track, side * track.width / 2, side * (track.width / 2 + 1.4), -0.02, 6), gm);
    m.receiveShadow = true;
    group.add(m);
  }
  addWet(gm, { rough: 1 });

  // terrain (mountainside sculpted around the road)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of S) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const pad = 260, res = 5;
  const x0 = minX - pad, x1 = maxX + pad, z0 = minZ - pad, z1 = maxZ + pad;
  const nx = Math.ceil((x1 - x0) / res) + 1, nz = Math.ceil((z1 - z0) / res) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const near = {};
  const hash = (x, z) => Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1;
  const fbm = (x, z) => { let v = 0, a = 1, f = 0.008; for (let o = 0; o < 4; o++) { v += a * Math.sin(x * f + 1.7 * o) * Math.cos(z * f * 1.3 - o); a *= 0.5; f *= 2.1; } return v; };
  const yStart = S[0].y, yEnd = S[S.length - 1].y;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * res, z = z0 + j * res;
    track.nearest(x, z, near);
    const d = near.dist;
    // smooth far-field mountain slope: higher at the start (small z), lower at the end
    const k = Math.min(1, Math.max(0, (z - minZ) / (maxZ - minZ)));
    const far = yStart + 25 - (yStart - yEnd + 40) * k + fbm(x, z) * 18 + (Math.abs(x) > (maxX + 40) ? (Math.abs(x) - maxX - 40) * 0.35 : 0);
    // weighted blend between the local road height and the far-field mountain
    const t = Math.min(1, Math.max(0, (d - track.width / 2 - 2.2) / 38));
    const tt = t * t * (3 - 2 * t);
    let y = near.y - 0.35 + (far - near.y) * tt;
    if (d < track.width / 2 + 2.2) y = near.y - 0.35;
    y += Math.sin(hash(x, z)) * 0.3 * tt;
    pos.set([x, y, z], (j * nx + i) * 3);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) uvs.set([i * res / 12, j * res / 12], (j * nx + i) * 2);
  tg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  // colour by slope: steep = rock, flat = grass
  const nrm = tg.attributes.normal.array, colors = new Float32Array(nx * nz * 3);
  for (let i = 0; i < nx * nz; i++) {
    const ny = nrm[i * 3 + 1];
    const rock = Math.min(1, Math.max(0, (0.86 - ny) / 0.25));
    colors.set([0.36 + rock * 0.35, 0.42 + rock * 0.25, 0.27 + rock * 0.33], i * 3);
  }
  tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const grass = simpleSet('grass');
  const terrainMat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, vertexColors: true, roughness: 0.95 });
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  // guardrails: W-beam ribbon + posts
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7c8186, metalness: 0.7, roughness: 0.5 });
  const off = track.width / 2 + track.def.barrierOffset;
  for (const side of [1, -1]) {
    for (const [ya, yb] of [[0.48, 0.66], [0.66, 0.78]]) {
      const g = ribbon(track, side * off, side * off, 0, 4);
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 6) { p[i + 1] += ya; p[i + 4] += yb; }
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, railMat));
    }
  }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), postMat, Math.ceil(S.length / 2) * 2 + 2);
  const m4 = new THREE.Matrix4();
  let pc = 0;
  for (let i = 0; i < S.length; i += 2) for (const side of [1, -1]) {
    const p = S[i];
    m4.makeTranslation(p.x + p.nx * (off + 0.08) * side, p.y + 0.4, p.z + p.nz * (off + 0.08) * side);
    posts.setMatrixAt(pc++, m4);
  }
  posts.count = pc;
  group.add(posts);

  // pine forest
  const treeCount = Math.floor(2600 * q.trees);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 3, 6), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }), treeCount);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 7.5, 7), new THREE.MeshStandardMaterial({ color: 0x1f3a24, roughness: 0.95 }), treeCount);
  crown.castShadow = true;
  let tc = 0;
  const tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3();
  for (let tries = 0; tries < treeCount * 4 && tc < treeCount; tries++) {
    const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
    track.nearest(x, z, near);
    if (near.dist < track.width / 2 + 5) continue;
    const i = Math.min(nx - 1, Math.round((x - x0) / res)), j = Math.min(nz - 1, Math.round((z - z0) / res));
    const y = pos[(j * nx + i) * 3 + 1];
    const s = 0.7 + Math.random() * 0.8;
    tq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    ts.set(s, s, s);
    trunk.setMatrixAt(tc, m4.compose(tp.set(x, y + 1.5 * s, z), tq, ts));
    crown.setMatrixAt(tc, m4.compose(tp.set(x, y + 3 * s + 3.75 * s, z), tq, ts));
    tc++;
  }
  trunk.count = crown.count = tc;
  group.add(trunk, crown);

  addLampsAlong(stage, track, group, result, 46, track.def.barrierOffset + 0.6, 0xffb46b, 7.5, postMat);
}

/* ------------------------------------------------------------ DOCKS */
function buildDocks(stage, track, q, group, result, addWet) {
  const def = track.def, X = def.bounds.X, Z = def.bounds.Z;
  const cset = simpleSet('concrete');
  cset.map.repeat.set(60, 45); cset.normalMap.repeat.set(60, 45);
  const groundMat = new THREE.MeshStandardMaterial({ map: cset.map, normalMap: cset.normalMap, roughness: 0.85, envMapIntensity: 0.6 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(X * 2 + 60, Z * 2 + 30), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  addWet(groundMat, { rough: 0.85 });
  // painted route edges (dashed) as a guide
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd9c35a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const side of [1, -1]) {
    for (let s = 0; s < track.length; s += 10) group.add(new THREE.Mesh(ribbonRange(track, s, Math.min(track.length, s + 5), side * (track.width / 2), side * (track.width / 2 - 0.25), 0.01), lineMat));
  }
  // wet patches: dark glossy puddles (SSR adds real reflections on High+)
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.8 });
  for (const w of def.wetPatches) {
    const shape = new THREE.Shape();
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2, r = w.r * (0.8 + 0.2 * Math.sin(a * 3 + w.x)); k ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), puddleMat);
    m.rotation.x = -Math.PI / 2; m.position.set(w.x, 0.012, w.z);
    group.add(m);
  }
  // containers (instanced, per-instance colour)
  const stacks = def.visualStacks;
  const cmat = new THREE.MeshStandardMaterial({ map: containerTexture(), roughness: 0.6, metalness: 0.45 });
  const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cmat, stacks.length);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  stacks.forEach((c, i) => {
    qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
    cont.setMatrixAt(i, m4.compose(pp.set(c.x, c.y + c.h / 2, c.z), qq, sc.set(c.w, c.h, c.l)));
    cont.setColorAt(i, new THREE.Color(c.color));
  });
  cont.castShadow = true; cont.receiveShadow = true;
  group.add(cont);
  // gantry cranes
  const red = new THREE.MeshStandardMaterial({ color: 0xb8361f, metalness: 0.4, roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd9d9d4, metalness: 0.4, roughness: 0.5 });
  const warn = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 });
  for (const c of def.cranes) {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-9, -8], [9, -8], [-9, 8], [9, 8]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 34, 1.4), red); leg.position.set(lx, 17, lz); leg.castShadow = true; g.add(leg); }
    for (const lz of [-8, 8]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(20, 2.2, 1.6), white); beam.position.set(0, 34, lz); g.add(beam); }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 70), red); boom.position.set(0, 38, -18); boom.castShadow = true; g.add(boom);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), white); cab.position.set(0, 35.5, 0); g.add(cab);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), warn); light.position.set(0, 39.6, -52); g.add(light);
    g.position.set(c.x, 0, c.z);
    group.add(g);
  }
  // quay edge + water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1200), new THREE.MeshStandardMaterial({ color: 0x0a1820, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -2.2, -Z - 600);
  group.add(water);
  const conc = new THREE.MeshStandardMaterial({ map: cset.map, roughness: 0.9, color: 0xbab6ad });
  for (const w of def.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.7), conc);
    wall.position.set((w.ax + w.bx) / 2, 0.55, (w.az + w.bz) / 2);
    wall.rotation.y = -Math.atan2(w.bz - w.az, w.bx - w.ax);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  }
  // warehouses on the skyline
  const ware = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.8, metalness: 0.3 });
  for (let i = 0; i < 9; i++) {
    const w = 40 + Math.random() * 50, h = 14 + Math.random() * 20;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 30), ware);
    b.position.set(-X + i * (X * 2 / 8), h / 2, Z + 40 + Math.random() * 30);
    group.add(b);
  }
  // flood-light towers
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.7, roughness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe8ff, emissiveIntensity: 5 });
  result.lampHeads = [headMat];
  result.poolDecals = [];
  const poolTex = poolTexture('rgba(220,232,255,1)');
  for (const [x, z] of [[-200, -60], [-200, 60], [-60, -78], [60, -78], [200, -60], [200, 60], [-60, 82], [60, 82], [0, -125], [0, 120], [-130, 0], [130, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 22, 8), poleMat); pole.position.set(x, 11, z); group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 1.2), headMat); head.position.set(x, 22, z); group.add(head);
    result.lamps.push({ pos: new THREE.Vector3(x, 21, z), power: 2200 });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(x, 0.03, z);
    group.add(decal); result.poolDecals.push(decal);
  }
  for (const L of result.pool || []) void L;
}

/* ------------------------------------------------------------ CIRCUIT */
function buildCircuit(stage, track, q, group, result, addWet) {
  const grass = simpleSet('grass');
  grass.map.repeat.set(80, 80); grass.normalMap.repeat.set(80, 80);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughness: 0.95, color: 0x8fb070 }));
  g.rotation.x = -Math.PI / 2; g.position.y = -0.05; g.receiveShadow = true;
  group.add(g);
  // paved run-off
  const set = asphaltSet('none');
  const runMat = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughness: 0.95, color: 0xb5b5b5 });
  const ro = track.def.barrierOffset;
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(ribbon(track, side * track.width / 2, side * (track.width / 2 + ro + 0.4), -0.015, 16), runMat);
    m.receiveShadow = true; group.add(m);
  }
  addWet(runMat, { rough: 0.95 });
  // kerbs on the inside of corners
  const km = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.6 });
  const S = track.samples;
  let i = 0;
  while (i < S.length) {
    if (Math.abs(S[i].curv) > 1 / 90) {
      let j = i; const dir = Math.sign(S[i].curv);
      while (j < S.length && Math.abs(S[j].curv) > 1 / 110 && Math.sign(S[j].curv) === dir) j++;
      const geo = ribbonRange(track, i * TRACK_STEP, j * TRACK_STEP, dir * (track.width / 2 + 0.9), dir * (track.width / 2 - 0.1), 0.02);
      group.add(new THREE.Mesh(geo, km));
      i = j + 1;
    } else i++;
  }
  // tyre walls: stacked tyres along the barrier lines
  const off = track.width / 2 + ro;
  const per = Math.ceil(S.length * 2 / 0.35) * 2;
  const tireGeo = new THREE.TorusGeometry(0.3, 0.13, 6, 12);
  tireGeo.rotateX(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 });
  const tires = new THREE.InstancedMesh(tireGeo, tireMat, per * 3);
  const m4 = new THREE.Matrix4();
  let c = 0;
  const bands = [new THREE.Color(0x18181a), new THREE.Color(0xc4161c), new THREE.Color(0xeeeeee)];
  for (const side of [1, -1]) for (let k = 0; k < S.length; k++) for (const sub of [0, 0.5]) {
    const a = S[k], b = track.sample(k + 1);
    const x = a.x + (b.x - a.x) * sub + a.nx * (off + 0.3) * side, z = a.z + (b.z - a.z) * sub + a.nz * (off + 0.3) * side;
    for (let l = 0; l < 3; l++) {
      if (c >= per * 3) break;
      m4.makeTranslation(x, 0.13 + l * 0.27, z);
      tires.setMatrixAt(c, m4);
      tires.setColorAt(c, bands[(k >> 3) % 2 === 0 && l === 1 ? 1 + ((k >> 4) % 2) : 0]);
      c++;
    }
  }
  tires.count = c;
  tires.castShadow = true;
  group.add(tires);
  // grandstands along the main straight
  const standMat = new THREE.MeshStandardMaterial({ color: 0x7d8590, roughness: 0.8 });
  const crowd = (() => { const cv = canvas(256, 64), cg = cv.getContext('2d'); cg.fillStyle = '#333'; cg.fillRect(0, 0, 256, 64); for (let k = 0; k < 900; k++) { cg.fillStyle = `hsl(${Math.random() * 360},${40 + Math.random() * 40}%,${30 + Math.random() * 40}%)`; cg.fillRect(Math.random() * 256, Math.random() * 64, 3, 4); } return tex(cv, 6, 1); })();
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
  for (const zc of [-90, -10, 60]) {
    const st = new THREE.Group();
    for (let r = 0; r < 8; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 60), r % 2 ? standMat : crowdMat);
      step.position.set(-(off + 6 + r * 1.6), 0.3 + r * 0.9, zc);
      st.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 62), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.5, roughness: 0.4 }));
    roof.position.set(-(off + 12), 11, zc);
    roof.castShadow = true;
    st.add(roof);
    group.add(st);
  }
  // pit building
  const pit = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 120), new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.3 }));
  pit.position.set(off + 14, 3.5, -40); pit.castShadow = true;
  group.add(pit);
  // flood lights for night sessions
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.7, roughness: 0.4 });
  addLampsAlong(null, track, group, result, 70, ro + 3, 0xdfe8ff, 16, poleMat);
  result.lamps.forEach((l) => { l.power = 1800; });
}
