'use strict';
/* ==========================================================================
   Tunnels: an optional underground lane in cave regions.

   Each cave region (region.tunnel) has a tunnel mouth on the flight line. When it is
   a few seconds ahead, "TUNNEL AHEAD" asks the player to press DIVE. Taking it runs
   a short scripted dive into the mouth, then a 3-lane runner: the plane flies level
   at a fixed speed with unlimited fuel, the ◀ ▶ pads (or ←/→, A/D) switch lanes,
   coins can be collected, and hitting an obstacle ejects the plane to the surface
   with an empty main tank. At the far end a ramp launches it back into normal
   flight with the main tank half full. Distance counts the whole way.
   ========================================================================== */

const TUNNEL_SPEED = 80;                 // m/s (288 km/h): a big help for a weak plane, slow for a strong one
const TUNNEL_VW = 55 + 2.4 * TUNNEL_SPEED; // the view width used for sizes inside, as the 2D zoom would be at that speed

// Where the tunnels are on a dealt map: one per cave region.
function tunnelsFor(map) {
  const out = [];
  for (const rg of map) {
    if (!rg.tunnel) continue;
    const len = clamp(rg.len * 0.5, 1500, 5000), x0 = rg.at + Math.max(260, rg.len * 0.18);
    out.push({ rg, x0, x1: x0 + len, crystals: rg.key === 'crystal' });
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
    this.ramp = Math.max(120, this.depth * 5);
    this.mouthY = this.H * 0.42;                                 // centre line at the mouths: the floor meets the ground
    this.playY = -this.depth + this.H * 0.42;                    // where the plane flies inside
    this.group = new THREE.Group(); scene.add(this.group);
    this.buildBore();
    this.layout(seed);
    this.buildProps();
  }
  // centre-line height at x: mouth, ramp down, level, ramp up, exit mouth
  centerY(x) {
    const a = smooth(this.x0, this.x0 + this.ramp, x), b = smooth(this.x1 - this.ramp, this.x1, x);
    return lerp(lerp(this.mouthY, this.playY, a), this.mouthY, b);
  }
  buildBore() {
    // cross-section: a flat floor and a vaulted roof, listed round the inside
    const W = this.W, H = this.H, prof = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; prof.push([Math.cos(a) * W, H * 0.25 + Math.sin(a) * H * 0.75]); }
    prof.push([-W, -H * 0.42 + 0.01]); prof.push([W, -H * 0.42]);
    const P = prof.length, step = 10, n = Math.ceil((this.x1 - this.x0) / step) + 1, r = rng(911);
    const pos = new Float32Array(n * P * 3), col = new Float32Array(n * P * 3), idx = [];
    const base = new THREE.Color(this.crystals ? '#3a3450' : '#4a3e34'), dark = new THREE.Color(this.crystals ? '#1e1a30' : '#2a221c'), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = this.x0 + Math.min(i * step, this.x1 - this.x0), cy = this.centerY(x);
      for (let k = 0; k < P; k++) {
        const j = (k > 0 && k < 12) ? 1 + (r() - 0.5) * 0.12 : 1; // rough rock walls
        const v = i * P + k; pos[v * 3] = x; pos[v * 3 + 1] = cy + prof[k][1] * j; pos[v * 3 + 2] = prof[k][0] * j;
        c.copy(base).lerp(dark, r() * 0.6 + (k >= 12 ? 0.3 : 0)); col.set([c.r, c.g, c.b], v * 3);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < P; k++) {
      const a = i * P + k, b = i * P + (k + 1) % P, a2 = a + P, b2 = b + P;
      idx.push(a, a2, b, b, a2, b2); // wound to face inward
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.bore = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.bore.frustumCulled = false; this.group.add(this.bore);
    // stone frames round both mouths
    const frame = new THREE.MeshLambertMaterial({ color: '#6a6258' });
    for (const x of [this.x0, this.x1]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(W * 1.02, W * 0.14, 8, 24, Math.PI), frame);
      arch.rotation.y = Math.PI / 2; arch.scale.set(1, H * 0.75 / W, 1); arch.position.set(x, this.mouthY + H * 0.25, 0); this.group.add(arch);
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(W * 0.28, H * 0.67, W * 0.28), frame); post.position.set(x, this.mouthY - H * 0.085, s * W * 1.02); this.group.add(post); }
    }
  }
  // Rows of obstacles blocking one or two lanes, with lines of coins in the free lanes.
  layout(seed) {
    const r = rng(seed), L = this.lane; this.obs = []; this.coins = [];
    let x = this.x0 + this.ramp + 160;
    while (x < this.x1 - this.ramp - 120) {
      const free = Math.floor(r() * 3) - 1, two = r() < 0.3, others = [-1, 0, 1].filter(l => l !== free);
      for (const lane of two ? others : [others[Math.floor(r() * 2)]]) this.obs.push({ x, lane, kind: r() < 0.6 ? 'rock' : 'beam', len: L * 0.5 });
      const gap = 60 + r() * 40;
      for (let k = 0; k < 4; k++) this.coins.push({ x: x + 18 + k * (gap - 30) / 4, lane: free, taken: false });
      x += gap;
    }
  }
  buildProps() {
    const L = this.lane, H = this.H;
    const rockGeo = mergeParts([{ g: jitter(new THREE.ConeGeometry(0.5, 1, 7), 0.12, 61), c: '#6a5a4a', m: M(0, 0.5), flat: true }, { g: jitter(new THREE.ConeGeometry(0.35, 0.7, 6), 0.1, 62), c: '#5a4a3a', m: M(0.2, 0.35 + 0, 0.25), flat: true }]);
    const beamGeo = mergeParts([{ g: new THREE.BoxGeometry(1, 0.18, 1.1), c: '#7a5a38', m: M(0, 0.5) }, { g: new THREE.BoxGeometry(0.12, 1, 0.12), c: '#5a4028', m: M(-0.4, 0.5, 0.45) }, { g: new THREE.BoxGeometry(0.12, 1, 0.12), c: '#5a4028', m: M(0.4, 0.5, -0.45) }]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const rocks = this.obs.filter(o => o.kind === 'rock'), beams = this.obs.filter(o => o.kind === 'beam');
    const floor = x => this.centerY(x) - H * 0.42;
    const mk = (geo, list, fn) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length; list.forEach((o, i) => im.setMatrixAt(i, fn(o))); im.frustumCulled = false; this.group.add(im); return im; };
    mk(rockGeo, rocks, o => M(o.x, floor(o.x), o.lane * L, 0, o.x % 3, 0, L * 0.9, H * 0.95, L * 0.9));
    mk(beamGeo, beams, o => M(o.x, floor(o.x), o.lane * L, 0, 0, 0, L * 0.35, H * 0.9, L * 0.95));
    // lamps (or crystals) along the walls
    const lampGeo = this.crystals ? mergeParts([{ g: new THREE.OctahedronGeometry(0.5), c: '#ffffff', m: M(0, 0, 0, 0, 0, 0, 0.6, 2.2, 0.6), flat: true }, { g: new THREE.OctahedronGeometry(0.35), c: '#ffffff', m: M(0.4, -0.3, 0.2, 0, 0, 0.5, 0.5, 1.6, 0.5), flat: true }])
      : mergeParts([{ g: new THREE.BoxGeometry(0.5, 0.5, 0.5), c: '#ffffff' }]);
    const lamps = []; for (let x = this.x0 + 20; x < this.x1; x += this.crystals ? 18 : 30) for (const s of [-1, 1]) lamps.push({ x, s });
    const lm = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), lamps.length);
    const lc = new THREE.Color();
    lamps.forEach((l, i) => {
      const y = this.centerY(l.x) + (this.crystals ? -H * 0.3 : H * 0.35);
      lm.setMatrixAt(i, M(l.x, y, l.s * this.W * (this.crystals ? 0.85 : 0.93), 0, 0, 0, this.crystals ? L * 0.35 : L * 0.12));
      lm.setColorAt(i, lc.set(this.crystals ? CRYSTAL_TINT[i % 3] : '#ffcf7a'));
    });
    lm.frustumCulled = false; this.group.add(lm);
    // coins
    const cg = new THREE.CylinderGeometry(1, 1, 0.2, 20); cg.rotateX(Math.PI / 2);
    this.coinMesh = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: '#ffcf3d', metalness: 0.35, roughness: 0.3, emissive: '#8a5c00', emissiveIntensity: 0.8 }), Math.max(1, this.coins.length));
    this.coinMesh.frustumCulled = false; this.group.add(this.coinMesh);
  }
  updateCoins(time) {
    const L = this.lane; let n = 0;
    for (const c of this.coins) { if (c.taken) continue; this.coinMesh.setMatrixAt(n++, M(c.x, this.playY, c.lane * L, 0, time * 4 + c.x * 0.1, 0, L * 0.18)); }
    this.coinMesh.count = n; this.coinMesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
