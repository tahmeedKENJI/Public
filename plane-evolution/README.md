# Plane Evolution

A launch-and-glide plane game in the style of *Epic Plane Evolution* — with **no ads, no
network, no accounts**. One HTML file; progress is saved in your browser.

## Play

- **Easiest:** open `index.html` in any browser (double-click it). Works fully offline.
- **On a phone, as an app:** host this folder anywhere static (e.g. GitHub Pages), open it once,
  then "Add to Home Screen". The service worker caches everything, so it runs offline afterwards.

## How it works

1. **Launch** — tap when the needle is in the green zone. A *Perfect* launch gives +10% speed.
2. **Fly** — hold **▲ CLIMB** (or ↑ / W, or tap anywhere) to pull up, hold **▼ DIVE** (or ↓ / S)
   to push the nose down; let go of both and the plane noses down gently on its own. Dive to gain
   speed, pull up to trade it for height. Fly through coins, **rings** (speed boost) and
   **fuel cans**; avoid birds and balloons.
   - **Reserve tank** (Jet Fighter and later): once the main fuel is empty, hold **Space** (or the
     RESERVE button) to burn the reserve. Upgrading *Reserve* lowers its drain rate, so it lasts
     longer. On the earlier planes, Space still climbs.
3. **Upgrade** — spend coins on Launch, Engine, Fuel, Aero and Income (5 levels per stage), plus
   Reserve from the Jet Fighter on.
4. **Evolve** — max the four flight stats and pay to evolve:
   Paper Plane → Balsa Glider → Biplane → Prop Plane → Jet Fighter → Supersonic Jet →
   Rocket Plane → Space Shuttle → UFO.

Extras: distance milestones pay one-time bonuses, the hangar crew earns a little while you're
away (up to 4 hours), and ⚙️ lets you export/import a save code as a backup.

Balance target: roughly 190 flights (~3–4 hours of play) to reach the UFO, with good flying
getting you there noticeably faster than just letting the plane glide.

## Save compatibility

Saves carry a version number and are upgraded automatically when the game updates — progress
from any earlier version (including exported save codes) always loads. Before an old save is
upgraded, a copy is kept in the browser as a backup. If you change the save format, bump
`SAVE_VERSION` in `index.html` and add a step to `MIGRATIONS`; never delete old steps.
