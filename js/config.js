/* ==========================================================================
   Settings, persistence (localStorage) and the local leaderboard.
   Every read/write is guarded: private browsing or full storage never
   breaks the game, it just stops remembering.
   ========================================================================== */
import { CARS, defaultTuning } from './cars/carSpecs.js';

const KEY = 'apexdrift.v1';

export const DEFAULT_KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  clutch: ['ShiftLeft', 'ShiftRight'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  toggleTrans: ['KeyM'],
  pause: ['Escape'],
};
export const ACTION_LABELS = {
  throttle: 'Throttle', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', handbrake: 'Handbrake',
  clutch: 'Clutch', shiftUp: 'Shift up', shiftDown: 'Shift down', camera: 'Change camera', reset: 'Reset car',
  toggleTrans: 'Manual / auto', pause: 'Pause',
};

export const ASSIST_PRESETS = {
  pro: { counterSteer: false, tc: false, abs: false },
  sport: { counterSteer: false, tc: false, abs: true },
  casual: { counterSteer: true, tc: true, abs: true },
};

const defaults = () => ({
  car: 'supra',
  track: 'touge',
  mode: 'score',
  quality: null,             // null = auto-detect on first run
  showFps: false,
  motionBlur: true,
  units: 'kmh',
  automatic: true,
  assists: { ...ASSIST_PRESETS.pro },
  assistPreset: 'pro',
  keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)),
  volume: { master: 0.8, engine: 0.9, effects: 0.8 },
  timeOfDay: null,           // null = track default
  rain: false,
  camera: 0,
  cars: {},                  // per-car { paint, wheelStyle, tuning }
  leaderboard: {},           // "track|car|mode" -> [{score, date, detail}]
});

let state = defaults();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) state = Object.assign(defaults(), saved, { keys: Object.assign(JSON.parse(JSON.stringify(DEFAULT_KEYS)), saved.keys || {}) });
} catch (_) { /* storage unavailable */ }

export const settings = state;

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
}

export function carSetup(id) {
  const spec = CARS[id];
  if (!state.cars[id]) state.cars[id] = {};
  const c = state.cars[id];
  if (!c.paint) c.paint = spec.look.defaultPaint;
  if (!c.wheelStyle) c.wheelStyle = id === 'gtr' ? 'mesh' : id === 'm4' ? 'fivespoke' : 'dish';
  c.tuning = Object.assign(defaultTuning(spec), c.tuning || {});
  return c;
}

/* ------------------------------------------------------------ leaderboard */
export function lbKey(track, car, mode) { return `${track}|${car}|${mode}`; }
export function getBoard(track, car, mode) { return state.leaderboard[lbKey(track, car, mode)] || []; }
/** Adds a score; returns its 1-based rank (or 0 if it didn't make the top 10). */
export function submitScore(track, car, mode, score, detail) {
  const k = lbKey(track, car, mode);
  const list = state.leaderboard[k] || (state.leaderboard[k] = []);
  const entry = { score: Math.round(score), date: new Date().toISOString().slice(0, 10), detail: detail || '' };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, 10);
  save();
  return list.indexOf(entry) + 1;
}

/* ------------------------------------------------------------ ghosts */
export function loadGhost(track, car) {
  try { return JSON.parse(localStorage.getItem(`apexdrift.ghost.${track}.${car}`) || 'null'); } catch (_) { return null; }
}
export function saveGhost(track, car, ghost) {
  try { localStorage.setItem(`apexdrift.ghost.${track}.${car}`, JSON.stringify(ghost)); return true; } catch (_) { return false; }
}
