/* ==========================================================================
   Effects: thick tyre smoke (instanced, lit billboards that grow, linger
   and drift downwind), permanent skid marks (ring-buffer ribbon), sparks
   from wall contact, and exhaust flames.
   ========================================================================== */
import * as THREE from 'three';

/* ------------------------------------------------------------ smoke texture */
function smokeTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // build a cauliflower puff from many soft blobs
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * S * 0.28;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, rad = S * (0.1 + Math.random() * 0.16);
    const shade = 200 + Math.random() * 55;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${shade},${shade},${shade},0.22)`);
    gr.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  // radial falloff mask
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = m; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Smoke {
  constructor(scene, max) {
    this.max = max;
    this.parts = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // size, alpha, rot, shade
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        map: { value: smokeTexture() },
        uLight: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.4, 0.42, 0.46) },
        uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iData;
        varying vec2 vUv; varying float vAlpha; varying float vShade; varying float vDepth; varying float vH;
        void main() {
          vUv = uv; vAlpha = iData.y; vShade = iData.w;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iData.z), s = sin(iData.z);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iData.x;
          vH = position.y;
          mv.xy += p;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 uLight, uAmbient, uFogColor; uniform float uFogDensity;
        varying vec2 vUv; varying float vAlpha, vShade, vDepth, vH;
        void main() {
          vec4 t = texture2D(map, vUv);
          // fade smoke that is right at the lens so the chase cam isn't whited out
          float a = t.a * vAlpha * smoothstep(0.8, 5.5, vDepth);
          if (a < 0.003) discard;
          // fake volumetric lighting: tops of puffs catch the key light, undersides go darker
          float lit = clamp(0.45 + vH * 0.9, 0.0, 1.0) * (0.6 + 0.4 * t.r);
          vec3 col = (uAmbient + uLight * lit) * vShade;
          float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(col, uFogColor, f), a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.wind = new THREE.Vector3(1.3, 0, 0.6);
  }

  setMax(max) { this.cap = Math.min(max, this.max); }

  emit(x, y, z, vx, vy, vz, size, life, shade) {
    if (this.parts.length >= (this.cap || this.max)) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, size, grow: 2.2 + Math.random() * 2.4, age: 0, life, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6, shade });
  }

  update(dt, lightColor, ambient, fog) {
    this.mat.uniforms.uLight.value.copy(lightColor);
    this.mat.uniforms.uAmbient.value.copy(ambient);
    if (fog) { this.mat.uniforms.uFogColor.value.copy(fog.color); this.mat.uniforms.uFogDensity.value = fog.density; }
    const P = this.aPos.array, D = this.aData.array, w = this.wind;
    let n = 0;
    const keep = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const drag = Math.exp(-1.6 * dt);
      p.vx = (p.vx - w.x) * drag + w.x; p.vz = (p.vz - w.z) * drag + w.z;
      p.vy = p.vy * drag + 0.25 * dt;   // gentle buoyancy
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const k = p.age / p.life;
      const size = p.size + p.grow * Math.sqrt(p.age) * 1.6;
      const alpha = Math.min(1, p.age * 5) * Math.pow(1 - k, 1.7) * 0.3;
      P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z;
      D[n * 4] = size; D[n * 4 + 1] = alpha; D[n * 4 + 2] = p.rot; D[n * 4 + 3] = p.shade;
      n++;
      keep.push(p);
    }
    this.parts = keep;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true;
  }

  clear() { this.parts.length = 0; this.geo.instanceCount = 0; }
}

/* ------------------------------------------------------------ skid marks */
export class SkidMarks {
  constructor(scene, maxQuads = 14000) {
    this.max = maxQuads;
    this.head = 0; this.count = 0;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.col = new Float32Array(maxQuads * 4 * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = new Map();
  }

  /** Add a skid segment for wheel `key` at contact point p with lateral axis `side`. */
  add(key, p, side, width, strength, wet) {
    const last = this.last.get(key);
    if (strength <= 0.02) { this.last.delete(key); return; }
    const hx = side.x * width * 0.5, hz = side.z * width * 0.5;
    const L = [p.x + hx, p.y + 0.02, p.z + hz], Rr = [p.x - hx, p.y + 0.02, p.z - hz];
    if (!last) { this.last.set(key, { L, R: Rr, a: strength }); return; }
    const dx = p.x - (last.L[0] + last.R[0]) / 2, dz = p.z - (last.L[2] + last.R[2]) / 2;
    if (dx * dx + dz * dz < 0.09) return;
    if (dx * dx + dz * dz > 25) { this.last.set(key, { L, R: Rr, a: strength }); return; }
    const q = this.head;
    this.pos.set([...last.L, ...last.R, ...L, ...Rr], q * 12);
    const tone = wet ? 0.05 : 0.02;
    const a0 = Math.min(0.75, last.a), a1 = Math.min(0.75, strength);
    this.col.set([tone, tone, tone, a0, tone, tone, tone, a0, tone, tone, tone, a1, tone, tone, tone, a1], q * 16);
    this.aPos.addUpdateRange(q * 12, 12);
    this.aCol.addUpdateRange(q * 16, 16);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
    this.head = (q + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.setDrawRange(0, this.count * 6);
    this.last.set(key, { L, R: Rr, a: strength });
  }

  clear() { this.head = 0; this.count = 0; this.geo.setDrawRange(0, 0); this.last.clear(); }
}

/* ------------------------------------------------------------ sparks */
export class Sparks {
  constructor(scene, max = 600) {
    this.max = max; this.parts = [];
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  emit(x, y, z, nx, nz, vx, vz, n) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const s = 3 + Math.random() * 8;
      this.parts.push({ x, y, z, vx: vx * 0.6 + nx * s * 0.5 + (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 4, vz: vz * 0.6 + nz * s * 0.5 + (Math.random() - 0.5) * 4, age: 0, life: 0.25 + Math.random() * 0.45 });
    }
  }
  update(dt) {
    let n = 0;
    this.parts = this.parts.filter((p) => (p.age += dt) < p.life);
    for (const p of this.parts) {
      p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = 1 - p.age / p.life;
      this.pos.set([p.x, p.y, p.z, p.x - p.vx * 0.025, p.y - p.vy * 0.025, p.z - p.vz * 0.025], n * 6);
      this.col.set([4 * k, 2.2 * k, 0.6 * k, 2 * k, 0.6 * k, 0.1 * k], n * 6);
      n++;
    }
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/* ------------------------------------------------------------ exhaust flames */
export function makeFlame() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime, uIntensity;
      void main() {
        float y = vUv.y;
        float n = sin(vUv.x * 30.0 + uTime * 60.0) * 0.5 + 0.5;
        float core = smoothstep(0.5, 0.0, abs(vUv.x - 0.5) * (1.0 + y * 1.5)) * (1.0 - y);
        vec3 c = mix(vec3(0.3, 0.5, 4.0), vec3(5.0, 1.6, 0.3), smoothstep(0.0, 0.35, y));
        gl_FragColor = vec4(c * core * (0.7 + 0.3 * n) * uIntensity, 1.0);
      }`,
  });
  const geo = new THREE.ConeGeometry(0.09, 0.6, 10, 1, true);
  geo.rotateX(-Math.PI / 2); // point backwards (-Z)
  geo.translate(0, 0, -0.3);
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  return m;
}
