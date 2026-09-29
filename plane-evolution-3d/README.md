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

- **50 regions, a new map every flight.** Each launch deals a fresh sequence of regions: the
  first is always a gentle Common one, no region repeats, and region *k* is 400 × 1.25^*k* m long,
  so every new area takes longer to reach (a 100 km flight passes about 19). Rarity tiers are
  Common, Uncommon, Rare, Epic and Legendary, and a stronger plane (higher core power: the
  average of Frame, Wings, Engine and Fuel) meets the rare ones more often. The hangar backdrop
  is where your next flight starts. The area title marks Rare-and-up regions, and the hangar
  counts regions found. The full list is in `js/regions.js`; the choices behind it are in
  [`DECISIONS.md`](DECISIONS.md).
  - Meadows, farmland, vineyards, lavender and sunflower fields, rice terraces, orchards, forests
    (birch, autumn, pine, bamboo, rainforest), moors, coasts and rivers.
  - Deserts, red-rock canyons, salt flats, dry coral seabeds, sandstorm ruins.
  - Tundra, glacier fjords, the South Pole with auroras.
  - Cities by day and neon cities at night, harbour, abandoned and ghost towns, twilight valleys,
    stormy steppes, mushroom swamps, floating islands.
  - Calderas and eruptions, a toxic wasteland, blood-moon wastes, the alien expanse.
  - The Moon, Mars, a frozen moon, the asteroid belt, a ringworld, orbit above Earth, a nebula,
    a quasar field, the event horizon of a black hole, and the void beyond.
- **Tunnels.** Cave regions (Deep Caverns, Underground Tunnels, Crystal Caves) have a tunnel
  mouth on the flight line. "TUNNEL AHEAD" appears a few seconds before it: press **▼ DIVE** to
  go underground, or fly on through the gorge. Inside, the plane flies level at 288 km/h with
  unlimited fuel, and **◀ ▶** (or ←/→, A/D) switch between 3 lanes to dodge rocks and beams and
  collect coins. Hitting one ejects you to the surface with an empty main tank; reaching the
  end launches you off a ramp with the main tank half full. It rescues weak planes that are out
  of fuel, and it's slow for strong ones.
- The flight line runs down a flat strip at height 0, which is the physics ground. Landscape
  rises on the far side. The near side stays low (a plain, the sea or a river), so no camera ends
  up inside a hill.
- **Every part is its own 3D model**, and every level visibly changes it: livery stripes, bands,
  ribs and size within a look stage, and a new shape and material at each stage. Any mix works
  (a paper plane with rocket engines is fine). The selected part glows in the hangar.
- The sky fades toward space above ~600 m. Stars come out and twinkle, and shooting stars pass.
- Distance signposts (⚙️ → Distance markers turns them off) and a **BEST** flag stand beside the
  flight line.

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
js/regions.js           the 50 regions, rarity odds and the per-flight map dealer
js/terrain.js           noise, terrain heights and paint, LOD tile quadtree, terrain shader
js/scenery.js           instanced vegetation and props, volcano glows and smoke
js/sky.js               sky dome, sun/moon, stars, aurora, planet, clouds, weather particles, lights, fog
js/plane.js             the modular plane: one procedural model per part and look stage
js/items.js             coins, rings, fuel cans, birds, balloons, particles, signposts, ramp
js/tunnel.js            the tunnel minigame in cave regions: bore, mouths, obstacles, coins
js/game.js              renderer, cameras, game loop, UI and input
vendor/three.min.js     three.js r186 as one classic script (re-make with tools/vendor-three.sh)
sw.js, manifest.webmanifest, icon.svg   offline install
tools/sim.js            balance simulator on the real physics (node tools/sim.js)
tools/browser-test.js   browser checks (see the file header)
```

## Save compatibility

The storage key (`planeEvolution.save.v1`), schema (v3) and migrations are the 2D game's. The 3D
additions (`settings.quality`, `settings.camera`, `settings.markers`, and `seen3d` for regions
found) are plain fields with defaults. The 2D game
keeps them untouched, so the version is not bumped. If the save format ever changes, bump
`SAVE_VERSION` and add a step to `MIGRATIONS` in `js/core.js` **and** in the 2D game. Never delete
old steps.

When any file changes, bump `CACHE` in `sw.js` so installed copies update.

## Checking a change

- `node tools/sim.js` prints the pacing: runs and hours to reach each core level. Core Lv 40
  arrives after about 200 flights. Keep that curve if you touch physics or economy.
- `node tools/browser-test.js out/` needs Playwright. It runs the checks and saves screenshots of
  every terrain and screen size.
