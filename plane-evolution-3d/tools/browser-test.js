// Browser checks for Plane Evolution 3D. Starts its own static server on the repo folder (so the
// 2D game is reachable too), drives Chromium with Playwright, prints PASS/FAIL lines and writes
// screenshots to the output folder.
//   npm i -g playwright            (once; or use a local install)
//   node tools/browser-test.js [outDir]      (screenshots default to <tmp>/plane-evolution-3d-shots)
// Env: CHROMIUM=/path/to/chrome to use a specific browser build.
// Checks: save migrations and backups, unreadable saves, 2D <-> 3D save sharing, pause freezing,
// every quit path banking exactly the promised coins, results, export/import, offline earnings,
// physics identical to the 2D game, UI overflow at seven screen sizes, the 50 regions and map
// dealing (rarity odds), area titles and the region tag, the distance-markers setting, the plane's size
// on landing, the tunnel minigame (area skip, lanes, multipliers, bumps, time limit, exit), and zero
// console errors.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const C = require('../js/core.js');

const ROOT = path.resolve(__dirname, '../..'), OUT = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'plane-evolution-3d-shots'));
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/plain' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`, URL3 = base + '/plane-evolution-3d/index.html', URL2 = base + '/plane-evolution/index.html', BLANK = base + '/plane-evolution-3d/README.md';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.location().url)) errs.push(m.text()); });
  p.on('pageerror', e => errs.push(e.message));
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png') });
  // seed storage from a neutral page, since the game saves over storage when it unloads
  const seed = async (fn, arg) => { await p.goto(BLANK); await p.evaluate(fn, arg); await p.goto(URL3); await p.waitForTimeout(1200); };
  const put = s => { localStorage.clear(); localStorage.setItem('planeEvolution.save.v1', typeof s === 'string' ? s : JSON.stringify(s)); };

  // --- saves
  await seed(put, { coins: 500, lv: { launch: 7, aero: 3, engine: 2, fuel: 1, income: 4 }, tier: 2, best: 321, bestAlt: 40, ms: 2, runs: 9, sound: false, last: Date.now() });
  let r = await p.evaluate(() => ({ save, bk: localStorage.getItem('planeEvolution.save.v1.backup.v1') }));
  ok(r.save.v === 3 && r.save.parts.frame === 7 && r.save.parts.wings === 3 && r.save.parts.magnet === 4 && r.save.parts.tail === 4 && r.save.coins === 500 && r.save.sound === false, 'v1 save migrates');
  ok(!!r.bk && JSON.parse(r.bk).tier === 2 && r.save.legacy.tier === 2, 'v1 backup and legacy fields kept');
  ok(r.save.settings.quality === 'auto' && r.save.settings.camera === 'chase', '3D settings get defaults');
  await seed(put, { v: 2, coins: 1, tier: 5, lv: { launch: 30, aero: 30, engine: 25, fuel: 20, income: 10, reserve: 2 }, best: 5000, ms: 5, runs: 50, sound: true, last: Date.now(), extra: 'keep me' });
  r = await p.evaluate(() => save);
  ok(r.parts.reserve === 3 && r.parts.tail === 10 && r.parts.engine === 25 && r.extra === 'keep me', 'v2 save migrates and keeps unknown fields');
  await seed(put, '{broken json');
  r = await p.evaluate(() => ({ un: localStorage.getItem('planeEvolution.save.v1.unreadable'), coins: save.coins }));
  ok(r.un === '{broken json' && r.coins === 0, 'unreadable save is stashed, not dropped');
  await p.evaluate(() => { save = migrateSave({ v: 3, coins: 777, parts: { frame: 5, wings: 6, engine: 7, fuel: 8, tail: 1, nose: 2, magnet: 3, reserve: 0 }, best: 99, runs: 3, settings: { weather: false, titles: true, quality: 'low', camera: 'side' }, seen: [0, 1], last: Date.now() }); persist(); });
  await p.goto(URL2); await p.waitForTimeout(1000);
  ok(await p.evaluate(() => save.coins === 777 && save.parts.engine === 7), 'the 2D game loads a save written by 3D');
  await p.evaluate(() => { save.coins += 1; persist(); });
  await p.goto(URL3); await p.waitForTimeout(1200);
  r = await p.evaluate(() => save);
  ok(r.coins === 778 && r.settings.quality === 'low' && r.settings.camera === 'side', '3D settings survive a 2D save');

  // --- flight flows
  await p.evaluate(() => { Object.assign(save.parts, { frame: 30, wings: 30, engine: 30, fuel: 30 }); save.settings.camera = 'chase'; persist(); renderHangar(); });
  await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const x1 = await p.evaluate(() => P.x); await p.waitForTimeout(1000);
  ok(x1 > 0 && x1 === await p.evaluate(() => P.x), 'pause freezes the flight');
  ok(/Yours if you quit now/.test(await p.evaluate(() => document.querySelector('#modal').innerText)), 'pause shows what quitting banks');
  await p.click('#exitBtn'); await p.waitForTimeout(150);
  ok(/Do you want to quit\?/.test(await p.evaluate(() => document.querySelector('#modal').innerText)), 'exit asks "Do you want to quit?"');
  await p.click('#noQuit'); ok(await p.evaluate(() => modalKind === 'pause'), 'No goes back to the pause menu');
  await p.click('#resBtn'); await p.waitForTimeout(500); ok(await p.evaluate(() => !paused && mode === 'fly'), 'Resume flies again');
  await p.click('#quitBtn'); await p.click('#noQuit'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !paused && mode === 'fly' && !modalOpen()), '✕ then No goes back to flying');
  await p.click('#quitBtn'); await p.waitForTimeout(100);
  const before = await p.evaluate(() => ({ coins: save.coins, promised: runEarnings().total }));
  await p.click('#yesQuit'); await p.waitForTimeout(200);
  r = await p.evaluate(() => ({ coins: save.coins, mode }));
  ok(r.mode === 'hangar' && r.coins === before.coins + before.promised, `Yes banks exactly the promised ${before.promised} coins`);
  await p.evaluate(() => { save.parts = { frame: 0, wings: 0, engine: 0, fuel: 0, tail: 0, nose: 0, magnet: 0, reserve: 0 }; renderHangar(); });
  await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.keyboard.press('Enter');
  for (let i = 0; i < 120; i++) { if (await p.evaluate(() => mode) === 'done') break; await p.waitForTimeout(250); }
  ok(/(Landed!|Crash landing!)[\s\S]*Distance reward[\s\S]*Collect/.test(await p.evaluate(() => document.querySelector('#modal').innerText)), 'landing shows the results');
  await shot('results');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200); ok(await p.evaluate(() => mode === 'hangar'), 'Collect returns to the hangar');
  const code = await p.evaluate(() => btoa(unescape(encodeURIComponent(JSON.stringify(save)))));
  await p.evaluate(() => { save.coins = 5; openSettings(); }); await p.click('#impBtn'); await p.fill('#codeBox', code); await p.click('#okBtn');
  ok(await p.evaluate(() => save.coins !== 5), 'import restores an export code');
  await p.evaluate(() => openSettings()); await p.click('#impBtn'); await p.fill('#codeBox', '{"coins":42,"lv":{"launch":1}}'); await p.click('#okBtn');
  ok(await p.evaluate(() => save.coins === 42 && save.parts.frame === 1), 'import migrates raw v1 JSON');
  const cur = await p.evaluate(() => save);
  await seed(s => { s.runs = 5; s.last = Date.now() - 30 * 60000; localStorage.setItem('planeEvolution.save.v1', JSON.stringify(s)); }, cur);
  ok(/Welcome back!/.test(await p.evaluate(() => document.querySelector('#modal').innerText)), 'welcome-back modal after 30 min away');

  // --- physics identical to the 2D game (its own physStep, driven through its ctl.keys)
  await p.goto(URL2); await p.waitForTimeout(800);
  const script = t => ({ up: (t % 3) < 1.2, down: (t % 3) > 2.2 && (t % 3) < 2.6, reserve: t > 4 });
  for (const bld of [{ frame: 0, wings: 0, engine: 0, fuel: 0, tail: 0, nose: 0, magnet: 0, reserve: 0 }, { frame: 20, wings: 25, engine: 22, fuel: 18, tail: 7, nose: 3, magnet: 5, reserve: 4 }, { frame: 50, wings: 50, engine: 50, fuel: 50, tail: 20, nose: 20, magnet: 50, reserve: 30 }]) {
    const two = await p.evaluate(([bld, src]) => {
      const script = eval(src); save.parts = Object.assign({}, bld); newRun(); world.chunk = () => []; P.v = runSt.launch * 1.1; mode = 'fly';
      let t = 0; const out = [];
      for (let i = 0; i < 4800 && !(P.grounded && P.stopT > 0.6); i++) { const c = script(t); ctl.keys.clear(); for (const k in c) if (c[k]) ctl.keys.add(k); physStep(1 / 120); t += 1 / 120; if (i % 240 === 0) out.push([P.x, P.y, P.v, P.a]); }
      out.push([P.x, P.y, P.v, P.a]); return out;
    }, [bld, script.toString()]);
    const st = C.statsFor(bld), P = C.newPlaneState(st); P.v = st.launch * 1.1;
    let t = 0; const three = [];
    for (let i = 0; i < 4800 && !(P.grounded && P.stopT > 0.6); i++) { C.flightStep(P, st, script(t), 1 / 120, Math.max(1, st.Sv), null); t += 1 / 120; if (i % 240 === 0) three.push([P.x, P.y, P.v, P.a]); }
    three.push([P.x, P.y, P.v, P.a]);
    let d = two.length === three.length ? 0 : Infinity;
    two.forEach((row, i) => row.forEach((v, k) => { d = Math.max(d, Math.abs(v - three[i][k])); }));
    ok(d < 1e-9, `physics matches 2D for engine Lv ${bld.engine} (${fmtN(three[three.length - 1][0])} m, max diff ${d})`);
  }

  // --- UI overflow at seven screen sizes, with huge numbers everywhere
  await seed(put, { v: 3, coins: 1234567890123, parts: { frame: 49, wings: 50, engine: 47, fuel: 44, tail: 19, nose: 20, magnet: 48, reserve: 29 }, best: 123456, ms: 10, runs: 999, sound: true, settings: { weather: true, titles: true, quality: 'low', camera: 'chase' }, seen: [0, 1, 2, 3, 4, 5], last: Date.now() });
  const check = label => p.evaluate(label => {
    const bad = [], vis = el => { const q = el.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.hidden'); };
    for (const el of document.querySelectorAll('.pill, .chip, .chip .nm, .chip .lv, #upBtn, #flyBtn, #planeTitle .name, #planeTitle .sub, #detail .dh, #detail .look, #detail .eff, #detail .desc, .toggle, .toggle > span, .modal h2, .modal .row, .modal .row b, .modal .total, .modal button, #hudDist, #hudRow, .ctl, #areaTitle .name, #launchUI .t, .iconbtn, #topbar .pills, #tunnelPrompt .t, #tunnelPrompt .s, #regionTag')) {
      if (!vis(el)) continue;
      const q = el.getBoundingClientRect();
      if (el.id !== 'regionTag' && el.scrollWidth > el.clientWidth + 1) bad.push(`${label}: "${el.textContent.trim().slice(0, 30)}" overflows its box`);
      if (q.left < -1 || q.right > innerWidth + 1) bad.push(`${label}: "${el.textContent.trim().slice(0, 30)}" leaves the screen`);
    }
    return bad;
  }, label);
  let bad = [];
  for (const [w, h] of [[360, 640], [390, 844], [844, 390], [700, 500], [1024, 768], [1280, 720], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
    for (const id of C.PARTS.map(x => x.id)) { await p.evaluate(id => { selPart = id; renderHangar(); }, id); bad = bad.concat(await check(`${w}x${h} hangar/${id}`)); }
    await shot(`hangar_${w}x${h}`);
    await p.evaluate(() => openSettings()); bad = bad.concat(await check(`${w}x${h} settings`)); await p.evaluate(() => closeModal());
    await p.evaluate(() => document.querySelector('#flyBtn').click()); await p.waitForTimeout(150); bad = bad.concat(await check(`${w}x${h} launch`));
    await p.evaluate(() => doLaunch()); await p.waitForTimeout(200);
    await p.evaluate(() => { P.x = 123456.7; P.y = 98765; P.v = 999; run.coins = 987654321; showArea(5); });
    await p.waitForTimeout(200); bad = bad.concat(await check(`${w}x${h} flight`)); await shot(`flight_${w}x${h}`);
    await p.evaluate(() => pauseGame()); await p.waitForTimeout(100); bad = bad.concat(await check(`${w}x${h} pause`));
    await p.click('#exitBtn'); bad = bad.concat(await check(`${w}x${h} quit`)); await p.click('#noQuit'); await p.click('#resBtn');
    await p.evaluate(() => { P.grounded = true; P.v = 0; P.stopT = 1; save.ms = 0; }); await p.waitForTimeout(300);
    bad = bad.concat(await check(`${w}x${h} results`));
    await p.evaluate(() => { const c = document.querySelector('#colBtn'); if (c) c.click(); }); await p.waitForTimeout(150);
  }
  ok(!bad.length, 'no UI text overflows at 360x640 … 1920x1080' + (bad.length ? '\n  ' + bad.join('\n  ') : ''));

  // --- regions: the catalogue, dealing, rarity odds
  r = await p.evaluate(() => {
    const tiers = [0, 1, 2, 3, 4].map(t => REGIONS.filter(x => x.tier === t).length), keys = new Set(REGIONS.map(x => x.key));
    let firstCommon = true, noDup = true, lens = true; const rare = { low: 0, high: 0 };
    for (let i = 0; i < 400; i++) {
      const lo = dealMap(i + 1, 5), hi = dealMap(i + 1, 45);
      if (lo[0].tier !== 0 || hi[0].tier !== 0) firstCommon = false;
      if (new Set(lo.map(x => x.key)).size !== 50) noDup = false;
      lo.forEach((x, k) => { if (Math.abs(x.len - 400 * Math.pow(1.25, k)) > 1e-6) lens = false; });
      for (let k = 1; k < 12; k++) { if (lo[k].tier >= 3) rare.low++; if (hi[k].tier >= 3) rare.high++; }
    }
    return { n: REGIONS.length, tiers, uniq: keys.size, firstCommon, noDup, lens, rare };
  });
  ok(r.n === 50 && r.uniq === 50 && r.tiers.join() === '12,12,12,9,5', `50 regions in tiers ${r.tiers.join('/')}`);
  ok(r.firstCommon && r.noDup && r.lens, 'every map starts Common, never repeats a region, and region k is 400 × 1.25^k m');
  ok(r.rare.high > r.rare.low * 3, `stronger planes meet Epic/Legendary regions more often (${r.rare.low} vs ${r.rare.high} in 400 maps)`);
  await p.evaluate(() => closeModal && closeModal());
  const m1 = await p.evaluate(() => BIOMES.map(x => x.key).join());
  await p.evaluate(() => setMode('hangar'));
  const m2 = await p.evaluate(() => BIOMES.map(x => x.key).join());
  ok(m1 !== m2, 'returning to the hangar deals a new map');

  // --- a screenshot of the first regions of a dealt map, from the chase and side cameras
  await p.setViewportSize({ width: 960, height: 540 });
  await p.evaluate(() => { save.settings.quality = 'low'; save.seen3d = []; save.seen = [0]; applyQuality(); renderHangar(); });
  await p.evaluate(() => { document.querySelector('#flyBtn').click(); doLaunch(); });
  for (let i = 0; i < 6; i++) for (const cam of ['chase', 'side']) {
    await p.evaluate(([i, cam]) => { const g = BIOMES[i]; window.X = g.at + Math.min(150, g.len * 0.4); save.settings.camera = cam; P.x = X; P.y = 35; P.a = 0.1; P.v = 30; P.fuel = 99; camState.init = false; }, [i, cam]);
    await p.waitForTimeout(2000); await p.evaluate(() => { P.x = X; P.y = 35; camState.init = false; }); await p.waitForTimeout(300);
    await shot(`region${i}_${cam}`);
    if (cam === 'chase') { const nm = await p.evaluate(i => [document.querySelector('#areaName').textContent, BIOMES[i].name], i); ok(nm[0] === nm[1], `area title reads "${nm[1]}"`); }
  }
  r = await p.evaluate(() => ({ seen3d: save.seen3d.slice(), keys: BIOMES.slice(0, 6).map(x => x.key), seen: save.seen }));
  ok(r.keys.every(k => r.seen3d.includes(k)) && r.seen.join() === '0', 'discoveries go to seen3d by region; the 2D seen list is untouched');

  // --- distance markers setting (BEST flag stays)
  await p.evaluate(() => { save.best = P.x + 60; save.settings.markers = false; });
  await p.waitForTimeout(400);
  r = await p.evaluate(() => ({ posts: signs.pool.filter(s => s.g.visible).length, best: signs.best.visible }));
  ok(r.posts === 0 && r.best, 'Distance markers off hides the signposts but keeps the BEST flag');
  await p.evaluate(() => { save.settings.markers = true; }); await p.waitForTimeout(400);
  ok(await p.evaluate(() => signs.pool.some(s => s.g.visible)), 'Distance markers on shows the signposts');

  // --- the region tag under the HUD: after the splash title, or straight away with titles off
  r = await p.evaluate(() => { const t = document.querySelector('#regionTag'); return { txt: t.textContent, cls: t.className, name: BIOMES[run.area].name, op: getComputedStyle(t).opacity }; });
  ok(r.txt.startsWith(r.name + ' · ') && r.cls === '' && r.op === '1', `after the splash, the HUD names the region ("${r.txt}")`);
  await p.evaluate(() => { save.settings.titles = false; showArea(run.area); });
  r = await p.evaluate(() => ({ cls: document.querySelector('#regionTag').className, splash: document.querySelector('#areaTitle').classList.contains('show') }));
  ok(r.cls === '' && !r.splash, 'with area titles off, the region tag shows straight away');
  await p.evaluate(() => { save.settings.titles = true; });

  // --- the plane keeps its size once it lands
  await p.evaluate(() => { P.x = BIOMES[2].at; P.y = 0.4; P.v = 70; P.a = -0.05; P.fuel = 0; P.grounded = false; run.tun = null; });
  for (let i = 0; i < 40 && !(await p.evaluate(() => P.grounded)); i++) await p.waitForTimeout(50);
  const vw0 = await p.evaluate(() => Vw); await p.waitForTimeout(700);
  r = await p.evaluate(() => ({ vw: Vw, v: P.v, g: P.grounded }));
  ok(r.g && Math.abs(r.vw - vw0) < 1e-9, `the plane's size holds while it rolls to a stop (view ${Math.round(vw0)} → ${Math.round(r.vw)})`);

  // --- tunnels: under every 5th area, skipping it; 10 s lane game, multipliers, 3 bumps, ramp exit
  r = await p.evaluate(() => ({ n: tunnels.length, at: tunnels.every((t, i) => t.area === 4 + 5 * i && t.x0 === BIOMES[t.area].at && Math.abs(t.exitX - (BIOMES[t.area].at + BIOMES[t.area].len)) < 1e-6), mult: tunnels.map(t => t.mult).join() }));
  ok(r.n === 10 && r.at, 'a tunnel starts each of areas 5, 10, 15 … 50 and comes out at the start of the next area');
  ok(r.mult === '2,4,8,8,8,8,8,8,8,8', `the multiplier is ×2 in the first tunnel, ×4 in the second, then ×8 (${r.mult})`);
  const toTunnel = () => { run.tun = null; run.tunPassed.clear(); save.settings.camera = 'chase'; const t = tunnels[0]; P.x = t.x0 - 150; P.y = 30; P.a = 0; P.v = 40; P.fuel = 0; P.grounded = false; camState.init = false; run.area = t.area - 1; };
  await p.evaluate(toTunnel);
  for (let i = 0; i < 60 && !(await p.evaluate(() => !!tunnelPrompt)); i++) await p.waitForTimeout(100);
  r = await p.evaluate(() => ({ shown: !document.querySelector('#tunnelPrompt').classList.contains('hidden'), sub: document.querySelector('#tunnelSub').textContent }));
  ok(r.shown && /×2 coins/.test(r.sub), `"TUNNEL AHEAD" shows before area 5 ("${r.sub}")`);
  await shot('tunnel_prompt');
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(700);
  r = await p.evaluate(() => ({ phase: run.tun && run.tun.phase, dist: document.querySelector('#hudDist').textContent, want: fmtDist(tunnels[0].exitX), earn: runEarnings().dist, exitX: tunnels[0].exitX }));
  ok(r.phase === 'enter' && r.dist === r.want && Math.abs(r.earn - r.exitX) < 1e-6, `DIVE takes the tunnel and the distance jumps to the end of the skipped area (${r.dist})`);
  await p.evaluate(() => { run.tun.t = run.tun.dur; });
  for (let i = 0; i < 60 && !(await p.evaluate(() => run.tun && run.tun.phase === 'play')); i++) await p.waitForTimeout(100);
  r = await p.evaluate(() => ({ phase: run.tun.phase, lanes: [...document.querySelectorAll('.ctl.lane')].every(e => !e.classList.contains('hidden')), flight: [...document.querySelectorAll('.ctl:not(.lane)')].every(e => e.style.visibility === 'hidden'), hud: !document.querySelector('#tunHud').classList.contains('hidden') }));
  ok(r.phase === 'play' && r.lanes && r.flight && r.hud, 'in the tunnel only the ◀ ▶ lane pads show, with chances and time on the HUD');
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => run.tun.lane === 1), '→ moves one lane right');
  await p.evaluate(() => { const T = run.tun.T; T.obs.forEach(o => { if (o.x < T.play0 + 200) o.hit = true; }); P.x = T.play0 + 60; }); await p.waitForTimeout(900); await shot('tunnel_inside');
  r = await p.evaluate(() => ({ fuel: P.fuel === runSt.fuel, dist: document.querySelector('#hudDist').textContent, want: fmtDist(tunnels[0].exitX), cam: camera.layers.mask }));
  ok(r.fuel && r.dist === r.want, 'fuel is unlimited inside, and the distance stays frozen at the end of the skipped area');
  ok(r.cam === 2, 'inside, the camera sees only the tunnel layer (no ground or weather showing through)');
  await p.evaluate(() => { const T = run.tun.T, m = T.multi; T.obs.forEach(o => { if (Math.abs(o.x - m.x) < T.lane * 4) o.hit = true; }); run.coins = 1000; run.tun.lane = m.lane; P.z = m.lane * T.lane; P.x = m.x - T.lane * 0.8; });
  for (let i = 0; i < 120 && !(await p.evaluate(() => run.tun.T.multi.taken)); i++) await p.waitForTimeout(50);
  r = await p.evaluate(() => run.coins);
  ok(r >= 2000 && r < 2100, `the ×2 multiplier doubles the flight's coins (1,000 → ${r})`);
  const COINS = r;
  for (let k = 0; k < 3; k++) {
    await p.evaluate(() => { const T = run.tun.T, o = T.obs.find(o => !o.hit && o.x > P.x + T.lane) || T.obs.find(o => !o.hit); run.tun.inv = 0; run.tun.lane = o.lane; P.z = o.lane * T.lane; P.x = o.x - T.lane * 0.8; });
    for (let i = 0; i < 40 && (await p.evaluate(k => run.tun.lives > 2 - k, k)); i++) await p.waitForTimeout(50);
    if (k === 0) await shot('tunnel_bump');
  }
  r = await p.evaluate(() => ({ lives: run.tun.lives, phase: run.tun.phase, coins: run.coins, toast: document.querySelector('#toast').textContent }));
  ok(r.lives === 0 && r.phase === 'exit' && r.coins >= COINS && r.toast === 'OUT OF CHANCES!', 'the 3rd bump ends the tunnel early, keeping the coins and the multiplier');
  await p.evaluate(() => { // note the state at the moment of the launch, before the engine starts burning fuel
    const show = showToast; window.showToast = (t, c) => { if (t === 'BACK IN THE AIR!') window.EXIT = { fuel: P.fuel, v: P.v, x: P.x }; return show(t, c); };
    P.x = run.tun.T.exitX - 5;
  });
  for (let i = 0; i < 40 && (await p.evaluate(() => !!run.tun)); i++) await p.waitForTimeout(50);
  await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ tun: !!run.tun, e: window.EXIT, full: runSt.fuel, exitX: tunnels[0].exitX, y: P.y, area: run.area, skipped: tunnels[0].area, seen: save.seen3d.includes(tunnels[0].rg.key), next: BIOMES[tunnels[0].area + 1].key, seenNext: save.seen3d.includes(BIOMES[tunnels[0].area + 1].key) }));
  ok(!r.tun && r.e && Math.abs(r.e.fuel - r.full * 0.5) < 1e-9 && r.e.v === 80 && r.e.x >= r.exitX && r.y > 0, 'the ramp launches the plane at 288 km/h with the main tank half full, at the next area');
  ok(r.area === r.skipped + 1 && r.seenNext, 'after the tunnel the flight is in the next area, and it is announced');
  await shot('tunnel_out');
  // the time limit
  await p.evaluate(toTunnel);
  for (let i = 0; i < 60 && !(await p.evaluate(() => !!tunnelPrompt)); i++) await p.waitForTimeout(100);
  await p.evaluate(() => { startTunnel(); run.tun.t = run.tun.dur; });
  for (let i = 0; i < 60 && !(await p.evaluate(() => run.tun && run.tun.phase === 'play')); i++) await p.waitForTimeout(100);
  await p.evaluate(() => { run.tun.T.obs.length = 0; run.tun.play = TUNNEL_TIME - 0.02; });
  for (let i = 0; i < 40 && (await p.evaluate(() => run.tun.phase === 'play')); i++) await p.waitForTimeout(50);
  r = await p.evaluate(() => ({ phase: run.tun.phase, lives: run.tun.lives, toast: document.querySelector('#toast').textContent, lanes: [...document.querySelectorAll('.ctl.lane')].every(e => e.classList.contains('hidden')) }));
  ok(r.phase === 'exit' && r.lives === 3 && r.toast === "TIME'S UP!" && r.lanes, `after ${10} s the lane game ends and the plane heads for the exit`);
  // quitting from inside banks the skipped area's distance
  r = await p.evaluate(() => ({ d: runEarnings().dist, exitX: run.tun.T.exitX }));
  ok(Math.abs(r.d - r.exitX) < 1e-6, 'quitting from inside the tunnel counts the skipped area');

  ok(!errs.length, 'no console errors' + (errs.length ? '\n  ' + errs.slice(0, 10).join('\n  ') : ''));
  console.log(`\n${fails ? fails + ' FAILED' : 'all passed'}; screenshots in ${OUT}`);
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
function fmtN(v) { return Math.round(v).toLocaleString('en-US'); }
