/* ==========================================================================
   AudioWorklet engine synthesiser.
   Models the exhaust note as a train of combustion pulses: every cylinder
   firing (720° / cylinders apart) excites a damped resonator (the exhaust).
   Per-cylinder amplitude variation, combustion noise, a 2nd harmonic and a
   load-dependent brightness give each engine its own character.
   Parameters arrive via port.postMessage and are smoothed per sample.
   ========================================================================== */
class EngineSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = { rpm: 900, load: 0, cyl: 6, res: 180, tau: 0.004, noise: 0.3, harm2: 0.3, rough: 0.08, gain: 0 };
    this.s = { rpm: 900, load: 0, gain: 0 };
    this.crank = 0;          // radians within the 720° cycle
    this.nextFire = 0;
    this.cylIdx = 0;
    this.env = 0;
    this.resPhase = 0;
    this.body = 0;
    this.lp = 0;
    this.amps = [1, 0.93, 1.05, 0.97, 1.02, 0.95, 1, 0.98];
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate, p = this.p, s = this.s;
    const cycle = Math.PI * 4;
    const interval = cycle / p.cyl;
    const decay = Math.exp(-1 / (p.tau * sr));
    for (let i = 0; i < out.length; i++) {
      s.rpm += (p.rpm - s.rpm) * 0.0015;
      s.load += (p.load - s.load) * 0.002;
      s.gain += (p.gain - s.gain) * 0.002;
      const w = (s.rpm / 60) * Math.PI * 2;
      this.crank += w / sr;
      if (this.crank >= this.nextFire) {
        // a cylinder fires
        const a = this.amps[this.cylIdx % this.amps.length];
        const jitter = 1 + (Math.random() - 0.5) * p.rough * 2;
        this.env = Math.max(this.env, (0.35 + 0.65 * Math.min(1, s.load + 0.15)) * a * jitter);
        this.resPhase = 0;
        this.cylIdx++;
        this.nextFire += interval;
        if (this.crank >= cycle) { this.crank -= cycle; this.nextFire -= cycle; }
      }
      const fres = p.res * (0.75 + 0.45 * (s.rpm / 7000));
      this.resPhase += (fres * Math.PI * 2) / sr;
      const e = this.env;
      let v = e * (Math.sin(this.resPhase) + p.harm2 * Math.sin(this.resPhase * 2 + 0.6) + 0.18 * Math.sin(this.resPhase * 3.01));
      v += e * (Math.random() * 2 - 1) * p.noise * (0.35 + s.load * 0.9);
      // low "body" thump at the firing frequency
      this.body += ((p.cyl / 2) * (s.rpm / 60) * Math.PI * 2) / sr;
      v += Math.sin(this.body) * 0.22 * (0.4 + 0.6 * s.load);
      this.env *= decay;
      // load-dependent brightness (one-pole low-pass)
      const k = 0.08 + 0.55 * Math.min(1, s.load + s.rpm / 14000);
      this.lp += (v - this.lp) * k;
      out[i] = Math.tanh(this.lp * 1.6) * s.gain;
    }
    return true;
  }
}
registerProcessor('engine-synth', EngineSynth);
