# Handoff: Plane Evolution 3D

You are building a **3D version** of an existing 2D browser game, `plane-evolution/index.html`
(single file, ~1,650 lines, canvas 2D). The owner wants **the same game in 3D**: the same mechanics,
progression and features, but with a **far more realistic terrain** than the 2D's flat cartoon art.
This document is the spec. The 2D file is the reference implementation: when this doc and the
code disagree, the code wins. Read the 2D game first, then this.

---

## 1. Who it's for and what they care about

The owner built this because the original mobile game (*Epic Plane Evolution*) had intolerable ads
and no offline mode. Their stated priorities, in their own framing:

- **No ads, no network, no accounts. Must work fully offline.** Nothing is loaded from a CDN at
  runtime. Bundle every library and asset locally.
- **Slow progression is fine.** They like that costs rise and each step takes longer. Don't speed
  it up.
- **Never lose progress.** "Losing progress per upgrade is a recipe for disaster." Save
  compatibility is a hard requirement (§8).
- **Coin amounts show every digit** (`1,234,567`). No K/M/B abbreviations anywhere.
- **UI text must never overflow its box**, at any screen size. They noticed this once. Check
  phone portrait, phone landscape, tablet and desktop.
- They like a visual sense of progress: every upgrade should visibly change the plane.
- They sometimes cheat for testing using DevTools (`save.coins = …; persist()`). Don't obfuscate
  state, and keep a global save object reachable from the console.
- They iterate in small rounds and report bugs precisely. Keep a playable build at every step.

---

## 2. Recommended approach for 3D

These are recommendations, not decisions the owner has made (see §11).

- **Engine:** Three.js, vendored into the repo (e.g. `plane-evolution-3d/vendor/three.module.js`),
  imported as an ES module. No build step is needed; if you add one (Vite), the output must still
  be a static folder that works offline.
- **Keep the flight model 2D at first.** All balance (§5–§6) was tuned on a vertical-plane model
  where x = distance and y = altitude. Render it in 3D with a chase camera, and keep the physics
  identical, so progression carries over unchanged. Lateral steering or banking can come later,
  as an opt-in change that is re-balanced with the simulator (§10).
- **Units:** 1 world unit = 1 metre, matching the 2D physics.
- **Performance target:** 60 fps on a mid-range phone. Use instancing for vegetation and pickups,
  LOD or chunked terrain, capped particle counts, and pixel ratio ≤ 2 (lower on phones if needed).
  The 2D game already has a "Weather effects" toggle; add a quality setting too.
- **Offline install:** keep the PWA pattern: a `manifest.webmanifest` plus a **network-first**
  service worker that caches every file, so updates arrive when online. The current `sw.js` is
  the template; bump the cache name whenever files change.
- Put the 3D game in its own folder (e.g. `plane-evolution-3d/`), and leave the 2D game working.

---

## 3. Game loop

1. **Hangar:** the plane is on display, with part upgrades, coins, best distance, sound and
   settings.
2. **Launch:** a power needle sweeps back and forth; tap, click or press a key to launch.
3. **Fly:** climb or dive, collect coins, rings and fuel cans, and avoid birds and balloons.
4. **Land:** the plane slides to a stop, then a results screen appears. Coins are banked and you
   return to the hangar.

### Launch meter
- `m = triangle wave of (meterT * 0.9)`, ranging 0→1→0.
- If `m ≥ 0.85`, it's **Perfect**: power 1.1, with a "PERFECT LAUNCH!" toast.
- Otherwise power is `0.55 + 0.4 * (m / 0.85)`, with a "Good!" toast if `m > 0.6`.
- Launch speed is `stats.launch * power`. Start state: `x=0, y=2.2, angle a=0.45 rad`, on a
  wooden ramp.

### Controls (all must exist)
| Action | Touch | Keyboard |
|---|---|---|
| Climb | ▲ CLIMB pad, or touch anywhere else on screen | ↑ / W |
| Dive | ▼ DIVE pad | ↓ / S |
| Reserve tank | RESERVE pad (only visible if a reserve is installed) | Space (climbs if no reserve is installed) |
| Launch | tap anywhere | Enter / Space / ↑ / ↓ |
| Pause | ❚❚ button | Esc / P |
| Exit | ✕ button | — |
| Hangar | tap a part chip, then Upgrade | ←/→ select part, U or + buy, Space/Enter to fly |

- Multi-touch is tracked by pointer id, so holding CLIMB and tapping RESERVE works at the same
  time.
- When neither climb nor dive is held, the nose drifts down gently.

---

## 4. Flight physics (keep identical)

Fixed substeps of 1/120 s; the frame dt is capped at 0.05 s. `st` means the derived stats (§6).

```
if airborne:
  up   → a = min(1.0,  a + st.pitch*dt)
  down → a = max(-1.1, a - st.pitch*dt)
  none → if a > -0.35: a = max(-0.35, a - 0.6*dt) else a += 0.4*dt
  if v < 7: a -= (7 - v)*0.22*dt                          // stall
  a = clamp(a, -1.3, 1.0)
  thrust T = 0
  if fuel > 0 and st.thrust > 0: T = st.thrust; fuel -= dt
  elif reserve > 0 and reserve held: T = st.thrust; reserve -= dt   // reserve ONLY once main fuel is empty
  v += (T - 9.8*sin(a) - st.drag*v²)*dt ;  v = max(v, 0.3)
  sink = v*cos(a)/st.ld + st.ind/(v² + 4)
  x += v*cos(a)*dt ;  y += (v*sin(a) - sink)*dt
  on y ≤ 0: crashed = (v*sin(a) < -max(14, 0.5v)); v = v*cos(a)*(crashed ? 0.25 : 0.8); a = 0; grounded
if grounded: v -= 12*max(1, scale*0.5)*dt ; x += v*dt ; run ends 0.6 s after v < 0.5
safety net: flights end after 300 s
```

---

## 5. Economy and progression (keep identical)

### Parts
Eight parts, each levelled independently. The cost of the next level is `ceil(base * g^level)`.

| id | Name | base | g | max | look step | Installable (Lv 0 = absent) | Requirement |
|---|---|---|---|---|---|---|---|
| frame | Frame | 12 | 1.26 | 50 | 5 | no | — |
| wings | Wings | 16 | 1.26 | 50 | 5 | no | — |
| engine | Engine | 20 | 1.26 | 50 | 5 | yes | — |
| fuel | Fuel | 16 | 1.26 | 50 | 5 | yes | — |
| tail | Tail | 80 | 1.42 | 20 | 4 | yes | — |
| nose | Nose | 60 | 1.42 | 20 | 4 | yes | — |
| magnet | Magnet | 30 | 1.26 | 50 | 5 | yes | — |
| reserve | Reserve | 2500 | 1.30 | 30 | 5 | yes | engine ≥ 20 |

- **Look stage** = `min(stages-1, floor(level / step))`.
- The hangar button says "Install" at Lv 0 for installable parts. It shows 🔒 "Needs Engine Lv 20"
  for a locked reserve, and "MAXED OUT" at max level.
- Installing a part, or reaching a new look stage, plays a fanfare and shows a toast:
  "Engine installed!" or "New look: Swept wings!".

### Derived stats (`statsFor(parts)`)
```
Se = 1.074^engine ; Sa = 1.074^wings ; Sv = sqrt(Se*Sa)
launch  = 15 * 1.08^frame                    (m/s)
thrust  = engine>0 ? 5*Se : 0
fuel    = 1 + 0.5*fuel                       (seconds)
drag    = 0.008 / Sa
ind     = 60*Sv² / (1 + 0.03*wings)          (induced sink)
ld      = 5 + 0.2*wings                      (glide ratio)
income  = 1 + 0.12*magnet
magnetR = 1 + 0.03*magnet                    (coin pickup radius multiplier)
pitch   = 1.3 * (1 + 0.045*tail)             (rad/s)
armor   = 0.7 + 0.012*nose                   (share of speed kept on a bird/balloon hit)
reserve = (reserve>0 && engine>0) ? 2.5*(1 + 0.15*(reserve-1)) : 0   (seconds)
drain   = 40 / (1 + 0.15*max(0, reserve-1))  (% per second, display only)
top     = sqrt(thrust/drag)                  (display only)
```

### Earnings when a run ends (landing *or* quitting)
- Distance reward: `floor(dist * 0.5 * income)`.
- Coins picked up during the run.
- Milestones `[100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]` m pay
  `ceil(m * 0.5)` once ever. `save.ms` is the index of the next milestone.
- Update `best` (distance), `bestAlt`, `runs`.

### Offline earnings
- Applies if away ≥ 2 min and `runs > 0`.
- Minutes counted = `min(away, 240)`.
- Rate per minute = `max(1, 0.15 * 3.2^(corePower/5) * income)`, where
  `corePower = avg(frame, wings, engine, fuel)`.
- Show a "Welcome back!" modal.

### Pacing (from the simulator, §10)
All core parts reach Lv 40 after about 200 flights (~4 h); Lv 50 is a long endgame. Flight time
grows from ~2 s to ~2.5 min. If you change anything in §4–§6, re-run the simulator and keep this
curve.

---

## 6. World contents (keep identical)

### Scale
- `scale = max(1, Sv)`. Everything spatial scales with it, so faster planes see the same
  density per second.

### Chunks
- Items are generated in chunks of length `CH = 45*scale`. Each run has its own seed, so a run is
  stable but different runs differ.
- Chunk `i ≥ 0` starts at `x0 = i*CH` (+14·scale for chunk 0). The height ceiling is
  `(18 + min(i*3, 160))*scale`.

| roll | spawn |
|---|---|
| < 0.58 | coin arc: 5–9 coins, spacing 4·scale, at y = 3 + r·ceil, arcing up by 2–8·scale |
| < 0.72 | boost ring |
| < 0.83 | fuel can (a coin instead if the plane has no engine) |
| else | bird or balloon (50/50) |
| plus 25% | one low bonus coin |

### Pickup effects
| Item | Effect |
|---|---|
| Coin | value `ceil(income * scale * 1.6 * (1 + x/(500*scale)))` |
| Ring | `v += 7*scale + 0.12*v` |
| Fuel can | +1.5 s to the main tank, **but** if the main tank is empty and a reserve exists: +1.5 s to the reserve (capped at full) |
| Bird / balloon | `v *= armor; a -= 0.25*(1 - (armor-0.7)*2)`, plus a "BONK!"/"POP!" floater and camera shake |

- **Collision** is a segment-vs-point test over each substep, so fast planes can't skip items.
- The base radius in 2D is `max(2.2*scale, 26px / zoom)`. It depends on screen zoom, which 3D
  doesn't have, so derive a world-space equivalent that feels the same. Rings get ×1.9 radius and
  coins get ×1.1·magnetR.

---

## 7. Terrains (the big 3D upgrade)

Six terrains in order of distance. The 3D versions should look **realistic**: heightmap terrain,
proper lighting, fog/atmosphere, instanced vegetation and real weather. The flight path itself
stays over a flat corridor at y = 0 (the physics ground), so the terrain can rise on both sides and
far away without affecting the physics. Ideas: carve a valley or runway along the flight line; or
treat the ground under the path as the true surface and keep it gently rolling within a metre or
two.

| From (m) | Name | Sky / light | Weather | Landscape to build |
|---|---|---|---|---|
| 0 | **Verdant Meadow** | clear blue, warm sun | clear, drifting pollen | rolling green hills, deciduous trees, bushes, flowers |
| 400 | **Amber Farmlands** | overcast grey | rain | fields and crop rows, fences, hay bales, windmills |
| 1,500 | **Sunscorch Desert** | hot orange, big sun | blowing dust | dunes, mesas, cacti, rocks, tumbleweeds, heat haze |
| 4,000 | **Frostveil Tundra** | night-blue, moon | snow, aurora, stars | jagged snow-capped mountains, snowy pines, ice rocks |
| 9,000 | **Ashen Caldera** | red-black, dim red sun | ash, rising embers, lightning | volcanoes with glowing craters and smoke, dead trees, lava cracks |
| 18,000 | **The Alien Expanse** | deep purple night, ringed planet, moon | glowing spores, full starfield | spires, glowing crystals, mushroom trees, glowing plants |

- **Blending:** each terrain fades into the next over `min(260*scale, 0.3*gap)` metres before the
  boundary: sky, fog, ground colour and weather mix. The 2D `BIOMES` array has every colour.
- **Altitude:** the sky fades toward space from about 600 m up (fully dark near 9,600 m), and
  stars come out. Weather fades out above roughly 250–750·scale m.
- **Stars:** twinkling and in varied colours, with occasional shooting stars. They appear in
  night terrains and at altitude.
- **Area title (the owner asked for Dark Souls style):**
  - On entering each terrain, and at launch for the Meadow, show a centred serif, uppercase,
    letter-spaced name over a dark translucent band with a thin fading rule underneath.
  - It fades in about 0.9 s, holds about 3 s and fades out about 1.4 s, with a low gong.
  - The first visit ever adds a small "NEW AREA DISCOVERED" line above; `save.seen` lists the
    visited terrains.
  - It hides on pause and can be turned off with the "Area titles" setting.
- Ground markers every "nice" distance (10/25/50/…m) and a **BEST** flag at the best distance
  are important feedback. Keep them as 3D signposts.

---

## 8. Saves (hard requirement)

- **Storage:** `localStorage` key `planeEvolution.save.v1`. The key name is permanent; the
  version lives inside the save. **Use the same key and schema** so a player's 2D progress
  appears in 3D when both are served from the same origin. Export/import codes cover the other
  cases.
- **Current schema, v3:**
  ```json
  { "v": 3, "coins": 0,
    "parts": { "frame": 0, "wings": 0, "engine": 0, "fuel": 0, "tail": 0, "nose": 0, "magnet": 0, "reserve": 0 },
    "best": 0, "bestAlt": 0, "ms": 0, "runs": 0, "sound": true,
    "settings": { "weather": true, "titles": true }, "seen": [0],
    "last": 1727400000000, "tipSeen": false, "tip2Seen": false, "legacy": { } }
  ```
- **Migrations:**
  - Copy `MIGRATIONS` and `migrateSave` from the 2D file verbatim: v1→v2 (reserve) and v2→v3
    (tiers → parts).
  - Never delete a migration step.
  - Merge onto defaults, sanitise numbers, clamp part levels to max, and keep unknown fields.
  - Before migrating, store the raw old save under `planeEvolution.save.v1.backup.v<old>`.
  - An unreadable save is stashed under `.unreadable` and is never silently dropped.
- **New fields:** if 3D adds any (e.g. a quality setting), add them to the defaults. **Don't bump
  the version for 3D-only additions** unless the shape changes, and make sure the 2D game still
  loads a save written by 3D. It will, because unknown fields are preserved and defaults fill
  gaps.
- **Export/import:** the export code is base64 of the save JSON. Import accepts that **or** raw
  JSON, from any version, through `migrateSave`.
- **When to save:** every 15 s, on `pagehide`, on `visibilitychange` (hidden), and after every
  purchase or run.

---

## 9. UI and features checklist

- [ ] **Hangar**
  - Top bar: coins (full digits), best distance, sound toggle, ⚙️ settings.
  - Plane on display, slowly bobbing and rotating so the 3D parts are visible.
  - Name = the frame's look stage (e.g. "Space Shuttle"), plus tagline · "Build rating"
    (sum of all levels).
  - 8 **part chips**: icon, name, level. A green dot means affordable, 🔒 means locked, "MAX"
    at max. Layout: 8 across on wide screens, 4×2 on phones.
  - **Detail panel** for the selected part:
    - Name, `Lv x / max`.
    - "Look: *current* · Lv N: *next look*".
    - Current effect → **next effect**, and a one-line description.
    - Install/Upgrade button with the cost.
  - **The selected part glows on the plane.** A purchase gives a small pulse or flash, plus a
    fanfare on new looks.
  - The hangar opens with the cheapest affordable part selected.
- [ ] **Flight HUD**
  - Distance (big), altitude, speed in km/h, run coins.
  - Fuel bar; a reserve bar that glows when the reserve is active.
  - ❚❚ and ✕ buttons; ▼ / RESERVE / ▲ pads.
  - First-flight hint: "Hold ▲ to climb · ▼ to dive".
  - Toast when the reserve becomes usable: "RESERVE READY — hold SPACE".
  - Floaters: +coins, BOOST!, +FUEL, +RESERVE, BONK!/POP!. Toasts: CRASH!, PERFECT LAUNCH!.
  - Speed lines at high speed, and exhaust trails (cyan while the reserve burns).
- [ ] **Pause menu**
  - Freezes everything.
  - Shows distance so far and "Yours if you quit now: X".
  - Toggles for Sound / Weather effects / Area titles; Resume; Exit to hangar.
  - Auto-pauses when the tab is hidden mid-flight.
- [ ] **Quit confirmation**
  - **Every exit asks "Do you want to quit?"**, showing the amount to be banked.
  - Yes → bank the earnings (§5) and go **straight to the hangar**, with a "+X coins banked"
    toast.
  - No → back to the pause menu, or back to flying if they came from ✕.
- [ ] **Results modal**
  - Title: "Landed!" or "Crash landing!"; a new-best banner.
  - Rows: distance, max altitude, top speed, distance reward, coins collected, milestone bonus.
  - Total, and a Collect button.
- [ ] **Settings modal**
  - The same toggles.
  - Export save, Import save, and Reset (with its own confirmation).
- [ ] **Welcome-back modal** (offline earnings).
- [ ] **Sound:** a small WebAudio synth only, with no audio files needed. The 2D `sfx` table
  defines coin, buy, launch, ring, fuel, hit, land, fanfare, perfect and the area gong.

---

## 10. Plane parts in 3D: every level must change the look

- Build the plane from **modular procedural meshes**, one group per part, so the hangar can
  highlight one part and any combination works. The owner likes odd builds, such as a paper plane
  with rocket engines.
- Inside a look stage, each level must still visibly change something. The 2D game adds a livery
  stripe per level and grows the part slightly; do the equivalent with extra decals, trim, panel
  lines or size.
- Look names by stage are below (the 2D `LOOKS` table). Materials per stage are in the 2D `MAT`
  table: paper, balsa, fabric, aluminium, titanium, composite, heat shield, ceramic, starfighter,
  chrome, void.

| Part | Stages |
|---|---|
| Frame | Paper Plane · Balsa Glider · Barnstormer · Prop Plane · Jet Fighter · Supersonic Jet · Rocket Plane · Space Shuttle · Starfighter · UFO · Singularity |
| Wings | Paper folds · Balsa wings · Biplane wings · Aluminium wings · Swept wings · Delta wings · Titanium delta · Heat-tiled delta · Forward-swept blades · Alien fins · Void sails |
| Engine | Rubber band · Wooden propeller · Three-blade prop · Radial engine · Turbojet · Afterburner · Twin afterburners · Rocket motor · Triple rocket · Ion drive · Plasma core |
| Fuel | Soda bottle · Belly tank · Big belly tank · Drop tank · Twin drop tanks · Conformal tanks · Cryo tanks · Rocket-fuel pods · Antimatter cells · Dark-matter cells · Singularity cell |
| Tail | Paper fin · Wooden fin · Swept fin · Twin fins · Canted twin fins · Vector vanes |
| Nose | Cardboard tip · Rubber bumper · Steel cone · Pitot spike · Titanium ram · Force shield |
| Magnet | Fridge magnet · Horseshoe magnet · Big horseshoe · Coil magnet · Radar dish · Twin dishes · Tractor emitter · Gravity orb · Graviton ring · Quantum lure · Wealth singularity |
| Reserve | Spare canister · Reserve pod · Twin pods · Cryo reserve · Plasma reserve · Quantum reserve · Infinity reserve |

- Engines show propellers spinning or flames depending on type. Flame colours: orange for jets,
  white-orange for rockets, blue for ion, purple for plasma, cyan when the reserve is burning.
- Frames at stage 9–10 are saucers; attach the other parts sensibly.

---

## 11. Open questions to ask the owner before or while building

1. Should the 3D flight stay on a straight line (the recommended start), or should it gain
   left/right steering, which needs re-balancing?
2. Should it be a separate game folder, or eventually replace the 2D one?
3. Which camera: chase cam behind the plane, a side-on cinematic view, or switchable?
4. For realism vs. phone performance: which devices do they play on?

---

## 12. How the 2D version was verified (reuse this)

- **Balance simulator:** a headless Node script runs the physics in §4 with a simple autopilot
  (climb while `v > 14*Sv && a < 0.4`, or when low and slow) and greedily buys the cheapest
  upgrade. It checks runs and hours to reach each level. Any balance change should keep the
  pacing in §5.
- **Browser tests:** Playwright with the preinstalled Chromium. Checks used:
  - Seed saves of every old version and check the migrated result and backups.
  - Autopilot a flight via the keyboard.
  - Teleport into each terrain and screenshot it; check the area title text.
  - Pause (position must not change), exit → confirm → no/yes, and check banked coins equal the
    promised amount.
  - Render a gallery of part builds.
  - Measure UI elements for overflow at 360×640, 390×844, 844×390, 700×500, 1024×768, 1280×720
    and 1920×1080.
  - Zero console errors.
- **Reproduce 2D results as a baseline:**
  - A fresh first flight is about 35 m and earns 17 coins.
  - A mid-late build (frame 36 / wings 37 / engine 38 / fuel 35) reaches kilometres at around
    500 km/h at launch.

---

## 13. Where things live in the 2D file (`index.html`)

| Section | Look for |
|---|---|
| Parts, looks, costs | `LOOKS`, `PARTS`, `MAT`, `FRAME_TAGS` |
| Terrains | `BIOMES` |
| Save and migrations | `SAVE_KEY`, `SAVE_VERSION`, `MIGRATIONS`, `migrateSave`, `loadSave` |
| Stats | `statsFor` |
| Plane art | `drawPlane` and `drawBody` / `drawWing` / `drawTail` / `drawNose` / `drawEngine` / `drawFuel` / `drawMagnet` / `drawReserve` |
| World items | `makeWorld` |
| Physics and collisions | `physStep`, `collide` |
| Environment | `envAt`, `drawSky`, `drawHills`, `drawClouds`, `drawGround`, `drawDeco`, `drawWeather` |
| UI | `renderHangar`, `buy`, `openSettings`, `openPause`, `confirmQuit`, `quitRun`, `finishRun`, `runEarnings`, `bank`, `showArea` |
| Input | pointer/key handlers, `ctl`, `keyRole` |
| Offline earnings | `offlineEarnings` |
