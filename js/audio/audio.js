/* ==========================================================================
   Audio: RPM / load-driven engine (worklet synth, or real samples from
   /sounds when provided), turbo whistle, blow-off valve, backfire pops,
   slip-driven tyre squeal, gear-shift clunks, wind, rain, impacts.
   ========================================================================== */
import { settings } from '../config.js';

/** Load a sample by exact path (no guessing → no 404 spam). */
async function loadFile(ctx, path) {
  if (!path) return null;
  try {
    const r = await fetch(path);
    if (!r.ok) return null;
    return await ctx.decodeAudioData(await r.arrayBuffer());
  } catch (_) { return null; }
}
async function loadJson(path) {
  try { const r = await fetch(path); return r.ok ? await r.json() : null; } catch (_) { return null; }
}

export class AudioEngine {
  constructor() { this.ready = false; this.samples = {}; }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.engineBus = ctx.createGain(); this.engineBus.connect(this.master);
    this.fxBus = ctx.createGain(); this.fxBus.connect(this.master);
    // noise buffer shared by everything
    const nb = (this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate));
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // ---- engine chain
    try {
      await ctx.audioWorklet.addModule('js/audio/engine-worklet.js');
      this.synth = new AudioWorkletNode(ctx, 'engine-synth');
    } catch (e) { console.warn('AudioWorklet unavailable', e); this.synth = null; }
    this.engTone = ctx.createBiquadFilter(); this.engTone.type = 'lowpass'; this.engTone.Q.value = 0.7;
    this.engPeak = ctx.createBiquadFilter(); this.engPeak.type = 'peaking'; this.engPeak.Q.value = 1.2; this.engPeak.gain.value = 5;
    this.engShaper = ctx.createWaveShaper(); this.engShaper.curve = this.curve(2.2);
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    if (this.synth) this.synth.connect(this.engPeak);
    this.engPeak.connect(this.engShaper); this.engShaper.connect(this.engTone); this.engTone.connect(this.engGain); this.engGain.connect(this.engineBus);
    // intake / induction roar
    this.intake = this.loopNoise(); this.intakeF = ctx.createBiquadFilter(); this.intakeF.type = 'bandpass'; this.intakeF.Q.value = 1.4;
    this.intakeG = ctx.createGain(); this.intakeG.gain.value = 0;
    this.intake.connect(this.intakeF); this.intakeF.connect(this.intakeG); this.intakeG.connect(this.engineBus);

    // ---- turbo whistle + spool whoosh
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG); this.turboG.connect(this.fxBus); this.turbo.start();
    this.whoosh = this.loopNoise(); this.whooshF = ctx.createBiquadFilter(); this.whooshF.type = 'bandpass'; this.whooshF.Q.value = 3;
    this.whooshG = ctx.createGain(); this.whooshG.gain.value = 0;
    this.whoosh.connect(this.whooshF); this.whooshF.connect(this.whooshG); this.whooshG.connect(this.fxBus);

    // ---- tyre squeal (noise band + pitched oscillator with vibrato)
    this.sqN = this.loopNoise(); this.sqF = ctx.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.Q.value = 7;
    this.sqOsc = ctx.createOscillator(); this.sqOsc.type = 'sawtooth';
    this.sqOscF = ctx.createBiquadFilter(); this.sqOscF.type = 'bandpass'; this.sqOscF.Q.value = 9;
    this.sqVib = ctx.createOscillator(); this.sqVib.frequency.value = 9; const vg = ctx.createGain(); vg.gain.value = 18;
    this.sqVib.connect(vg); vg.connect(this.sqOsc.frequency);
    this.sqG = ctx.createGain(); this.sqG.gain.value = 0;
    this.sqN.connect(this.sqF); this.sqF.connect(this.sqG);
    const og = ctx.createGain(); og.gain.value = 0.12; this.sqOsc.connect(this.sqOscF); this.sqOscF.connect(og); og.connect(this.sqG);
    this.sqG.connect(this.fxBus); this.sqOsc.start(); this.sqVib.start();
    // ---- surface rumble, wind, rain, wall scrape
    this.rumble = this.loopNoise(); this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 260;
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0; this.rumble.connect(this.rumbleF); this.rumbleF.connect(this.rumbleG); this.rumbleG.connect(this.fxBus);
    this.wind = this.loopNoise(); this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 700;
    this.windG = ctx.createGain(); this.windG.gain.value = 0; this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.fxBus);
    this.rainN = this.loopNoise(); this.rainF = ctx.createBiquadFilter(); this.rainF.type = 'highpass'; this.rainF.frequency.value = 2500;
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0; this.rainN.connect(this.rainF); this.rainF.connect(this.rainG); this.rainG.connect(this.fxBus);
    this.scrape = this.loopNoise(); this.scrapeF = ctx.createBiquadFilter(); this.scrapeF.type = 'bandpass'; this.scrapeF.frequency.value = 2200; this.scrapeF.Q.value = 2;
    this.scrapeG = ctx.createGain(); this.scrapeG.gain.value = 0; this.scrape.connect(this.scrapeF); this.scrapeF.connect(this.scrapeG); this.scrapeG.connect(this.fxBus);

    // optional global samples, listed in sounds/sounds.json: { "bov": "bov.ogg", "turbo": "turbo.ogg", "squeal": "squeal.ogg" }
    const g = (await loadJson('sounds/sounds.json')) || {};
    this.samples.bov = await loadFile(ctx, g.bov && 'sounds/' + g.bov);
    this.samples.turbo = await loadFile(ctx, g.turbo && 'sounds/' + g.turbo);
    this.samples.squeal = await loadFile(ctx, g.squeal && 'sounds/' + g.squeal);
    if (this.samples.squeal) { this.sqSample = this.loopBuffer(this.samples.squeal, this.sqG); }
    if (this.samples.turbo) { this.turboSample = this.loopBuffer(this.samples.turbo, this.turboG); this.turbo.disconnect(); }
    this.ready = true;
    this.applyVolume();
  }

  curve(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }
  loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; s.start(); return s; }
  loopBuffer(buf, dest) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; const g = this.ctx.createGain(); s.connect(g); g.connect(dest); s.start(); s.gainNode = g; return s; }

  applyVolume() {
    if (!this.ctx) return;
    const v = settings.volume;
    this.master.gain.value = v.master;
    this.engineBus.gain.value = v.engine;
    this.fxBus.gain.value = v.effects;
  }

  /** Configure for a car (character + optional recorded samples). */
  async setCar(spec) {
    if (!this.ready) return;
    this.spec = spec;
    const s = spec.sound;
    if (this.synth) this.synth.port.postMessage({ cyl: spec.engine.cylinders, res: s.res, tau: s.tau, noise: s.noise, harm2: s.harm2, rough: s.rough });
    this.engPeak.frequency.value = s.res * 1.6;
    // samples: sounds/<car>/sound.json → { "on": "on.ogg", "off": "off.ogg", "onRpm": 4000, "offRpm": 4000 }
    for (const k of ['onSrc', 'offSrc']) if (this[k]) { this[k].stop(); this[k] = null; }
    const j = (await loadJson(`sounds/${spec.id}/sound.json`)) || {};
    const on = await loadFile(this.ctx, j.on && `sounds/${spec.id}/${j.on}`);
    const off = await loadFile(this.ctx, j.off && `sounds/${spec.id}/${j.off}`);
    this.sampleRpm = { on: j.onRpm || 4000, off: j.offRpm || j.onRpm || 4000 };
    if (on) {
      this.onSrc = this.loopBuffer(on, this.engineBus);
      this.offSrc = off ? this.loopBuffer(off, this.engineBus) : null;
      this.usingSamples = true;
    } else this.usingSamples = false;
  }

  /** Per-frame update from vehicle telemetry. */
  update(dt, veh, opts) {
    if (!this.ready || !veh) return;
    const t = this.ctx.currentTime, T = veh.telemetry, s = this.spec.sound, e = this.spec.engine;
    const rpm = T.rpm, load = Math.max(T.throttle * 0.9, veh.drivetrain.throttleEff * 0.9) * (0.4 + 0.6 * Math.min(1, veh.drivetrain.load + 0.3));
    const paused = opts.paused ? 0 : 1;
    const inside = opts.camera === 'cockpit' || opts.camera === 'hood';
    const engineVol = paused * (0.28 + 0.4 * load) * (inside ? 1.15 : 1);
    if (this.usingSamples) {
      if (this.synth) this.synth.port.postMessage({ gain: 0 });
      this.onSrc.playbackRate.setTargetAtTime(rpm / this.sampleRpm.on, t, 0.03);
      this.onSrc.gainNode.gain.setTargetAtTime(paused * (this.offSrc ? load : 0.3 + 0.7 * load), t, 0.05);
      if (this.offSrc) { this.offSrc.playbackRate.setTargetAtTime(rpm / this.sampleRpm.off, t, 0.03); this.offSrc.gainNode.gain.setTargetAtTime(paused * (1 - load) * 0.7, t, 0.05); }
    } else if (this.synth) {
      this.synth.port.postMessage({ rpm, load, gain: 1 });
    }
    this.engGain.gain.setTargetAtTime(this.usingSamples ? 0 : engineVol, t, 0.04);
    this.engTone.frequency.setTargetAtTime((inside ? 900 : 1400) + rpm * 0.55 + load * 3500, t, 0.03);
    this.intakeF.frequency.setTargetAtTime(400 + rpm * 0.25, t, 0.05);
    this.intakeG.gain.setTargetAtTime(paused * T.throttle * (rpm / e.redline) * 0.05, t, 0.05);
    // turbo
    const b = T.boost;
    this.turbo.frequency.setTargetAtTime((1500 + 7500 * b) * s.turboPitch, t, 0.05);
    const tv = paused * b * (0.3 + 0.7 * T.throttle) * (rpm / e.redline) * s.turboVol;
    this.turboG.gain.setTargetAtTime(tv * (this.turboSample ? 0.6 : 0.012), t, 0.05);
    if (this.turboSample) this.turboSample.playbackRate.setTargetAtTime(0.6 + b * 0.9, t, 0.05);
    this.whooshF.frequency.setTargetAtTime(2200 + 3500 * b, t, 0.05);
    this.whooshG.gain.setTargetAtTime(tv * 0.05, t, 0.05);
    // tyres
    let squeal = 0, rumble = 0, wet = 0;
    for (const w of veh.wheels) {
      if (!w.contact) continue;
      const slip = Math.max(0, w.slipSpeed - 2.2);
      const k = Math.min(1, slip / 9) * Math.min(1.3, w.Fz / 4000);
      if (w.offroad) rumble = Math.max(rumble, Math.min(1, T.speed / 20)); else squeal = Math.max(squeal, k);
      wet = Math.max(wet, w.wet);
    }
    squeal *= paused * (1 - 0.65 * wet);
    const pitch = 820 + squeal * 380;
    this.sqF.frequency.setTargetAtTime(pitch, t, 0.06);
    this.sqOsc.frequency.setTargetAtTime(pitch * 0.9, t, 0.06);
    this.sqOscF.frequency.setTargetAtTime(pitch, t, 0.06);
    if (this.sqSample) this.sqSample.playbackRate.setTargetAtTime(0.85 + squeal * 0.3, t, 0.06);
    this.sqG.gain.setTargetAtTime(squeal * squeal * 0.55, t, 0.05);
    this.rumbleG.gain.setTargetAtTime(paused * (rumble * 0.35 + wet * Math.min(1, T.speed / 25) * 0.08), t, 0.08);
    this.windG.gain.setTargetAtTime(paused * Math.min(0.3, (T.speed * T.speed) / 9000) * (inside ? 0.5 : 1), t, 0.1);
    this.rainG.gain.setTargetAtTime(opts.rain ? 0.09 * (inside ? 1.4 : 1) : 0, t, 0.3);
    this.scrapeG.gain.setTargetAtTime(paused * Math.min(0.6, (opts.scrape || 0) / 12), t, 0.03);
  }

  /** One-shot events from the drivetrain / collisions. */
  event(ev) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, s = this.spec ? this.spec.sound : { bovVol: 0.5, pops: 0.5 };
    const burst = (dur, type, f0, f1, vol, q = 1) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.fxBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    };
    const thump = (f0, f1, dur, vol) => {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.fxBus); o.start(t); o.stop(t + dur + 0.05);
    };
    switch (ev.type) {
      case 'bov':
        if (this.samples.bov) { const src = ctx.createBufferSource(); src.buffer = this.samples.bov; const g = ctx.createGain(); g.gain.value = 0.6 * s.bovVol; src.connect(g); g.connect(this.fxBus); src.start(); }
        else {
          burst(0.42, 'bandpass', 3200, 700, 0.5 * s.bovVol * ev.amount, 1.5);
          // flutter on big-turbo cars
          if (s.bovVol > 0.8) for (let i = 0; i < 5; i++) { const src = ctx.createBufferSource(); src.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; const g = ctx.createGain(); const st = t + 0.05 + i * 0.045; g.gain.setValueAtTime(0, t); g.gain.setValueAtTime(0.18, st); g.gain.exponentialRampToValueAtTime(0.001, st + 0.03); src.connect(f); f.connect(g); g.connect(this.fxBus); src.start(t); src.stop(st + 0.05); }
        }
        break;
      case 'backfire':
        burst(0.07 + ev.strength * 0.05, 'lowpass', 1800, 300, 0.55 * ev.strength * s.pops, 0.8);
        thump(110, 45, 0.08, 0.5 * ev.strength);
        break;
      case 'shift':
        burst(0.03, 'highpass', 2500, 1500, 0.15);
        thump(140, 60, 0.07, 0.25);
        break;
      case 'impact':
        burst(0.25, 'lowpass', 900, 120, Math.min(1, ev.speed / 10));
        thump(90, 40, 0.18, Math.min(0.9, ev.speed / 9));
        break;
      default: break;
    }
  }

  suspend(on) { if (this.ctx) { if (on) this.ctx.suspend(); else this.ctx.resume(); } }
}
