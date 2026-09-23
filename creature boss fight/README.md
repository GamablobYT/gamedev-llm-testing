# Tidal Bell

A contained, browser-playable 3D boss fight set in a submerged tidal observatory.

## Play

Run `npm run dev` from this folder, then open [http://127.0.0.1:4173](http://127.0.0.1:4173). Node.js is the only runtime dependency; the Three.js modules and Blender exports are included locally.

| Control | Action |
|---|---|
| WASD / arrow keys | Move |
| Click / Space / J | Strike |
| Shift / K | Evade with brief invulnerability |
| Touch stick and buttons | Mobile controls |
| R | Restart after defeat or death |

Approach the creature to strike. Its coral floor patterns warn of a broad sweep, a narrow thrust, or an expanding resonance ring. At half health, the shell opens and delayed turquoise echoes follow its attacks. Defeat and death both lead to a restart flow.

## Source assets

The Blender source scenes are `assets_source.blend`, `arena_source.blend`, and `warden_source.blend`. Their procedural source is [`tools/build_assets.py`](tools/build_assets.py). To regenerate the GLBs with Blender 5.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python tools/build_assets.py
```

The creature has a skinned armature and named clips for idle, stride, sweep, lance, pulse, recoil, shell unfurl, defeat, and six persistent phase-two variants. The observatory and player are separate Blender assets. Runtime logic and UI are in `src/main.js` and `src/style.css`.

The locally vendored Three.js 0.185.1 files retain their MIT license in `public/vendor/package/LICENSE`.
