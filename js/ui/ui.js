/* ==========================================================================
   Menus: main menu, session setup, garage (paint / wheels / tuning with
   explanations), settings (graphics, assists, controls remap, audio,
   gameplay), leaderboards, pause and results.
   ========================================================================== */
import { CARS, CAR_IDS, TUNING_FIELDS, defaultTuning } from '../cars/carSpecs.js';
import { TRACKS, TRACK_IDS } from '../tracks/trackDefs.js';
import { settings, save, carSetup, getBoard, ACTION_LABELS, DEFAULT_KEYS, ASSIST_PRESETS } from '../config.js';
import { QUALITY, QUALITY_IDS } from '../render/stage.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MODES = {
  free: { name: 'Free Roam', desc: 'Drive anywhere, no timer, no pressure.' },
  score: { name: 'Drift Score Attack', desc: 'Angle × speed × duration. Chain drifts to build the combo; walls break it.' },
  zones: { name: 'Zone Challenge', desc: 'Clip points and outer zones judged on Line, Angle and Style.' },
  ghost: { name: 'Ghost Battle', desc: 'Score attack against a replay of your best run on this track.' },
};
export const MODE_IDS = Object.keys(MODES);
export { MODES };
const PAINTS = ['#c7cbd1', '#0d0f12', '#f4f4f2', '#d9241f', '#1f6fd6', '#ffb400', '#2d8a4e', '#7a3fd1', '#ff6a00', '#5b6b7a', '#c0a062', '#e83e8c'];
const fmtKey = (c) => (c || '—').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow ').replace(/(.)(Left|Right)$/, '$1 $2');

export class UI {
  constructor(game) {
    this.g = game;
    this.screens = ['menu', 'setup', 'garage', 'settingsScr', 'leaderboards', 'pause', 'results'];
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => this.go(b.dataset.go); });
    $('settingsBack').onclick = () => this.go(this.settingsReturn || 'menu');
    // pause
    $('pResume').onclick = () => game.resume();
    $('pRestart').onclick = () => game.restart();
    $('pReplay').onclick = () => game.startReplay();
    $('pSettings').onclick = () => { this.settingsReturn = 'pause'; this.go('settingsScr'); };
    $('pQuit').onclick = () => game.quitToMenu();
    // setup conditions
    $('tod').oninput = () => { $('todDefault').checked = false; settings.timeOfDay = +$('tod').value; this.todLabel(); game.applyConditions(); save(); };
    $('todDefault').onchange = () => { settings.timeOfDay = $('todDefault').checked ? null : +$('tod').value; game.applyConditions(); this.syncTod(); save(); };
    $('rainToggle').onchange = () => { settings.rain = $('rainToggle').checked; game.applyConditions(); save(); };
    $('startBtn').onclick = () => game.startSession();
  }

  go(id) {
    for (const s of this.screens) $(s).hidden = s !== id;
    this.current = id;
    if (id === 'menu') this.menuCar();
    if (id === 'setup') this.buildSetup();
    if (id === 'garage') this.buildGarage();
    if (id === 'settingsScr') this.buildSettings(this.setTab || 'graphics');
    if (id === 'leaderboards') this.buildLeaderboards();
    this.g.onScreen && this.g.onScreen(id);
  }
  hideAll() { for (const s of this.screens) $(s).hidden = true; this.current = null; }

  menuCar() {
    const c = CARS[settings.car], t = TRACKS[settings.track];
    $('menuCar').innerHTML = `<div class="sub">${esc(c.chassis)}</div><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.tagline)}</div><div class="sub" style="margin-top:8px">Track: <b>${esc(t.name)}</b></div>`;
  }

  /* ------------------------------------------------------------ setup */
  buildSetup() {
    const mc = $('modeCards');
    mc.innerHTML = MODE_IDS.map((m) => `<button class="card ${settings.mode === m ? 'on' : ''}" data-m="${m}"><b>${MODES[m].name}</b><span>${MODES[m].desc}</span></button>`).join('');
    mc.querySelectorAll('.card').forEach((b) => { b.onclick = () => { settings.mode = b.dataset.m; save(); this.buildSetup(); }; });
    const tc = $('trackCards');
    tc.innerHTML = TRACK_IDS.map((t) => `<button class="card ${settings.track === t ? 'on' : ''}" data-t="${t}"><b>${TRACKS[t].name}</b><span>${TRACKS[t].subtitle}</span></button>`).join('');
    tc.querySelectorAll('.card').forEach((b) => { b.onclick = async () => { settings.track = b.dataset.t; save(); this.buildSetup(); await this.g.loadTrack(settings.track); }; });
    $('rainToggle').checked = settings.rain;
    this.syncTod();
  }
  syncTod() {
    const def = TRACKS[settings.track].defaultTime;
    $('todDefault').checked = settings.timeOfDay == null;
    $('tod').value = settings.timeOfDay == null ? def : settings.timeOfDay;
    this.todLabel();
  }
  todLabel() {
    const h = +$('tod').value;
    const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
    const phase = h < 5 || h > 20.5 ? 'Night' : h < 7.5 ? 'Dawn' : h < 17 ? 'Day' : h < 19.5 ? 'Sunset' : 'Dusk';
    $('todLabel').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${phase}`;
  }

  /* ------------------------------------------------------------ garage */
  buildGarage() {
    const id = settings.car, spec = CARS[id], setup = carSetup(id);
    $('carTabs').innerHTML = CAR_IDS.map((c) => `<button class="${c === id ? 'on' : ''}" data-c="${c}">${CARS[c].name.replace(/^(Nissan|BMW|Toyota) /, '')}</button>`).join('');
    $('carTabs').querySelectorAll('button').forEach((b) => { b.onclick = async () => { settings.car = b.dataset.c; save(); await this.g.setCar(settings.car); this.buildGarage(); }; });
    const peak = Math.max(...spec.engine.torque.map((x) => x[1]));
    const hp = Math.max(...spec.engine.torque.map(([r, t]) => (t * r) / 7121));
    $('carStats').innerHTML = `<div class="tag">${esc(spec.chassis)} · ${esc(spec.tagline)}</div>
      <div class="stats"><div class="stat"><b>${Math.round(hp)}</b><span>hp</span></div><div class="stat"><b>${peak}</b><span>N·m</span></div>
      <div class="stat"><b>${spec.mass}</b><span>kg</span></div><div class="stat"><b>${Math.round(spec.frontWeight * 100)}/${Math.round((1 - spec.frontWeight) * 100)}</b><span>F/R weight</span></div></div>`;
    // paint
    const sw = $('swatches');
    sw.innerHTML = PAINTS.map((c) => `<button class="swatch ${setup.paint.toLowerCase() === c ? 'on' : ''}" style="background:${c}" data-p="${c}" aria-label="Paint ${c}"></button>`).join('') + `<input type="color" id="paintPick" value="${setup.paint}" aria-label="Custom paint">`;
    sw.querySelectorAll('.swatch').forEach((b) => { b.onclick = () => { setup.paint = b.dataset.p; save(); this.g.setPaint(setup.paint); this.buildGarage(); }; });
    $('paintPick').oninput = (e) => { setup.paint = e.target.value; save(); this.g.setPaint(setup.paint); };
    // wheels
    const styles = { fivespoke: '5-spoke', mesh: 'Mesh', dish: 'Deep dish' };
    $('wheelSeg').innerHTML = Object.keys(styles).map((s) => `<button class="${setup.wheelStyle === s ? 'on' : ''}" data-w="${s}">${styles[s]}</button>`).join('');
    $('wheelSeg').querySelectorAll('button').forEach((b) => { b.onclick = async () => { setup.wheelStyle = b.dataset.w; save(); await this.g.setCar(id); this.buildGarage(); }; });
    // tuning
    const tu = setup.tuning;
    $('tuning').innerHTML = TUNING_FIELDS.filter((f) => !f.only || f.only === spec.layout).map((f) => {
      const max = f.key === 'steerLock' ? spec.steering.maxLock : f.max;
      return `<div class="tune"><div class="top"><span>${f.label}</span><b id="tv_${f.key}">${tu[f.key]}${f.unit}</b></div>
        <input type="range" min="${f.min}" max="${max}" step="${f.step}" value="${tu[f.key]}" data-k="${f.key}" aria-label="${f.label}">
        <p>${f.help}</p></div>`;
    }).join('');
    $('tuning').querySelectorAll('input').forEach((inp) => {
      inp.oninput = () => {
        const f = TUNING_FIELDS.find((x) => x.key === inp.dataset.k);
        tu[f.key] = +inp.value;
        $('tv_' + f.key).textContent = (+inp.value).toFixed(f.step < 1 ? (f.step < 0.05 ? 2 : 1) : 0) + f.unit;
        save();
        this.g.applyTuning();
      };
    });
    $('resetTune').onclick = () => { setup.tuning = defaultTuning(spec); save(); this.g.applyTuning(); this.buildGarage(); };
  }

  /* ------------------------------------------------------------ settings */
  buildSettings(tab) {
    this.setTab = tab;
    const tabs = { graphics: 'Graphics', assists: 'Assists', controls: 'Controls', audio: 'Audio', gameplay: 'Gameplay' };
    $('setTabs').innerHTML = Object.entries(tabs).map(([k, v]) => `<button class="${k === tab ? 'on' : ''}" data-t="${k}">${v}</button>`).join('');
    $('setTabs').querySelectorAll('button').forEach((b) => { b.onclick = () => this.buildSettings(b.dataset.t); });
    const body = $('setBody');
    const row = (label, sub, control) => `<div class="set-row"><div class="lbl"><b>${label}</b><span>${sub || ''}</span></div>${control}</div>`;
    const toggle = (id, on) => `<input type="checkbox" id="${id}" ${on ? 'checked' : ''}>`;
    if (tab === 'graphics') {
      body.innerHTML =
        row('Quality preset', 'Ultra renders at native resolution up to 4K.', `<select id="sQuality">${QUALITY_IDS.map((q) => `<option value="${q}" ${settings.quality === q ? 'selected' : ''}>${QUALITY[q].label}</option>`).join('')}</select>`) +
        row('Motion blur', 'Camera motion blur (High / Ultra).', toggle('sMB', settings.motionBlur)) +
        row('FPS counter', '', toggle('sFps', settings.showFps)) +
        row('What each preset does', 'Low: 0.75× res, no shadows, FXAA · Medium: shadows, bloom · High: MSAA, motion blur, SSR wet roads · Ultra: native/4K, 4K shadows, more smoke', '');
      $('sQuality').onchange = (e) => { settings.quality = e.target.value; save(); this.g.setQuality(settings.quality); };
      $('sMB').onchange = (e) => { settings.motionBlur = e.target.checked; save(); this.g.applyGraphics(); };
      $('sFps').onchange = (e) => { settings.showFps = e.target.checked; save(); };
    } else if (tab === 'assists') {
      body.innerHTML =
        row('Preset', 'Pro = everything off (default). Sport = ABS only. Casual = all on.', `<div class="seg" id="aPreset">${['pro', 'sport', 'casual'].map((p) => `<button class="${settings.assistPreset === p ? 'on' : ''}" data-p="${p}">${p.toUpperCase()}</button>`).join('')}</div>`) +
        row('Counter-steer assist', 'Helps point the front wheels where the car is sliding.', toggle('aCS', settings.assists.counterSteer)) +
        row('Traction control', 'Cuts power when the driven wheels spin (kills drifts!).', toggle('aTC', settings.assists.tc)) +
        row('ABS', 'Prevents locking the wheels under braking.', toggle('aABS', settings.assists.abs));
      body.querySelectorAll('#aPreset button').forEach((b) => { b.onclick = () => { settings.assistPreset = b.dataset.p; settings.assists = { ...ASSIST_PRESETS[b.dataset.p] }; save(); this.g.applyAssists(); this.buildSettings('assists'); }; });
      const bind = (id, key) => { $(id).onchange = (e) => { settings.assists[key] = e.target.checked; settings.assistPreset = 'custom'; save(); this.g.applyAssists(); this.buildSettings('assists'); }; };
      bind('aCS', 'counterSteer'); bind('aTC', 'tc'); bind('aABS', 'abs');
    } else if (tab === 'controls') {
      body.innerHTML = Object.keys(ACTION_LABELS).map((a) => row(ACTION_LABELS[a], '', `<div style="display:flex;gap:6px">${[0, 1].map((i) => `<button class="keycap" data-a="${a}" data-i="${i}">${esc(fmtKey(settings.keys[a][i]))}</button>`).join('')}</div>`)).join('') +
        row('Gamepad', 'RT throttle · LT brake · stick steer · A handbrake · B clutch · RB/LB shift · Y camera · X manual/auto · View reset · Menu pause', '') +
        `<div class="row-btns"><button class="btn ghost" id="kReset">Reset to defaults</button></div>`;
      body.querySelectorAll('.keycap').forEach((k) => {
        k.onclick = () => {
          k.classList.add('wait'); k.textContent = 'Press a key…';
          this.g.input.captureNext((code) => {
            const a = k.dataset.a, i = +k.dataset.i;
            if (code !== 'Escape' || a === 'pause') {
              // remove the key from any other action to avoid conflicts
              for (const other of Object.keys(settings.keys)) settings.keys[other] = settings.keys[other].map((c) => (c === code ? undefined : c));
              settings.keys[a][i] = code;
            }
            for (const other of Object.keys(settings.keys)) settings.keys[other] = settings.keys[other].filter(Boolean);
            save();
            this.buildSettings('controls');
          });
        };
      });
      $('kReset').onclick = () => { settings.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS)); save(); this.buildSettings('controls'); };
    } else if (tab === 'audio') {
      const sl = (k, label) => row(label, '', `<input type="range" min="0" max="1" step="0.01" value="${settings.volume[k]}" data-k="${k}" style="width:220px">`);
      body.innerHTML = sl('master', 'Master volume') + sl('engine', 'Engine') + sl('effects', 'Effects (tyres, turbo, impacts)') +
        row('Real engine samples', 'Drop recordings into /sounds/&lt;car&gt;/on.ogg and off.ogg (see README).', '');
      body.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => { settings.volume[r.dataset.k] = +r.value; save(); this.g.audio.applyVolume(); }; });
    } else {
      body.innerHTML =
        row('Transmission', 'Toggle in-game with M.', `<div class="seg" id="gTrans"><button class="${settings.automatic ? 'on' : ''}" data-v="1">Automatic</button><button class="${settings.automatic ? '' : 'on'}" data-v="0">Manual</button></div>`) +
        row('Speed units', '', `<div class="seg" id="gUnits"><button class="${settings.units === 'kmh' ? 'on' : ''}" data-v="kmh">km/h</button><button class="${settings.units === 'mph' ? 'on' : ''}" data-v="mph">mph</button></div>`);
      body.querySelectorAll('#gTrans button').forEach((b) => { b.onclick = () => { settings.automatic = b.dataset.v === '1'; save(); this.g.applyAssists(); this.buildSettings('gameplay'); }; });
      body.querySelectorAll('#gUnits button').forEach((b) => { b.onclick = () => { settings.units = b.dataset.v; save(); this.buildSettings('gameplay'); }; });
    }
  }

  /* ------------------------------------------------------------ leaderboards */
  buildLeaderboards() {
    const fill = (sel, items, val) => { $(sel).innerHTML = items.map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v}</option>`).join(''); };
    fill('lbTrack', TRACK_IDS.map((t) => [t, TRACKS[t].name]), this.lbT || settings.track);
    fill('lbCar', CAR_IDS.map((c) => [c, CARS[c].name]), this.lbC || settings.car);
    fill('lbMode', MODE_IDS.filter((m) => m !== 'free').map((m) => [m, MODES[m].name]), this.lbM || (settings.mode === 'free' ? 'score' : settings.mode));
    const render = () => {
      this.lbT = $('lbTrack').value; this.lbC = $('lbCar').value; this.lbM = $('lbMode').value;
      const list = getBoard(this.lbT, this.lbC, this.lbM);
      $('lbBody').innerHTML = list.length ? list.map((e, i) => `<tr><td>${i + 1}</td><td>${e.score.toLocaleString()}</td><td>${esc(e.detail)}</td><td>${e.date}</td></tr>`).join('') : '<tr><td colspan="4" style="color:var(--faint)">No runs yet. Go set one.</td></tr>';
    };
    ['lbTrack', 'lbCar', 'lbMode'].forEach((s) => { $(s).onchange = render; });
    render();
  }

  /* ------------------------------------------------------------ results */
  showResults(r, rank, best, ghostSaved) {
    const v = r.verdict;
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
    const main = r.mode === 'zones' ? `${v.total.toFixed(1)}<span style="font-size:28px"> / 100</span>` : r.score.toLocaleString();
    $('resultsCard').innerHTML = `
      <h2>${r.mode === 'zones' ? 'Judges’ score' : 'Run complete'}</h2>
      <div class="res-score">${main}</div>
      <div class="res-sub">${fmt(r.time)} · best single drift ${r.bestDrift.toLocaleString()} · max angle ${r.maxAngle}° · wall hits ${r.crashes}</div>
      <div class="judge"><div><b>${v.line}</b><span>Line</span></div><div><b>${v.angle}</b><span>Angle</span></div><div><b>${v.style}</b><span>Style</span></div></div>
      <div class="zone-list">${r.zones.map((z) => `<span class="zchip ${z.grade}">${esc(z.label)} · ${z.grade}</span>`).join('')}</div>
      <p class="res-sub">${rank ? `Leaderboard position <b>#${rank}</b>` : 'Not in your top 10'}${best ? ` · personal best ${best.toLocaleString()}` : ''}${ghostSaved ? ' · new ghost saved' : ''}</p>
      <div class="row-btns"><button class="btn ghost" id="rReplay">Watch replay</button><button class="btn ghost" id="rMenu">Menu</button><button class="btn" id="rRetry">Retry</button></div>`;
    $('rReplay').onclick = () => this.g.startReplay();
    $('rMenu').onclick = () => this.g.quitToMenu();
    $('rRetry').onclick = () => this.g.restart();
    this.go('results');
  }
}
