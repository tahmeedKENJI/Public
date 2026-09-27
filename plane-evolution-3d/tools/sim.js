// Headless balance simulator. Loads js/core.js (the same physics, stats and world the game
// uses), flies with a simple autopilot and greedily buys the cheapest upgrade after every run.
//   node tools/sim.js            pacing table (runs and hours to reach each core level)
//   node tools/sim.js --first    one fresh first flight (2D baseline: ~35 m, ~17 coins)
// The autopilot climbs while v > 14*Sv and a < 0.4, or when low and slow; it burns the reserve
// as soon as it may, and collects items with the collision radius 2.2*scale.
'use strict';
const C = require('../js/core.js');

function fly(parts, save, seed, power = 1) {
  const st = C.statsFor(parts), world = C.makeWorld(st, seed), scale = world.scale;
  const P = C.newPlaneState(st);
  P.v = st.launch * power;
  let coins = 0, t = 0; const taken = new Set();
  const collide = (ox, oy) => {
    const R = 2.2 * scale, i0 = Math.floor(Math.min(ox, P.x) / world.CH), i1 = Math.floor(Math.max(ox, P.x) / world.CH);
    const dx = P.x - ox, dy = P.y - oy, L2 = dx * dx + dy * dy || 1;
    for (let i = i0 - 1; i <= i1 + 1; i++) {
      const items = world.chunk(i);
      for (let j = 0; j < items.length; j++) {
        const it = items[j], key = i * 64 + j; if (taken.has(key)) continue;
        const u = C.clamp(((it.x - ox) * dx + (it.y - oy) * dy) / L2, 0, 1);
        const ex = ox + dx * u - it.x, ey = oy + dy * u - it.y;
        const rr = it.k === 'ring' ? R * 1.9 : it.k === 'coin' ? R * 1.1 * st.magnetR : R;
        if (ex * ex + ey * ey > rr * rr) continue;
        taken.add(key);
        if (it.k === 'coin') coins += Math.ceil(st.income * scale * 1.6 * (1 + it.x / (500 * scale)));
        else if (it.k === 'ring') P.v += 7 * scale + P.v * 0.12;
        else if (it.k === 'fuel') { if (P.fuel <= 0 && st.reserve > 0) P.reserve = Math.min(st.reserve, Math.max(0, P.reserve) + 1.5); else P.fuel = Math.min(st.fuel, P.fuel + 1.5); }
        else { P.v *= st.armor; P.a -= 0.25 * (1 - (st.armor - 0.7) * 2); }
      }
    }
  };
  const dt = 1 / 120;
  while (t < 400) {
    const up = (P.v > 14 * st.Sv && P.a < 0.4) || (P.y < 3 * scale && P.v < 10 * st.Sv && P.a < 0.2);
    flightStep(P, st, { up, down: false, reserve: true }, dt, scale, collide);
    t += dt;
    if (P.grounded && P.stopT > 0.6) break;
    if (t > 300 && !P.grounded) { P.grounded = true; P.v = 0; P.y = 0; }
  }
  const e = C.runEarningsFor(save, P.x, coins, st.income);
  return { e, P, t };
}
const flightStep = C.flightStep;

if (process.argv.includes('--first')) {
  const save = C.defaultSave();
  let d = 0, c = 0; const N = 200;
  for (let s = 1; s <= N; s++) { const r = fly(save.parts, save, s, 1.1); d += r.e.dist; c += r.e.total; }
  console.log(`fresh first flight, perfect launch, avg of ${N} seeds: ${(d / N).toFixed(1)} m, ${(c / N).toFixed(1)} coins`);
  const mid = { frame: 36, wings: 37, engine: 38, fuel: 35, tail: 0, nose: 0, magnet: 0, reserve: 0 };
  const st = C.statsFor(mid), r = fly(mid, save, 7, 1.1);
  console.log(`mid-late build f36/w37/e38/fu35: launch ${Math.round(st.launch * 1.1 * 3.6)} km/h, flight ${(r.e.dist / 1000).toFixed(2)} km in ${r.t.toFixed(0)} s`);
  process.exit(0);
}

const save = C.defaultSave();
let hours = 0, runs = 0; const reached = {};
const marks = [5, 10, 20, 30, 40, 50];
while (runs < 3000) {
  const { e, t } = fly(save.parts, save, runs + 1, 0.55 + 0.4 * 0.8); // typical, not perfect, launch
  save.coins += e.total; save.ms = e.ms; save.runs++; runs++;
  hours += (t + 25) / 3600; // flight + ~25 s in the hangar and launching
  for (;;) { // greedy: buy the cheapest available upgrade
    const ok = C.PARTS.filter(p => (!p.req || p.req(save.parts)) && save.parts[p.id] < p.max).map(p => ({ id: p.id, c: C.partCost(p.id, save.parts[p.id]) }));
    ok.sort((a, b) => a.c - b.c);
    if (!ok.length || ok[0].c > save.coins) break;
    save.coins -= ok[0].c; save.parts[ok[0].id]++;
  }
  const core = Math.min(save.parts.frame, save.parts.wings, save.parts.engine, save.parts.fuel);
  for (const m of marks) if (core >= m && !reached[m]) reached[m] = { runs, hours, t, dist: e.dist };
  if (core >= 50) break;
}
console.log('core lv | runs | hours | last flight time | last distance');
for (const m of marks) { const r = reached[m]; if (r) console.log(`${String(m).padStart(7)} | ${String(r.runs).padStart(4)} | ${r.hours.toFixed(1).padStart(5)} | ${r.t.toFixed(0).padStart(6)} s | ${Math.round(r.dist)} m`); }
