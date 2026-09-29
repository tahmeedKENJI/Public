'use strict';
/* ==========================================================================
   Plane Evolution 3D: shared core. Data tables, save format, stats, world
   items and flight physics. No DOM and no three.js here, so the balance
   simulator (tools/sim.js) can load this file in Node.

   Everything in this file is kept identical to the 2D game
   (../plane-evolution/index.html), which is the reference implementation.
   ========================================================================== */

/* ---------- plane parts ----------
   Every part is levelled on its own. Each level changes the part's look a little
   (size, livery stripes); every few levels it changes shape/material ("look stage"). */
const LOOKS = {
  frame:   ['Paper Plane', 'Balsa Glider', 'Barnstormer', 'Prop Plane', 'Jet Fighter', 'Supersonic Jet', 'Rocket Plane', 'Space Shuttle', 'Starfighter', 'UFO', 'Singularity'],
  wings:   ['Paper folds', 'Balsa wings', 'Biplane wings', 'Aluminium wings', 'Swept wings', 'Delta wings', 'Titanium delta', 'Heat-tiled delta', 'Forward-swept blades', 'Alien fins', 'Void sails'],
  engine:  ['Rubber band', 'Wooden propeller', 'Three-blade prop', 'Radial engine', 'Turbojet', 'Afterburner', 'Twin afterburners', 'Rocket motor', 'Triple rocket', 'Ion drive', 'Plasma core'],
  fuel:    ['Soda bottle', 'Belly tank', 'Big belly tank', 'Drop tank', 'Twin drop tanks', 'Conformal tanks', 'Cryo tanks', 'Rocket-fuel pods', 'Antimatter cells', 'Dark-matter cells', 'Singularity cell'],
  tail:    ['Paper fin', 'Wooden fin', 'Swept fin', 'Twin fins', 'Canted twin fins', 'Vector vanes'],
  nose:    ['Cardboard tip', 'Rubber bumper', 'Steel cone', 'Pitot spike', 'Titanium ram', 'Force shield'],
  magnet:  ['Fridge magnet', 'Horseshoe magnet', 'Big horseshoe', 'Coil magnet', 'Radar dish', 'Twin dishes', 'Tractor emitter', 'Gravity orb', 'Graviton ring', 'Quantum lure', 'Wealth singularity'],
  reserve: ['Spare canister', 'Reserve pod', 'Twin pods', 'Cryo reserve', 'Plasma reserve', 'Quantum reserve', 'Infinity reserve'],
};
const PARTS = [
  { id: 'frame',   name: 'Frame',   icon: '🛩️', base: 12,   g: 1.26, max: 50, step: 5, desc: 'The body of the plane. A stronger, lighter frame survives a harder catapult launch.' },
  { id: 'wings',   name: 'Wings',   icon: '🪶', base: 16,   g: 1.26, max: 50, step: 5, desc: 'Better wings glide further and cut drag, raising top speed.' },
  { id: 'engine',  name: 'Engine',  icon: '⚙️', base: 20,   g: 1.26, max: 50, step: 5, install: true, desc: 'Thrust while fuel lasts. More power means a higher top speed.' },
  { id: 'fuel',    name: 'Fuel',    icon: '⛽', base: 16,   g: 1.26, max: 50, step: 5, install: true, desc: 'How long the engine burns before it runs dry.' },
  { id: 'tail',    name: 'Tail',    icon: '🧭', base: 80,   g: 1.42, max: 20, step: 4, install: true, desc: 'Steering. Climb and dive faster for sharper flying.' },
  { id: 'nose',    name: 'Nose',    icon: '🛡️', base: 60,   g: 1.42, max: 20, step: 4, install: true, desc: 'Armoured nose cone. Birds and balloons slow you down less.' },
  { id: 'magnet',  name: 'Magnet',  icon: '🧲', base: 30,   g: 1.26, max: 50, step: 5, install: true, desc: 'Coins are worth more, and you grab them from further away.' },
  { id: 'reserve', name: 'Reserve', icon: '🛢️', base: 2500, g: 1.30, max: 30, step: 5, install: true, req: p => p.engine >= 20, reqText: 'Engine Lv 20',
    desc: 'Backup fuel. Once the main tank is empty, hold Space (or RESERVE) to burn it. Upgrades slow the drain.' },
];
const PART = Object.fromEntries(PARTS.map(p => [p.id, p]));
const stageOf = (id, lvl) => Math.min(LOOKS[id].length - 1, Math.floor(lvl / PART[id].step));
const lookName = (id, lvl) => lvl === 0 && PART[id].install ? 'Not installed' : LOOKS[id][stageOf(id, lvl)];
const partCost = (id, lvl) => Math.ceil(PART[id].base * Math.pow(PART[id].g, lvl));
const FRAME_TAGS = ['Folded from last week\'s homework.', 'Light wood, long wings, big dreams.', 'Fabric, wire and nerve.', 'A proper aeroplane.', 'Afterburners online.',
  'Breakfast in London, lunch in New York.', 'Barely a plane anymore.', 'Next stop: orbit.', 'Built for the space lanes.', 'Where did you even get this?', 'It bends light a little.'];
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

/* Materials by look stage: base, dark, light, accent. The 3D-only fields say how the
   surface reflects light: rough = roughness, metal = metalness. */
const MAT = [
  { base: '#f4f6f8', dark: '#c3cedb', light: '#ffffff', accent: '#6b8ab5', rough: 0.95, metal: 0 },    // paper
  { base: '#dcae74', dark: '#a97b44', light: '#f0cf9c', accent: '#7a4f25', rough: 0.85, metal: 0 },    // balsa
  { base: '#d8433b', dark: '#962821', light: '#f07a6e', accent: '#f3e3c3', rough: 0.8, metal: 0 },     // fabric
  { base: '#f2c230', dark: '#b88e12', light: '#ffe07a', accent: '#1f5fa8', rough: 0.45, metal: 0.5 },  // aluminium
  { base: '#8795a6', dark: '#556171', light: '#b5c1cf', accent: '#3aa0ff', rough: 0.35, metal: 0.75 }, // titanium
  { base: '#eef1f5', dark: '#aab3c0', light: '#ffffff', accent: '#1a3a7a', rough: 0.4, metal: 0.2 },   // composite
  { base: '#2b2e37', dark: '#15171c', light: '#4a4f5c', accent: '#ffcc00', rough: 0.7, metal: 0.3 },   // heat shield
  { base: '#f3f2ec', dark: '#bdbcb4', light: '#ffffff', accent: '#222222', rough: 0.6, metal: 0.05 },  // ceramic
  { base: '#34467e', dark: '#1c2750', light: '#5a70b8', accent: '#ff4fd8', rough: 0.3, metal: 0.6 },   // starfighter
  { base: '#b9c3d3', dark: '#7b8598', light: '#e8eef8', accent: '#7dffa8', rough: 0.12, metal: 1 },    // chrome
  { base: '#2a1a4a', dark: '#0c0618', light: '#4a2d80', accent: '#c77dff', rough: 0.25, metal: 0.6 },  // void
];

/* ---------- terrains ---------- */
let BIOMES = [ // the current map: the 2D terrains until regions.js deals a flight map (see useMap)
  { at: 0,     name: 'Verdant Meadow',    key: 'meadow',  skyTop: '#3d8fe0', skyBot: '#c4e8ff', ground: '#6cc24a', dirt: '#4a8a32', hillA: '#7cb866', hillB: '#5a9a52', far: '#8fbad6',
    style: 'rolling', weather: 'clear', cloud: '#ffffff', cover: 0.22, stars: 0,   sun: { c: '#fff6c8', r: 34, y: 0.16 } },
  { at: 400,   name: 'Amber Farmlands',   key: 'farm',    skyTop: '#62758f', skyBot: '#cfd6de', ground: '#b3bd4a', dirt: '#857f33', hillA: '#96a45a', hillB: '#768644', far: '#9aa8b6',
    style: 'rolling', weather: 'rain',  cloud: '#8a94a3', cover: 0.5,  stars: 0,   sun: null },
  { at: 1500,  name: 'Sunscorch Desert',  key: 'desert',  skyTop: '#e38f45', skyBot: '#ffe4ae', ground: '#edc978', dirt: '#c49a4e', hillA: '#e2b36b', hillB: '#c98f4a', far: '#eebd8e',
    style: 'dunes',   weather: 'dust',  cloud: '#fff0da', cover: 0.07, stars: 0,   sun: { c: '#fffbe8', r: 50, y: 0.2 } },
  { at: 4000,  name: 'Frostveil Tundra',  key: 'tundra',  skyTop: '#0f1a3e', skyBot: '#6d84b2', ground: '#eef5f8', dirt: '#b3c6d3', hillA: '#dbe6ef', hillB: '#9fb3c6', far: '#56699a',
    style: 'jagged',  weather: 'snow',  cloud: '#c3cfe3', cover: 0.28, stars: 0.85, aurora: true, moon: { c: '#eef3ff', r: 22, y: 0.14 } },
  { at: 9000,  name: 'Ashen Caldera',     key: 'volcano', skyTop: '#1d0a0c', skyBot: '#9a391f', ground: '#4b3b38', dirt: '#2a201e', hillA: '#3a2a28', hillB: '#261a18', far: '#5a2921',
    style: 'volcanic', weather: 'ash',  cloud: '#4a3230', cover: 0.35, stars: 0.3, sun: { c: '#ff7a3a', r: 30, y: 0.24 } },
  { at: 18000, name: 'The Alien Expanse', key: 'alien',   skyTop: '#0e0826', skyBot: '#5f3a9a', ground: '#7e5bc0', dirt: '#4a3383', hillA: '#5a3f9a', hillB: '#3b2870', far: '#382868',
    style: 'spires',  weather: 'spores', cloud: '#9a7ad0', cover: 0.2, stars: 1,   planet: true },
];
const biomeIndex = x => { let i = 0; while (i < BIOMES.length - 1 && x >= BIOMES[i + 1].at) i++; return i; };

/* ---------- save ----------
   Saves are versioned. When the save format changes:
     1. bump SAVE_VERSION,
     2. add a MIGRATIONS[oldVersion] step that upgrades the old shape in place.
   Never remove old migration steps: any save (or exported code) from any earlier
   version must keep loading. The storage key name is permanent — the version lives
   inside the save. Before a save is migrated, the original is kept as a backup.
   The 3D game shares this key and schema with the 2D game, so progress carries over
   when both are served from the same origin. 3D-only fields (settings.quality, .camera, .markers,
   seen3d) are
   plain additions with defaults: the 2D game keeps them untouched, so no version bump. */
const SAVE_KEY = 'planeEvolution.save.v1';
const SAVE_VERSION = 3;
const MIGRATIONS = {
  // v1 -> v2: reserve tank upgrade added
  1: s => { s.lv = Object.assign({ reserve: 0 }, s.lv); return s; },
  // v2 -> v3: evolution tiers replaced by individually upgradable parts.
  // Each old stat level maps onto the matching part at the same level, which gives
  // the same (or slightly better) performance; the old tier also grants tail/nose
  // levels so the plane keeps the look it had. The old fields are kept under `legacy`.
  2: s => {
    const t = Math.max(0, Math.floor(s.tier || 0)), lv = s.lv || {};
    s.parts = {
      frame: lv.launch || 0, wings: lv.aero || 0, engine: lv.engine || 0, fuel: lv.fuel || 0, magnet: lv.income || 0,
      tail: Math.min(20, t * 2), nose: Math.min(20, t * 2), reserve: t >= 4 ? (lv.reserve || 0) + 1 : 0,
    };
    s.legacy = { tier: s.tier, lv: s.lv };
    delete s.tier; delete s.lv;
    return s;
  },
};
const defaultSave = () => ({ v: SAVE_VERSION, coins: 0,
  parts: { frame: 0, wings: 0, engine: 0, fuel: 0, tail: 0, nose: 0, magnet: 0, reserve: 0 },
  best: 0, bestAlt: 0, ms: 0, runs: 0, sound: true, settings: { weather: true, titles: true, quality: 'auto', camera: 'chase', markers: true }, seen: [0], seen3d: [],
  last: Date.now(), tipSeen: false, tip2Seen: false });
function migrateSave(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a save');
  let s = JSON.parse(JSON.stringify(raw));
  let v = Number.isInteger(s.v) && s.v > 0 ? s.v : 1;
  while (v < SAVE_VERSION) { if (MIGRATIONS[v]) s = MIGRATIONS[v](s); v++; }
  // merge onto defaults so any missing field gets a sane value; unknown fields are kept
  const d = defaultSave();
  const out = Object.assign(d, s, { parts: Object.assign(d.parts, s.parts), settings: Object.assign(d.settings, s.settings) });
  out.v = Math.max(v, SAVE_VERSION);
  const num = (x, def = 0) => (typeof x === 'number' && isFinite(x) && x >= 0) ? x : def;
  out.coins = num(out.coins); out.best = num(out.best); out.bestAlt = num(out.bestAlt);
  out.ms = Math.floor(num(out.ms)); out.runs = Math.floor(num(out.runs)); out.last = num(out.last, Date.now());
  for (const k in out.parts) out.parts[k] = Math.floor(num(out.parts[k]));
  for (const p of PARTS) out.parts[p.id] = Math.min(p.max, out.parts[p.id]);
  if (!Array.isArray(out.seen)) out.seen = [0];
  if (!Array.isArray(out.seen3d)) out.seen3d = []; // regions discovered in 3D (by key); `seen` stays the 2D game's list
  return out;
}

/* ---------- derived stats ---------- */
function statsFor(p) {
  const { frame: L, engine: E, fuel: F, wings: A, magnet: I, reserve: R, tail: T, nose: N } = p;
  const Se = Math.pow(1.074, E), Sa = Math.pow(1.074, A), Sv = Math.sqrt(Se * Sa);
  const st = {
    launch: 15 * Math.pow(1.08, L),
    thrust: E > 0 ? 5 * Se : 0,
    fuel: 1 + 0.5 * F,
    drag: 0.008 / Sa,
    ind: 60 * Sv * Sv / (1 + 0.03 * A),
    ld: 5 + 0.2 * A,
    income: 1 + 0.12 * I,
    magnetR: 1 + 0.03 * I,
    pitch: 1.3 * (1 + 0.045 * T),
    armor: 0.7 + 0.012 * N,              // share of speed kept when hitting a bird/balloon
    reserve: R > 0 && E > 0 ? 2.5 * (1 + 0.15 * (R - 1)) : 0, // seconds of burn
    drain: 40 / (1 + 0.15 * Math.max(0, R - 1)),               // % of the tank per second
    Sv,
  };
  st.top = st.thrust > 0 ? Math.sqrt(st.thrust / st.drag) : 0;
  return st;
}
const corePowerOf = parts => (parts.frame + parts.wings + parts.engine + parts.fuel) / 4;

/* ---------- utils ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fmt = n => Math.floor(n).toLocaleString('en-US');
function fmtDist(m) { return m < 10000 ? Math.floor(m).toLocaleString('en-US') + ' m' : (m / 1000).toFixed(m < 100000 ? 2 : 1) + ' km'; }
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s); s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; }
const RGB = {};
function rgb(h) { if (RGB[h]) return RGB[h]; const n = parseInt(h.slice(1), 16); return (RGB[h] = [n >> 16, (n >> 8) & 255, n & 255]); }
const mixA = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (a, al = 1) => `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`;

/* ---------- terrain blending ----------
   Each terrain fades into the next over min(260*scale, 0.3*gap) metres before the boundary. */
function envAt(x, scale = 1) {
  const i = biomeIndex(x), a = BIOMES[i], b = BIOMES[i + 1];
  if (!b) return { i, a, b: a, t: 0 };
  const win = Math.min(260 * scale, (b.at - a.at) * 0.3); // blend into the next terrain
  return { i, a, b, t: clamp((x - (b.at - win)) / win, 0, 1) };
}
const envMix = (e, key) => mixA(rgb(e.a[key]), rgb(e.b[key]), e.t);
const envNum = (e, key) => lerp(e.a[key] || 0, e.b[key] || 0, e.t);
const envFlag = (e, key) => (e.a[key] ? 1 - e.t : 0) + (e.b[key] ? e.t : 0);

/* ---------- world objects ---------- */
// Items are generated per chunk from a deterministic seed so a run is stable while you fly.
// Identical to the 2D makeWorld, except the chunk cache is larger because the 3D chase
// camera looks much further ahead than the 2D screen does.
function makeWorld(st, seed) {
  const scale = Math.max(1, st.Sv);
  const CH = 45 * scale;
  const chunks = new Map();
  const runSeed = seed !== undefined ? seed : (Math.random() * 1e9) | 0;
  function chunk(i) {
    if (chunks.has(i)) return chunks.get(i);
    const r = rng(runSeed + i * 7919), items = [];
    if (i >= 0) {
      const x0 = i * CH + (i === 0 ? 14 * scale : 0);
      const ceil = (18 + Math.min(i * 3, 160)) * scale;
      const roll = r();
      if (roll < 0.58) {
        const n = 5 + Math.floor(r() * 5), y0 = (3 + r() * ceil), step = 4 * scale, amp = (2 + r() * 6) * scale;
        const sx = x0 + r() * CH * 0.4;
        for (let k = 0; k < n; k++) items.push({ k: 'coin', x: sx + k * step, y: y0 + Math.sin(k / (n - 1) * Math.PI) * amp });
      } else if (roll < 0.72) {
        items.push({ k: 'ring', x: x0 + r() * CH * 0.6, y: 6 * scale + r() * ceil * 0.8 });
      } else if (roll < 0.83) {
        items.push({ k: st.thrust > 0 ? 'fuel' : 'coin', x: x0 + r() * CH * 0.6, y: 4 * scale + r() * ceil * 0.8 });
      } else {
        const k = r() < 0.5 ? 'bird' : 'balloon';
        items.push({ k, x: x0 + r() * CH * 0.7, y: 5 * scale + r() * ceil * 0.9, ph: r() * 6, hue: r() });
      }
      if (r() < 0.25) items.push({ k: 'coin', x: x0 + r() * CH, y: 2 * scale + r() * 10 * scale });
    }
    chunks.set(i, items);
    if (chunks.size > 600) { const first = chunks.keys().next().value; chunks.delete(first); }
    return items;
  }
  return { CH, chunk, scale, seed: runSeed };
}

/* ---------- flight physics ----------
   One fixed substep (the caller runs 1/120 s substeps, frame dt capped at 0.05 s).
   Identical to the 2D physStep; the side effects (sound, dust, toasts) are returned
   as an event instead of being done here. inp = { up, down, reserve } booleans. */
function newPlaneState(st) {
  return { x: 0, y: 2.2, a: 0.45, v: 0, fuel: st.fuel, reserve: st.reserve, reserveOn: false, thrusting: false,
    maxY: 0, maxV: 0, grounded: false, stopT: 0, crashed: false };
}
function flightStep(P, st, inp, dt, scale, collide) {
  if (!P.grounded) {
    const up = inp.up, down = inp.down;
    if (up && !down) P.a = Math.min(1.0, P.a + st.pitch * dt);
    else if (down && !up) P.a = Math.max(-1.1, P.a - st.pitch * dt);
    else if (P.a > -0.35) P.a = Math.max(-0.35, P.a - 0.6 * dt);
    else P.a += 0.4 * dt;
    if (P.v < 7) P.a -= (7 - P.v) * 0.22 * dt; // stall: nose drops
    P.a = clamp(P.a, -1.3, 1.0);
    let T = 0;
    P.reserveOn = false;
    if (P.fuel > 0 && st.thrust > 0) { T = st.thrust; P.fuel -= dt; }
    else if (P.reserve > 0 && inp.reserve) { T = st.thrust; P.reserve -= dt; P.reserveOn = true; }
    P.thrusting = T > 0;
    P.v += (T - 9.8 * Math.sin(P.a) - st.drag * P.v * P.v) * dt;
    if (P.v < 0.3) P.v = 0.3;
    const sink = P.v * Math.cos(P.a) / st.ld + st.ind / (P.v * P.v + 4);
    const ox = P.x, oy = P.y;
    P.x += P.v * Math.cos(P.a) * dt;
    P.y += (P.v * Math.sin(P.a) - sink) * dt;
    P.maxY = Math.max(P.maxY, P.y); P.maxV = Math.max(P.maxV, P.v);
    if (collide) collide(ox, oy);
    if (P.y <= 0) {
      P.y = 0; P.grounded = true;
      const vy = P.v * Math.sin(P.a);
      P.crashed = vy < -Math.max(14, P.v * 0.5);
      P.v = P.v * Math.cos(P.a) * (P.crashed ? 0.25 : 0.8);
      P.a = 0; P.thrusting = false; P.reserveOn = false;
      return 'landed';
    }
  } else {
    const fr = 12 * Math.max(1, scale * 0.5);
    P.v = Math.max(0, P.v - fr * dt);
    P.x += P.v * dt; P.thrusting = false;
    if (P.v < 0.5) P.stopT += dt;
  }
  return null;
}

/* ---------- earnings ---------- */
function runEarningsFor(save, dist, runCoins, income) {
  const distCoins = Math.floor(dist * 0.5 * income);
  let msBonus = 0, ms = save.ms; const hit = [];
  while (ms < MILESTONES.length && dist >= MILESTONES[ms]) { msBonus += Math.ceil(MILESTONES[ms] * 0.5); hit.push(MILESTONES[ms]); ms++; }
  return { dist, distCoins, coins: runCoins, msBonus, hit, ms, total: distCoins + runCoins + msBonus };
}

if (typeof module !== 'undefined') module.exports = { LOOKS, PARTS, PART, MAT, BIOMES, MILESTONES, SAVE_KEY, SAVE_VERSION, MIGRATIONS, defaultSave, migrateSave,
  statsFor, stageOf, partCost, corePowerOf, makeWorld, newPlaneState, flightStep, runEarningsFor, envAt, biomeIndex, clamp };
