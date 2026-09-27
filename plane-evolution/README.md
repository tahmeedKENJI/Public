# Plane Evolution

A launch-and-glide plane game in the style of *Epic Plane Evolution* — with **no ads, no
network, no accounts**. One HTML file; progress is saved in your browser.

There is also a **3D version** with realistic terrain in [`../plane-evolution-3d`](../plane-evolution-3d). It is the same game
and uses the same save, so progress carries over when both are served from the same site.

## Play

- **Easiest:** open `index.html` in any browser (double-click it). Works fully offline.
- **On a phone, as an app:** host this folder anywhere static (e.g. GitHub Pages), open it once,
  then "Add to Home Screen". The service worker caches everything, so it runs offline afterwards.

## How it works

1. **Launch** — tap when the needle is in the green zone. A *Perfect* launch gives +10% speed.
2. **Fly** — hold **▲ CLIMB** (or ↑ / W, or tap anywhere) to pull up, hold **▼ DIVE** (or ↓ / S)
   to push the nose down; let go of both and the plane noses down gently on its own. Fly through
   coins, **rings** (speed boost) and **fuel cans**; avoid birds and balloons.
   - **Reserve tank**: once the main fuel is empty, hold **Space** (or the RESERVE button) to burn
     the reserve. Fuel cans picked up after the main tank is empty refill the reserve instead.
   - **Pause** with ❚❚ (or Esc / P): resume, change settings, or exit. **✕** exits directly.
     Exiting always asks *"Do you want to quit?"* — quitting keeps everything earned so far.
3. **Build your plane from parts.** Each part levels up on its own and changes how it looks —
   a new livery stripe or size bump every level, and a whole new shape/material every few levels:

   | Part | Effect | Looks (examples) |
   |---|---|---|
   | Frame | Launch speed | Paper plane → balsa → barnstormer → … → space shuttle → UFO → singularity |
   | Wings | Glide, top speed | Paper folds → biplane → swept → delta → alien fins → void sails |
   | Engine | Thrust | Rubber band → propellers → turbojet → afterburners → rockets → ion → plasma |
   | Fuel | Burn time | Soda bottle → belly tank → drop tanks → cryo → antimatter cells |
   | Tail | Turn rate | Paper fin → swept fin → twin fins → vector vanes |
   | Nose | Keeps speed when you hit birds/balloons | Cardboard tip → steel cone → pitot spike → force shield |
   | Magnet | Coin value and pickup reach | Fridge magnet → horseshoe → radar dish → gravity orb |
   | Reserve | Backup fuel (needs Engine Lv 20) | Canister → pods → cryo → quantum |

   Mix and match freely — a paper plane with rocket engines is allowed.
4. **Explore** six terrains, each with its own sky and weather, announced on screen as you enter:
   Verdant Meadow (clear), Amber Farmlands (rain), Sunscorch Desert (dust), Frostveil Tundra
   (snow, aurora, stars), Ashen Caldera (ash, embers, lightning), The Alien Expanse (spores,
   ringed planet). Flying high fades the sky toward space and brings out the stars.

Extras: distance milestones pay one-time bonuses, the hangar crew earns a little while you're
away (up to 4 hours), and ⚙️ has sound/weather/area-title toggles plus save export/import.

## Save compatibility

Saves carry a version number and are upgraded automatically when the game updates — progress
from any earlier version (including exported save codes) always loads. Before an old save is
upgraded, a copy is kept in the browser as a backup. Saves from the old evolution system are
converted part-for-part (Launch → Frame, Aero → Wings, Income → Magnet, …) at the same levels,
which performs the same or slightly better; the old evolution stage also grants Tail and Nose
levels. If you change the save format, bump `SAVE_VERSION` in `index.html` and add a step to
`MIGRATIONS`; never delete old steps.
