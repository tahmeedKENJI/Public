'use strict';
/* ==========================================================================
   Plane Evolution 3D: game loop, cameras, UI and input.
   Mechanics, economy and UI flows follow the 2D game exactly; see core.js.
   ========================================================================== */

const $ = s => document.querySelector(s);

/* ---------- save (same key and schema as the 2D game) ---------- */
function loadSave() {
  let rawText = null;
  try { rawText = localStorage.getItem(SAVE_KEY); } catch (e) {}
  if (!rawText) return defaultSave();
  try {
    const raw = JSON.parse(rawText);
    const oldV = Number.isInteger(raw.v) ? raw.v : 1;
    if (oldV < SAVE_VERSION) { try { const bk = SAVE_KEY + '.backup.v' + oldV; if (!localStorage.getItem(bk)) localStorage.setItem(bk, rawText); } catch (e) {} }
    return migrateSave(raw);
  } catch (e) {
    try { localStorage.setItem(SAVE_KEY + '.unreadable', rawText); } catch (e2) {}
    return defaultSave();
  }
}
let save = loadSave();
function persist() { save.last = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
setInterval(persist, 15000);
addEventListener('pagehide', persist);
const curStats = () => statsFor(save.parts);
const corePower = () => corePowerOf(save.parts);

/* ---------- audio (tiny synth, no files) ---------- */
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
function beep(freq, dur = 0.08, type = 'square', vol = 0.06, slide = 0) {
  if (!save.sound) return; const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  coin: () => beep(1200 + Math.random() * 200, 0.07, 'square', 0.035, 500),
  buy: () => { beep(660, 0.06); setTimeout(() => beep(990, 0.09), 60); },
  launch: () => beep(220, 0.35, 'sawtooth', 0.05, 600),
  ring: () => { beep(700, 0.1, 'triangle', 0.08, 700); },
  fuel: () => beep(500, 0.12, 'triangle', 0.07, 300),
  hit: () => beep(160, 0.2, 'sawtooth', 0.07, -100),
  land: () => beep(110, 0.25, 'triangle', 0.1, -60),
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'triangle', 0.08), i * 110)),
  perfect: () => { beep(880, 0.08, 'triangle', 0.08); setTimeout(() => beep(1320, 0.12, 'triangle', 0.08), 70); },
  area: () => { beep(98, 1.6, 'sine', 0.12, -8); beep(147, 1.4, 'sine', 0.06, -10); setTimeout(() => beep(196, 1.2, 'sine', 0.05, -10), 180); },
};

/* ---------- renderer and scene ---------- */
const QUALITY = {
  low:    { dpr: 1,    shadows: 0,    tileN: 16, lodK: 1.1, view: 10000, minSize: 128, veg: 0.4,  vegR: 380,  vegMax: 2500,  wx: 0.45, clouds: 160, budget: 4 },
  medium: { dpr: 1.5,  shadows: 1024, tileN: 24, lodK: 1.3, view: 16000, minSize: 64,  veg: 0.7,  vegR: 620,  vegMax: 5000,  wx: 0.75, clouds: 320, budget: 6 },
  high:   { dpr: 2,    shadows: 2048, tileN: 32, lodK: 1.6, view: 24000, minSize: 64,  veg: 1,    vegR: 900,  vegMax: 9000, wx: 1,    clouds: 500, budget: 8 },
};
const coarse = matchMedia('(pointer: coarse)').matches;
let autoQ = coarse ? 'medium' : 'high';
const qualityName = () => save.settings.quality in QUALITY ? save.settings.quality : autoQ;

let W = innerWidth, H = innerHeight;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#boot').classList.add('err');
  $('#boot').textContent = 'This browser could not start 3D graphics (WebGL). The 2D version of Plane Evolution works everywhere, and uses the same save.';
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, W / H, 0.5, 60000);
const shared = { time: { value: 0 }, dpr: 1, height: H, px: H, camVel: new THREE.Vector3() }; // px: pixels per unit size at unit distance
const fx = $('#fx'), fctx = fx.getContext('2d');

const sky = new Sky(scene, shared);
scene.environment = (() => { // a soft sky/ground gradient, so metal parts have something to reflect
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, '#8fbbe8'); gr.addColorStop(0.48, '#eef3f8'); gr.addColorStop(0.52, '#8a8672'); gr.addColorStop(1, '#4a4a3c'); x.fillStyle = gr; x.fillRect(0, 0, 64, 32);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose(); return env;
})();
scene.environmentIntensity = 0.55;
const terrain = new Terrain(scene, shared);
const scenery = new Scenery(scene, shared);
const items = new Items(scene);
const particles = new Particles(scene, shared);
const signs = new Signs(scene);
const ramp = buildRamp(); scene.add(ramp);
const blob = makeBlobShadow(); scene.add(blob);
// one water surface following the camera; it only shows where a region's ground dips below it
const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#2a6a9a', roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.9 }));
water.rotation.x = -Math.PI / 2; water.renderOrder = 1; scene.add(water);
let plane = buildPlane(save.parts); scene.add(plane.root);

function applyQuality() {
  const q = QUALITY[qualityName()];
  shared.dpr = Math.min(q.dpr, window.devicePixelRatio || 1);
  renderer.setPixelRatio(shared.dpr); shared.height = H * shared.dpr; shared.px = shared.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  sky.sun.castShadow = q.shadows > 0;
  if (q.shadows) { sky.sun.shadow.mapSize.set(q.shadows, q.shadows); if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; } sky.sun.shadow.bias = -0.0004; sky.sun.shadow.normalBias = 0.02; }
  terrain.setQuality(q); scenery.setQuality(q); sky.clouds.max = q.clouds; sky.clouds.key = '';
  plane.root.traverse(o => { if (o.isMesh) o.castShadow = q.shadows > 0; });
}
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false); renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px';
  camera.aspect = W / H; camera.updateProjectionMatrix();
  const d = Math.min(2, window.devicePixelRatio || 1); fx.width = Math.round(W * d); fx.height = Math.round(H * d); fx.style.width = W + 'px'; fx.style.height = H + 'px';
  shared.height = H * shared.dpr; shared.px = shared.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}
addEventListener('resize', resize);
applyQuality(); resize();

function refreshPlane() {
  const same = PART_ORDER.every(id => plane.parts[id] === save.parts[id]);
  if (same) return;
  scene.remove(plane.root); disposePlane(plane);
  plane = buildPlane(save.parts); scene.add(plane.root);
  const q = QUALITY[qualityName()]; plane.root.traverse(o => { if (o.isMesh) o.castShadow = q.shadows > 0; });
}

/* ---------- game state ---------- */
let mode = 'hangar'; // hangar | launch | fly | done
let booted = false;
let paused = false;
let P = null, world = null, runSt = null, run = null;
let meterT = 0, time = 0, hangarT = 0, Vw = 96, shake = 0;
let floaters = [];
let selPart = 'frame';
const HANGAR_POS = new THREE.Vector3(-24, 3.4, 0);
const camState = { off: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

function setTerrainScale(s) {
  if (Math.abs(s - terrainScale) < 1e-6) return;
  terrainScale = s; terrain.clear(); scenery.reset();
}
// Every flight gets a freshly dealt map of the 50 regions (see regions.js). It is dealt on
// returning to the hangar, so the hangar shows where the next flight starts; if the plane's core
// power changes before launch, the map is dealt again with the new odds.
let tunnels = [], mapPower = -1;
const tunnelObjs = new Map();
function dealNextMap() {
  mapPower = corePower();
  useMap(dealMap((Math.random() * 1e9) | 0, mapPower));
  terrainScale = Math.max(1, curStats().Sv); terrain.clear(); scenery.reset(); sky.clouds.key = '';
  for (const t of tunnelObjs.values()) t.dispose(); tunnelObjs.clear();
  tunnels = tunnelsFor(BIOMES);
}
function newRun() {
  runSt = curStats();
  world = makeWorld(runSt);
  if (corePower() !== mapPower) { dealNextMap(); terrain.warm(new THREE.Vector3(-10, 12, 0), 500); }
  setTerrainScale(world.scale);
  P = newPlaneState(runSt); P.z = 0;
  run = { reserveToast: false, coins: 0, rings: 0, t: 0, taken: new Set(), hintT: 0, power: 1, area: 0, tun: null, tunPassed: new Set() };
  Vw = 96; camState.init = false;
  particles.clear(); floaters = [];
}

/* ---------- controls ---------- */
// keys: 'up' | 'down' | 'reserve' held on the keyboard; ptrs: pointerId -> role
const ctl = { keys: new Set(), ptrs: new Map() };
const ctlOn = role => ctl.keys.has(role) || [...ctl.ptrs.values()].includes(role);

/* ---------- physics ---------- */
function physStep(dt) {
  const ev = flightStep(P, runSt, { up: ctlOn('up'), down: ctlOn('down'), reserve: ctlOn('reserve') }, dt, world.scale, collide);
  if (ev === 'landed') {
    sfx.land(); shake = P.crashed ? 14 : 5;
    const dust = '#' + new THREE.Color().setRGB(...mixA(rgb(BIOMES[biomeIndex(P.x)].dirt), [150, 128, 100], 0.6).map(v => v / 255)).getHexString();
    for (let i = 0; i < 18; i++) particles.add({ x: P.x, y: 0.3, z: (Math.random() - 0.5) * 2 * world.scale, vx: (Math.random() - .3) * P.v * .4 + 2, vy: Math.random() * 6 * world.scale, vz: (Math.random() - 0.5) * 4 * world.scale, life: 1, c: dust, r: (0.4 + Math.random() * 0.5) * Vw / 96 });
    if (P.crashed) showToast('CRASH!', '#ff8a7a');
  }
}

function collide(ox, oy) {
  // segment-vs-point test so fast planes never skip items. The 2D radius depends on screen zoom
  // (26 px / camZ); here it uses the same zoom on a typical screen, camZ = 1152 / Vw.
  const R = Math.max(2.2 * world.scale, 26 * Vw / 1152);
  const i0 = Math.floor(Math.min(ox, P.x) / world.CH), i1 = Math.floor(Math.max(ox, P.x) / world.CH);
  const dx = P.x - ox, dy = P.y - oy, L2 = dx * dx + dy * dy || 1;
  for (let i = i0 - 1; i <= i1 + 1; i++) {
    const list = world.chunk(i);
    for (let j = 0; j < list.length; j++) {
      const it = list[j]; const key = i * 64 + j;
      if (run.taken.has(key)) continue;
      const t = clamp(((it.x - ox) * dx + (it.y - oy) * dy) / L2, 0, 1);
      const ex = ox + dx * t - it.x, ey = oy + dy * t - it.y;
      const rr = it.k === 'ring' ? R * 1.9 : it.k === 'coin' ? R * 1.1 * runSt.magnetR : R;
      if (ex * ex + ey * ey > rr * rr) continue;
      run.taken.add(key);
      const ps = itemSize(world.scale, Vw);
      if (it.k === 'coin') {
        const v = Math.ceil(runSt.income * world.scale * 1.6 * (1 + it.x / (500 * world.scale)));
        run.coins += v; sfx.coin(); floaters.push({ x: it.x, y: it.y, txt: '+' + fmt(v), c: '#ffd23d', life: 1 });
        for (let k = 0; k < 5; k++) particles.add({ x: it.x, y: it.y, vx: (Math.random() - .5) * 8 * world.scale, vy: (Math.random() - .2) * 8 * world.scale, vz: (Math.random() - .5) * 8 * world.scale, life: 0.6, c: '#fff4b0', r: ps * 0.25 });
      } else if (it.k === 'ring') {
        P.v += 7 * world.scale + P.v * 0.12; run.rings++; sfx.ring();
        floaters.push({ x: it.x, y: it.y, txt: 'BOOST!', c: '#7dfcff', life: 1 });
      } else if (it.k === 'fuel') {
        // Once the main tank is dry, cans top up the reserve instead, so they never re-open the
        // main tank and lock the reserve out again.
        if (P.fuel <= 0 && runSt.reserve > 0) {
          P.reserve = Math.min(runSt.reserve, Math.max(0, P.reserve) + 1.5);
          floaters.push({ x: it.x, y: it.y, txt: '+RESERVE', c: '#7de8ff', life: 1 });
        } else {
          P.fuel = Math.min(runSt.fuel, P.fuel + 1.5);
          floaters.push({ x: it.x, y: it.y, txt: '+FUEL', c: '#ffa94d', life: 1 });
        }
        sfx.fuel();
      } else {
        P.v *= runSt.armor; P.a -= 0.25 * (1 - (runSt.armor - 0.7) * 2); sfx.hit(); shake = 8;
        floaters.push({ x: it.x, y: it.y, txt: it.k === 'bird' ? 'BONK!' : 'POP!', c: '#ff8a7a', life: 1 });
        for (let k = 0; k < 10; k++) particles.add({ x: it.x, y: it.y, vx: (Math.random() - .5) * 20, vy: (Math.random() - .5) * 20, vz: (Math.random() - .5) * 20, life: 1, c: it.k === 'bird' ? '#ffffff' : '#ff5a7a', r: ps * 0.3 });
      }
    }
  }
}


/* ---------- tunnels (cave regions) ---------- */
let tunnelPrompt = null; // the tunnel the "TUNNEL AHEAD" prompt is offering
const laneWidth = () => Math.max(14, plane.radius * (TUNNEL_VW / 96) * 2.0);
function tunnelObj(info) {
  let t = tunnelObjs.get(info.x0);
  if (!t) { t = new Tunnel(scene, info, laneWidth(), (world ? world.seed : 1) + Math.round(info.x0)); tunnelObjs.set(info.x0, t); }
  return t;
}
function manageTunnels(camX) { // build tunnels as they come near, drop them once passed
  for (const info of tunnels) {
    const near = camX > info.x0 - 5000 && camX < info.x1 + 1500;
    if (near) tunnelObj(info); else if (tunnelObjs.has(info.x0)) { tunnelObjs.get(info.x0).dispose(); tunnelObjs.delete(info.x0); }
  }
  for (const t of tunnelObjs.values()) t.updateCoins(time);
}
function updateTunnelPrompt() {
  tunnelPrompt = null;
  if (mode === 'fly' && run && !run.tun && !P.grounded) for (const info of tunnels) {
    const dx = info.x0 - P.x;
    if (dx > 25 && dx < Math.max(260, P.v * 4) && !run.tunPassed.has(info.x0)) { tunnelPrompt = info; break; }
  }
  $('#tunnelPrompt').classList.toggle('hidden', !tunnelPrompt || paused);
}
function startTunnel() {
  const T = tunnelObj(tunnelPrompt); run.tunPassed.add(T.x0);
  const endX = T.x0 + T.ramp, speed = Math.max(P.v * Math.cos(P.a), TUNNEL_SPEED);
  run.tun = { T, phase: 'enter', x0: P.x, y0: P.y, dur: clamp((endX - P.x) / speed, 1.5, 4.5), t: 0, lane: 0 };
  run.hintT = 0; $('#hint').classList.add('hidden');
  tunnelPrompt = null; ctl.keys.clear(); ctl.ptrs.clear(); paintCtls(); P.thrusting = false; P.reserveOn = false;
  $('#tunnelPrompt').classList.add('hidden');
  showToast('INTO THE TUNNEL!', '#ffd08a'); sfx.launch(); showTunnelUI();
}
function tunnelStep(dt) {
  const tu = run.tun, T = tu.T, L = T.lane;
  if (tu.phase === 'enter') { // the scripted dive into the mouth and down the ramp
    tu.t += dt; const u = clamp(tu.t / tu.dur, 0, 1), ox = P.x, oy = P.y;
    P.x = lerp(tu.x0, T.x0 + T.ramp, u);
    P.y = P.x < T.x0 ? lerp(tu.y0, T.mouthY, smooth(tu.x0, T.x0, P.x)) : T.centerY(P.x);
    if (dt > 0) { P.v = Math.hypot(P.x - ox, P.y - oy) / dt; P.a = Math.atan2(P.y - oy, P.x - ox); }
    if (u >= 1) { tu.phase = 'play'; P.a = 0; showToast('GO!', '#8dff9a'); showTunnelUI(); }
  } else {
    P.v = TUNNEL_SPEED; P.x += TUNNEL_SPEED * dt; P.fuel = runSt.fuel; // unlimited fuel underground
    P.z = lerp(P.z, tu.lane * L, 1 - Math.exp(-dt * 12));
    if (tu.phase === 'play') {
      P.y = T.playY; P.a = 0;
      for (const c of T.coins) if (!c.taken && Math.abs(c.x - P.x) < L * 0.4 && Math.abs(P.z - c.lane * L) < L * 0.55) {
        c.taken = true; const v = Math.ceil(runSt.income * world.scale * 1.6 * (1 + c.x / (500 * world.scale)));
        run.coins += v; sfx.coin(); floaters.push({ x: c.x, y: T.playY, z: c.lane * L, txt: '+' + fmt(v), c: '#ffd23d', life: 1 });
      }
      for (const o of T.obs) if (Math.abs(o.x - P.x) < L * 0.35 && Math.abs(P.z - o.lane * L) < L * 0.6) return ejectFromTunnel();
      if (P.x >= T.x1 - T.ramp) { tu.phase = 'exit'; showTunnelUI(); }
    } else if (P.x < T.x1) { P.y = T.centerY(P.x); P.a = Math.atan2(T.centerY(P.x + 1) - P.y, 1); }
    else { // the exit ramp launches the plane back into normal flight with the main tank half full
      P.y = T.mouthY; P.a = 0.45; P.fuel = runSt.thrust > 0 ? runSt.fuel * 0.5 : 0; run.tun = null;
      showToast('BACK IN THE AIR!', '#8dff9a'); sfx.launch(); showTunnelUI();
    }
  }
  P.maxV = Math.max(P.maxV, P.v);
}
function ejectFromTunnel() { // an obstacle hit throws the plane out to the surface with an empty main tank
  run.tun = null;
  P.y = Math.max(3, 6 * world.scale); P.a = 0.35; P.v = TUNNEL_SPEED * 0.7; P.fuel = 0;
  sfx.hit(); shake = 12; showToast('EJECTED!', '#ff8a7a');
  for (let k = 0; k < 16; k++) particles.add({ x: P.x, y: 1, z: P.z, vx: (Math.random() - .5) * 20, vy: Math.random() * 25, vz: (Math.random() - .5) * 20, life: 1, c: '#8a7a6a', r: 0.6 * vis() });
  showTunnelUI();
}
function laneShift(d) { if (run && run.tun && run.tun.phase === 'play') run.tun.lane = clamp(run.tun.lane + d, -1, 1); }
function showTunnelUI() { // the ◀ ▶ pads exist only in the tunnel minigame; the flight pads hide meanwhile
  const inTun = mode === 'fly' && run && run.tun, lanes = inTun && run.tun.phase === 'play';
  document.querySelectorAll('.ctl.lane').forEach(el => el.classList.toggle('hidden', !lanes));
  document.querySelectorAll('.ctl:not(.lane)').forEach(el => { el.style.visibility = inTun ? 'hidden' : ''; });
}

/* ---------- cameras ---------- */
const CAMS = ['chase', 'cinematic', 'side'];
const CAM_NAMES = { chase: 'Chase', cinematic: 'Cinematic', side: 'Side (classic)' };
const camMode = () => CAMS.includes(save.settings.camera) ? save.settings.camera : 'chase';
const vis = () => Vw / 96; // the plane and items keep a readable size on screen as the view widens
let camDist = 30;
function flightCamera(dt) {
  const m = camMode(), fov = camera.fov * Math.PI / 180, A = W / H;
  const off = new THREE.Vector3(), look = new THREE.Vector3(), inTube = run && run.tun && P.y < -1;
  if (inTube) { // inside the tunnel: a low chase view, whatever the camera setting
    const L = run.tun.T.lane; off.set(-5.2 * L, 1.35 * L, -P.z * 0.5); look.set(7 * L, -0.1 * L, -P.z * 0.7); camDist = 5.4 * L;
  } else if (m === 'side') {
    // Same framing as the 2D game: the view is W / camZ metres wide, the plane sits at 32% from
    // the left, the ground at 78% down the screen, and the plane never rises above 40%.
    const hw = 0.5 * W * Vw / Math.min(W, H * 1.6), hh = hw / A, D = hh / Math.tan(fov / 2);
    const cy = Math.max(0.56 * hh, P.y - 0.2 * hh);
    off.set(0.36 * hw, cy - P.y, D); look.set(0.36 * hw, cy - P.y, 0); camDist = D;
  } else {
    // Keep the plane a steady share of the screen: about a quarter of the width in landscape and
    // under half in portrait, whatever its size, and never nearer than the 2D-style view needs.
    const tanH = Math.tan(fov / 2) * A, share = A >= 1 ? 0.24 : 0.4, r = plane.radius * vis();
    const D = Math.max((m === 'chase' ? 0.15 : 0.22) * Vw, r / (tanH * share) * (m === 'chase' ? 1 : 1.3));
    if (m === 'chase') { off.set(-D * 0.96, D * 0.3, D * 0.08); look.set(D * 1.2, D * 0.12, 0); }
    else { off.set(-D * 0.5, D * 0.26, D * 0.84); look.set(D * 0.28, D * 0.04, 0); }
    camDist = D;
  }
  if (!camState.init) { camState.off.copy(off); camState.look.copy(look); camState.init = true; }
  const k = 1 - Math.exp(-dt * 5);
  camState.off.lerp(off, k); camState.look.lerp(look, k);
  const prev = camera.position.clone();
  camera.position.set(P.x + camState.off.x, P.y + camState.off.y, P.z + camState.off.z);
  const ground = heightAt(camera.position.x, camera.position.z) + Math.max(1.5, camDist * 0.05);
  if (camera.position.y < ground && !(run && run.tun)) camera.position.y = ground;
  if (shake > 0 && dt > 0) { const s = shake * camDist / 900; camera.position.x += (Math.random() - .5) * s; camera.position.y += (Math.random() - .5) * s; }
  camera.lookAt(P.x + camState.look.x, P.y + camState.look.y, P.z + camState.look.z);
  if (dt > 0) shared.camVel.copy(camera.position).sub(prev).divideScalar(dt);
}
let hangarYaw = 0.9, dragX = null;
function hangarCamera() {
  const top = $('#topbar').getBoundingClientRect().bottom, bottom = Math.max(top + 60, $('#planeTitle').getBoundingClientRect().top - 6);
  const fov = camera.fov * Math.PI / 180, r = plane.radius;
  const want = Math.min((bottom - top) / 2, W / 2) * 0.86, d = r * H / (2 * Math.tan(fov / 2) * want);
  const cys = Math.min(H * 0.34, (top + bottom) / 2);
  const dir = new THREE.Vector3(-0.8, 0.13, 0.62).normalize();
  const target = HANGAR_POS.clone();
  camera.position.copy(target).addScaledVector(dir, d);
  camera.lookAt(target);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.lookAt(target.addScaledVector(up, -(H / 2 - cys) / (H / 2) * d * Math.tan(fov / 2)));
  camDist = d; shared.camVel.set(0, 0, 0);
}

/* ---------- UI ---------- */
function showToast(t, color = '#fff') {
  const el = $('#toast'); el.textContent = t; el.style.color = color; el.classList.add('show');
  clearTimeout(showToast.h); showToast.h = setTimeout(() => el.classList.remove('show'), 1300);
}
let modalKind = null;
function openModal(html, kind = 'info') { modalKind = kind; $('#modal').innerHTML = html; $('#modalBg').classList.remove('hidden'); }
function closeModal() { modalKind = null; $('#modalBg').classList.add('hidden'); }
const modalOpen = () => !$('#modalBg').classList.contains('hidden');

function showArea(i) {
  if (!save.settings.titles) return;
  const b = BIOMES[i], isNew = !save.seen3d.includes(b.key), rare = b.tier >= 2 ? TIERS[b.tier].name + ' region' : '';
  if (isNew) { save.seen3d.push(b.key); persist(); }
  $('#areaSub').textContent = isNew ? 'New area discovered' + (rare ? ' · ' + rare : '') : rare;
  $('#areaName').textContent = b.name;
  const el = $('#areaTitle'); el.classList.add('show'); sfx.area();
  clearTimeout(showArea.h); showArea.h = setTimeout(() => el.classList.remove('show'), 3000);
}

function effText(id, st) {
  switch (id) {
    case 'frame':   return `Launch ${fmt(st.launch * 3.6)} km/h`;
    case 'wings':   return `Glide ×${(0.008 / st.drag).toFixed(2)}`;
    case 'engine':  return st.thrust > 0 ? `Top speed ${fmt(st.top * 3.6)} km/h` : 'No engine';
    case 'fuel':    return `${st.fuel.toFixed(1)} s burn`;
    case 'tail':    return `Turn rate ×${(st.pitch / 1.3).toFixed(2)}`;
    case 'nose':    return `Keep ${Math.round(st.armor * 100)}% speed on hits`;
    case 'magnet':  return `Coins ×${st.income.toFixed(2)} · reach ×${st.magnetR.toFixed(2)}`;
    case 'reserve': return st.reserve > 0 ? `${st.reserve.toFixed(1)} s · drain ${Math.round(st.drain)}%/s` : 'No reserve tank';
  }
}
const partLocked = id => PART[id].req && !PART[id].req(save.parts);

function renderHangar() {
  $('#coins').textContent = fmt(save.coins);
  $('#best').textContent = fmtDist(save.best);
  $('#soundBtn').textContent = save.sound ? '🔊' : '🔇';
  const fs = stageOf('frame', save.parts.frame);
  $('#planeName').textContent = LOOKS.frame[fs];
  const rating = PARTS.reduce((s, p) => s + save.parts[p.id], 0);
  $('#planeSub').textContent = `${FRAME_TAGS[fs]} · Build rating ${rating} · ${save.seen3d.length}/${REGIONS.length} regions found`;
  const chips = $('#chips');
  if (!chips.children.length) {
    for (const p of PARTS) {
      const b = document.createElement('button'); b.className = 'chip'; b.dataset.id = p.id;
      b.innerHTML = `<span class="ic">${p.icon}</span><span class="nm">${p.name}</span><span class="lv"></span>`;
      b.addEventListener('click', () => { selPart = p.id; renderHangar(); });
      chips.appendChild(b);
    }
  }
  for (const b of chips.children) {
    const id = b.dataset.id, lvl = save.parts[id], P_ = PART[id], locked = partLocked(id);
    b.classList.toggle('sel', id === selPart);
    b.classList.toggle('locked', !!locked);
    b.classList.toggle('maxed', lvl >= P_.max);
    b.classList.toggle('afford', !locked && lvl < P_.max && save.coins >= partCost(id, lvl));
    b.querySelector('.lv').textContent = locked ? '🔒' : lvl >= P_.max ? 'MAX' : `Lv ${lvl}`;
  }
  // detail panel for the selected part
  const id = selPart, P_ = PART[id], lvl = save.parts[id], locked = partLocked(id);
  const st = curStats();
  $('#dIcon').textContent = P_.icon; $('#dName').textContent = P_.name; $('#dLv').textContent = `Lv ${lvl} / ${P_.max}`;
  const nextStageLv = Math.min(P_.max, (Math.floor(lvl / P_.step) + 1) * P_.step);
  let look = `Look: <b>${lookName(id, lvl)}</b>`;
  if (lvl === 0 && P_.install) look += ` · installs as <b>${LOOKS[id][0]}</b>`;
  else if (nextStageLv > lvl && stageOf(id, nextStageLv) !== stageOf(id, lvl)) look += ` · Lv ${nextStageLv}: ${LOOKS[id][stageOf(id, nextStageLv)]}`;
  $('#dLook').innerHTML = look;
  const btn = $('#upBtn');
  if (lvl >= P_.max) {
    $('#dEff').innerHTML = effText(id, st);
    btn.className = 'max'; btn.disabled = true; btn.textContent = 'MAXED OUT';
  } else {
    const nx = statsFor(Object.assign({}, save.parts, { [id]: lvl + 1 }));
    $('#dEff').innerHTML = `${effText(id, st)} → <b>${effText(id, nx)}</b>`;
    const c = partCost(id, lvl);
    btn.className = ''; btn.disabled = !!locked || save.coins < c;
    btn.innerHTML = locked ? `🔒 Needs ${P_.reqText}` : `${lvl === 0 && P_.install ? 'Install' : 'Upgrade'} · <span class="coin"></span> ${fmt(c)}`;
  }
  $('#dDesc').textContent = P_.desc;
  refreshPlane();
}

let buyPulse = 0;
function buy(id) {
  const P_ = PART[id], lvl = save.parts[id];
  if (partLocked(id) || lvl >= P_.max) return;
  const c = partCost(id, lvl); if (save.coins < c) return;
  const before = stageOf(id, lvl);
  save.coins -= c; save.parts[id]++; persist();
  buyPulse = 1;
  if (lvl === 0 && P_.install) { sfx.fanfare(); showToast(`${P_.name} installed!`, '#ffe08a'); }
  else if (stageOf(id, lvl + 1) !== before) { sfx.fanfare(); showToast(`New look: ${LOOKS[id][stageOf(id, lvl + 1)]}!`, '#ffe08a'); }
  else sfx.buy();
  renderHangar();
}
$('#upBtn').addEventListener('click', () => buy(selPart));

function setMode(m) {
  mode = m;
  const flying = m === 'fly' || m === 'launch';
  $('#hangar').classList.toggle('hidden', m !== 'hangar');
  $('#topbar').classList.toggle('hidden', m !== 'hangar');
  $('#hud').classList.toggle('hidden', !(flying || m === 'done'));
  $('#flightBtns').classList.toggle('hidden', !flying);
  $('#launchUI').classList.toggle('hidden', m !== 'launch');
  $('#ctls').classList.toggle('hidden', m !== 'fly');
  if (m !== 'fly') { ctl.ptrs.clear(); ctl.keys.clear(); paintCtls(); }
  $('#hint').classList.add('hidden');
  if (m === 'hangar') { $('#areaTitle').classList.remove('show'); items.hide(); particles.clear(); floaters = []; dealNextMap(); renderHangar(); hangarCamera(); terrain.warm(camera.position, booted ? 500 : 1500); }
  showTunnelUI();
}

$('#flyBtn').addEventListener('click', () => {
  audio(); newRun(); meterT = 0; paused = false; setMode('launch');
  $('#fuelWrap').classList.toggle('hidden', !(runSt.thrust > 0));
  $('#reserveWrap').classList.toggle('hidden', !(runSt.reserve > 0));
  $('#ctlRes').classList.toggle('hidden', !(runSt.reserve > 0));
  updateHud();
});
$('#soundBtn').addEventListener('click', () => { save.sound = !save.sound; persist(); renderHangar(); });
$('#menuBtn').addEventListener('click', openSettings);

/* settings shared by the hangar settings and the pause menu: on/off toggles, then choices */
const TOGGLES = [
  ['sound', 'Sound', () => save.sound, v => { save.sound = v; }],
  ['weather', 'Weather effects', () => save.settings.weather, v => { save.settings.weather = v; }],
  ['titles', 'Area titles', () => save.settings.titles, v => { save.settings.titles = v; }],
  ['markers', 'Distance markers', () => save.settings.markers !== false, v => { save.settings.markers = v; }],
];
const CHOICES = [
  ['camera', 'Camera', CAMS.map(k => [k, CAM_NAMES[k]]), () => camMode(), v => { save.settings.camera = v; }],
  ['quality', 'Graphics', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => save.settings.quality in QUALITY ? save.settings.quality : 'auto', v => { save.settings.quality = v; applyQuality(); }],
];
const choiceLabel = c => { const v = c[3](), o = c[2].find(x => x[0] === v); return (o ? o[1] : v) + (c[0] === 'quality' && v === 'auto' ? ` (${qualityName()})` : ''); };
const togglesHtml = () => `<div class="toggles">${TOGGLES.map(([k, label, get]) => `<button class="toggle${get() ? ' on' : ''}" data-k="${k}"><span>${label}</span><span class="sw"></span></button>`).join('')}${
  CHOICES.map(c => `<button class="toggle choice" data-c="${c[0]}"><span>${c[1]}</span><span class="val">${choiceLabel(c)}</span></button>`).join('')}</div>`;
function wireToggles() {
  document.querySelectorAll('.toggle[data-k]').forEach(b => b.addEventListener('click', () => {
    const t = TOGGLES.find(x => x[0] === b.dataset.k); t[3](!t[2]()); b.classList.toggle('on', t[2]()); persist();
    if (mode === 'hangar') renderHangar();
  }));
  document.querySelectorAll('.toggle[data-c]').forEach(b => b.addEventListener('click', () => {
    const c = CHOICES.find(x => x[0] === b.dataset.c), opts = c[2].map(o => o[0]), i = opts.indexOf(c[3]());
    c[4](opts[(i + 1) % opts.length]); b.querySelector('.val').textContent = choiceLabel(c); persist();
  }));
}

function openSettings() {
  openModal(`<h2>Settings</h2>
    ${togglesHtml()}
    <p style="margin-top:12px">Everything runs offline in your browser. Progress is saved automatically on this device, and shared with the 2D version when both are on the same site.</p>
    <div class="btns">
      <button id="expBtn">Export save (backup)</button>
      <button id="impBtn">Import save</button>
      <button id="rstBtn" class="danger">Reset all progress</button>
      <button id="clsBtn" class="primary">Close</button>
    </div>`, 'settings');
  wireToggles();
  $('#clsBtn').onclick = closeModal;
  $('#expBtn').onclick = () => {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(save))));
    openModal(`<h2>Your save code</h2><p>Copy this somewhere safe. Paste it into “Import save” to restore.</p>
      <textarea readonly id="codeBox">${code}</textarea><div class="btns"><button id="cpBtn">Copy</button><button class="primary" id="clsBtn">Done</button></div>`);
    const box = $('#codeBox'); box.addEventListener('focus', () => box.select());
    $('#cpBtn').onclick = () => { box.select(); (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).catch(() => document.execCommand('copy')); $('#cpBtn').textContent = 'Copied!'; };
    $('#clsBtn').onclick = closeModal;
  };
  $('#impBtn').onclick = () => {
    openModal(`<h2>Import save</h2><p>Paste a save code (from any version, 2D or 3D). This replaces your current progress.</p>
      <textarea id="codeBox" placeholder="Paste code here"></textarea><div class="btns"><button class="primary" id="okBtn">Import</button><button id="clsBtn">Cancel</button></div>`);
    $('#clsBtn').onclick = closeModal;
    $('#okBtn').onclick = () => {
      try {
        const txt = $('#codeBox').value.trim();
        const raw = JSON.parse(txt.startsWith('{') ? txt : decodeURIComponent(escape(atob(txt))));
        if (typeof raw.coins !== 'number') throw 0;
        save = migrateSave(raw); persist(); applyQuality();
        closeModal(); renderHangar(); showToast('Save imported!');
      } catch (e) { $('#okBtn').textContent = 'Invalid code — try again'; }
    };
  };
  $('#rstBtn').onclick = () => {
    openModal(`<h2>Reset everything?</h2><p>All coins and parts will be lost. This can’t be undone.</p>
      <div class="btns"><button class="danger" id="yesBtn">Yes, reset</button><button class="primary" id="clsBtn">Cancel</button></div>`);
    $('#clsBtn').onclick = closeModal;
    $('#yesBtn').onclick = () => { save = defaultSave(); persist(); selPart = 'frame'; applyQuality(); closeModal(); renderHangar(); };
  };
}

function updateHud() {
  $('#hudDist').textContent = fmtDist(P.x);
  $('#hudAlt').textContent = run.tun && P.y < 0 ? 'Tunnel' : fmtDist(Math.max(0, P.y));
  $('#hudSpd').textContent = fmt(P.v * 3.6) + ' km/h';
  $('#hudCoins').textContent = fmt(run.coins);
  if (runSt.thrust > 0) $('#fuelBar').style.width = clamp(P.fuel / runSt.fuel * 100, 0, 100) + '%';
  if (runSt.reserve > 0) {
    $('#reserveBar').style.width = clamp(P.reserve / runSt.reserve * 100, 0, 100) + '%';
    const ready = P.fuel <= 0 && P.reserve > 0 && !P.grounded;
    $('#reserveWrap').classList.toggle('on', P.reserveOn);
    const b = $('#ctlRes'); b.classList.toggle('ready', ready); b.classList.toggle('active', P.reserveOn);
    $('#resTxt').textContent = P.reserve > 0 ? (P.fuel > 0 ? 'after main fuel' : `${Math.max(0, P.reserve).toFixed(1)} s · SPACE`) : 'EMPTY';
    if (ready && !run.reserveToast && mode === 'fly') { run.reserveToast = true; showToast('RESERVE READY — hold SPACE', '#7de8ff'); }
  }
}

/* ---------- ending a run: landing, or quitting early ---------- */
const runEarnings = () => runEarningsFor(save, P.x, run.coins, runSt.income);
function bank(e) {
  const newBest = e.dist > save.best;
  save.coins += e.total; save.ms = e.ms; save.runs++;
  if (newBest) save.best = e.dist;
  save.bestAlt = Math.max(save.bestAlt, P.maxY);
  persist();
  return newBest;
}
function finishRun() {
  setMode('done');
  const e = runEarnings(), newBest = bank(e);
  openModal(`<h2>${P.crashed ? 'Crash landing!' : 'Landed!'}</h2>
    ${newBest ? '<div class="nb">🏆 NEW BEST DISTANCE!</div>' : ''}
    <div class="row"><span>Distance</span><b>${fmtDist(e.dist)}</b></div>
    <div class="row"><span>Max altitude</span><b>${fmtDist(P.maxY)}</b></div>
    <div class="row"><span>Top speed</span><b>${fmt(P.maxV * 3.6)} km/h</b></div>
    <div class="row"><span>Distance reward</span><b><span class="coin"></span> ${fmt(e.distCoins)}</b></div>
    <div class="row"><span>Coins collected</span><b><span class="coin"></span> ${fmt(e.coins)}</b></div>
    ${e.msBonus ? `<div class="row"><span>Milestone ${e.hit.map(fmtDist).join(', ')}</span><b><span class="coin"></span> ${fmt(e.msBonus)}</b></div>` : ''}
    <div class="total"><span class="coin"></span> +${fmt(e.total)}</div>
    <div class="btns"><button class="primary" id="colBtn">Collect</button></div>`, 'result');
  $('#colBtn').onclick = () => { closeModal(); setMode('hangar'); };
  if (e.hit.length) sfx.fanfare();
}

function pauseGame() {
  if (!(mode === 'fly' || mode === 'launch') || paused) return;
  paused = true; ctl.keys.clear(); ctl.ptrs.clear(); paintCtls();
  $('#areaTitle').classList.remove('show');
  openPause();
}
function openPause() {
  paused = true;
  const e = runEarnings();
  openModal(`<h2>Paused</h2>
    <div class="row"><span>Distance so far</span><b>${fmtDist(e.dist)}</b></div>
    <div class="row"><span>Yours if you quit now</span><b><span class="coin"></span> ${fmt(e.total)}</b></div>
    ${togglesHtml()}
    <div class="btns"><button class="primary" id="resBtn">Resume</button><button class="danger" id="exitBtn">Exit to hangar</button></div>`, 'pause');
  wireToggles();
  $('#resBtn').onclick = resumeGame;
  $('#exitBtn').onclick = () => confirmQuit(openPause);
}
function resumeGame() { closeModal(); paused = false; lastT = performance.now(); }
function confirmQuit(back) {
  if (!(mode === 'fly' || mode === 'launch')) return;
  $('#areaTitle').classList.remove('show');
  paused = true; ctl.keys.clear(); ctl.ptrs.clear(); paintCtls();
  const e = runEarnings();
  openModal(`<h2>Do you want to quit?</h2>
    <p>You’ll leave now and keep everything earned so far.</p>
    <div class="total"><span class="coin"></span> +${fmt(e.total)}</div>
    <div class="btns"><button class="danger" id="yesQuit">Yes, quit</button><button class="primary" id="noQuit">No, keep flying</button></div>`, 'quit');
  $('#yesQuit').onclick = quitRun;
  $('#noQuit').onclick = () => back ? back() : resumeGame();
  confirmQuit.back = back;
}
function quitRun() {
  const e = runEarnings(), newBest = bank(e);
  closeModal(); paused = false; setMode('hangar');
  showToast(e.total > 0 ? `+${fmt(e.total)} coins banked${newBest ? ' · new best!' : ''}` : 'Flight abandoned', '#ffe08a');
}
function cycleCamera() { const i = CAMS.indexOf(camMode()); save.settings.camera = CAMS[(i + 1) % CAMS.length]; persist(); showToast(CAM_NAMES[save.settings.camera] + ' camera'); }
$('#pauseBtn').addEventListener('click', pauseGame);
$('#camBtn').addEventListener('click', cycleCamera);
$('#quitBtn').addEventListener('click', () => confirmQuit(null));
document.addEventListener('visibilitychange', () => { if (document.hidden) { persist(); if (mode === 'fly' && !paused) pauseGame(); } });

/* ---------- input ---------- */
// Touch/mouse: the ▲ / ▼ / RESERVE pads do what they say; tapping anywhere else climbs.
// Keyboard: ↑/W climb, ↓/S dive, Space = reserve tank once you have one (climbs before that), Esc/P pause, C camera.
// In the tunnel minigame the ◀ ▶ pads (or ←/→, A/D) switch lanes; ▼ / ↓ at the "TUNNEL AHEAD" prompt goes in.
// In the hangar, drag the plane to turn it.
function paintCtls() { document.querySelectorAll('.ctl').forEach(el => el.classList.toggle('active', ctlOn(el.dataset.role))); }
addEventListener('pointerdown', e => {
  if (e.target.closest && e.target.closest('button, .modal, textarea')) return;
  audio();
  if (mode === 'hangar' && e.target === renderer.domElement) { dragX = e.clientX; return; }
  if (paused) return;
  if (mode === 'launch') { doLaunch(); return; }
  if (mode !== 'fly') return;
  const pad = e.target.closest && e.target.closest('.ctl'), role = pad ? pad.dataset.role : 'up';
  if (run.tun) { if (role === 'left') laneShift(-1); else if (role === 'right') laneShift(1); return; }
  if (tunnelPrompt && role === 'down') { startTunnel(); return; }
  ctl.ptrs.set(e.pointerId, role); paintCtls();
});
addEventListener('pointermove', e => { if (dragX !== null && mode === 'hangar') { hangarYaw += (e.clientX - dragX) * 0.012; dragX = e.clientX; hangarSpinPause = 3; } });
const lift = e => { dragX = null; ctl.ptrs.delete(e.pointerId); paintCtls(); };
addEventListener('pointerup', lift);
addEventListener('pointercancel', lift);
addEventListener('blur', () => { ctl.ptrs.clear(); ctl.keys.clear(); paintCtls(); });
function keyRole(code) {
  if (code === 'ArrowUp' || code === 'KeyW') return 'up';
  if (code === 'ArrowDown' || code === 'KeyS') return 'down';
  if (code === 'Space') return save.parts.reserve > 0 ? 'reserve' : 'up';
  return null;
}
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('textarea')) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (mode === 'fly' || mode === 'launch') {
      if (!paused) pauseGame();
      else if (modalKind === 'pause') resumeGame();
      else if (modalKind === 'quit') (confirmQuit.back || resumeGame)();
    } else if (modalOpen() && modalKind !== 'result') closeModal();
    return;
  }
  if (e.code === 'KeyC' && (mode === 'fly' || mode === 'launch') && !paused) { cycleCamera(); return; }
  if (mode === 'hangar' && !modalOpen()) {
    const ids = PARTS.map(p => p.id), i = ids.indexOf(selPart);
    if (e.code === 'ArrowRight') { selPart = ids[(i + 1) % ids.length]; renderHangar(); return; }
    if (e.code === 'ArrowLeft') { selPart = ids[(i + ids.length - 1) % ids.length]; renderHangar(); return; }
    if (e.code === 'KeyU' || e.code === 'Equal' || e.code === 'NumpadAdd') { buy(selPart); return; }
  }
  if (mode === 'fly' && !paused && run && run.tun) { // the tunnel minigame: ←/→ or A/D switch lanes
    const d = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (d) { e.preventDefault(); if (!e.repeat) laneShift(d); return; }
  }
  const role = keyRole(e.code);
  if (!role && e.code !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  if (mode === 'hangar') { if (!modalOpen() && (e.code === 'Space' || e.code === 'Enter')) $('#flyBtn').click(); return; }
  if (mode === 'done') { if (modalOpen() && $('#colBtn') && (e.code === 'Space' || e.code === 'Enter')) $('#colBtn').click(); return; }
  if (paused) return;
  if (mode === 'launch') { audio(); doLaunch(); return; }
  if (mode === 'fly' && role) { if (role === 'down' && tunnelPrompt) { startTunnel(); return; } if (run.tun) return; ctl.keys.add(role); paintCtls(); }
});
addEventListener('keyup', e => { const role = keyRole(e.code); if (role) { ctl.keys.delete(role); paintCtls(); } });
addEventListener('contextmenu', e => e.preventDefault());

function meterValue() { const p = (meterT * 0.9) % 2; return p < 1 ? p : 2 - p; }
function doLaunch() {
  const m = meterValue();
  const perfect = m >= 0.85;
  run.power = perfect ? 1.1 : 0.55 + 0.4 * (m / 0.85);
  P.v = runSt.launch * run.power;
  sfx.launch();
  if (perfect) { sfx.perfect(); showToast('PERFECT LAUNCH!', '#8dff9a'); }
  else if (m > 0.6) showToast('Good!', '#fff');
  setMode('fly');
  run.area = 0; setTimeout(() => { if (mode === 'fly' && run.area === 0) showArea(0); }, 700);
  if (!save.tipSeen || !save.tip2Seen) { $('#hint').textContent = 'Hold ▲ to climb · ▼ to dive'; $('#hint').classList.remove('hidden'); run.hintT = 4; }
}

/* ---------- overlay: floaters and speed lines ---------- */
const _pv = new THREE.Vector3();
function toScreen(x, y, z = 0) { _pv.set(x, y, z).project(camera); return [(_pv.x + 1) / 2 * W, (1 - _pv.y) / 2 * H, _pv.z < 1]; }
function drawOverlay(dt) {
  const d = fx.width / W; fctx.setTransform(d, 0, 0, d, 0, 0); fctx.clearRect(0, 0, W, H);
  if (mode === 'hangar' || !P) return;
  fctx.font = 'bold 16px system-ui, sans-serif'; fctx.textAlign = 'center';
  for (const f of floaters) {
    const [sx, sy, ok] = toScreen(f.x, f.y, f.z || 0); if (!ok) continue;
    fctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
    fctx.fillStyle = 'rgba(0,0,0,.4)'; fctx.fillText(f.txt, sx + 1, sy - (1 - f.life) * 40 + 1);
    fctx.fillStyle = f.c; fctx.fillText(f.txt, sx, sy - (1 - f.life) * 40);
  }
  fctx.globalAlpha = 1;
  if (!paused && P.v >= 25 * world.scale) { // speed lines
    const n = Math.min(24, (P.v / (25 * world.scale) - 1) * 10), side = camMode() === 'side';
    fctx.strokeStyle = 'rgba(255,255,255,.35)'; fctx.lineWidth = 2;
    const [cx, cy] = toScreen(P.x + 1000 * Math.cos(P.a), P.y + 1000 * Math.sin(P.a));
    for (let i = 0; i < n; i++) {
      const y = hash(i * 7 + Math.floor(time * 20)) * H, x = hash(i * 13 + Math.floor(time * 20)) * W;
      fctx.beginPath();
      if (side) { fctx.moveTo(x, y); fctx.lineTo(x - 60, y + Math.sin(P.a) * 60); }
      else { const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1; if (L < Math.min(W, H) * 0.22) continue; fctx.moveTo(x, y); fctx.lineTo(x + dx / L * 60, y + dy / L * 60); }
      fctx.stroke();
    }
  }
}

/* ---------- main loop ---------- */
let lastT = performance.now(), hangarSpinPause = 0, perf = { t: 0, n: 0 };
const vec = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!paused) time += dt;
  shared.time.value = time;
  let envX, alt;
  if (mode === 'hangar') {
    hangarT += dt;
    if (!world) world = makeWorld(curStats());
    envX = -4; alt = 0;
    hangarCamera();
    const s = 1 + buyPulse * 0.08; buyPulse = Math.max(0, buyPulse - dt * 2);
    if (hangarSpinPause > 0) hangarSpinPause -= dt; else hangarYaw += dt * 0.28;
    plane.root.position.copy(HANGAR_POS); plane.root.position.y += Math.sin(hangarT * 2) * 0.12;
    plane.root.rotation.set(0, hangarYaw, Math.sin(hangarT * 1.3) * 0.04 + 0.05, 'YXZ'); plane.root.scale.setScalar(s);
    plane.anim({ t: hangarT, thrust: save.parts.engine > 0, hl: selPart });
    $('#flash').style.opacity = buyPulse > 0.5 ? (buyPulse - 0.5) * 0.5 : 0;
    blob.visible = false; signs.update(1, 0, 96, 0, time);
  } else {
    if (!paused) {
      if (mode === 'launch') meterT += dt;
      if (mode === 'fly') {
        if (run.tun) tunnelStep(dt);
        else { const sub = Math.ceil(dt / (1 / 120)); for (let i = 0; i < sub; i++) physStep(dt / sub); P.z = lerp(P.z, 0, 1 - Math.exp(-dt * 3)); }
        run.t += dt;
        if (run.hintT > 0) { run.hintT -= dt; if (run.hintT <= 0) { $('#hint').classList.add('hidden'); save.tipSeen = save.tip2Seen = true; } }
        const vs = vis();
        if (P.thrusting && Math.random() < 0.8) particles.add({ x: P.x - Math.cos(P.a) * 3 * vs, y: P.y + 0.3 * vs, vx: -P.v * 0.1, vy: 0.5, life: 1, c: P.reserveOn ? '#7de8ff' : '#e6e6e6', a: 0.7, r: 0.45 * vs, grow: true });
        if (P.grounded && P.stopT > 0.6) finishRun();
        if (P.grounded && P.v > 1 && Math.random() < 0.5) particles.add({ x: P.x, y: 0.2, z: (Math.random() - 0.5) * vs, vx: -2, vy: 2, life: 0.8, c: '#a7875f', r: 0.35 * vs });
        if (run.t > 300 && !P.grounded && !run.tun) { P.grounded = true; P.v = 0; P.y = 0; } // safety net
        const area = biomeIndex(P.x);
        if (area > run.area) { run.area = area; showArea(area); }
        if (save.settings.weather) { // lightning in stormy regions
          const e = envAt(P.x, world.scale), vol = (e.a.lightning ? 1 - e.t : 0) + (e.b.lightning ? e.t : 0);
          if (vol > 0.5 && Math.random() < dt * 0.18) { sky.flash = 0.35; beep(60, 0.5, 'sawtooth', 0.03, -20); }
        }
      }
      particles.update(dt);
      for (const f of floaters) f.life -= dt * 1.1;
      floaters = floaters.filter(f => f.life > 0);
      Vw = lerp(Vw, clamp(55 + P.v * 2.4, 96, 9600), 1 - Math.exp(-dt * 2.5));
      shake = Math.max(0, shake - dt * 40);
    }
    flightCamera(paused ? 0 : dt);
    envX = P.x; alt = Math.max(0, P.y);
    const vs = vis();
    plane.root.scale.setScalar(vs);
    plane.root.position.set(P.x, P.y - plane.bottom * vs, P.z);
    plane.root.rotation.set(run.tun ? (run.tun.lane * run.tun.T.lane - P.z) / run.tun.T.lane * 0.5 : 0, 0, P.a);
    plane.anim({ t: time, thrust: P.thrusting || (!!run.tun && run.tun.phase !== 'enter' && runSt.thrust > 0), reserveOn: P.reserveOn, frozen: paused });
    const sh = !sky.sun.castShadow;
    const a = clamp(1 - P.y * 1152 / (300 * Vw), 0, 0.35);
    blob.visible = sh && a > 0 && !run.tun; blob.position.set(P.x, 0.06, 0); const bw = 68 * (1 - a) * Vw / 1152; blob.scale.set(bw * 1.2, bw * 0.45, 1); blob.material.opacity = a / 0.35;
    const side = camMode() === 'side', ahead = side ? Vw * 1.3 : Vw * 9;
    const under = run.tun && P.x > run.tun.T.x0; // underground, the surface's items and signs are out of sight
    if (under) { items.hide(); signs.update(1, 0, Vw, 0, time); }
    else {
      items.update(world, run.taken, P.x - Vw * 0.7, P.x + ahead, Vw, time);
      signs.update(P.x - Vw * 0.7, P.x + (side ? Vw * 1.3 : Vw * 5), Vw, save.best, time, save.settings.markers !== false);
    }
    $('#flash').style.opacity = sky.flash;
    if (mode === 'launch') $('#needle').style.left = (meterValue() * 100) + '%';
    updateTunnelPrompt();
    updateHud();
  }
  // world
  const scale = world ? world.scale : 1, e = envAt(envX, scale), q = QUALITY[qualityName()];
  camera.near = clamp(camDist * 0.03, 0.1, 50); camera.far = (q.view + camera.position.y * 2) * 1.25; camera.updateProjectionMatrix();
  sky.update(e, alt, paused ? 0 : dt, camera, { weather: save.settings.weather, wxQ: q.wx, scale, dist: camDist });
  if (sky.sun.castShadow) { // the shadow box follows the plane
    const S = mode === 'hangar' ? 6 : clamp(camDist * 0.9, 12, 900), tp = plane.root.position;
    sky.sun.target.position.copy(tp); sky.sun.position.copy(tp).addScaledVector(sky.lightDir, S * 3);
    const c = sky.sun.shadow.camera; if (c.right !== S) { c.left = -S; c.right = S; c.top = S; c.bottom = -S; c.near = 0.5; c.far = S * 6; c.updateProjectionMatrix(); }
  }
  const wa = e.a.water ? 1 - e.t : 0, wb = e.b !== e.a && e.b.water ? e.t : 0;
  water.visible = wa + wb > 0.01 || (e.a.water && e.t === 0);
  if (water.visible) { water.material.color.set(e.t > 0.5 && e.b.water ? e.b.water : e.a.water || e.b.water); water.position.set(camera.position.x, WATER_Y, camera.position.z); water.scale.setScalar(camera.far * 1.6); }
  manageTunnels(camera.position.x);
  if (camera.position.y < -1) { // underground: dark, close fog and little sunlight
    sky.fog.color.set('#0c0a08'); sky.fog.near = 20; sky.fog.far = 60 * (run && run.tun ? run.tun.T.lane : 20); sky.sun.intensity *= 0.15;
  }
  terrain.update(camera.position, q.budget);
  scenery.update(camera.position, camDist, time);
  renderer.render(scene, camera);
  drawOverlay(dt);
  // auto graphics: step down if frames are slow for a few seconds
  if (save.settings.quality === 'auto' && !paused && !document.hidden) {
    perf.t += dt; perf.n++;
    if (perf.t > 4) { const avg = perf.t / perf.n; if (avg > 1 / 38 && autoQ !== 'low') { autoQ = autoQ === 'high' ? 'medium' : 'low'; applyQuality(); } perf.t = 0; perf.n = 0; }
  }
  requestAnimationFrame(frame);
}

/* ---------- offline earnings ---------- */
function offlineEarnings() {
  const away = (Date.now() - (save.last || Date.now())) / 60000; // minutes
  if (away < 2 || save.runs === 0) return;
  const mins = Math.min(away, 240);
  const rate = Math.max(1, 0.15 * Math.pow(3.2, corePower() / 5) * curStats().income);
  const earn = Math.floor(rate * mins);
  if (earn <= 0) return;
  save.coins += earn; persist();
  openModal(`<h2>Welcome back!</h2>
    <p>Your hangar crew polished planes while you were away${away > 240 ? ' (up to 4 hours counts)' : ''}.</p>
    <div class="total"><span class="coin"></span> +${fmt(earn)}</div>
    <div class="btns"><button class="primary" id="clsBtn">Nice</button></div>`);
  $('#clsBtn').onclick = () => { closeModal(); renderHangar(); };
}

// start on the cheapest thing you can afford, so the next step is obvious
(function pickStartPart() {
  const ok = PARTS.filter(p => !partLocked(p.id) && save.parts[p.id] < p.max);
  ok.sort((a, b) => partCost(a.id, save.parts[a.id]) - partCost(b.id, save.parts[b.id]));
  if (ok.length) selPart = ok[0].id;
})();
setMode('hangar'); // deals the first map and builds the first view before anything shows
booted = true;
offlineEarnings();
persist();
$('#boot').remove();
requestAnimationFrame(frame);

/* ---------- offline install (PWA) ---------- */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
