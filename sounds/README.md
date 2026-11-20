# Engine & effect sounds (optional)

Without files here, the game synthesises every sound in real time. To use real recordings:

## Per-car engine loops
Put two seamless loops in `sounds/<car>/` (`<car>` is `gtr`, `m4` or `supra`) and describe them in `sounds/<car>/sound.json`:

```json
{ "on": "on.ogg", "off": "off.ogg", "onRpm": 4000, "offRpm": 4000 }
```
- `on` is the engine under load (throttle open) and `off` is the engine on overrun (throttle closed).
- `onRpm` / `offRpm` are the RPM each loop was recorded at. Playback speed is scaled from that RPM.

## Global effects
`sounds/sounds.json`:
```json
{ "bov": "bov.ogg", "turbo": "turbo.ogg", "squeal": "squeal.ogg" }
```
- `bov` is a one-shot blow-off valve, `turbo` a looping whistle, and `squeal` a looping tyre squeal.

Any format the browser can decode works (ogg, mp3, wav). Leave out any you don't have.
