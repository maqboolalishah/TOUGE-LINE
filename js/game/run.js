/* ==========================================================================
   Run management: start line, laps / finish, checkpoints, timing, scoring
   and ghost recording for one attempt on a track.
   Modes: free (no pressure), score (drift score attack), zones (judged
   zone challenge), ghost (score attack against your best run's replay).
   ========================================================================== */
import { DriftScorer, ZoneJudge } from './scoring.js';

export class Run {
  constructor(mode, track) {
    this.mode = mode;
    this.track = track;
    this.scorer = new DriftScorer();
    this.judge = new ZoneJudge(track);
    this.reset();
  }
  reset() {
    this.state = this.mode === 'free' ? 'free' : 'pre';
    this.time = 0; this.lap = 0; this.lastS = null; this.progress = 0; this.checkpoints = 0;
    this.ghostFrames = []; this.ghostAcc = 0;
    this.scorer.reset(); this.judge.reset();
    this.result = null;
    this.near = {};
  }

  /** @returns events */
  update(dt, veh, crash) {
    const ev = [];
    const tr = this.track;
    const n = tr.nearest(veh.p.x, veh.p.z, this.near);
    const s = n.s;
    const T = veh.telemetry;
    const offroad = n.dist > tr.width / 2 + (tr.def.open ? 14 : 1.5);
    if (this.lastS === null) this.lastS = s;
    let ds = s - this.lastS;
    if (tr.closed) { if (ds > tr.length / 2) ds -= tr.length; if (ds < -tr.length / 2) ds += tr.length; }
    this.lastS = s;

    if (this.state === 'free') {
      for (const e of this.scorer.update(dt, { kmh: T.kmh, angle: T.driftAngle, offroad, crash })) ev.push(e);
      return ev;
    }
    if (this.state === 'pre') {
      // crossing the start line forwards starts the run
      const crossed = tr.closed ? (this.prevPreS != null && this.prevPreS < tr.startS && s >= tr.startS && s - this.prevPreS < 20) : s >= tr.startS;
      this.prevPreS = s;
      if (crossed && T.fwdSpeed > 1) { this.state = 'running'; this.time = 0; this.progress = 0; ev.push({ type: 'start' }); }
      return ev;
    }
    if (this.state !== 'running') return ev;

    this.time += dt;
    this.progress += ds;
    for (const e of this.scorer.update(dt, { kmh: T.kmh, angle: T.driftAngle, offroad, crash })) ev.push(e);
    if (this.mode === 'zones' || this.mode === 'score' || this.mode === 'ghost') for (const e of this.judge.update(dt, veh, s, T.driftAngle)) ev.push(e);
    // ghost recording (20 Hz)
    this.ghostAcc += dt;
    if (this.ghostAcc >= 0.05) {
      this.ghostAcc = 0;
      const r = (v) => Math.round(v * 1000) / 1000;
      this.ghostFrames.push([r(this.time), r(veh.p.x), r(veh.p.y), r(veh.p.z), r(veh.q.x), r(veh.q.y), r(veh.q.z), r(veh.q.w), this.scorer.live]);
    }
    // laps / finish
    if (tr.closed) {
      const lapLen = tr.length;
      if (this.progress >= lapLen * (this.lap + 1) - 1) {
        this.lap++;
        ev.push({ type: 'lap', lap: this.lap });
        if (this.lap >= tr.laps) this.finish(ev);
      }
    } else if (s >= tr.finishS && this.progress > (tr.finishS - tr.startS) * 0.9) this.finish(ev);
    // stalled backwards for a long time: invalidate
    if (this.progress < -60) { this.state = 'pre'; ev.push({ type: 'abort', reason: 'Wrong way. Run reset.' }); this.scorer.reset(); this.judge.reset(); }
    return ev;
  }

  finish(ev) {
    this.state = 'finished';
    this.scorer.flush();
    const verdict = this.judge.verdict(this.scorer, this.time);
    this.result = {
      mode: this.mode, time: this.time, score: this.scorer.total, verdict,
      bestDrift: this.scorer.bestDrift, crashes: this.scorer.crashes, maxAngle: Math.round(this.scorer.maxAngle),
      zones: [...this.judge.results.values()].map((r) => ({ label: r.zone.label, grade: r.grade, quality: r.quality })),
      ghost: { frames: this.ghostFrames, score: this.scorer.total, time: this.time },
    };
    ev.push({ type: 'finish', result: this.result });
  }
}

/** Plays back a recorded ghost run by time. */
export class GhostPlayer {
  constructor(data) { this.f = data.frames; this.score = data.score; this.time = data.time; this.i = 0; }
  sample(t, out) {
    const f = this.f;
    if (!f.length) return null;
    if (t <= f[0][0]) return f[0];
    if (t >= f[f.length - 1][0]) return null;
    while (this.i < f.length - 2 && f[this.i + 1][0] < t) this.i++;
    while (this.i > 0 && f[this.i][0] > t) this.i--;
    const a = f[this.i], b = f[this.i + 1];
    const k = (t - a[0]) / (b[0] - a[0] || 1);
    for (let j = 1; j < 9; j++) out[j] = a[j] + (b[j] - a[j]) * k;
    return out;
  }
}
