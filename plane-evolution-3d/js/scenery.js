'use strict';
/* ==========================================================================
   Scenery: instanced vegetation and props per terrain, placed deterministically
   in 80 m tiles around the camera, plus volcano crater glows and smoke.
   ========================================================================== */

/* ---------- geometry helpers ---------- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}
function jitter(g, amt, seed) {
  const r = rng(seed), p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) { // move shared corners together so the surface stays closed
    const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    if (!seen.has(k)) seen.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    const d = seen.get(k); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  return g;
}
// Merge parts [{ g, c: '#hex' | [r,g,b], m: Matrix4, flat }] into one non-indexed geometry with vertex colours.
function mergeParts(parts) {
  const geos = parts.map(({ g, c, m, flat }) => {
    let q = g.index ? g.toNonIndexed() : g.clone();
    if (m) q.applyMatrix4(m);
    if (flat || !q.attributes.normal) q.computeVertexNormals();
    const col = new Float32Array(q.attributes.position.count * 3);
    const cc = typeof c === 'string' ? new THREE.Color(c) : new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    for (let i = 0; i < col.length; i += 3) { col[i] = cc.r; col[i + 1] = cc.g; col[i + 2] = cc.b; }
    q.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return q;
  });
  let n = 0; for (const q of geos) n += q.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const q of geos) { pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); col.set(q.attributes.color.array, o * 3); o += q.attributes.position.count; q.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
const Cyl = (rt, rb, h, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const Ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const Box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const Cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg, 1);

/* ---------- vegetation types ----------
   size: s = small ground cover, m = medium, t = tall. near: min |z| from the flight line.
   lit: lit parts; glow: unlit glowing parts. Heights are in metres, base at y = 0. */
const VEG = {
  oak: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.22, 0.42, 3.4), c: '#5a3d25', m: M(0, 1.5) },
    { g: jitter(Ico(1.9), 0.7, 1), c: '#3f7a33', m: M(0, 4.6), flat: true },
    { g: jitter(Ico(1.5, 0), 0.5, 2), c: '#4b8c3c', m: M(1.2, 3.8, 0.4), flat: true },
    { g: jitter(Ico(1.5, 0), 0.5, 3), c: '#37702f', m: M(-1.1, 3.9, -0.5), flat: true },
    { g: jitter(Ico(1.2), 0.5, 4), c: '#56963f', m: M(0.2, 5.8, 0.2), flat: true }]) },
  bush: { size: 'm', near: 5, lit: () => mergeParts([
    { g: jitter(Ico(0.9), 0.35, 5), c: '#4a8a3d', m: M(0, 0.55), flat: true },
    { g: jitter(Ico(0.7), 0.3, 6), c: '#5a9a45', m: M(0.7, 0.45, 0.2), flat: true }]) },
  flowers: { size: 's', near: 3, lit: () => { const r = rng(9), parts = [{ g: Cone(0.45, 0.35, 6), c: '#4f9f45', m: M(0, 0.12) }];
    const cs = ['#ffd23d', '#ff6fa8', '#ffffff', '#b58cff'];
    for (let i = 0; i < 9; i++) parts.push({ g: new THREE.OctahedronGeometry(0.075), c: cs[i % 4], m: M((r() - 0.5) * 1.2, 0.28 + r() * 0.12, (r() - 0.5) * 1.2) });
    return mergeParts(parts); } },
  poplar: { size: 't', near: 14, lit: () => mergeParts([
    { g: Cyl(0.15, 0.28, 2.4), c: '#5a3d25', m: M(0, 1.1) },
    { g: jitter(Ico(1.1, 1), 0.3, 7), c: '#4f7a32', m: M(0, 5.4, 0, 0, 0, 0, 1, 3.4, 1), flat: true }]) },
  hay: { size: 'm', near: 5, lit: () => mergeParts([
    { g: Cyl(0.75, 0.75, 1.3, 12), c: '#e2bd4c', m: M(0, 0.75, 0, 0, 0, Math.PI / 2) },
    { g: Cyl(0.5, 0.5, 1.32, 12), c: '#b8912a', m: M(0, 0.75, 0, 0, 0, Math.PI / 2) }]) },
  fence: { size: 'm', near: 6, lit: () => mergeParts([
    { g: Box(0.14, 1.25, 0.14), c: '#7a5a38', m: M(0, 0.62) },
    { g: Box(6, 0.1, 0.07), c: '#8a6a44', m: M(3, 0.9) },
    { g: Box(6, 0.1, 0.07), c: '#8a6a44', m: M(3, 0.45) }]) },
  barn: { size: 't', near: 30, lit: () => mergeParts([
    { g: Box(9, 5, 6.5), c: '#9e3326', m: M(0, 2.5) },
    { g: Cyl(4.1, 4.1, 9.2, 3), c: '#56514d', m: M(0, 6.1, 0, 0, 0, Math.PI / 2, 1, 1, 0.82), flat: true },
    { g: Box(2.4, 3.2, 0.1), c: '#f3eadb', m: M(0, 1.6, 3.27) }]) },
  windmill: { size: 't', near: 40, lit: () => mergeParts([
    { g: Cyl(1.0, 1.9, 13, 8), c: '#e9e2d0', m: M(0, 6.5), flat: true },
    { g: Cone(1.6, 2.6, 8), c: '#b8422f', m: M(0, 14.2), flat: true },
    { g: Box(0.8, 1.6, 0.1), c: '#6a4a2a', m: M(0, 1.2, 1.55) }]),
    blades: () => mergeParts([0, 1, 2, 3].map(i => ({ g: Box(0.9, 7.5, 0.08), c: '#f0ead8', m: M(0, 0, 0, 0, 0, i * Math.PI / 2).multiply(M(0, 4.1)) }))
      .concat([{ g: Cyl(0.35, 0.35, 0.6, 8), c: '#5a4a3a', m: M(0, 0, 0, Math.PI / 2) }])) },
  cactus: { size: 't', near: 8, lit: () => mergeParts([
    { g: Cyl(0.36, 0.42, 5, 9), c: '#3f7f45', m: M(0, 2.5) }, { g: new THREE.SphereGeometry(0.36, 9, 5, 0, 6.29, 0, 1.6), c: '#4a8f50', m: M(0, 5) },
    { g: Cyl(0.24, 0.24, 1.0, 7), c: '#3f7f45', m: M(-0.7, 2.2, 0, 0, 0, Math.PI / 2) }, { g: Cyl(0.24, 0.24, 1.6, 7), c: '#3f7f45', m: M(-1.1, 2.9) },
    { g: Cyl(0.22, 0.22, 0.9, 7), c: '#3f7f45', m: M(0.6, 2.9, 0, 0, 0, Math.PI / 2) }, { g: Cyl(0.22, 0.22, 1.2, 7), c: '#3f7f45', m: M(0.95, 3.4) }]) },
  rock: { size: 'm', near: 4, tint: true, lit: () => mergeParts([
    { g: jitter(Ico(1, 1), 0.45, 11), c: '#ffffff', m: M(0, 0.25, 0, 0, 0, 0, 1.3, 0.7, 1), flat: true },
    { g: jitter(Ico(0.55, 1), 0.25, 12), c: '#e8e8e8', m: M(1.0, 0.1, 0.5), flat: true }]) },
  tumbleweed: { size: 'm', near: 3, anim: 'roll', lit: () => mergeParts([0, 1, 2, 3].map(i => ({ g: new THREE.TorusGeometry(0.62, 0.035, 3, 14), c: i % 2 ? '#a8804a' : '#8a6a3a', m: M(0, 0.62, 0, i * 0.8, i * 1.3, i * 0.5) }))
    .concat([{ g: jitter(Ico(0.45, 0), 0.2, 13), c: '#9a7444', m: M(0, 0.62), flat: true }])) },
  pine: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.16, 0.3, 1.6), c: '#4a3322', m: M(0, 0.8) },
    { g: Cone(2.1, 2.8, 8), c: '#2c5d4a', m: M(0, 2.6), flat: true }, { g: Cone(1.35, 1.3, 8), c: '#f2f7fa', m: M(0, 3.4), flat: true },
    { g: Cone(1.6, 2.4, 8), c: '#2a5846', m: M(0, 4.2), flat: true }, { g: Cone(1.0, 1.1, 8), c: '#f2f7fa', m: M(0, 4.9), flat: true },
    { g: Cone(1.1, 2.0, 8), c: '#2c5d4a', m: M(0, 5.7), flat: true }, { g: Cone(0.62, 0.95, 8), c: '#f7fafc', m: M(0, 6.35), flat: true }]) },
  icerock: { size: 'm', near: 5, lit: () => mergeParts([
    { g: jitter(new THREE.OctahedronGeometry(1, 0), 0.4, 14), c: '#bfe3f2', m: M(0, 0.9, 0, 0.2, 0, 0.3, 0.8, 1.6, 0.8), flat: true },
    { g: jitter(new THREE.OctahedronGeometry(0.7, 0), 0.3, 15), c: '#9fd0e8', m: M(0.8, 0.5, 0.3, -0.4, 0, -0.5, 0.7, 1.3, 0.7), flat: true }]) },
  deadtree: { size: 't', near: 10, lit: () => mergeParts([
    { g: Cyl(0.12, 0.3, 5, 6), c: '#1e1614', m: M(0, 2.5) },
    { g: Cyl(0.06, 0.12, 2.2, 5), c: '#241a17', m: M(0.6, 3.6, 0, 0, 0, -0.8) },
    { g: Cyl(0.05, 0.1, 1.8, 5), c: '#241a17', m: M(-0.5, 4.0, 0.2, 0.2, 0, 0.9) },
    { g: Cyl(0.04, 0.08, 1.4, 5), c: '#241a17', m: M(0.1, 4.6, -0.5, -0.8, 0, 0.2) }]) },
  lavarock: { size: 'm', near: 5, lit: () => mergeParts([{ g: jitter(Ico(1, 1), 0.5, 16), c: '#2a1f1d', m: M(0, 0.3, 0, 0, 0, 0, 1.2, 0.75, 1), flat: true }]),
    glow: () => mergeParts([{ g: new THREE.OctahedronGeometry(0.22), c: '#ff6a2a', m: M(0.3, 0.95, 0.2) }, { g: new THREE.OctahedronGeometry(0.16), c: '#ffa040', m: M(-0.4, 0.8, -0.3) }]) },
  crystal: { size: 'm', near: 5, glowTint: true, glow: () => { const r = rng(17), parts = [];
    for (let i = 0; i < 5; i++) parts.push({ g: new THREE.OctahedronGeometry(0.5, 0), c: '#ffffff', m: M((r() - 0.5) * 1.4, 1.2 + r(), (r() - 0.5) * 1.4, (r() - 0.5) * 0.7, r() * 3, (r() - 0.5) * 0.7, 0.55, 2.4 + r() * 2, 0.55), flat: true });
    return mergeParts(parts); } },
  mushroom: { size: 't', near: 10, lit: () => mergeParts([
    { g: Cyl(0.35, 0.55, 4.5, 8), c: '#d8c8ff', m: M(0, 2.25) },
    { g: new THREE.SphereGeometry(2.5, 12, 6, 0, 6.29, 0, 1.5), c: '#ff5fc8', m: M(0, 4.2, 0, 0, 0, 0, 1, 0.55, 1) }]),
    glow: () => { const r = rng(18), parts = []; for (let i = 0; i < 7; i++) { const a = r() * 6.28, rr = 0.6 + r() * 1.5; parts.push({ g: new THREE.SphereGeometry(0.22, 6, 4), c: '#ffffff', m: M(Math.cos(a) * rr, 4.2 + 1.3 * Math.sqrt(1 - (rr / 2.5) ** 2) * 0.55 + 0.05, Math.sin(a) * rr) }); } return mergeParts(parts); } },
  glowplant: { size: 's', near: 3, lit: () => mergeParts([{ g: Cyl(0.04, 0.07, 1.1, 5), c: '#6a4fa0', m: M(0, 0.55) }, { g: Cyl(0.03, 0.05, 0.8, 5), c: '#6a4fa0', m: M(0.25, 0.4, 0, 0, 0, -0.5) }]),
    glow: () => mergeParts([{ g: new THREE.SphereGeometry(0.2, 8, 6), c: '#7dffc8', m: M(0, 1.15) }, { g: new THREE.SphereGeometry(0.14, 8, 6), c: '#ff8ce6', m: M(0.45, 0.78) }]) },
  spire: { size: 't', near: 16, lit: () => mergeParts([{ g: Cone(1.1, 16, 7), c: '#3b2870', m: M(0, 8), flat: true }, { g: Cone(0.5, 5, 7), c: '#5a3f9a', m: M(0.9, 2.5, 0.3, 0, 0, -0.25), flat: true }]),
    glow: () => mergeParts([{ g: new THREE.OctahedronGeometry(0.45), c: '#b58cff', m: M(0, 16.2) }]) },
};
const ROCK_TINT = { meadow: '#8a8478', farm: '#8a8478', desert: '#b5824a', tundra: '#6f7c8c', volcano: '#3a2c29', alien: '#4a3580' };
const CRYSTAL_TINT = ['#7de8ff', '#ff78dc', '#b58cff'];

function chooseVeg(key, x, z, pick) {
  const d = Math.abs(z);
  switch (key) {
    case 'meadow': { const f = forestAt(x, z);
      if (d > 30 && f > 0.56 && pick < 0.55 * smooth(0.56, 0.7, f)) return 'oak';
      return pick < 0.03 ? 'oak' : pick < 0.1 ? 'bush' : pick < 0.3 ? 'flowers' : pick < 0.315 ? 'rock' : null; }
    case 'farm':
      return pick < 0.035 ? 'hay' : pick < 0.045 ? 'poplar' : pick < 0.047 ? 'windmill' : pick < 0.0485 ? 'barn' : pick < 0.13 ? 'fence' : pick < 0.14 ? 'bush' : null;
    case 'desert': return pick < 0.045 ? 'cactus' : pick < 0.11 ? 'rock' : pick < 0.122 ? 'tumbleweed' : null;
    case 'tundra': { const f = forestAt(x, z);
      if (d > 30 && f > 0.5 && pick < 0.45 * smooth(0.5, 0.66, f)) return 'pine';
      return pick < 0.025 ? 'pine' : pick < 0.07 ? 'icerock' : pick < 0.08 ? 'rock' : null; }
    case 'volcano': return pick < 0.04 ? 'deadtree' : pick < 0.1 ? 'lavarock' : pick < 0.12 ? 'rock' : null;
    case 'alien': return pick < 0.045 ? 'crystal' : pick < 0.085 ? 'mushroom' : pick < 0.18 ? 'glowplant' : pick < 0.192 ? 'spire' : null;
  }
  return null;
}

const VEG_TILE = 80, VEG_CELL = 10;
function vegTile(ix, iz) {
  const out = [], r = rng((hash2(ix * 31 + 7, iz * 17 + 3) * 4294967296) >>> 0 || 1), n = VEG_TILE / VEG_CELL;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let x = ix * VEG_TILE + (i + r()) * VEG_CELL, z = iz * VEG_TILE + (j + r()) * VEG_CELL;
    const pick = r(), rank = r(), side = r(), rot = r() * Math.PI * 2, sc = 0.75 + r() * 0.6;
    const e = envAt(x, terrainScale), key = side < e.t ? e.b.key : e.a.key;
    const type = chooseVeg(key, x, z, pick); if (!type) continue;
    const def = VEG[type], d = Math.abs(z);
    if (d < def.near) continue;
    if (def.size === 't' && z > 0 && z < 400) continue; // keep the side camera's view of the plane clear
    let ry = rot;
    if (type === 'fence') { // snap onto a field edge and run along it
      const ca = 0.35, u = x * Math.cos(ca) - z * Math.sin(ca), v = x * Math.sin(ca) + z * Math.cos(ca);
      if (hash2(Math.floor(u / 84), Math.floor(v / 58) + 5) > 0.55 || d < CORRIDOR + 4) continue;
      const vs = Math.round(v / 58) * 58; x = u * Math.cos(ca) + vs * Math.sin(ca); z = -u * Math.sin(ca) + vs * Math.cos(ca); ry = ca;
      if (Math.abs(z) < CORRIDOR + 4) continue;
    }
    const y = heightAt(x, z);
    if (def.size !== 's') { const sl = Math.abs(heightAt(x + 1.5, z) - y) + Math.abs(heightAt(x, z + 1.5) - y); if (sl > (def.size === 't' ? 1.2 : 2.0)) continue; }
    let c = null;
    if (def.tint) c = ROCK_TINT[key]; else if (def.glowTint) c = CRYSTAL_TINT[Math.floor(rank * 3)];
    const big = type === 'windmill' || type === 'barn' ? 1 : sc;
    const s = big * (key === 'alien' && type === 'mushroom' ? 1.4 : 1), it = { type, x, y: y - 0.15, z, ry, s, rank, c, var: 0.85 + side * 0.3 };
    // matrix and colours are worked out once here, so rebuilding the instance buffers is a copy
    it.m = new Float32Array(16); _m4.compose(_v3.set(x, it.y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s3.set(s, s, s)).toArray(it.m);
    if (c) TMP_COLOR.set(c); else TMP_COLOR.setRGB(1, 1, 1);
    it.cl = [TMP_COLOR.r * it.var, TMP_COLOR.g * it.var, TMP_COLOR.b * it.var];
    it.cg = type === 'crystal' ? [TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b] : [1, 1, 1];
    if (def.blades) { it.mb = new Float32Array(16); _m4.compose(_v3.set(x, it.y + 12.4, z), _q.setFromEuler(_e.set(0, ry, 0)), _s3.set(1, 1, 1)).multiply(_m4b.makeTranslation(0, 0, 1.9)).toArray(it.mb); }
    out.push(it);
  }
  return out;
}

class Scenery {
  constructor(scene, shared) {
    this.scene = scene; this.shared = shared;
    this.litMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.meshes = {}; this.tiles = new Map(); this.last = null; this.R = 900; this.dens = 1; this.shadows = false; this.max = 9000; this.adapt = 1;
    for (const [type, def] of Object.entries(VEG)) {
      const m = { list: [] };
      if (def.lit) m.lit = this.mk(def.lit(), this.litMat, def.size === 't');
      if (def.glow) m.glow = this.mk(def.glow(), this.glowMat, false);
      if (def.blades) m.blades = this.mk(def.blades(), this.litMat, false);
      this.meshes[type] = m;
    }
    // volcano crater glows and smoke
    this.glowTex = makeGlowTexture();
    this.craters = []; this.smokeTex = makePuffTexture();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false; scene.add(s);
      const smoke = [];
      for (let k = 0; k < 6; k++) { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x2a2020, depthWrite: false, transparent: true, opacity: 0.5 })); p.visible = false; scene.add(p); smoke.push(p); }
      this.craters.push({ glow: s, smoke });
    }
  }
  mk(geo, mat, shadow) {
    const im = new THREE.InstancedMesh(geo, mat, 16); im.count = 0; im.frustumCulled = false; im.castShadow = shadow && this.shadows;
    im.userData.shadow = shadow; this.scene.add(im); return im;
  }
  setQuality(q) {
    this.R = q.vegR; this.dens = q.veg; this.max = q.vegMax; this.adapt = 1; this.shadows = q.shadows > 0; this.last = null;
    for (const m of Object.values(this.meshes)) for (const k of ['lit', 'glow', 'blades']) if (m[k]) m[k].castShadow = m[k].userData.shadow && this.shadows;
  }
  reset() { this.tiles.clear(); this.last = null; }
  ensure(im, n) { // grow an InstancedMesh's capacity
    if (im.instanceMatrix.count >= n) return im;
    const cap = Math.ceil(n * 1.5), nm = new THREE.InstancedMesh(im.geometry, im.material, cap);
    nm.count = 0; nm.frustumCulled = false; nm.castShadow = im.castShadow; nm.userData = im.userData;
    nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.scene.remove(im); im.dispose(); this.scene.add(nm); return nm;
  }
  update(cam, dist, time) {
    const R = this.R * clamp(dist / 60, 1, 1.6);
    if (!this.last || Math.hypot(cam.x - this.last.x, cam.z - this.last.z) > R * 0.06 || Math.abs(R - this.last.R) > R * 0.2) this.rebuild(cam, R);
    this.animate(time);
    this.updateCraters(cam, time);
  }
  rebuild(cam, R) {
    this.last = { x: cam.x, z: cam.z, R };
    const t0 = Math.floor((cam.x - R) / VEG_TILE), t1 = Math.floor((cam.x + R) / VEG_TILE), u0 = Math.floor((cam.z - R) / VEG_TILE), u1 = Math.floor((cam.z + R) / VEG_TILE);
    for (const m of Object.values(this.meshes)) m.list.length = 0;
    const lim = { s: 0.28, m: 0.6, t: 1 };
    for (let ix = t0; ix <= t1; ix++) for (let iz = u0; iz <= u1; iz++) {
      const cx = (ix + 0.5) * VEG_TILE, cz = (iz + 0.5) * VEG_TILE, td = Math.hypot(cx - cam.x, cz - cam.z);
      if (td > R + VEG_TILE) continue;
      const k = ix + ':' + iz; let list = this.tiles.get(k);
      if (!list) { list = vegTile(ix, iz); this.tiles.set(k, list); }
      for (const it of list) {
        const d = Math.hypot(it.x - cam.x, it.z - cam.z), def = VEG[it.type], lr = R * lim[def.size];
        if (d > lr || it.rank > this.dens * this.adapt * (1 - 0.85 * smooth(lr * 0.25, lr, d))) continue;
        this.meshes[it.type].list.push(it);
      }
    }
    if (this.tiles.size > 3000) { let n = this.tiles.size - 2500; for (const k of this.tiles.keys()) { this.tiles.delete(k); if (--n <= 0) break; } }
    let total = 0;
    for (const [type, m] of Object.entries(this.meshes)) {
      const n = m.list.length; total += n;
      for (const part of ['lit', 'glow', 'blades']) {
        if (!m[part]) continue;
        m[part] = this.ensure(m[part], n);
        const im = m[part], ma = im.instanceMatrix.array;
        if (!im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(im.instanceMatrix.count * 3), 3);
        const ca = im.instanceColor.array;
        for (let i = 0; i < n; i++) {
          const it = m.list[i];
          ma.set(part === 'blades' ? it.mb : it.m, i * 16);
          ca.set(part === 'lit' ? it.cl : it.cg, i * 3);
        }
        im.count = n; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      }
    }
    // keep the instance count within the quality budget by thinning, not by cutting off an area
    if (total > this.max) { this.adapt *= this.max / total; this.last = null; }
    else if (total < this.max * 0.6 && this.adapt < 1) this.adapt = Math.min(1, this.adapt * 1.15);
  }
  animate(time) {
    const wm = this.meshes.windmill;
    if (wm.blades && wm.list.length) {
      for (let i = 0; i < wm.list.length; i++) {
        const it = wm.list[i];
        _m4.compose(_v3.set(it.x, it.y + 12.4, it.z), _q.setFromEuler(_e.set(0, it.ry, 0)), _s3.set(1, 1, 1));
        _m4.multiply(_m4b.makeTranslation(0, 0, 1.9)).multiply(_m4c.makeRotationZ(time * 1.5 + it.rank * 6));
        wm.blades.setMatrixAt(i, _m4);
      }
      wm.blades.instanceMatrix.needsUpdate = true;
    }
    const tw = this.meshes.tumbleweed;
    if (tw.lit && tw.list.length) {
      for (let i = 0; i < tw.list.length; i++) {
        const it = tw.list[i], run = ((time * 4 + it.rank * 97) % 70) - 35, x = it.x + run, y = it.y + 0.1 + Math.abs(Math.sin(time * 3 + it.rank * 9)) * 0.35;
        _m4.compose(_v3.set(x, y, it.z), _q.setFromEuler(_e.set(0, 0, -run / 0.7)), _s3.set(it.s, it.s, it.s));
        tw.lit.setMatrixAt(i, _m4);
      }
      tw.lit.instanceMatrix.needsUpdate = true;
    }
  }
  updateCraters(cam, time) {
    const found = [];
    const e = envAt(cam.x, terrainScale), vol = (e.a.key === 'volcano' ? 1 - e.t : 0) + (e.b.key === 'volcano' ? e.t : 0) + (cam.x > BIOMES[4].at - 6000 && cam.x < BIOMES[5].at + 6000 ? 1 : 0);
    if (vol > 0) {
      const cx = Math.floor(cam.x / CONE_CELL), cz = Math.floor(cam.z / CONE_CELL);
      for (let i = -3; i <= 5; i++) for (let j = -4; j <= 0; j++) {
        const c = coneIn(cx + i, cz + j);
        if (c && biomeIndex(c.x) === 4) found.push(c);
      }
      found.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    }
    this.craters.forEach((cr, i) => {
      const c = found[i];
      cr.glow.visible = !!c; cr.smoke.forEach(s => { s.visible = !!c; });
      if (!c) return;
      const top = heightAt(c.x, c.z) + c.H * 0.05;
      cr.glow.position.set(c.x, top, c.z); const g = c.R * 0.55 * (0.9 + 0.1 * Math.sin(time * 3 + i)); cr.glow.scale.set(g, g, 1);
      cr.smoke.forEach((s, k) => {
        const ph = ((time * 0.06 + k / cr.smoke.length + i * 0.13) % 1), sz = c.R * (0.25 + ph * 0.7);
        s.position.set(c.x + ph * c.R * 0.5 + Math.sin(time * 0.3 + k) * c.R * 0.05, top + ph * c.H * 1.4, c.z);
        s.scale.set(sz, sz, 1); s.material.opacity = 0.55 * Math.sin(ph * Math.PI);
      });
    });
  }
}
const _m4b = new THREE.Matrix4(), _m4c = new THREE.Matrix4();

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makePuffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = rng(42);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (r() - 0.5) * 60, y = 64 + (r() - 0.5) * 40, rad = 18 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
