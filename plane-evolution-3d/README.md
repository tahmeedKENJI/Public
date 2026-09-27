# Plane Evolution 3D

The same launch-and-glide plane game as [`../plane-evolution`](../plane-evolution), in 3D, with
realistic terrain. It has the same mechanics, economy, progression and save. There are **no ads,
no network and no accounts**, and everything, including three.js, is bundled in this folder.

## Play

- **Easiest:** open `index.html` in a browser (double-click it). It works offline, straight from
  disk, with no build step and no server.
- **On a phone, as an app:** host this folder anywhere static (e.g. GitHub Pages), open it once,
  then "Add to Home Screen". The service worker caches every file, so it runs offline afterwards.
- **Progress is shared with the 2D game** when both are served from the same site. Otherwise, use
  ⚙️ → Export save in one and Import save in the other.

Controls are the same as in 2D: hold **▲ CLIMB** (↑ / W, or tap anywhere) and **▼ DIVE** (↓ / S);
**RESERVE** or Space burns the reserve once the main tank is empty; ❚❚ or Esc / P pauses; ✕ exits.
New in 3D:
- **🎥** (or **C**) switches the camera: **Chase** (behind the plane), **Cinematic** (three-quarter
  view) or **Side (classic)**, which frames the flight exactly like the 2D game.
- In the hangar, drag the plane to turn it.
- ⚙️ has a **Graphics** setting (Auto / Low / Medium / High). Auto starts on Medium on touch
  devices and High elsewhere, and steps down if frames get slow.

## What is in 3D

- **Six terrains** built from a procedural heightmap, with lighting, fog and weather that blend
  from one terrain to the next exactly as the 2D colours do:
  - Verdant Meadow: rolling hills, forests, bushes and flowers, with snow-capped ranges behind.
  - Amber Farmlands: a patchwork of fields with crop rows and hedges, fences, hay bales,
    windmills and barns, in the rain.
  - Sunscorch Desert: dunes, striped mesas, cacti, rocks and rolling tumbleweeds, in blowing dust.
  - Frostveil Tundra: jagged snowy mountains, snowy pines, ice rocks and frozen ponds, under an
    aurora and stars, with snowfall.
  - Ashen Caldera: volcanoes with glowing craters and smoke, glowing lava cracks, dead trees, ash,
    embers and lightning.
  - The Alien Expanse: spires, glowing crystals and veins, mushroom trees and glowing plants,
    under a ringed planet, with spores.
- The flight line runs down a flat valley floor at height 0, which is the physics ground. Hills
  rise on the far side. The near side stays a low plain for 4 km, so no camera ends up inside a
  hill.
- **Every part is its own 3D model**, and every level visibly changes it: livery stripes, bands,
  ribs and size within a look stage, and a new shape and material at each stage. Any mix works
  (a paper plane with rocket engines is fine). The selected part glows in the hangar.
- The sky fades toward space above ~600 m. Stars come out and twinkle, and shooting stars pass.
- Distance signposts and a **BEST** flag stand beside the flight line.

## Things that are exactly the 2D game

The flight physics, the stats, part costs, world items (coins, rings, fuel cans, birds, balloons),
earnings, milestones, offline earnings, UI flows and texts are the 2D code, moved into
`js/core.js` without changes. `tools/browser-test.js` checks the 3D physics against the 2D game's
own `physStep`, and they agree to 1e-13.

Two things depended on the 2D screen zoom, and are derived in world units as that zoom works out
on a typical screen:
- The item pickup radius, `max(2.2·scale, 26 px / zoom)`.
- The item size.

## Files

```
index.html              markup and CSS (the 2D layout, plus a camera button and graphics setting)
js/core.js              data tables, save + migrations, stats, world items, physics (shared logic, no DOM)
js/terrain.js           noise, terrain heights and paint, LOD tile quadtree, terrain shader
js/scenery.js           instanced vegetation and props, volcano glows and smoke
js/sky.js               sky dome, sun/moon, stars, aurora, planet, clouds, weather particles, lights, fog
js/plane.js             the modular plane: one procedural model per part and look stage
js/items.js             coins, rings, fuel cans, birds, balloons, particles, signposts, ramp
js/game.js              renderer, cameras, game loop, UI and input
vendor/three.min.js     three.js r186 as one classic script (re-make with tools/vendor-three.sh)
sw.js, manifest.webmanifest, icon.svg   offline install
tools/sim.js            balance simulator on the real physics (node tools/sim.js)
tools/browser-test.js   browser checks (see the file header)
```

## Save compatibility

The storage key (`planeEvolution.save.v1`), schema (v3) and migrations are the 2D game's. The 3D
settings (`settings.quality`, `settings.camera`) are plain additions with defaults. The 2D game
keeps them untouched, so the version is not bumped. If the save format ever changes, bump
`SAVE_VERSION` and add a step to `MIGRATIONS` in `js/core.js` **and** in the 2D game. Never delete
old steps.

When any file changes, bump `CACHE` in `sw.js` so installed copies update.

## Checking a change

- `node tools/sim.js` prints the pacing: runs and hours to reach each core level. Core Lv 40
  arrives after about 200 flights. Keep that curve if you touch physics or economy.
- `node tools/browser-test.js out/` needs Playwright. It runs the checks and saves screenshots of
  every terrain and screen size.
