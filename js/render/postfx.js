/* ==========================================================================
   Post-processing chain (HDR, half-float):
     Render → depth capture → SSR (wet ground) → camera motion blur → bloom
     → depth of field (replays) → ACES tone map (OutputPass)
     → grade (heat haze, chroma, vignette, grain, letterbox) → FXAA
   ========================================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** Base class for our full-screen passes. */
class QuadPass extends Pass {
  constructor(material) { super(); this.material = material; this.fsQuad = new FullScreenQuad(material); }
  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

/** Records the scene depth texture right after the RenderPass (buffers ping-pong). */
class DepthCapturePass extends Pass {
  constructor(shared) { super(); this.shared = shared; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) { this.shared.depth = readBuffer.depthTexture; }
}

/* ------------------------------------------------------------ SSR */
function ssrMaterial(steps) {
  return new THREE.ShaderMaterial({
    defines: { STEPS: steps },
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(1, 1) }, uWet: { value: 0 }, uMaxDist: { value: 40 },
      uPuddles: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) }, uPuddleCount: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse, tDepth;
      uniform mat4 uProj, uInvProj, uInvView, uView;
      uniform vec2 uRes; uniform float uWet, uMaxDist;
      uniform vec3 uPuddles[12]; uniform int uPuddleCount;
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return v.xyz / v.w;
      }
      vec2 toUv(vec3 q) { vec4 c = uProj * vec4(q, 1.0); return c.xy / c.w * 0.5 + 0.5; }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        float d0 = texture2D(tDepth, vUv).x;
        if (d0 >= 0.99999) { gl_FragColor = base; return; }
        vec3 P = viewPos(vUv);
        vec2 px = 1.0 / uRes;
        vec3 N = normalize(cross(viewPos(vUv + vec2(px.x, 0.0)) - P, viewPos(vUv + vec2(0.0, px.y)) - P));
        vec3 Nw = normalize((uInvView * vec4(N, 0.0)).xyz);
        if (Nw.y < 0.85) { gl_FragColor = base; return; }
        vec3 Pw = (uInvView * vec4(P, 1.0)).xyz;
        float wet = uWet;
        for (int i = 0; i < 12; i++) {
          if (i >= uPuddleCount) break;
          float dd = length(Pw.xz - uPuddles[i].xy);
          wet = max(wet, 1.0 - smoothstep(uPuddles[i].z * 0.7, uPuddles[i].z, dd));
        }
        if (wet < 0.02) { gl_FragColor = base; return; }
        // flatten the normal (wet asphalt reads as a mirror-ish plane)
        N = normalize((uView * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 V = normalize(P);
        vec3 R = normalize(reflect(V, N));
        float stepLen = uMaxDist / float(STEPS);
        vec3 Q = P + R * 0.05;
        vec2 hit = vec2(-1.0);
        float travelled = 0.0;
        for (int i = 0; i < STEPS; i++) {
          float s = stepLen * (1.0 + float(i) * 0.09);
          Q += R * s; travelled += s;
          vec2 uv = toUv(Q);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float diff = viewPos(uv).z - Q.z;
          if (diff > 0.0 && diff < s * 2.5) {
            vec3 lo = Q - R * s, hi = Q;
            for (int j = 0; j < 5; j++) {
              vec3 mid = (lo + hi) * 0.5;
              if (viewPos(toUv(mid)).z - mid.z > 0.0) hi = mid; else lo = mid;
            }
            hit = toUv(hi);
            break;
          }
        }
        if (hit.x < 0.0) { gl_FragColor = vec4(base.rgb * (1.0 - 0.25 * wet), base.a); return; }
        vec3 refl = texture2D(tDiffuse, hit).rgb;
        vec2 e = smoothstep(0.0, 0.12, hit) * (1.0 - smoothstep(0.88, 1.0, hit));
        float edge = e.x * e.y * (1.0 - smoothstep(uMaxDist * 0.5, uMaxDist * 1.6, travelled));
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        float k = wet * edge * mix(0.3, 1.0, fres);
        gl_FragColor = vec4(base.rgb * (1.0 - 0.25 * wet) + refl * k * 0.8, base.a);
      }`,
  });
}

/* ------------------------------------------------------------ motion blur */
function motionBlurMaterial() {
  return new THREE.ShaderMaterial({
    defines: { SAMPLES: 10 },
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
      uStrength: { value: 0.5 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse, tDepth;
      uniform mat4 uInvViewProj, uPrevViewProj, uInvProj;
      uniform float uStrength;
      void main() {
        float d = texture2D(tDepth, vUv).x;
        vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec4 w = uInvViewProj * ndc; w /= w.w;
        vec4 pc = uPrevViewProj * w;
        vec2 vel = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * uStrength;
        vec4 vp = uInvProj * ndc;
        float vz = -vp.z / vp.w;
        vel *= smoothstep(8.0, 22.0, vz);            // keep the car (near camera) crisp
        float l = length(vel);
        if (l > 0.035) vel *= 0.035 / l;
        if (l < 0.0005) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec4 acc = vec4(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          float t = float(i) / float(SAMPLES - 1) - 0.5;
          acc += texture2D(tDiffuse, vUv + vel * t);
        }
        gl_FragColor = acc / float(SAMPLES);
      }`,
  });
}

/* ------------------------------------------------------------ grade */
function gradeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uVignette: { value: 0.35 }, uSat: { value: 1.08 }, uContrast: { value: 1.06 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uGrain: { value: 0.025 }, uChroma: { value: 0 }, uLetterbox: { value: 0 },
      uHaze: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uAspect: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uVignette, uSat, uContrast, uGrain, uChroma, uLetterbox, uAspect;
      uniform vec3 uTint; uniform vec4 uHaze[2];
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        // exhaust heat haze: rising, shimmering refraction above the tail pipes
        for (int i = 0; i < 2; i++) {
          vec4 h = uHaze[i];
          if (h.w <= 0.0) continue;
          vec2 d = uv - h.xy; d.x *= uAspect;
          d.y -= h.z * 0.6;
          float f = (1.0 - smoothstep(0.0, h.z, length(d))) * h.w;
          if (f > 0.0) {
            float n = sin(uv.y * 260.0 + uTime * 22.0) * cos(uv.x * 190.0 - uTime * 13.0);
            uv += vec2(n, n * 0.7) * 0.0022 * f;
          }
        }
        vec3 c;
        if (uChroma > 0.0) {
          vec2 dir = (uv - 0.5) * uChroma;
          c = vec3(texture2D(tDiffuse, uv + dir).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dir).b);
        } else c = texture2D(tDiffuse, uv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        c *= uTint;
        float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.15, 1.0)));
        c *= mix(1.0, v, uVignette);
        c += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;
        if (uLetterbox > 0.0 && (vUv.y < uLetterbox || vUv.y > 1.0 - uLetterbox)) c = vec3(0.0);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });
}

export class PostFX {
  constructor(stage) {
    this.stage = stage;
    this.shared = { depth: null };
    this.prevViewProj = new THREE.Matrix4();
    this.time = 0;
    this.replay = false;
    this.focus = 8;
    this.haze = [];
    this.wet = 0;
    this.puddles = [];
    this.motionBlurEnabled = true;
  }

  build(q) {
    const { renderer, scene, camera } = this.stage;
    if (this.composer) { this.composer.passes.forEach((p) => p.dispose && p.dispose()); this.composer.dispose(); }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    const c = (this.composer = new EffectComposer(renderer, rt));
    c.setPixelRatio(1);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new DepthCapturePass(this.shared));
    this.ssr = null; this.mb = null; this.bloom = null;
    if (q.ssr) { this.ssr = new QuadPass(ssrMaterial(q.ssrSteps)); c.addPass(this.ssr); }
    if (q.motionBlur) { this.mb = new QuadPass(motionBlurMaterial()); c.addPass(this.mb); }
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.5, 2.4); c.addPass(this.bloom); }
    this.bokeh = new BokehPass(scene, camera, { focus: 8, aperture: 0.0012, maxblur: 0.009 });
    this.bokeh.enabled = false;
    c.addPass(this.bokeh);
    c.addPass(new OutputPass());
    this.grade = new QuadPass(gradeMaterial());
    c.addPass(this.grade);
    if (q.fxaa) { this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa); } else this.fxaa = null;
    this.setSize();
  }

  setSize() {
    if (!this.composer) return;
    const size = this.stage.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(size.x, size.y);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
    if (this.ssr) this.ssr.material.uniforms.uRes.value.set(size.x, size.y);
    this.grade.material.uniforms.uRes.value.set(size.x, size.y);
    this.grade.material.uniforms.uAspect.value = size.x / size.y;
  }

  render(dt, opts) {
    const cam = this.stage.camera;
    this.time += dt;
    cam.updateMatrixWorld();
    const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (this.ssr) {
      const u = this.ssr.material.uniforms;
      u.tDepth.value = this.shared.depth;
      u.uProj.value.copy(cam.projectionMatrix);
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uInvView.value.copy(cam.matrixWorld);
      u.uView.value.copy(cam.matrixWorldInverse);
      u.uWet.value = this.wet;
      u.uPuddleCount.value = Math.min(12, this.puddles.length);
      this.puddles.slice(0, 12).forEach((p, i) => u.uPuddles.value[i].set(p.x, p.z, p.r));
      this.ssr.enabled = this.wet > 0.01 || this.puddles.length > 0;
    }
    if (this.mb) {
      const u = this.mb.material.uniforms;
      u.tDepth.value = this.shared.depth;
      u.uInvViewProj.value.copy(viewProj).invert();
      u.uPrevViewProj.value.copy(this.prevViewProj);
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uStrength.value = this.motionBlurEnabled ? Math.min(1.2, (1 / 60 / Math.max(dt, 1 / 240)) * 0.55) : 0;
      this.mb.enabled = this.motionBlurEnabled && !opts.cut;
    }
    this.prevViewProj.copy(viewProj);
    this.bokeh.enabled = !!opts.replay;
    if (opts.replay) { this.bokeh.uniforms.focus.value = opts.focus || 10; this.bokeh.uniforms.aperture.value = 0.00075; }
    const g = this.grade.material.uniforms;
    g.uTime.value = this.time;
    g.uChroma.value = opts.chroma || 0;
    g.uLetterbox.value = opts.replay ? 0.09 : 0;
    g.uTint.value.set(...(opts.tint || [1, 1, 1]));
    g.uSat.value = opts.sat || 1.08;
    for (let i = 0; i < 2; i++) {
      const h = (opts.haze || [])[i];
      if (h) g.uHaze.value[i].set(h.x, h.y, h.r, h.s); else g.uHaze.value[i].set(0, 0, 0, 0);
    }
    this.stage.renderer.toneMappingExposure = this.stage.exposure || 1;
    this.composer.render(dt);
  }
}
