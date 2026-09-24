# HALCYON

A vertical-slice boss fight on a flooded salt mirror at blue hour. One pilgrim, one glaive, and
Halcyon, Warden of the Still Water: a stilt-legged wader with a salt-crystal shell and a lantern
beneath its body.

## Run

```
npm install
npm run dev          # http://localhost:5173
```

`npm run build` produces a static build in `dist/`.

| Input | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD | left stick |
| Strike (3-hit combo) | LMB / J | X / RT |
| Skim (dodge, i-frames) | Space / K / RMB | A / B |
| Drink the still water (heal, 3 charges) | R / E | Y |
| Toggle lock-on / free camera | Tab / Q / MMB | RB |

## Rebuilding the assets (Blender 5.2)

Every asset is procedural Python, run headless. Nothing is downloaded or hand-sculpted.

```
npm run assets                 # all three (needs `blender` on PATH)
blender -b --factory-startup --python blender/build_halcyon.py -- anims export sheet   # + pose contact sheets
```

| Script | Output |
|---|---|
| `blender/lib.py` | mesh builder (lofted tubes, ellipsoids, crystal prisms, weights, vertex colour and glow mask), armature helpers, per-frame action baking, socket sampling, preview renders |
| `blender/build_halcyon.py` + `halcyon_anims.py` | creature model, rig (IK legs), 17 clips, `halcyon.glb` + `halcyon_meta.json` (events, foot plants, socket paths) |
| `blender/build_player.py` | pilgrim model, rig (glaive-driven arm IK), 9 clips, `pilgrim.glb` + meta |
| `blender/build_arena.py` | salt landmarks, the predecessor's remains, pilgrim poles, horizon mesas, phase-2 spire |

Preview renders and pose sheets live in `docs/preview/`. The art direction write-up is in
`docs/ART_DIRECTION.md`.

## Code map

- `src/main.js`: game flow (title, wake, fight, phase change, death/victory, restart), hit resolution, hitstop and slow-motion
- `src/actors/boss.js`: creature runtime (materials, clip events, spring plumes, foot planting IK, hurtboxes, shell shatter)
- `src/actors/brain.js`: creature behaviour (attack selection, telegraphs, hit shapes, ring waves, spires)
- `src/actors/player.js`: pilgrim controller
- `src/world/*`: atmosphere presets (dusk, night, dawn), sky, mirror water, world lighting
- `src/fx/*`: particles, telegraph decals, glaive trail
- `src/core/audio.js`: all sound is synthesised with WebAudio

## Debug flags

`?play` skips the title, and `?debug` shows a state readout. `?auto` runs a bot, `?speed=N` runs N
simulation steps per frame, and `?tick` keeps simulating in a hidden tab. In the console,
`__stage('lance', 0.8)` stages an attack and freezes at clip time 0.8.
