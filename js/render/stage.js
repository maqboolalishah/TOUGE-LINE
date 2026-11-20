/* ==========================================================================
   Stage: WebGL renderer, quality presets, sky, sun/moon, HDR environment
   lighting (PMREM from the live sky), fog, rain and shadows.
   ========================================================================== */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 0.75, shadows: false, shadowSize: 1024, msaa: 0, fxaa: true, bloom: false, motionBlur: false, ssr: false, ssrSteps: 0, smoke: 450, haze: false, trees: 0.35, lights: 2, maxPixels: 1920 * 1080 },
  medium: { label: 'Medium', pixelRatio: 1, shadows: true, shadowSize: 1024, msaa: 0, fxaa: true, bloom: true, motionBlur: false, ssr: false, ssrSteps: 0, smoke: 900, haze: true, trees: 0.6, lights: 4, maxPixels: 1920 * 1080 },
  high: { label: 'High', pixelRatio: 1.5, shadows: true, shadowSize: 2048, msaa: 4, fxaa: false, bloom: true, motionBlur: true, ssr: true, ssrSteps: 28, smoke: 1500, haze: true, trees: 1, lights: 6, maxPixels: 2560 * 1440 },
  ultra: { label: 'Ultra', pixelRatio: 4, shadows: true, shadowSize: 4096, msaa: 4, fxaa: false, bloom: true, motionBlur: true, ssr: true, ssrSteps: 48, smoke: 2400, haze: true, trees: 1.3, lights: 8, maxPixels: 3840 * 2160 },
};
export const QUALITY_IDS = ['low', 'medium', 'high', 'ultra'];

/** Pick a sensible default from the GPU string. */
export function detectQuality(renderer) {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (_) { /* ignore */ }
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
  if (/RTX\s?(40|50)|RX\s?(79|78)|Apple M\d (Max|Ultra)/i.test(gpu)) return 'ultra';
  if (/RTX|GTX\s?(16|10)|Radeon RX|Arc A|Apple M\d/i.test(gpu)) return 'high';
  if (/Intel|UHD|Iris|Mali|Adreno/i.test(gpu)) return 'medium';
  return 'high';
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in post (OutputPass)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 4000);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    // sky
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    this.scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.skyForEnv = new Sky();
    this.skyForEnv.scale.setScalar(1000);
    this.skyScene.add(this.skyForEnv);
    this.stars = this.makeStars();
    this.scene.add(this.stars);
    this.envGlow = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x0a0f1c, side: THREE.BackSide }));
    this.skyScene.add(this.envGlow);

    // lights
    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    const sc = this.key.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    this.scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a3328, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0x9fb3c8, 0.0015);
    this.fogBase = 0.0015;

    this.timeOfDay = 14; this.night = 0; this.wet = 0; this.rainOn = false;
    this.rain = this.makeRain();
    this.scene.add(this.rain);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.lastEnvTime = -99;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(id) {
    const q = (this.q = QUALITY[id] || QUALITY.high);
    this.qualityId = id;
    this.renderer.shadowMap.enabled = q.shadows;
    this.key.castShadow = q.shadows;
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  resize() {
    const q = this.q || QUALITY.high;
    const w = innerWidth, h = innerHeight;
    let pr = Math.min(devicePixelRatio || 1, q.pixelRatio);
    // cap total pixels (Ultra goes up to native / 4K)
    while (w * h * pr * pr > q.maxPixels && pr > 0.5) pr -= 0.05;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize && this.onResize(w, h, pr);
  }

  makeStars() {
    const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.1;
      const th = u * Math.PI * 2, ph = Math.acos(v);
      pos.set([Math.sin(ph) * Math.cos(th) * 3000, Math.cos(ph) * 3000, Math.sin(ph) * Math.sin(th) * 3000], i * 3);
      const b = 0.5 + Math.random() * 0.5;
      col.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }

  makeRain() {
    const n = 5000;
    this.rainDrops = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.rainDrops.set([(Math.random() - 0.5) * 70, Math.random() * 35, (Math.random() - 0.5) * 70], i * 3);
    const pos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xaab8cc, transparent: true, opacity: 0.32, depthWrite: false });
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }

  setRain(on) {
    this.rainOn = on;
    this.rain.visible = on;
  }

  /** Hour 0..24 → sun / moon, sky, fog, exposure, environment map. */
  setTimeOfDay(h, fogDensity) {
    this.timeOfDay = h;
    if (fogDensity != null) this.fogBase = fogDensity;
    const th = ((h - 6) / 12) * Math.PI;
    const elev = Math.sin(th) * 68; // degrees
    const day = smooth(-4, 8, elev);
    this.night = 1 - smooth(-10, 2, elev);
    const az = th + 0.6;
    const el = (Math.max(elev, -15) * Math.PI) / 180;
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));

    const u = this.sky.material.uniforms;
    for (const s of [this.sky, this.skyForEnv]) {
      const U = s.material.uniforms;
      U.sunPosition.value.copy(this.sunDir);
      U.turbidity.value = 4 + (1 - day) * 6;
      U.rayleigh.value = 1.2 + (1 - day) * 2.5;
      U.mieCoefficient.value = 0.004;
      U.mieDirectionalG.value = 0.82;
    }
    void u;
    const golden = smooth(25, 2, elev) * day;
    if (this.night < 0.5) {
      this.key.color.setRGB(1, 0.93 - golden * 0.35, 0.85 - golden * 0.55);
      this.key.intensity = 3.2 * day;
      this.lightDir = this.sunDir.clone();
    } else {
      // moonlight (from the opposite side, cool and dim)
      this.key.color.setRGB(0.55, 0.65, 1);
      this.key.intensity = 0.35;
      this.lightDir = new THREE.Vector3(-this.sunDir.x, 0.65, -this.sunDir.z).normalize();
    }
    this.hemi.intensity = 0.12 + 0.55 * day;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.62 + 0.2 * day, 0.85);
    this.stars.material.opacity = this.rainOn ? 0 : this.night;
    const fogCol = new THREE.Color().setRGB(0.55 * day + 0.03, 0.62 * day + 0.04, 0.72 * day + 0.07);
    if (golden > 0.2) fogCol.lerp(new THREE.Color(0.75, 0.5, 0.38), golden * 0.5);
    if (this.rainOn) {
      // overcast: no direct sun, flat grey sky, soft omnidirectional light
      fogCol.setRGB(0.32 * day + 0.03, 0.34 * day + 0.035, 0.37 * day + 0.045);
      this.key.intensity *= 0.22;
      this.hemi.intensity = 0.1 + 0.85 * day;
      this.hemi.color.setRGB(0.78, 0.8, 0.84);
    }
    this.sky.visible = !this.rainOn;
    this.skyForEnv.visible = !this.rainOn;
    this.scene.background = this.rainOn ? fogCol.clone() : null;
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = this.fogBase * (1 + this.night * 0.6) * (this.rainOn ? 1.5 : 1);
    if (this.rainOn) this.envGlow.material.color.copy(fogCol).multiplyScalar(1.4);
    else this.envGlow.material.color.setRGB(0.02 + 0.03 * this.night, 0.03 + 0.03 * this.night, 0.06 + 0.05 * this.night);
    // simple auto-exposure from scene illuminance (like a camera would)
    const dayExposure = Math.min(2.2, Math.max(0.5, 2.6 / (this.key.intensity * 0.8 + this.hemi.intensity + 0.6)));
    this.exposure = dayExposure * (1 - this.night) + 1.18 * this.night;
    if (Math.abs(h - this.lastEnvTime) > 0.2 || this._envRain !== this.rainOn) this.updateEnv();
  }

  updateEnv() {
    this.lastEnvTime = this.timeOfDay;
    this._envRain = this.rainOn;
    const rt = this.pmrem.fromScene(this.skyScene, 0.02);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.35 + 0.65 * (1 - this.night) + 0.15;
  }

  /** Keep the shadow frustum centred on the action. */
  follow(target, dt, camPos) {
    const d = this.lightDir || this.sunDir;
    this.key.target.position.copy(target);
    this.key.position.copy(target).addScaledVector(d, 150);
    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    if (this.rainOn) this.updateRain(dt, camPos);
  }

  updateRain(dt, cam) {
    const d = this.rainDrops, n = d.length / 3;
    const pos = this.rain.geometry.attributes.position.array;
    const wx = 3, wz = 1.5, vy = 22;
    for (let i = 0; i < n; i++) {
      let x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      y -= vy * dt; x += wx * dt; z += wz * dt;
      if (y < -2) { y += 37; x = (Math.random() - 0.5) * 70; z = (Math.random() - 0.5) * 70; }
      if (x > 35) x -= 70; if (z > 35) z -= 70;
      d[i * 3] = x; d[i * 3 + 1] = y; d[i * 3 + 2] = z;
      const px = cam.x + x, py = cam.y - 8 + y, pz = cam.z + z;
      pos[i * 6] = px; pos[i * 6 + 1] = py; pos[i * 6 + 2] = pz;
      pos[i * 6 + 3] = px - wx * 0.035; pos[i * 6 + 4] = py + vy * 0.035; pos[i * 6 + 5] = pz - wz * 0.035;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}
