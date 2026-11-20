# Car models

Drop your own car models here. They replace the built-in procedural cars automatically:

| File | Car |
|---|---|
| `gtr.glb` | Nissan GT-R (R35) |
| `bmw.glb` | BMW M4 (G82) |
| `supra.glb` | Toyota Supra (A80) |

Requirements:
- glTF binary (`.glb`), with the car facing **+Z** (forward). If yours faces another way, set `model.rotationY` in `js/cars/carSpecs.js` (in radians, for example `Math.PI` for a model facing −Z).
- Name the four wheel nodes `wheel_fl`, `wheel_fr`, `wheel_rl` and `wheel_rr` (front-left, and so on). Matching is case-insensitive and "contains", so `Wheel_FL_mesh` works too. You can change the names in `model.wheelNames`.
- Name the body paint material `paint`, `body` or `carpaint` so the garage colour applies to it.

The full guide is in the main README under "Adding your own car models".
