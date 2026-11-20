# APEX DRIFT

A browser car-drifting game built around a custom vehicle simulation: Pacejka "Magic Formula" tyres with combined slip, real weight transfer from a 6-DOF body on four suspension rays, and a turbocharged engine and drivetrain (clutch, gearbox, limited-slip diffs, AWD split). There are three cars, three tracks, four game modes, and Three.js PBR rendering with post-processing.

The cars are the Nissan GT-R (R35), BMW M4 (G82) and Toyota Supra (A80). The tracks are Mountain Touge, Industrial Docks and Drift Circuit.

---

## 1. Run it

The game uses ES modules, so the browser must load it from a local web server. Opening `index.html` directly with `file://` will not work.

From this folder, run either of these:

```bash
npx serve .            # Node: then open the URL it prints (usually http://localhost:3000)
python3 -m http.server 8080   # Python: then open http://localhost:8080
```

- Three.js (v0.169.0) and the fonts load from a CDN, so the first launch needs an internet connection.
- Use a desktop Chromium browser (Chrome, Edge, Arc, Brave) or Firefox. Safari works, but its WebGL is slower.
- The graphics quality is auto-detected on first launch. You can change it under Settings → Graphics.
- Click or press a key once to enable audio (browsers require a user gesture).

---

## 2. Controls

All keys can be remapped in **Settings → Controls**. Each action has two key slots.

| Action | Keyboard | Gamepad (standard layout) |
|---|---|---|
| Throttle (ramps in smoothly) | W / ↑ | RT |
| Brake / reverse | S / ↓ | LT |
| Steer | A / D or ← / → | Left stick |
| Handbrake | Space | A |
| Clutch (for clutch kicks) | Shift | B |
| Shift up / down (manual) | E / Q | RB / LB |
| Change camera | C | Y |
| Reset car to track | R | View / Back |
| Manual / automatic | M | X |
| Pause | Esc | Menu / Start |

**Steering feel.** Keyboard steering is speed-sensitive: you get full lock when slow or sliding, and less when gripping at speed. When you release the steering keys, the front wheels self-align with the direction of travel. This is caster, as in a real car, and it is not an assist. During a slide the car naturally counter-steers itself, the same way drifters let the wheel spin through their hands.

**Automatic gearbox.** The automatic gearbox also works the clutch for you, including dipping it when you pull the handbrake. In **manual** you control everything yourself: hold Shift for clutch kicks, and Q into neutral, then Q again for reverse.

### Drift techniques that work
- **Handbrake entry:** turn in, then tap Space. The rear locks and steps out. Get back on the throttle and catch the slide with counter-steer.
- **Clutch kick:** with throttle held mid-corner, tap Shift. The revs flare, and when the clutch bites again the torque spike breaks the rear tyres loose.
- **Power-over:** in a low gear, use full throttle mid-corner. The Supra's big turbo surge does this on its own.
- **Feint (Scandinavian flick):** steer briefly away from the corner, then snap back. The weight swing pendulums the rear out.
- **Weight-transfer entry:** brake or lift on entry. Load shifts to the front tyres and the rear loses grip.
- **Holding it:** counter-steer to match the slide and steer the angle with the throttle. More throttle gives more angle; lifting straightens the car.

---

## 3. Game modes

| Mode | What it is |
|---|---|
| **Free Roam** | No timer. Drift scoring still runs, so you can practise combos. |
| **Drift Score Attack** | Cross the start line, then score until the finish (touge) or for 2 laps (docks, circuit). Points come from angle × speed × duration. Each **transition** (switching drift direction) and every 3 s of continuous drift raises the combo multiplier up to ×5. **Hitting a wall** wipes the current drift and resets the combo. |
| **Zone Challenge** | Judged like a drift competition. Yellow **clip points** sit on the inside of corners and are judged on your front bumper. Cyan **outer zones** are judged on your rear bumper's distance to the edge. The final score out of 100 is Line 40%, Angle 30% and Style 30% (speed, commitment, cleanliness). |
| **Ghost Battle** | Score attack against a translucent replay of your best Score Attack or Ghost run for this track and car. The HUD shows your live score difference. |

Every finished run goes into a **local top-10 leaderboard** per track × car × mode, stored in browser localStorage. Press **Esc → Watch replay** (or use the results screen) to see the last 30 s from cinematic trackside cameras, with letterboxing, depth of field and a 0.5× slow-motion toggle.

---

## 4. Tracks & conditions

- **Mountain Touge:** a 2.2 km downhill switchback descent with five long runs joined by hairpins. It has guardrails, a pine-covered mountainside and sodium streetlights. Night by default.
- **Industrial Docks:** a wide-open port with stacked shipping containers to weave between, gantry cranes, floodlights and puddles that cut grip by about 30%. Sunset by default.
- **Drift Circuit:** a purpose-built track with tyre walls, paved run-off, kerbs, grandstands and floodlights. Afternoon by default.

**Time of day** can be anything from 0:00 to 24:00. It drives the sun and moon, sky, fog, environment reflections, street and flood lights (with real point lights near the car), headlights and colour grading. **Rain** makes the sky overcast, darkens and glosses the roads, lowers tyre grip by about 32%, reduces smoke and squeal, and enables screen-space reflections on wet ground.

---

## 5. Garage & tuning

Pick a car, a paint colour (presets or a custom picker) and a wheel style (5-spoke, mesh, deep dish). Each tuning slider has an explanation under it in the game:

| Setting | Effect in the simulation |
|---|---|
| Steering angle | Maximum wheel lock (each car has its own limit) |
| Front / rear camber | Lateral grip bonus up to about −4°, with a longitudinal grip penalty |
| Front / rear tyre pressure | Peak grip (best around 2.05 bar) and tyre stiffness (higher pressure is sharper but slides more) |
| Front / rear stiffness | Spring, damper and anti-roll bar rates, which change weight-transfer balance |
| Diff lock | LSD lock ramp. 100% is effectively welded |
| Final drive / gear spacing | Overall gearing and how close the ratios are |
| Brake bias | Front/rear brake split |
| Turbo boost | Boost pressure multiplier |
| AWD rear bias (GT-R only) | Centre-diff torque split; 100% turns the GT-R into a RWD car |

Settings are saved per car.

---

## 6. Adding your own car models

Download or make `.glb` models and put them in `models/`:

```
models/gtr.glb     Nissan GT-R
models/bmw.glb     BMW M4
models/supra.glb   Toyota Supra
```

When a file is present it replaces the procedural car on the next load. The loader does the following:

1. **Scales** the model so its length matches the real car length (`dims.length` in `js/cars/carSpecs.js`).
2. **Centres** it on the wheelbase and **places it on the ground**.
3. Finds the four **wheel nodes** by name and re-parents them onto the physics wheel pivots, so they spin, steer and move with the suspension. Default names are `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, matched case-insensitively with "contains", so `Wheel_FL_001` works. If it can't find all four, it keeps the procedural wheels and logs a message to the browser console.
4. Applies the garage paint to any material whose name contains `paint`, `body` or `carpaint`.

### Setting the wheel positions
The **physics** decides where the wheels are, from these fields in `js/cars/carSpecs.js`:

```js
wheelbase: 2.78,          // front-to-rear axle distance (m)
trackF: 1.59, trackR: 1.60, // left-to-right wheel spacing (m)
frontWeight: 0.54,         // fixes where the centre of gravity sits between the axles
cgHeight: 0.50,            // centre-of-gravity height (m)
wheel: { rF: 0.352, rR: 0.360, ... } // wheel radius (m)
```

Your model's wheels are moved onto those positions. If the body and wheels don't line up:

- Compare the wheel centres in your 3D tool with the values above. Fix the model's proportions, or adjust `wheelbase` and `trackF`/`trackR` to match the model. That also changes the handling slightly, which is realistic.
- Use the per-car fine-tuning in `model`:

```js
model: {
  file: 'models/gtr.glb',
  wheelNames: { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' },
  paintMaterials: ['paint', 'body', 'carpaint'],
  rotationY: 0,            // Math.PI if your model faces −Z
  scale: 1.0,              // optional extra scale after auto-fit
  offset: [0, 0.02, 0.05], // optional body nudge in metres (x, y, z)
},
```

Exhaust tip positions (for flames, heat haze and the BOV) are in `look.exhaust`.

---

## 7. Adding real engine sounds

Every sound is synthesised by default. The engine is an AudioWorklet that models each cylinder's combustion pulse exciting an exhaust resonance, tuned per car. To use real recordings instead, see `sounds/README.md`. In short:

```
sounds/supra/on.ogg  + off.ogg  + sound.json  { "on": "on.ogg", "off": "off.ogg", "onRpm": 4000, "offRpm": 4000 }
sounds/sounds.json   { "bov": "bov.ogg", "turbo": "turbo.ogg", "squeal": "squeal.ogg" }
```

The on/off loops are pitch-shifted by RPM and crossfaded by throttle load.

---

## 8. Graphics & performance

| Preset | What changes |
|---|---|
| Low | 0.75× resolution, no shadows, FXAA, 450 smoke particles, fewer trees |
| Medium | Native resolution (capped at 1080p), 1K shadows, bloom, heat haze |
| High | Up to 1.5× pixel ratio (1440p cap), 2K soft shadows, 4× MSAA, camera motion blur, SSR on wet ground, 1500 smoke particles |
| Ultra | Native device resolution up to 4K, 4K shadows, longer SSR rays, 2400 smoke particles, more trees and point lights |

Turn on the FPS counter under Settings → Graphics.

**Rendering pipeline.** The scene renders in HDR (half-float), then passes through screen-space reflections, depth-based camera motion blur (the car stays sharp), bloom, depth of field (replays only), ACES tone mapping, a grading pass (heat haze, chromatic aberration, vignette, film grain, letterbox) and FXAA. Car paint uses a clear-coat physical material lit by an environment map generated from the live sky.

---

## 9. How the physics works

All physics is in `js/physics/`. It is plain JavaScript with no rendering dependency, so it can run headlessly in Node.

- **Rigid body:** a 6-DOF body with a box-approximated inertia tensor, integrated at a fixed **240 Hz**.
- **Suspension:** four rays against the track surface, with spring, bump/rebound damping, bump stops and anti-roll bars. Weight transfer is not scripted. Braking pitches the body, which loads the front springs, which raises the front tyres' vertical force, which (through Pacejka and load sensitivity) changes their grip.
- **Tyres** (`pacejka.js`): separate longitudinal (slip ratio κ) and lateral (slip angle α) Magic Formula curves, combined with a normalised-slip friction ellipse. That is why spinning or locked tyres lose lateral grip, which is what makes every drift technique work. It also includes load sensitivity, a relaxation length (lateral lag), temperature (grip peaks around 90 °C) and wear.
- **Wheel spin:** integrated implicitly, using ∂Fx/∂ω plus a prediction of the contact patch's change in speed. This stays stable at any speed and avoids the artificial drag of a naive implicit step.
- **Engine** (`drivetrain.js`): a full-boost torque curve, engine braking, an idle controller, a fuel-cut rev limiter, turbo spool driven by exhaust flow above a threshold rpm (the Supra's big single turbo lags until about 3,700 rpm and then surges), a blow-off valve on lift, and over-run pops.
- **Clutch:** solved at the velocity level each step (the locking torque is clamped to clutch capacity), which allows real clutch kicks. There is also an auto-clutch for launches, so the engine never stalls.
- **Differentials:** a clutch-type LSD (preload plus power/coast ramp) and an AWD planetary centre split for the GT-R.
- **Assists** (all off in the default **Pro** preset): counter-steer assist, traction control and ABS.

**Verification.** A headless Node test drove all three cars with a driver bot. The GT-R and M4 held steady drifts at 25° and 40° targets within about ±1° at 55–70 km/h, after handbrake, clutch-kick and power-over entries. The Supra's turbo surge makes it livelier (±10°).

---

## 10. Project layout

```
index.html               entry point + import map
css/style.css            UI
js/main.js               game controller and main loop
js/config.js             settings, key bindings, leaderboard, ghost storage
js/input.js              keyboard + gamepad, remapping, smoothing
js/physics/              math, pacejka, drivetrain, vehicle, collision
js/cars/                 carSpecs (data + tuning), carModel (procedural + GLB)
js/tracks/               trackData (centreline, surface, zones), trackDefs (3 layouts), trackBuilder (visuals)
js/render/               stage (renderer, sky, lights, rain), postfx, effects (smoke, skids, sparks, flames), cameras
js/audio/                audio engine + engine-worklet (AudioWorklet synth)
js/game/                 scoring (drift + zone judging), run (laps, finish, ghost), replay (recorder)
js/ui/                   hud (tacho, drift meter, minimap), ui (menus, garage, settings, results)
models/                  put gtr.glb / bmw.glb / supra.glb here
sounds/                  optional engine / effect recordings
```

---

## 11. Troubleshooting

- **Black screen or "Failed to start":** you opened the file directly. Serve the folder (section 1).
- **404 errors in the console for `models/*.glb` or `sounds/*.json`:** these are expected. The game checks for optional models and sounds and falls back to procedural cars and synthesised audio.
- **Low FPS:** pick a lower preset. Motion blur and SSR (High and above) are the most expensive effects.
- **No sound:** click inside the page once, and check Settings → Audio.
- **Gamepad not detected:** press a button on it after the page loads (browsers only expose a gamepad after input).

---

## 12. Ideas for future updates

1. **Online tandem drifting:** a lead and chase battle over WebRTC (low-latency peer-to-peer). Share inputs plus periodic state, and score the chaser on proximity to the leader while matching angle (like D1/FD battles).
2. **More tracks:** an Ebisu-style multi-course facility, a Hakone-style uphill touge with hairpin stacks, a snow and ice track (very low μ and long slides), and a downtown night street course.
3. **Photo mode:** a free camera, a focus/aperture/exposure/time-of-day editor, smoke freeze, livery filters and PNG export at higher resolution.
4. **Livery editor:** decals, number boards and two-tone paint, saved as JSON so it can be shared.
5. **Career and progression:** licence tests for each drift technique, a parts shop (angle kits, bigger turbos, hydraulic handbrake), and a tuning dyno screen showing the torque curve live.
6. **Physics depth:** dynamic camber from suspension geometry, tyre carcass flex, kingpin/caster self-aligning torque with force feedback for wheels (Gamepad haptics / WebHID), and surface-dependent Pacejka sets for gravel and wet.
7. **Replays 2.0:** save and share replays as small files of compressed state, a free orbit camera, and a timeline scrubber.
8. **Accessibility:** colour-blind HUD palettes, an option to reduce motion blur and camera shake, and one-handed control layouts.
