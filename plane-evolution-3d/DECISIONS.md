# Decisions log

Design decisions for Plane Evolution 3D, newest first. **Owner** means you decided it;
**Claude** means I made the call and it's open to change. Each line says where it lives in the
code, so any of them can be changed.

## Round 2: procedural regions, tunnels, distance markers

### Regions and the map
| # | Decision | By | Where |
|---|---|---|---|
| 1 | 50 regions in 5 rarity tiers: Common 12, Uncommon 12, Rare 12, Epic 9, Legendary 5 (full list in `regions.js`). Several are variants of a shared base (palette, weather, time of day, props). | Claude (list shown to you; edit freely) | `REGIONS` in `js/regions.js` |
| 2 | **A new map is dealt for every flight.** Within a flight the map is fixed. | Owner | `dealNextMap` in `js/game.js` |
| 3 | Region *k* is 400 × 1.25^*k* m long, so each new area takes longer to reach. A 100 km flight passes about 19 regions. | Owner | `REGION_FIRST_LEN`, `REGION_GROWTH` |
| 4 | Rarity odds follow **core power** (the average of Frame, Wings, Engine, Fuel). They blend from Common 60 / Uncommon 25 / Rare 10 / Epic 4 / Legendary 1 % at core power 0, to 14 / 22 / 26 / 22 / 16 % at core power 50. | Owner (core power); Claude (the numbers) | `TIERS`, `tierOdds` |
| 5 | The first region of every flight is always Common, so launches start somewhere gentle. | Claude | `dealMap` |
| 6 | No region repeats within a flight, and two regions of the same base kind (two cities, two gorges…) rarely sit next to each other (up to 3 re-rolls). | Claude | `dealMap` |
| 7 | The map is dealt when you return to the hangar, and the hangar backdrop is the first region of your next flight. If you upgrade a core part before launching, the map is dealt again with the new odds. | Claude | `setMode('hangar')`, `newRun` |
| 8 | Discoveries are tracked per region in a new save field `seen3d` (region keys). The 2D game's `seen` list is untouched. The hangar shows "*n*/50 regions found". | Claude | `showArea`, `renderHangar`, `core.js` defaults |
| 9 | The area title adds the tier for Rare and above ("New area discovered · Epic region"), so rare finds feel special. | Claude | `showArea` |
| 10 | The near side of the flight line (+z, where the side camera sits) stays a low plain for 4 km in every region, except water (sea, rivers) and the gorge regions (walls from 320 m). Tall props (trees, houses, towers, floating islands) are never placed on the near side within 400 m. This keeps the side and cinematic cameras clear. | Claude | `styleHeight`, `vegTile` |
| 11 | Space regions (Lunar, Mars, Frozen Moon, Asteroid Belt, Orbit, Nebula, Event Horizon, Quasar, Void) keep a solid surface at the physics ground: regolith, ice, glass or a station deck. The space feel comes from the black sky, stars and big sky objects (Earth, a gas giant, the black hole, the quasar). | Claude | `regions.js`, `sky.js` |
| 12 | Only water regions dip below the water line. Everywhere else the ground is clamped above it, so crater bowls never fill with sea. | Claude | `styleHeight` |

### Tunnels (cave regions: Deep Caverns, Underground Tunnels, Crystal Caves)
| # | Decision | By | Where |
|---|---|---|---|
| 13 | Caves are an **optional underground lane**. The above-ground path through a cave region is a gorge with dense mountains on both sides. | Owner | `tunnel.js`, `gorge` style |
| 14 | The tunnel mouth sits on the flight line. "TUNNEL AHEAD — press ▼ DIVE" shows about 4 s before it (at least 260 m). Pressing DIVE runs a scripted dive into the mouth and down the ramp. Ignoring it keeps you on the normal path. | Owner | `updateTunnelPrompt`, `startTunnel` |
| 15 | Inside: 3 lanes, left / middle / right. ◀ ▶ pads appear **only** in the minigame, with ←/→ or A/D on a keyboard. ▲ ▼ and RESERVE are hidden meanwhile. | Owner | `showTunnelUI`, input handlers |
| 16 | Fixed speed of 80 m/s (288 km/h). That's a lifeline for weak planes and slow for strong ones. Fuel is unlimited inside. | Owner (fixed speed); Claude (80 m/s) | `TUNNEL_SPEED` |
| 17 | Hitting an obstacle **ejects** the plane to the surface with an empty main tank (the reserve is kept), at 70% of tunnel speed. | Owner | `ejectFromTunnel` |
| 18 | At the end, a ramp launches the plane back into flight at 80 m/s with the **main tank half full**. | Owner | `tunnelStep` |
| 19 | Tunnel length is half the region, clamped to 1.5–5 km. The mouth is at 18% of the region, at least 260 m in, so it comes after the area title. | Claude | `tunnelsFor` |
| 20 | Obstacle rows every 60–100 m: 70% block one lane, 30% block two. Four coins sit in the free lane after each row, worth the normal coin value. The first 160 m after the ramp are clear. | Claude | `Tunnel.layout` |
| 21 | Inside the tunnel the camera is always a low chase view, whatever the camera setting, because lanes can't be read from the side. | Claude | `flightCamera` |
| 22 | The tunnel mouth stands above the ground as a rock mound with a stone arch. It's visual only: a plane that skips the tunnel low down passes through it, the same as every other prop. | Claude | `Tunnel.buildBore` |
| 23 | Power-ups inside the tunnel: not built yet (to be discussed). | Owner | — |

### Settings
| # | Decision | By | Where |
|---|---|---|---|
| 24 | New setting **Distance markers**, on by default. The gold BEST flag always shows. | Owner | `TOGGLES`, `Signs.update` |

## Round 1: the 3D version (from the handoff)
| # | Decision | By |
|---|---|---|
| 25 | Flight stays on a straight line (no steering); physics identical to 2D. | Handoff default |
| 26 | A separate folder; the 2D game is kept. | Handoff default |
| 27 | Three cameras (Chase default, Cinematic, Side); a graphics setting (Auto/Low/Medium/High). | Claude |
| 28 | Pickup radius and item size use the 2D zoom as it works out on a typical screen (camZ = 1152 / Vw). | Claude |
| 29 | No desert heat haze (it needs a screen-distortion pass). | Claude; open |
