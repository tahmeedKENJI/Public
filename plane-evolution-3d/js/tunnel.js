'use strict';
/* ==========================================================================
   Tunnels: a coin minigame under every 5th area.

   A tunnel mouth sits at the start of areas 5, 10, 15, … of every map. When it is a few
   seconds ahead, "TUNNEL AHEAD" offers it: press DIVE and the plane runs a scripted dive
   into the mouth. Taking it skips that whole area: the distance jumps to the area's end
   and stays there while you are underground. Inside, the plane flies level at a fixed
   speed with unlimited fuel for a fixed TUNNEL_TIME seconds, and ◀ ▶ (or ←/→, A/D) switch
   between 3 lanes to dodge obstacles and collect coins. Each tunnel holds one coin
   multiplier (×2 in the first tunnel, ×4 in the second, ×8 from then on) that multiplies
   the flight's coins when picked up. Three bumps end the tunnel early (coins and
   multipliers are kept). Either way the plane comes up a ramp at the start of the next
   area and launches back into flight with the main tank half full.

   The play section lies under the skipped area. At the end of it the entry section is
   swapped for a short exit section under the next area's start, which looks the same from
   the inside, and the plane carries on there.
   ========================================================================== */

const TUNNEL_SPEED = 80;                  // m/s (288 km/h), inside and when launched out
const TUNNEL_TIME = 10;                   // seconds of the lane game
const TUNNEL_EVERY = 5;                   // a tunnel under every 5th area
const TUNNEL_LIVES = 3;                   // bumps before the tunnel ends early
const TUNNEL_MULTS = [2, 4, 8];           // the multiplier in the 1st, 2nd and later tunnels
const TUNNEL_VW = 55 + 2.4 * TUNNEL_SPEED; // the view width used for sizes inside, as the 2D zoom would be at that speed
const TUNNEL_LAYER = 1;                   // inside the bore the camera sees only this layer: the tunnel, the plane, particles, lights
const MULT_COLOR = { 2: '#7dff9a', 4: '#6fd0ff', 8: '#e48cff' };

// Where the tunnels are on a dealt map: under areas 5, 10, 15, …
function tunnelsFor(map) {
  const out = [];
  for (let k = TUNNEL_EVERY - 1, n = 0; k < map.length; k += TUNNEL_EVERY, n++) {
    const rg = map[k];
    out.push({ rg, n, area: k, x0: rg.at, exitX: rg.at + rg.len, mult: TUNNEL_MULTS[Math.min(n, TUNNEL_MULTS.length - 1)], crystals: rg.key === 'crystal' });
  }
  return out;
}

// Geometry and layout for one tunnel, built when the camera gets near it.
class Tunnel {
  constructor(scene, info, laneW, seed) {
    Object.assign(this, info);
    this.scene = scene; this.lane = laneW;
    this.W = laneW * 1.9; this.H = laneW * 1.7;                  // half-width and height of the bore
    this.depth = this.H * 1.42 + 12;                             // floor depth: the roof stays 12 m underground
    this.ramp = Math.max(120, this.depth * 4);
    this.mouthY = this.H * 0.42;                                 // centre line at the mouths: the floor meets the ground
    this.playY = -this.depth + this.H * 0.42;                    // where the plane flies inside
    this.play0 = this.x0 + this.ramp; this.play1 = this.play0 + TUNNEL_SPEED * TUNNEL_TIME;
    this.stage = 'entry';
    this.mats = {
      bore: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      frame: new THREE.MeshLambertMaterial({ color: '#6a6258' }),
      coin: new THREE.MeshStandardMaterial({ color: '#ffcf3d', metalness: 0.35, roughness: 0.3, emissive: '#8a5c00', emissiveIntensity: 0.8 }),
    };
    this.group = new THREE.Group(); scene.add(this.group);
    this.buildSection(this.x0, this.play1 + 320, this.x0);
    this.layout(seed);
    this.buildPlay();
    this.toLayer();
  }
  toLayer() { this.group.traverse(o => o.layers.enable(TUNNEL_LAYER)); }
  // centre-line height at x: down the entry ramp to the play level, or up the exit ramp
  centerY(x) {
    if (this.stage === 'exit') return lerp(this.playY, this.mouthY, smooth(this.exitX - this.ramp, this.exitX, x));
    return lerp(this.mouthY, this.playY, smooth(this.x0, this.x0 + this.ramp, x));
  }
  floorY(x) { return this.centerY(x) - this.H * 0.42; }
  slope(x) { return Math.atan2(this.centerY(x + 1) - this.centerY(x - 1), 2); }
  // Swap the entry section for the exit section under the start of the next area. Returns the
  // x where the plane carries on (a short level run before the ramp up).
  toExit() {
    this.clearGroup(); this.stage = 'exit'; this.obs = []; this.coins = []; this.multi = null;
    this.group = new THREE.Group(); this.scene.add(this.group);
    const xs = this.exitX - this.ramp - 70;
    this.buildSection(xs - 260, this.exitX, this.exitX);
    this.toLayer();
    return xs;
  }
  // A bore from xa to xb with a stone mouth at mouthX, lit by lamps (or crystals), with
  // timber frames, mine rails in the three lanes, and stalactites.
  buildSection(xa, xb, mouthX) {
    const W = this.W, H = this.H, L = this.lane, r = rng(911 + Math.round(xa)), cr = this.crystals;
    // cross-section: a flat floor and a vaulted roof, listed round the inside
    const prof = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; prof.push([Math.cos(a) * W, H * 0.25 + Math.sin(a) * H * 0.75]); }
    prof.push([-W, -H * 0.42 + 0.01]); prof.push([W, -H * 0.42]);
    const P = prof.length, step = 8, n = Math.ceil((xb - xa) / step) + 1;
    const pos = new Float32Array(n * P * 3), col = new Float32Array(n * P * 3), idx = [];
    const base = new THREE.Color(cr ? '#3a3450' : '#4a3e34'), dark = new THREE.Color(cr ? '#1e1a30' : '#2a221c'), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = xa + Math.min(i * step, xb - xa), cy = this.centerY(x);
      for (let k = 0; k < P; k++) {
        const j = (k > 0 && k < 12) ? 1 + (r() - 0.5) * 0.12 : 1; // rough rock walls
        const v = i * P + k; pos[v * 3] = x; pos[v * 3 + 1] = cy + prof[k][1] * j; pos[v * 3 + 2] = prof[k][0] * j;
        c.copy(base).lerp(dark, r() * 0.6 + (k >= 12 ? 0.3 : 0)); col.set([c.r, c.g, c.b], v * 3);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < P; k++) {
      const a = i * P + k, b = i * P + (k + 1) % P;
      idx.push(a, a + P, b, b, a + P, b + P);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.add(new THREE.Mesh(g, this.mats.bore));
    // the stone frame round the mouth
    const arch = new THREE.Mesh(new THREE.TorusGeometry(W * 1.02, W * 0.14, 8, 24, Math.PI), this.mats.frame);
    arch.rotation.y = Math.PI / 2; arch.scale.set(1, H * 0.75 / W, 1); arch.position.set(mouthX, this.mouthY + H * 0.25, 0); this.group.add(arch);
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(W * 0.28, H * 0.67, W * 0.28), this.mats.frame); post.position.set(mouthX, this.mouthY - H * 0.085, s * W * 1.02); this.group.add(post); }

    if (this.stage === 'entry') {
      const sh = new THREE.Shape(prof.slice(0, 13).map(([z, y]) => new THREE.Vector2(z, y)).concat([new THREE.Vector2(-W, -H * 0.42), new THREE.Vector2(W, -H * 0.42)]));
      const portal = new THREE.Mesh(new THREE.ShapeGeometry(sh, 12), new THREE.MeshBasicMaterial({ color: cr ? '#120e1c' : '#0e0b08' }));
      portal.rotation.y = -Math.PI / 2; portal.position.set(mouthX + 0.5, this.mouthY, 0); this.group.add(portal); // faces back up the flight line
    }
    const inside = x => x > xa + 6 && x < xb - 6 && Math.abs(x - mouthX) > 14;
    // mine rails down the three lanes: the sleepers streaming past show speed and distance
    const seg = Math.max(2.5, L * 0.25), track = [];
    for (const lane of [-1, 0, 1]) {
      track.push({ g: new THREE.BoxGeometry(seg * 0.3, L * 0.05, L * 0.62), c: '#4a3524', m: M(0, L * 0.025, lane * L) });
      for (const s of [-1, 1]) track.push({ g: new THREE.BoxGeometry(seg * 1.02, L * 0.06, L * 0.05), c: '#8d8f94', m: M(0, L * 0.07, lane * L + s * L * 0.22) });
    }
    const pieces = []; for (let x = xa + seg; x < xb - seg; x += seg) if (Math.abs(x - mouthX) > seg) pieces.push(x);
    this.inst(mergeParts(track), this.mats.solid, pieces, x => M(x, this.floorY(x), 0, 0, 0, this.slope(x)));
    if (cr) {
      // crystal clusters along both walls, glowing in three tints
      const geo = mergeParts([{ g: new THREE.OctahedronGeometry(0.5), c: '#ffffff', m: M(0, 0.9, 0, 0, 0, 0, 0.5, 2, 0.5), flat: true }, { g: new THREE.OctahedronGeometry(0.4), c: '#ffffff', m: M(0.35, 0.6, 0.2, 0, 0, 0.5, 0.4, 1.5, 0.4), flat: true }, { g: new THREE.OctahedronGeometry(0.35), c: '#ffffff', m: M(-0.3, 0.5, -0.2, 0.3, 0, -0.5, 0.35, 1.3, 0.35), flat: true }]);
      const list = []; for (let x = xa + 8; x < xb; x += 12) if (inside(x)) for (const s of [-1, 1]) list.push({ x: x + r() * 6, s, k: r() });
      const im = this.inst(geo, this.mats.glow, list, o => M(o.x, this.floorY(o.x), o.s * W * 0.9, 0, o.k * 6, o.s * 0.35, L * (0.35 + o.k * 0.25)));
      list.forEach((o, i) => im.setColorAt(i, c.set(CRYSTAL_TINT[i % 3])));
    } else {
      // timber frames following the vault (posts, braces and a cap high under the roof, clear of
      // the camera), each with a pair of lamps
      const t = L * 0.2, fr = [{ g: new THREE.BoxGeometry(t * 1.2, t, W * 1.25), c: '#5a3c22', m: M(0, H * 0.86, 0) }];
      for (const s of [-1, 1]) {
        fr.push({ g: new THREE.BoxGeometry(t, H * 0.74, t), c: '#6b4a2c', m: M(0, -H * 0.05, s * W * 0.93) });
        const dz = W * 0.33, dy = H * 0.54, len = Math.hypot(dz, dy);
        fr.push({ g: new THREE.BoxGeometry(t, len, t), c: '#6b4a2c', m: M(0, H * 0.32 + dy / 2, s * (W * 0.93 - dz / 2), s * Math.atan2(dz, dy), 0, 0) });
      }
      const frames = []; for (let x = xa + 16; x < xb; x += 30) if (inside(x)) frames.push(x);
      this.inst(mergeParts(fr), this.mats.solid, frames, x => M(x, this.centerY(x), 0, 0, 0, this.slope(x)));
      const lamp = mergeParts([{ g: new THREE.BoxGeometry(L * 0.13, L * 0.18, L * 0.13), c: '#ffcf7a', m: M(0, H * 0.22, W * 0.86) }, { g: new THREE.BoxGeometry(L * 0.13, L * 0.18, L * 0.13), c: '#ffcf7a', m: M(0, H * 0.22, -W * 0.86) }]);
      this.inst(lamp, this.mats.glow, frames, x => M(x, this.centerY(x), 0, 0, 0, this.slope(x)));
    }
    // stalactites hanging from the roof, clear of the plane's path
    const st = jitter(new THREE.ConeGeometry(0.5, 1, 6), 0.1, 71); st.rotateX(Math.PI); st.translate(0, -0.5, 0);
    const stg = mergeParts([{ g: st, c: cr ? '#4a4068' : '#5a4a3c', flat: true }]);
    const drips = []; for (let x = xa + 5; x < xb; x += 7) if (inside(x)) { const z = (r() * 2 - 1) * W * 0.75; drips.push({ x: x + r() * 4, z, s: 0.5 + r() }); }
    this.inst(stg, this.mats.solid, drips, o => { const y = this.centerY(o.x) + H * 0.25 + Math.sqrt(Math.max(0, 1 - (o.z / W) ** 2)) * H * 0.75; return M(o.x, y + 0.5, o.z, 0, 0, 0, L * 0.16 * o.s, H * 0.13 * o.s, L * 0.16 * o.s); });
  }
  add(mesh) { mesh.frustumCulled = false; this.group.add(mesh); return mesh; }
  inst(geo, mat, list, fn) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length;
    list.forEach((o, i) => im.setMatrixAt(i, fn(o)));
    return this.add(im);
  }
  // Rows of obstacles blocking one or two lanes, a line of coins in the free lane after each
  // row, and the tunnel's one multiplier in the free lane of a row about 60% of the way in.
  layout(seed) {
    const r = rng(seed); this.obs = []; this.coins = []; const rows = [];
    for (let k = 0; k < 5; k++) this.coins.push({ x: this.play0 + 30 + k * 18, lane: 0, taken: false });
    let x = this.play0 + 140;
    while (x < this.play1 - 80) {
      const free = Math.floor(r() * 3) - 1, two = r() < 0.35, others = [-1, 0, 1].filter(l => l !== free);
      for (const lane of two ? others : [others[Math.floor(r() * 2)]]) { const k = r(); this.obs.push({ x, lane, kind: k < 0.4 ? 'rock' : k < 0.75 ? 'barricade' : 'cart', hit: false }); }
      const gap = 58 + r() * 30; rows.push({ x, free, gap }); x += gap;
    }
    const mRow = rows[Math.floor(rows.length * 0.6)];
    for (const row of rows) if (row !== mRow) for (let k = 0; k < 5; k++) this.coins.push({ x: row.x + 14 + k * (row.gap - 26) / 5, lane: row.free, taken: false });
    this.multi = mRow ? { x: mRow.x + mRow.gap * 0.5, lane: mRow.free, taken: false } : null;
  }
  buildPlay() {
    const L = this.lane, H = this.H;
    // obstacles, with warning lamps and hazard stripes so they read from far off
    const rock = mergeParts([{ g: jitter(new THREE.IcosahedronGeometry(0.5, 1), 0.16, 61), c: '#6a5a4a', m: M(0, 0.45, 0, 0, 0, 0, 1, 0.95, 1), flat: true }, { g: jitter(new THREE.IcosahedronGeometry(0.3, 0), 0.1, 62), c: '#5a4a3a', m: M(0.25, 0.2, 0.3), flat: true }]);
    const bar = [
      { g: new THREE.BoxGeometry(0.12, 0.95, 0.12), c: '#5a4028', m: M(0, 0.475, 0.42) }, { g: new THREE.BoxGeometry(0.12, 0.95, 0.12), c: '#5a4028', m: M(0, 0.475, -0.42) },
      { g: new THREE.BoxGeometry(0.1, 0.1, 1.05), c: '#ff5a3d', m: M(0.02, 0.98, 0), },
    ];
    for (let i = 0; i < 4; i++) bar.push({ g: new THREE.BoxGeometry(0.08, 0.14, 1.0), c: i % 2 ? '#1d1d1d' : '#ffc72e', m: M(0.08, 0.3 + i * 0.16, 0, (i % 2 ? 1 : -1) * 0.3, 0, 0) });
    const cart = mergeParts([
      { g: new THREE.BoxGeometry(0.9, 0.5, 0.8), c: '#6d4b30', m: M(0, 0.45, 0) }, { g: new THREE.BoxGeometry(0.95, 0.08, 0.85), c: '#8d8f94', m: M(0, 0.7, 0) },
      { g: jitter(new THREE.IcosahedronGeometry(0.42, 1), 0.12, 63), c: '#c9a24a', m: M(0, 0.72, 0, 0, 0, 0, 1, 0.55, 0.9), flat: true },
      ...[[-0.3, -0.38], [0.3, -0.38], [-0.3, 0.38], [0.3, 0.38]].map(([x, z]) => ({ g: new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10), c: '#2a2a2a', m: M(x, 0.14, z, Math.PI / 2, 0, 0) })),
    ]);
    const kinds = { rock: [rock, [L * 0.95, H * 0.85, L * 0.9]], barricade: [mergeParts(bar), [L * 0.6, H * 0.8, L * 0.95]], cart: [cart, [L * 0.95, H * 0.8, L * 0.9]] };
    for (const [kind, [geo, s]] of Object.entries(kinds)) {
      const list = this.obs.filter(o => o.kind === kind);
      const im = this.inst(geo, this.mats.solid, list, o => M(o.x, this.floorY(o.x), o.lane * L, 0, kind === 'rock' ? o.x % 3 : 0, 0, s[0], s[1], s[2]));
      list.forEach((o, i) => { o.im = im; o.i = i; });
    }
    const warn = this.obs.filter(o => o.kind !== 'rock');
    this.inst(mergeParts([{ g: new THREE.SphereGeometry(1, 8, 6), c: '#ff3b2a' }]), this.mats.glow, warn, o => M(o.x, this.floorY(o.x) + H * 0.86, o.lane * L + L * 0.4, 0, 0, 0, L * 0.06));
    // coins
    const cg = new THREE.CylinderGeometry(1, 1, 0.2, 20); cg.rotateX(Math.PI / 2);
    this.coinMesh = this.add(new THREE.InstancedMesh(cg, this.mats.coin, Math.max(1, this.coins.length)));
    // the multiplier: a glowing ring with its value on it
    if (this.multi) {
      const col = MULT_COLOR[this.mult] || '#ffffff', grp = new THREE.Group();
      grp.add(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 32), new THREE.MeshBasicMaterial({ color: col })));
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const x = cv.getContext('2d');
      x.font = '900 96px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,.65)';
      x.strokeText('×' + this.mult, 128, 68); x.fillStyle = col; x.fillText('×' + this.mult, 128, 68);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); spr.scale.set(0.9, 0.45, 1); grp.add(spr);
      grp.scale.setScalar(L * 0.75); grp.position.set(this.multi.x, this.playY, this.multi.lane * L);
      this.multiMesh = grp; this.group.add(grp);
    }
  }
  hitObstacle(o) { // knock the obstacle out of the way once it has been bumped
    o.hit = true; o.im.setMatrixAt(o.i, M(o.x, -1e5, 0, 0, 0, 0, 0)); o.im.instanceMatrix.needsUpdate = true;
  }
  updateCoins(time) {
    if (this.stage !== 'entry') return;
    const L = this.lane; let n = 0;
    for (const c of this.coins) { if (c.taken) continue; this.coinMesh.setMatrixAt(n++, M(c.x, this.playY, c.lane * L, 0, time * 4 + c.x * 0.1, 0, L * 0.18)); }
    this.coinMesh.count = n; this.coinMesh.instanceMatrix.needsUpdate = true;
    if (this.multiMesh) { this.multiMesh.visible = !this.multi.taken; this.multiMesh.children[0].rotation.y = time * 3; this.multiMesh.position.y = this.playY + Math.sin(time * 4) * L * 0.06; }
  }
  clearGroup() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry && !o.isSprite) o.geometry.dispose(); // sprites share one geometry
      if (o.isSprite || (o.material && !Object.values(this.mats).includes(o.material))) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.multiMesh = null;
  }
  dispose() {
    this.clearGroup();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
