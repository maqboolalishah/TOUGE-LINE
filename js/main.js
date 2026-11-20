/* ==========================================================================
   APEX DRIFT — game controller
   Owns the loop: fixed 240 Hz physics sub-steps, then visuals, effects,
   camera, audio, HUD and run logic once per rendered frame.
   ========================================================================== */
import * as THREE from 'three';
import { CARS } from './cars/carSpecs.js';
import { TRACKS } from './tracks/trackDefs.js';
import { Vehicle } from './physics/vehicle.js';
import { loadCar, buildProceduralCar, updateCarVisual } from './cars/carModel.js';
import { buildTrack } from './tracks/trackBuilder.js';
import { Stage, detectQuality, QUALITY } from './render/stage.js';
import { PostFX } from './render/postfx.js';
import { Smoke, SkidMarks, Sparks, makeFlame } from './render/effects.js';
import { CameraRig } from './render/cameras.js';
import { AudioEngine } from './audio/audio.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { UI } from './ui/ui.js';
import { Run, GhostPlayer } from './game/run.js';
import { Recorder } from './game/replay.js';
import { settings, save, carSetup, submitScore, getBoard, loadGhost, saveGhost } from './config.js';

const PHYS_DT = 1 / 240;
const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.state = 'loading';
    this.stage = new Stage($('gl'));
    if (!settings.quality) { settings.quality = detectQuality(this.stage.renderer); save(); }
    this.stage.setQuality(settings.quality);
    this.post = new PostFX(this.stage);
    this.post.build(this.stage.q);
    this.stage.onResize = () => this.post.setSize();
    this.input = new Input();
    this.input.onPad = (id) => this.hud && this.hud.toast('Gamepad connected');
    this.audio = new AudioEngine();
    this.hud = new Hud();
    this.ui = new UI(this);
    this.rig = new CameraRig(this.stage.camera);
    this.rig.mode = settings.camera || 0;
    const scene = this.stage.scene;
    this.smoke = new Smoke(scene, 2600);
    this.smoke.setMax(this.stage.q.smoke);
    this.skids = new SkidMarks(scene);
    this.sparks = new Sparks(scene);
    this.recorder = new Recorder(45, 60);
    this.emitAcc = [0, 0, 0, 0];
    this.acc = 0; this.frames = 0; this.fpsT = 0; this.fps = 60;
    this.flames = []; this.flameTimer = 0;
    this.lastT = performance.now();
    this.ghostOut = new Array(9).fill(0);
    addEventListener('blur', () => { if (this.state === 'driving') this.pause(); });
    // audio needs a user gesture
    const unlock = async () => { await this.audio.init(); if (this.spec) await this.audio.setCar(this.spec); this.audio.applyVolume(); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    $('rpExit').onclick = () => this.exitReplay();
    $('rpSlow').onclick = () => { this.replaySpeed = this.replaySpeed === 1 ? 0.5 : 1; $('rpSlow').textContent = this.replaySpeed === 1 ? '0.5×' : '1×'; };
    $('rpCam').onclick = () => { this.replayCam = this.replayCam === 'cinematic' ? 'chase' : 'cinematic'; $('rpCam').textContent = 'Camera: ' + this.replayCam; };
  }

  async boot() {
    $('loadMsg').textContent = 'Building track…';
    await this.loadTrack(settings.track);
    $('loadMsg').textContent = 'Preparing car…';
    await this.setCar(settings.car);
    this.applyAssists();
    $('loading').hidden = true;
    this.state = 'menu';
    this.ui.go('menu');
    requestAnimationFrame(() => this.loop());
  }

  /* ------------------------------------------------------------ track / car */
  async loadTrack(id) {
    if (this.trackVis) { this.stage.scene.remove(this.trackVis.group); this.trackVis.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.trackId = id;
    this.track = TRACKS[id].make();
    this.track.rain = settings.rain;
    this.trackVis = buildTrack(this.stage, this.track, this.stage.q);
    this.stage.scene.add(this.trackVis.group);
    this.hud.setTrack(this.track);
    this.skids.clear(); this.smoke.clear();
    if (this.veh) { this.veh.world = this.track; this.placeAtStart(); }
    this.applyConditions();
  }

  async setCar(id) {
    const spec = (this.spec = CARS[id]);
    const setup = carSetup(id);
    if (this.carVis) this.stage.scene.remove(this.carVis.root);
    this.carVis = await loadCar(spec, { paint: setup.paint, wheelStyle: setup.wheelStyle });
    this.stage.scene.add(this.carVis.root);
    // exhaust flames + flash light
    this.flames = this.carVis.exhaust.map((p) => { const f = makeFlame(); f.position.copy(p); this.carVis.root.add(f); return f; });
    this.flash = new THREE.PointLight(0xff7a2a, 0, 6, 2);
    if (this.carVis.exhaust[0]) this.flash.position.copy(this.carVis.exhaust[0]);
    this.carVis.root.add(this.flash);
    const keep = this.veh;
    this.veh = new Vehicle(spec, setup.tuning, this.track);
    this.applyAssists();
    if (keep && this.state === 'driving') this.veh.reset(keep.p.x, keep.p.z, keep.heading); else this.placeAtStart();
    if (this.audio.ready) await this.audio.setCar(spec);
    this.ui.menuCar && this.ui.menuCar();
  }
  setPaint(hex) { if (this.carVis.paint && this.carVis.paint.color) this.carVis.paint.color.set(hex); }
  applyTuning() { this.veh.setTuning(carSetup(this.spec.id).tuning); }
  applyAssists() {
    if (!this.veh) return;
    this.veh.assists = { ...settings.assists };
    this.veh.automatic = settings.automatic;
  }
  setQuality(id) {
    this.stage.setQuality(id);
    this.post.build(this.stage.q);
    this.smoke.setMax(this.stage.q.smoke);
    this.loadTrack(this.trackId); // trees / light counts depend on quality
  }
  applyGraphics() { this.post.motionBlurEnabled = settings.motionBlur; }

  applyConditions() {
    const def = TRACKS[this.trackId];
    const h = settings.timeOfDay == null ? def.defaultTime : settings.timeOfDay;
    this.track.rain = settings.rain;
    this.stage.setRain(settings.rain);
    const fog = { touge: 0.0026, docks: 0.0016, circuit: 0.0011 }[this.trackId];
    this.stage.setTimeOfDay(h, fog);
    this.trackVis.setNight(this.stage.night);
    this.trackVis.setWet(settings.rain ? 1 : 0);
    this.post.wet = settings.rain ? 1 : 0;
    this.post.puddles = this.track.def.wetPatches || [];
    this.applyGraphics();
  }

  placeAtStart() {
    const tr = this.track;
    const s = tr.closed ? (tr.startS - 30 + tr.length) % tr.length : Math.max(10, tr.startS - 28);
    const sp = tr.spawnAt(s);
    this.veh.reset(sp.x, sp.z, sp.heading);
    this.rig.pos.set(0, 0, 0);
  }

  resetToTrack() {
    const n = this.track.nearest(this.veh.p.x, this.veh.p.z);
    const p = this.track.sample(n.i);
    this.veh.reset(p.x, p.z, p.heading);
    this.hud.toast('Car reset');
  }

  /* ------------------------------------------------------------ session */
  startSession() {
    this.ui.hideAll();
    this.mode = settings.mode;
    this.run = new Run(this.mode, this.track);
    this.best = (getBoard(this.trackId, this.spec.id, this.mode)[0] || {}).score || 0;
    this.ghost = null;
    if (this.ghostVis) { this.stage.scene.remove(this.ghostVis.root); this.ghostVis = null; }
    if (this.mode === 'ghost') {
      const g = loadGhost(this.trackId, this.spec.id);
      if (g && g.frames && g.frames.length) {
        this.ghost = new GhostPlayer(g);
        this.ghostVis = buildProceduralCar(this.spec, { paint: '#47e0ff', wheelStyle: 'fivespoke' }, { ghost: true });
        this.stage.scene.add(this.ghostVis.root);
      } else this.hud.toast('No ghost yet. Finish a Score Attack or Ghost run to create one');
    }
    this.placeAtStart();
    this.skids.clear(); this.smoke.clear(); this.recorder.clear();
    this.applyAssists();
    this.hud.show(true);
    this.state = 'driving';
    this.countdown = this.mode === 'free' ? 0 : 3;
    this.rig.snap();
    this.audio.suspend(false);
  }
  pause() {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    this.ui.go('pause');
  }
  resume() { this.ui.hideAll(); this.state = 'driving'; this.lastT = performance.now(); }
  restart() { this.exitReplay(true); this.startSession(); }
  quitToMenu() {
    this.exitReplay(true);
    this.hud.show(false);
    if (this.ghostVis) { this.stage.scene.remove(this.ghostVis.root); this.ghostVis = null; }
    this.placeAtStart();
    this.state = 'menu';
    this.ui.go('menu');
  }
  onScreen(id) { if (['menu', 'garage', 'setup', 'leaderboards'].includes(id) && this.state !== 'paused' && this.state !== 'results') this.state = 'menu'; }

  /* ------------------------------------------------------------ replay */
  startReplay() {
    if (this.recorder.count < 30) { this.hud.toast('Nothing recorded yet'); return; }
    this.prevState = this.state;
    this.ui.hideAll();
    this.state = 'replay';
    this.replayT = Math.max(0, this.recorder.duration - 30);
    this.replaySpeed = 1; this.replayCam = 'cinematic';
    $('replayBar').hidden = false; $('rpSlow').textContent = '0.5×'; $('rpCam').textContent = 'Camera: cinematic';
    this.hud.show(false);
    this.fake = {
      p: new THREE.Vector3(), q: new THREE.Quaternion(), wheels: this.veh.wheels.map((w) => ({ ...w })), telemetry: { ...this.veh.telemetry },
      brakeIn: 0, handbrakeIn: 0, delta: 0, spec: this.spec, drivetrain: { throttleEff: 0, load: 0 }, assists: this.veh.assists, automatic: this.veh.automatic,
    };
    this.smoke.clear();
  }
  exitReplay(silent) {
    if (this.state !== 'replay') return;
    $('replayBar').hidden = true;
    this.state = this.prevState === 'results' ? 'results' : 'paused';
    if (silent) return;
    this.hud.show(true);
    this.ui.go(this.state === 'results' ? 'results' : 'pause');
  }

  /* ------------------------------------------------------------ loop */
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    const inp = this.input.update(dt);
    const e = this.input.edges;

    if (this.state === 'replay') { if (e.pause) this.exitReplay(); this.replayFrame(dt); return; }
    if (e.pause) {
      if (this.state === 'driving') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    const driving = this.state === 'driving';
    const veh = this.veh;

    // ---------------------------------------------------- physics
    if (driving || this.state === 'menu') {
      if (driving) {
        if (e.camera) { this.hud.toast(this.rig.next()); settings.camera = this.rig.mode; save(); }
        if (e.reset) this.resetToTrack();
        if (e.toggleTrans) { veh.automatic = !veh.automatic; settings.automatic = veh.automatic; save(); this.hud.toast(veh.automatic ? 'Automatic' : 'Manual'); }
      }
      let pin = driving ? inp : { throttle: 0, brake: 0, steer: 0, handbrake: 1, clutch: 0, analogSteer: false };
      if (driving && this.countdown > 0) {
        this.countdown -= dt;
        this.hud.countdown(this.countdown > 0 ? String(Math.ceil(this.countdown)) : 'GO');
        pin = { ...inp, handbrake: 1, brake: 1, throttle: 0 };
        if (this.countdown <= 0) setTimeout(() => this.hud.countdown(''), 600);
      }
      this.acc += dt;
      let first = true, impactMax = 0, scrape = 0, crash = false;
      while (this.acc >= PHYS_DT) {
        const stepIn = first ? pin : { ...pin, shiftUp: false, shiftDown: false };
        first = false;
        veh.step(PHYS_DT, stepIn);
        for (const im of veh.impacts) {
          impactMax = Math.max(impactMax, im.speed);
          scrape = Math.max(scrape, im.slide);
          if (im.speed > 1.2 || im.slide > 3) crash = true;
          if (Math.random() < 0.35 && (im.slide > 2 || im.speed > 1.5)) this.sparks.emit(im.x, im.y - 0.25, im.z, im.nx, im.nz, veh.v.x, veh.v.z, 2 + Math.floor(Math.min(10, im.speed + im.slide * 0.3)));
        }
        this.acc -= PHYS_DT;
      }
      if (impactMax > 2) { this.audio.event({ type: 'impact', speed: impactMax }); }
      this.frameImpact = impactMax; this.frameScrape = scrape; this.frameCrash = crash;
      for (const ev of veh.drivetrain.events) {
        this.audio.event(ev);
        if (ev.type === 'backfire' && ev.flame) { this.flameTimer = 0.07 + Math.random() * 0.06; this.flameStrength = ev.strength; }
      }
      veh.drivetrain.events.length = 0;
      if (driving) this.recorder.push(dt, veh);
    }

    // ---------------------------------------------------- run logic
    if (driving && this.run) {
      const evs = this.run.update(dt, veh, this.frameCrash);
      for (const ev of evs) this.onRunEvent(ev);
    }

    // ---------------------------------------------------- visuals
    const lightsOn = this.stage.night > 0.35 || settings.rain;
    updateCarVisual(this.carVis, veh, dt, lightsOn);
    this.updateFlames(dt);
    this.emitTyreFx(dt, veh, driving);
    if (this.ghost && this.ghostVis && this.run && this.run.state === 'running') {
      const g = this.ghost.sample(this.run.time, this.ghostOut);
      this.ghostVis.root.visible = !!g;
      if (g) { this.ghostVis.root.position.set(g[1], g[2], g[3]); this.ghostVis.root.quaternion.set(g[4], g[5], g[6], g[7]); }
    } else if (this.ghostVis) this.ghostVis.root.visible = false;

    // ---------------------------------------------------- camera
    const carState = this.carState(veh);
    if (this.state === 'driving' || this.state === 'paused' || this.state === 'results') this.rig.update(dt, carState, this.carVis, this.frameImpact > 2 ? Math.min(1, this.frameImpact / 8) : 0);
    else { if (this.carVis.interior) this.carVis.interior.visible = false; this.rig.orbit(dt, carState.pos, this.ui.current === 'garage' ? 5.4 : 6.6, this.ui.current === 'garage' ? 1.2 : 1.7); }

    this.renderFrame(dt, veh, false);
    // ---------------------------------------------------- audio + hud
    this.audio.update(dt, veh, { paused: !(driving || this.state === 'menu'), camera: this.rig.name, rain: settings.rain, scrape: this.frameScrape });
    if (driving) {
      let ghostDelta = null;
      if (this.ghost && this.run.state === 'running') { const g = this.ghost.sample(this.run.time, this.ghostOut); if (g) ghostDelta = Math.round(this.run.scorer.live - g[8]); }
      this.hud.update(dt, veh, this.run, { units: settings.units, camera: this.rig.label, best: this.best, ghostDelta, ghostPos: this.ghostVis && this.ghostVis.root.visible ? this.ghostVis.root.position : null, fps: settings.showFps ? this.fps : null, quality: QUALITY[settings.quality].label });
    }
  }

  carState(veh) {
    const cs = this._cs || (this._cs = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), speed: 0 });
    cs.pos.set(veh.p.x, veh.p.y, veh.p.z); cs.quat.set(veh.q.x, veh.q.y, veh.q.z, veh.q.w);
    cs.vel.set(veh.v ? veh.v.x : 0, veh.v ? veh.v.y : 0, veh.v ? veh.v.z : 0);
    cs.speed = veh.telemetry.speed || 0; cs.spec = this.spec;
    cs.height = (x, z) => this.track.heightAt(x, z);
    return cs;
  }

  renderFrame(dt, veh, replay, focus) {
    const cam = this.stage.camera;
    this.stage.follow(this.carVis.root.position, dt, cam.position);
    this.trackVis.update(cam.position, this.stage.night);
    this.trackVis.setNight(this.stage.night);
    // Smoke lighting in the same physical units as the scene (albedo / π · irradiance):
    // key light (sun or moon), sky, plus nearby street / flood lights.
    const ALB = 0.75 / Math.PI;
    const kl = this.stage.key.color.clone().multiplyScalar(this.stage.key.intensity * ALB);
    const amb = this.stage.hemi.color.clone().multiplyScalar(this.stage.hemi.intensity * ALB * 0.9);
    const cp = this.carVis.root.position;
    for (const L of this.trackVis.pool || []) {
      if (!L.intensity) continue;
      const d2 = Math.max(9, L.position.distanceToSquared(cp));
      amb.add(L.color.clone().multiplyScalar((L.intensity / d2) * ALB * 0.8));
    }
    const m = Math.max(amb.r, amb.g, amb.b);
    if (m > 0.9) amb.multiplyScalar(0.9 / m);
    for (const b of this.carVis.beams || []) if (b.intensity) amb.add(new THREE.Color(0xfff1dc).multiplyScalar(0.05));
    this.smoke.update(dt, kl, amb, this.stage.scene.fog);
    this.sparks.update(dt);
    // heat haze over the exhaust tips
    const haze = [];
    if (this.stage.q.haze && (this.rig.name === 'chase' || this.rig.name === 'far' || replay)) {
      const rpmK = Math.min(1, (veh.telemetry.rpm || 0) / this.spec.engine.redline);
      for (const ex of this.carVis.exhaust.slice(0, 2)) {
        const wp = ex.clone().applyMatrix4(this.carVis.root.matrixWorld).project(cam);
        if (wp.z < 1 && Math.abs(wp.x) < 1.1 && Math.abs(wp.y) < 1.1) haze.push({ x: wp.x * 0.5 + 0.5, y: wp.y * 0.5 + 0.5, r: 0.05, s: 0.4 + rpmK * 0.8 });
      }
    }
    const night = this.stage.night, golden = this.stage.timeOfDay > 16.5 && this.stage.timeOfDay < 19.5 && night < 0.5;
    const tint = night > 0.5 ? [0.93, 0.98, 1.08] : golden ? [1.07, 1.0, 0.9] : [1.01, 1.0, 0.99];
    const speedK = Math.min(1, (veh.telemetry.kmh || 0) / 220);
    this.post.render(dt, { replay, focus, haze, tint, chroma: replay ? 0.0015 : 0.0006 + speedK * 0.0022 + (this.frameImpact > 3 ? 0.006 : 0), cut: this.rig.cut });
  }

  emitTyreFx(dt, veh, record) {
    const wheels = veh.wheels;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const vis = this.carVis.wheels[i];
      const slip = w.contact ? w.slipSpeed : 0;
      // contact point from the visual wheel (works for live play and replays)
      vis.root.updateWorldMatrix(true, false);
      const cp = new THREE.Vector3().setFromMatrixPosition(vis.root.matrixWorld);
      cp.y -= w.r;
      const wet = w.wet || (settings.rain ? 1 : 0);
      // skid marks (persistent)
      if (record) {
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.carVis.root.quaternion);
        const strength = Math.min(1, Math.max(0, (slip - 2.6) / 7)) * (w.offroad ? 0 : 1) * (1 - 0.5 * wet);
        cp.y = this.track.heightAt(cp.x, cp.z);
        this.skids.add(i, cp, side, w.width, strength, wet > 0.5);
      }
      // tyre smoke
      if (slip > 3.4 && !w.offroad) {
        const rate = (slip - 3.4) * 5 * Math.min(1.5, (w.Fz || 4000) / 4000) * (wet > 0.5 ? 0.3 : 1) * (w.front ? 0.55 : 1);
        this.emitAcc[i] += rate * dt;
        const vx = veh.v ? veh.v.x : 0, vz = veh.v ? veh.v.z : 0;
        while (this.emitAcc[i] >= 1) {
          this.emitAcc[i] -= 1;
          this.smoke.emit(cp.x + (Math.random() - 0.5) * 0.5, cp.y + 0.25, cp.z + (Math.random() - 0.5) * 0.5,
            vx * 0.18 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.8, vz * 0.18 + (Math.random() - 0.5) * 2,
            0.6 + Math.random() * 0.5, 3.8 + Math.random() * 3.2, 0.85 + Math.random() * 0.15);
        }
      } else this.emitAcc[i] = 0;
    }
  }

  updateFlames(dt) {
    this.flameTimer -= dt;
    const on = this.flameTimer > 0;
    for (const f of this.flames) {
      f.visible = on;
      if (on) { f.material.uniforms.uIntensity.value = (0.6 + Math.random() * 0.6) * (this.flameStrength || 1); f.material.uniforms.uTime.value += dt; f.scale.set(1, 1, 0.7 + Math.random() * 0.9); }
    }
    if (this.flash) this.flash.intensity = on ? 25 * (this.flameStrength || 1) : 0;
  }

  replayFrame(dt) {
    const rec = this.recorder, fake = this.fake;
    this.replayT += dt * this.replaySpeed;
    if (this.replayT >= rec.duration) this.replayT = Math.max(0, rec.duration - 30);
    rec.apply(this.replayT, fake);
    // derive the steering-wheel angle from the front wheel steer
    fake.delta = (fake.wheels[0].steer + fake.wheels[1].steer) / 2;
    updateCarVisual(this.carVis, fake, dt, this.stage.night > 0.35 || settings.rain);
    this.carVis.root.updateMatrixWorld(true);
    fake.v = null;
    fake.telemetry.speed = 0;
    this.emitTyreFx(dt * this.replaySpeed, fake, false);
    let focus = 10;
    if (this.replayCam === 'cinematic') focus = this.rig.cinematic(dt, this.carVis.root.position, this.trackVis.camSpots);
    else { this.rig.mode = 0; this.rig.update(dt, this.carState(fake), this.carVis, 0); }
    this.renderFrame(dt * this.replaySpeed, fake, true, focus);
    fake.drivetrain.throttleEff = fake.telemetry.throttle; fake.drivetrain.load = fake.telemetry.throttle;
    fake.telemetry.kmh = 0;
    this.audio.update(dt, fake, { paused: false, camera: 'chase', rain: settings.rain, scrape: 0 });
  }

  /* ------------------------------------------------------------ run events */
  onRunEvent(ev) {
    const h = this.hud;
    switch (ev.type) {
      case 'start': h.popup('GO!', 'GOOD'); break;
      case 'transition': h.popup(`Transition ×${ev.mult}`, 'GREAT small'); break;
      case 'combo': h.popup(`Combo ×${ev.mult}`, 'GOOD small'); break;
      case 'chain': h.popup(`Chain ×${ev.mult}`, 'GREAT small'); break;
      case 'banked': if (ev.points > 150) h.popup(`+${ev.points.toLocaleString()}`, ev.points > 3000 ? 'PERFECT' : 'GOOD'); break;
      case 'crash': h.popup(ev.lost > 0 ? `Wall hit · −${ev.lost.toLocaleString()}` : 'Wall hit', 'crash'); break;
      case 'zoneEnter': this.trackVis.highlightZone(ev.zone.id, true); break;
      case 'zone': this.trackVis.highlightZone(ev.zone.id, false); h.popup(`${ev.zone.label}: ${ev.grade}`, ev.grade); break;
      case 'lap': if (ev.lap < this.track.laps) h.popup(`Lap ${ev.lap + 1}`, 'GOOD'); break;
      case 'abort': h.toast(ev.reason); break;
      case 'finish': this.finishRun(ev.result); break;
      default: break;
    }
  }

  finishRun(r) {
    const mode = this.mode;
    const score = mode === 'zones' ? Math.round(r.verdict.total) : r.score;
    const detail = mode === 'zones' ? `${r.verdict.total.toFixed(1)}/100 · line ${r.verdict.line} angle ${r.verdict.angle} style ${r.verdict.style}` : `${r.time.toFixed(1)}s · max ${r.maxAngle}° · ${r.crashes} hits`;
    const rank = submitScore(this.trackId, this.spec.id, mode, score, detail);
    let ghostSaved = false;
    if (mode === 'score' || mode === 'ghost') {
      const old = loadGhost(this.trackId, this.spec.id);
      if (!old || r.score > old.score) ghostSaved = saveGhost(this.trackId, this.spec.id, r.ghost);
    }
    setTimeout(() => {
      if (this.state !== 'driving') return;
      this.state = 'results';
      this.ui.showResults(r, rank, this.best, ghostSaved);
    }, 1200);
  }
}

const game = new Game();
window.__apex = game;
game.boot().catch((e) => {
  console.error(e);
  $('loadMsg').textContent = 'Failed to start: ' + e.message + '. Run through a local server (see README).';
});
