/* ==========================================================================
   HUD: tachometer cluster (shift lights, gear, speed, boost, assists),
   drift-angle meter, tyre temperature / wear, minimap, score + popups.
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

export class Hud {
  constructor() {
    this.el = $('hud');
    this.cluster = $('cluster').getContext('2d');
    this.meter = $('driftMeter').getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.tyreEls = [...$('tyres').children];
    this.textT = 0;
    this.flash = 0;
  }
  show(on) { this.el.hidden = !on; }

  setTrack(track) {
    // pre-compute the minimap outline
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    this.mm = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale: 140 / Math.max(maxX - minX, maxZ - minZ), track };
  }

  popup(text, cls) {
    const d = document.createElement('div');
    d.className = 'pop ' + (cls || '');
    d.textContent = text;
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 1600);
    while ($('popups').children.length > 4) $('popups').firstChild.remove();
  }
  toast(text) {
    const t = $('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }
  countdown(text) { $('countdown').textContent = text || ''; }

  update(dt, veh, run, o) {
    const T = veh.telemetry, spec = veh.spec;
    this.drawCluster(T, spec, veh, o);
    this.drawMeter(T.driftAngle);
    this.drawMinimap(veh, o.ghostPos);
    this.textT -= dt;
    if (this.textT > 0) return;
    this.textT = 0.08;
    // score
    const sc = run.scorer;
    $('scoreTotal').textContent = sc.live.toLocaleString();
    $('liveVal').textContent = sc.current > 0 ? '+' + Math.round(sc.current).toLocaleString() : '';
    $('multVal').textContent = sc.multiplier > 1 ? '×' + sc.multiplier.toFixed(2).replace(/\.?0+$/, '') : '';
    // tyres
    veh.wheels.forEach((w, i) => {
      const t = w.temp;
      const col = t < 60 ? '#4aa3ff' : t < 80 ? '#5fd6c4' : t < 105 ? '#3ddc84' : t < 125 ? '#ffb800' : '#ff4d4d';
      this.tyreEls[i].style.background = col;
      this.tyreEls[i].textContent = Math.round(t) + '°';
      this.tyreEls[i].title = `Wear ${(w.wear * 100).toFixed(0)}%`;
    });
    // run info
    const modeNames = { free: 'FREE ROAM', score: 'SCORE ATTACK', zones: 'ZONE CHALLENGE', ghost: 'GHOST BATTLE' };
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
    let html = `<div class="mode">${modeNames[run.mode]}</div>`;
    if (run.state === 'pre') html += `<div class="big">→ START LINE</div>`;
    else if (run.state === 'running') {
      html += `<div class="big">${fmt(run.time)}</div>`;
      if (run.track.closed) html += `<div class="row">Lap <b>${Math.min(run.lap + 1, run.track.laps)}/${run.track.laps}</b></div>`;
      else html += `<div class="row">Progress <b>${Math.max(0, Math.min(100, (run.progress / (run.track.finishS - run.track.startS)) * 100)).toFixed(0)}%</b></div>`;
    } else if (run.state === 'free') html += `<div class="row">Best drift <b>${run.scorer.bestDrift.toLocaleString()}</b></div>`;
    if (o.best) html += `<div class="row">Best <b>${o.best.toLocaleString()}</b></div>`;
    if (o.ghostDelta != null) html += `<div class="row">Ghost <b class="delta ${o.ghostDelta >= 0 ? 'ahead' : 'behind'}">${o.ghostDelta >= 0 ? '+' : ''}${o.ghostDelta.toLocaleString()}</b></div>`;
    html += `<div class="row">${veh.automatic ? 'AUTO' : 'MANUAL'} <b>${o.camera}</b></div>`;
    $('runInfo').innerHTML = html;
    if (o.fps != null) { $('fps').hidden = false; $('fps').textContent = `${o.fps} FPS · ${o.quality}`; } else $('fps').hidden = true;
  }

  drawCluster(T, spec, veh, o) {
    const g = this.cluster, W = 300, cx = 150, cy = 158, R = 118;
    g.clearRect(0, 0, W, W);
    const red = spec.engine.redline, maxR = Math.ceil((spec.engine.limiter + 400) / 1000) * 1000;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(1, rpm / maxR);
    // backplate
    g.beginPath(); g.arc(cx, cy, R + 14, 0, TAU); g.fillStyle = 'rgba(8,10,14,0.66)'; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
    // arc
    g.lineCap = 'butt';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    g.strokeStyle = 'rgba(255,60,40,0.85)';
    g.beginPath(); g.arc(cx, cy, R, ang(red), a1); g.stroke();
    // live rpm fill
    const rpm = T.rpm;
    const grad = g.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.7, '#ffb800'); grad.addColorStop(1, '#ff4d1c');
    g.strokeStyle = grad; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R, a0, ang(rpm)); g.stroke();
    // ticks + numbers
    g.fillStyle = '#d8dde6'; g.font = '600 15px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= maxR; r += 1000) {
      const a = ang(r);
      g.strokeStyle = r >= red ? '#ff5a3c' : 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke();
      g.fillText(String(r / 1000), cx + Math.cos(a) * (R - 31), cy + Math.sin(a) * (R - 31));
    }
    // needle
    const na = ang(rpm);
    g.strokeStyle = '#ff4d1c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + Math.cos(na) * 22, cy + Math.sin(na) * 22); g.lineTo(cx + Math.cos(na) * (R - 4), cy + Math.sin(na) * (R - 4)); g.stroke();
    // shift lights
    const lights = 7, start = red * 0.72;
    const lim = rpm >= spec.engine.limiter - 60;
    this.flash += 1;
    for (let i = 0; i < lights; i++) {
      const th = start + (red - start) * (i / (lights - 1));
      const on = rpm >= th && (!lim || (this.flash >> 2) % 2 === 0);
      const col = i < 3 ? '#3ddc84' : i < 5 ? '#ffb800' : '#ff3b30';
      g.fillStyle = on ? col : 'rgba(255,255,255,0.08)';
      g.beginPath(); g.arc(cx - 54 + i * 18, cy - 74, 5.5, 0, TAU); g.fill();
    }
    // gear
    const gear = T.gear === -1 ? 'R' : T.gear === 0 ? 'N' : String(T.gear);
    g.fillStyle = '#fff'; g.font = 'italic 800 72px "Barlow Condensed", sans-serif';
    g.fillText(gear, cx, cy - 12);
    // speed
    const sp = o.units === 'mph' ? T.kmh * 0.621 : T.kmh;
    g.font = '700 34px "Barlow Condensed", sans-serif';
    g.fillText(Math.round(sp).toString(), cx, cy + 42);
    g.font = '600 13px "Barlow Condensed", sans-serif'; g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(o.units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 64);
    // boost bar
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(cx - 40, cy + 78, 80, 5);
    g.fillStyle = '#2fd8ff'; g.fillRect(cx - 40, cy + 78, 80 * Math.min(1, T.boost), 5);
    g.font = '600 11px "Barlow Condensed", sans-serif'; g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText('BOOST', cx, cy + 93);
    // assist lamps
    const lamps = [['TC', veh.assists.tc], ['ABS', veh.assists.abs], ['CS', veh.assists.counterSteer], [veh.automatic ? 'A' : 'M', true]];
    lamps.forEach(([t, on], i) => {
      g.fillStyle = on ? (t === 'M' ? '#ffb800' : '#3ddc84') : 'rgba(255,255,255,0.18)';
      g.font = '700 12px "Barlow Condensed", sans-serif';
      g.fillText(t, cx - 45 + i * 30, cy + 110);
    });
    // clutch / handbrake indicators
    if (T.clutch > 0.3) { g.fillStyle = '#ffb800'; g.fillText('CLUTCH', cx - 70, cy + 40); }
    if (T.handbrake > 0.3) { g.fillStyle = '#ff4d1c'; g.fillText('(P)', cx + 70, cy + 40); }
  }

  drawMeter(angle) {
    const g = this.meter, W = 200, H = 118, cx = 100, cy = 104, R = 86;
    g.clearRect(0, 0, W, H);
    const map = (a) => Math.PI + (Math.max(-90, Math.min(90, a)) + 90) / 180 * Math.PI;
    g.lineWidth = 9; g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.stroke();
    // sweet-spot bands
    for (const s of [-1, 1]) {
      g.strokeStyle = 'rgba(61,220,132,0.35)';
      g.beginPath(); g.arc(cx, cy, R, map(s > 0 ? 25 : -55), map(s > 0 ? 55 : -25)); g.stroke();
    }
    const a = angle;
    const col = Math.abs(a) < 12 ? '#9aa3b2' : Math.abs(a) < 25 ? '#ffb800' : Math.abs(a) < 60 ? '#3ddc84' : '#ff4d4d';
    g.strokeStyle = col; g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy, R, map(0), map(a), a < 0); g.stroke();
    const na = map(a);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + Math.cos(na) * (R - 26), cy + Math.sin(na) * (R - 26)); g.lineTo(cx + Math.cos(na) * (R + 6), cy + Math.sin(na) * (R + 6)); g.stroke();
    g.fillStyle = '#fff'; g.font = 'italic 800 34px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(Math.abs(Math.round(a)) + '°', cx, cy - 22);
    g.font = '600 11px "Barlow Condensed", sans-serif'; g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText('DRIFT ANGLE', cx, cy - 6);
  }

  drawMinimap(veh, ghost) {
    const mm = this.mm;
    if (!mm) return;
    const g = this.mini, S = 170, c = S / 2;
    g.clearRect(0, 0, S, S);
    const tr = mm.track;
    const head = veh.heading;
    const cos = Math.cos(head), sin = Math.sin(head);
    // rotate so the car always points up
    const tx = (x, z) => { const dx = (x - veh.p.x) * 0.55, dz = (z - veh.p.z) * 0.55; return [c - (dx * cos - dz * sin), c - (dx * sin + dz * cos)]; };
    g.save();
    g.beginPath(); g.arc(c, c, c - 2, 0, TAU); g.clip();
    g.lineWidth = Math.max(3, tr.width * 0.55); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineJoin = 'round';
    g.beginPath();
    tr.samples.forEach((p, i) => { if (i % 3) return; const [x, y] = tx(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    if (tr.closed) g.closePath();
    g.stroke();
    // zones
    g.lineWidth = 4;
    for (const z of tr.zones) {
      g.strokeStyle = z.type === 'clip' ? 'rgba(255,194,26,0.9)' : 'rgba(47,216,255,0.9)';
      g.beginPath();
      for (let s = z.s0; s <= z.s1; s += 4) { const p = tr.sample(Math.round(s / 2)); const [x, y] = tx(p.x, p.z); s === z.s0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    if (ghost) { const [x, y] = tx(ghost.x, ghost.z); g.fillStyle = '#47e0ff'; g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); }
    g.restore();
    g.fillStyle = '#ff4d1c';
    g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c - 5, c + 5); g.lineTo(c + 5, c + 5); g.closePath(); g.fill();
  }
}
