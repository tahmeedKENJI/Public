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
const CRYSTAL_TINT = ['#7de8ff', '#ff78dc', '#b58cff'];
// More vegetation and props for the 50 regions. size f = floating in the air; box = scaled
// per instance in x/y/z (buildings); snap = one per grid block of that size.
const winQuads = (cols, rows, parts, inset = 0.06) => { // glowing window quads on the 4 sides of a unit box (0..1 high)
  for (let side = 0; side < 4; side++) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const u = (c + 0.5) / cols - 0.5, v = (r + 0.6) / (rows + 0.4), w = 0.55 / cols, hgt = 0.5 / (rows + 0.4);
    const g = new THREE.PlaneGeometry(w, hgt), a = side * Math.PI / 2;
    parts.push({ g, c: '#ffffff', m: M(Math.sin(a) * (0.5 + 0.004) + Math.cos(a) * u, v, Math.cos(a) * (0.5 + 0.004) - Math.sin(a) * u, 0, a, 0) });
  }
  return parts;
};
Object.assign(VEG, {
  birch: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.16, 0.24, 6.5, 7), c: '#e8e4dc', m: M(0, 3.1) }, { g: Box(0.34, 0.12, 0.34), c: '#2a2a2a', m: M(0, 2.2) }, { g: Box(0.3, 0.1, 0.3), c: '#2a2a2a', m: M(0, 4.1) },
    { g: jitter(Ico(1.3), 0.5, 21), c: '#8ab84a', m: M(0, 6.4, 0, 0, 0, 0, 1, 1.5, 1), flat: true }, { g: jitter(Ico(1.0, 0), 0.4, 22), c: '#9ac85a', m: M(0.6, 5.2, 0.3), flat: true }]) },
  autumn: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.22, 0.42, 3.4), c: '#4a3222', m: M(0, 1.5) },
    { g: jitter(Ico(1.9), 0.7, 23), c: '#d8702a', m: M(0, 4.6), flat: true }, { g: jitter(Ico(1.5, 0), 0.5, 24), c: '#e8a030', m: M(1.2, 3.8, 0.4), flat: true },
    { g: jitter(Ico(1.4, 0), 0.5, 25), c: '#b8402a', m: M(-1.1, 3.9, -0.5), flat: true }]) },
  fir: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.16, 0.3, 1.6), c: '#4a3322', m: M(0, 0.8) }, { g: Cone(2.2, 3.2, 8), c: '#24503a', m: M(0, 2.8), flat: true },
    { g: Cone(1.7, 2.8, 8), c: '#2a5a40', m: M(0, 4.6), flat: true }, { g: Cone(1.1, 2.4, 8), c: '#2e6446', m: M(0, 6.3), flat: true }]) },
  bamboo: { size: 't', near: 10, lit: () => { const r = rng(26), parts = [];
    for (let i = 0; i < 7; i++) { const x = (r() - 0.5) * 1.6, z = (r() - 0.5) * 1.6, h = 6 + r() * 4; parts.push({ g: Cyl(0.09, 0.11, h, 6), c: i % 2 ? '#7a9a3a' : '#8aaa48', m: M(x, h / 2, z, (r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1) });
      parts.push({ g: jitter(Ico(0.7, 0), 0.3, 27 + i), c: '#6a9a38', m: M(x, h, z, 0, 0, 0, 1, 0.5, 1), flat: true }); }
    return mergeParts(parts); } },
  jungle: { size: 't', near: 14, lit: () => mergeParts([
    { g: Cyl(0.35, 0.6, 9, 7), c: '#5a4632', m: M(0, 4.5) },
    { g: jitter(Ico(3, 1), 0.9, 30), c: '#2a6a2a', m: M(0, 9.5, 0, 0, 0, 0, 1.3, 0.55, 1.3), flat: true }, { g: jitter(Ico(1.8, 0), 0.6, 31), c: '#3a7a2a', m: M(1.8, 8.8, 1), flat: true },
    { g: jitter(Ico(1.6, 0), 0.5, 32), c: '#1e5a24', m: M(-1.6, 8.6, -1.2), flat: true }]) },
  blossom: { size: 't', near: 10, lit: () => mergeParts([
    { g: Cyl(0.18, 0.3, 2.4), c: '#5a3d2a', m: M(0, 1.1) },
    { g: jitter(Ico(1.6), 0.5, 33), c: '#f4b8d0', m: M(0, 3.4), flat: true }, { g: jitter(Ico(1.1, 0), 0.4, 34), c: '#fad0e0', m: M(1, 2.9, 0.4), flat: true },
    { g: jitter(Ico(1.0, 0), 0.4, 35), c: '#e8a0c0', m: M(-0.9, 3.0, -0.4), flat: true }]) },
  vine: { size: 'm', near: 6, rows: true, lit: () => { const parts = [];
    for (let i = 0; i < 4; i++) parts.push({ g: jitter(Ico(0.75, 0), 0.25, 36 + i), c: i % 2 ? '#4a7a2a' : '#5a8a32', m: M(i * 2 - 3, 1.0, 0, 0, 0, 0, 1.2, 0.9, 0.6), flat: true });
    parts.push({ g: Box(0.12, 1.4, 0.12), c: '#7a5a38', m: M(-4, 0.7) }, { g: Box(8, 0.05, 0.05), c: '#6a6a6a', m: M(0, 1.3) });
    return mergeParts(parts); } },
  sunflower: { size: 's', near: 4, lit: () => { const r = rng(40), parts = [];
    for (let i = 0; i < 5; i++) { const x = (r() - 0.5) * 2.4, z = (r() - 0.5) * 2.4, h = 1.6 + r() * 0.6;
      parts.push({ g: Cyl(0.04, 0.05, h, 5), c: '#5a7a2a', m: M(x, h / 2, z) }, { g: Cyl(0.32, 0.32, 0.06, 12), c: '#f0c020', m: M(x + 0.05, h, z, 0, 0, Math.PI / 2 - 0.3) }, { g: Cyl(0.14, 0.14, 0.08, 10), c: '#5a3a1a', m: M(x + 0.08, h, z, 0, 0, Math.PI / 2 - 0.3) }); }
    return mergeParts(parts); } },
  lavender: { size: 's', near: 4, rows: true, lit: () => { const parts = [];
    for (let i = 0; i < 5; i++) parts.push({ g: jitter(Ico(0.45, 0), 0.12, 41 + i), c: i % 2 ? '#8a6ac8' : '#9a78d4', m: M(i * 1.1 - 2.2, 0.35, 0, 0, 0, 0, 1, 0.8, 1), flat: true });
    return mergeParts(parts); } },
  house: { size: 't', near: 34, snap: 20, walls: ['#e8dcc8', '#d8c8a8', '#c8d0d8', '#f0e8d8', '#d8b8a0'], lit: () => mergeParts([
    { g: Box(8, 5, 6), c: '#ffffff', m: M(0, 2.5) }, { g: Cyl(4.3, 4.3, 8.4, 3), c: '#8a4a3a', m: M(0, 6.2, 0, 0, 0, Math.PI / 2, 1, 1, 0.8), flat: true },
    { g: Box(1.4, 2.2, 0.1), c: '#5a3a2a', m: M(0, 1.1, 3.02) }, { g: Box(0.8, 2.4, 0.8), c: '#8a7a6a', m: M(2.2, 7.2, 0) }]),
    glow: () => mergeParts([[-2.4, 3], [2.4, 3], [-2.4, -3.01], [2.4, -3.01]].map(([x, z]) => ({ g: new THREE.PlaneGeometry(1.2, 1.1), c: '#ffffff', m: M(x, 3.2, z + (z > 0 ? 0.03 : -0.01), 0, z > 0 ? 0 : Math.PI, 0) }))) },
  ruin: { size: 't', near: 34, snap: 20, lit: () => mergeParts([
    { g: Box(8, 4.2, 0.4), c: '#9a9080', m: M(0, 2.1, 3) }, { g: Box(0.4, 2.8, 6), c: '#8a8070', m: M(-4, 1.4, 0) }, { g: Box(5, 1.6, 0.4), c: '#9a9080', m: M(1.5, 0.8, -3) },
    { g: jitter(Box(2, 0.8, 1.6), 0.3, 50), c: '#7a7060', m: M(1.5, 0.4, 0.5, 0, 0.4, 0), flat: true }, { g: Box(0.2, 1.2, 1.0), c: '#3a2a20', m: M(4, 0.6, 1, 0, 0, 0.3) }]) },
  tower: { size: 't', near: 34, snap: 40, box: [[12, 26], [22, 140], [12, 26]], lit: () => mergeParts([{ g: Box(1, 1, 1), c: '#b8c0c8', m: M(0, 0.5) }, { g: Box(1.04, 0.02, 1.04), c: '#6a7078', m: M(0, 1) }]),
    glow: () => mergeParts(winQuads(4, 14, [])) },
  lamp: { size: 'm', near: 28, lit: () => mergeParts([{ g: Cyl(0.08, 0.12, 5, 6), c: '#3a3a40', m: M(0, 2.5) }, { g: Box(1.2, 0.1, 0.1), c: '#3a3a40', m: M(0.5, 5) }]),
    glow: () => mergeParts([{ g: new THREE.SphereGeometry(0.28, 8, 6), c: '#ffe0a0', m: M(1.05, 4.85) }]) },
  boat: { size: 'm', near: 40, water: true, lit: () => mergeParts([
    { g: Box(6, 1.2, 2.2), c: '#e8e8e8', m: M(0, 0.4) }, { g: Cone(1.1, 1.8, 4), c: '#e8e8e8', m: M(3.8, 0.4, 0, 0, 0, -Math.PI / 2, 1, 1, 1.4), flat: true },
    { g: Cyl(0.06, 0.08, 6, 5), c: '#6a5a4a', m: M(0, 3.8) }, { g: new THREE.PlaneGeometry(2.4, 4.6), c: '#f4f0e8', m: M(0.8, 3.8, 0.05) }]) },
  coral: { size: 'm', near: 5, tint: true, lit: () => { const r = rng(52), parts = [];
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, h = 1 + r() * 2; parts.push({ g: Cyl(0.12, 0.22, h, 6), c: '#ffffff', m: M(Math.cos(a) * 0.5, h / 2, Math.sin(a) * 0.5, (r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.8) });
      parts.push({ g: new THREE.SphereGeometry(0.28, 6, 4), c: '#ffffff', m: M(Math.cos(a) * 0.5, h, Math.sin(a) * 0.5) }); }
    return mergeParts(parts); } },
  column: { size: 't', near: 12, lit: () => mergeParts([
    { g: Cyl(0.7, 0.8, 7, 10), c: '#d8c8a0', m: M(0, 3.5) }, { g: Box(2, 0.6, 2), c: '#c8b890', m: M(0, 0.3) }, { g: Box(1.9, 0.5, 1.9), c: '#c8b890', m: M(0, 7.2) },
    { g: Cyl(0.7, 0.7, 4, 10), c: '#c8b890', m: M(3, 0.7, 1, Math.PI / 2, 0.6, 0) }]) },
  barrel: { size: 'm', near: 5, lit: () => mergeParts([{ g: Cyl(0.5, 0.5, 1.3, 10), c: '#c8a020', m: M(0, 0.65) }, { g: Cyl(0.5, 0.5, 1.3, 10), c: '#8a7020', m: M(1.1, 0.5, 0.3, Math.PI / 2, 0.4, 0) }]),
    glow: () => mergeParts([{ g: new THREE.CircleGeometry(0.45, 12), c: '#9aff40', m: M(0, 1.31, 0, -Math.PI / 2) }]) },
  island: { size: 'f', near: 70, air: [70, 260], lit: () => mergeParts([
    { g: jitter(Cone(6, 9, 9), 1.2, 53), c: '#7a6a58', m: M(0, -4.5, 0, Math.PI), flat: true }, { g: Cyl(6.2, 6, 1.2, 12), c: '#5a9a3c', m: M(0, 0.5) },
    { g: Cyl(0.3, 0.45, 3, 6), c: '#5a3d25', m: M(1.5, 2.5, 1) }, { g: jitter(Ico(2, 1), 0.6, 54), c: '#3f7a33', m: M(1.5, 5, 1), flat: true }]) },
  asteroid: { size: 'f', near: 70, air: [50, 500], tint: true, lit: () => mergeParts([{ g: jitter(Ico(4, 1), 2.2, 55), c: '#ffffff', flat: true }]) },
  dish: { size: 't', near: 36, lit: () => mergeParts([
    { g: Cyl(0.4, 0.6, 6, 8), c: '#b0b4bc', m: M(0, 3) }, { g: new THREE.SphereGeometry(5, 18, 8, 0, 6.29, 0, 0.9), c: '#e0e4ea', m: M(0, 9, 0, 0.5, 0, 0) }]) },
});
const NEON = ['#ff4fd8', '#40e0ff', '#9a6aff', '#ffe040', '#40ff9a'];
// Choose the prop for one placement candidate, from the region's list of odds (first match wins).
function chooseVeg(rg, x, z, pick, leader) {
  const d = Math.abs(z), f = rg.forest;
  if (f && d > 30) { const k = forestAt(x, z); if (k > 0.56 && pick < f.dens * smooth(0.56, 0.7, k)) return f.type; }
  let acc = 0;
  for (const type in rg.veg) {
    const def = VEG[type]; if (!def) continue;
    if (def.snap && !leader(def.snap)) continue;
    acc += rg.veg[type]; if (pick < acc) return type;
  }
  return null;
}

const VEG_TILE = 80, VEG_CELL = 10;
function vegTile(ix, iz) {
  const out = [], r = rng((hash2(ix * 31 + 7, iz * 17 + 3) * 4294967296) >>> 0 || 1), n = VEG_TILE / VEG_CELL;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let x = ix * VEG_TILE + (i + r()) * VEG_CELL, z = iz * VEG_TILE + (j + r()) * VEG_CELL;
    const pick = r(), rank = r(), side = r(), rot = r() * Math.PI * 2, sc = 0.75 + r() * 0.6, r1 = r(), r2 = r();
    const e = envAt(x, terrainScale), rg = side < e.t ? e.b : e.a;
    const leader = S => (i % (S / VEG_CELL)) === 0 && (j % (S / VEG_CELL)) === 0;
    const type = chooseVeg(rg, x, z, pick, leader); if (!type) continue;
    const def = VEG[type];
    let ry = rot;
    if (def.snap) { x = ix * VEG_TILE + (i + 0.5 * def.snap / VEG_CELL) * VEG_CELL; z = iz * VEG_TILE + (j + 0.5 * def.snap / VEG_CELL) * VEG_CELL; ry = Math.round(rot / (Math.PI / 2)) * Math.PI / 2; }
    const d = Math.abs(z);
    if (d < def.near) continue;
    if ((def.size === 't' || def.size === 'f') && z > 0 && z < 400) continue; // keep the side camera's view of the plane clear
    if (type === 'fence') { // snap onto a field edge and run along it
      const ca = 0.35, u = x * Math.cos(ca) - z * Math.sin(ca), v = x * Math.sin(ca) + z * Math.cos(ca);
      if (hash2(Math.floor(u / 84), Math.floor(v / 58) + 5) > 0.55 || d < CORRIDOR + 4) continue;
      const vs = Math.round(v / 58) * 58; x = u * Math.cos(ca) + vs * Math.sin(ca); z = -u * Math.sin(ca) + vs * Math.cos(ca); ry = ca;
      if (Math.abs(z) < CORRIDOR + 4) continue;
    }
    if (def.rows) ry = -0.35 + (hash2(Math.floor((x * Math.cos(0.35) - z * Math.sin(0.35)) / 84), Math.floor((x * Math.sin(0.35) + z * Math.cos(0.35)) / 58)) < 0.5 ? 0 : Math.PI / 2);
    const ground = heightAt(x, z);
    if (def.water ? ground > WATER_Y - 0.8 : ground < WATER_Y + 0.3 && rg.water) continue; // boats float, everything else stays dry
    let y = def.water ? WATER_Y - 0.1 : ground - 0.15;
    if (def.air) y = Math.max(ground, 0) + def.air[0] + r1 * (def.air[1] - def.air[0]);
    else if (def.size !== 's' && !def.water) { const sl = Math.abs(heightAt(x + 1.5, z) - ground) + Math.abs(heightAt(x, z + 1.5) - ground); if (sl > (def.size === 't' ? 1.2 : 2.0)) continue; }
    let c = null, cg = null;
    if (def.tint) c = type === 'coral' ? ['#ff8a9a', '#ffb070', '#c89ae8', '#ffd0a0'][Math.floor(rank * 4)] : (rg.rockTint || '#8a8478');
    else if (def.glowTint) c = CRYSTAL_TINT[Math.floor(rank * 3)];
    else if (def.walls) c = def.walls[Math.floor(rank * def.walls.length)];
    if (def.glow && (type === 'tower' || type === 'house')) { const w = rg.windows || '#2a3440'; cg = w === 'neon' ? NEON[Math.floor(r2 * NEON.length)] : (r2 < 0.75 ? w : '#1a1e24'); }
    const big = type === 'windmill' || type === 'barn' ? 1 : def.air ? sc * (type === 'asteroid' ? 2.5 : 1.8) : sc;
    const s = big * (rg.base === 'alien' && type === 'mushroom' ? 1.4 : 1);
    const sx = def.box ? lerp(def.box[0][0], def.box[0][1], r1) : s, sy = def.box ? lerp(def.box[1][0], def.box[1][1], r2 * r2) : s, sz = def.box ? lerp(def.box[2][0], def.box[2][1], rank) : s;
    const it = { type, x, y, z, ry, s, rank, c, var: 0.85 + side * 0.3 };
    // matrix and colours are worked out once here, so rebuilding the instance buffers is a copy
    it.m = new Float32Array(16); _m4.compose(_v3.set(x, it.y, z), _q.setFromEuler(_e.set(def.air ? rot * 0.3 : 0, ry, 0)), _s3.set(sx, sy, sz)).toArray(it.m);
    if (c) TMP_COLOR.set(c); else TMP_COLOR.setRGB(1, 1, 1);
    it.cl = [TMP_COLOR.r * it.var, TMP_COLOR.g * it.var, TMP_COLOR.b * it.var];
    it.cg = cg ? (TMP_COLOR.set(cg), [TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b]) : type === 'crystal' ? [TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b] : [1, 1, 1];
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
    const lim = { s: 0.28, m: 0.6, t: 1, f: 1.4 };
    for (let ix = t0; ix <= t1; ix++) for (let iz = u0; iz <= u1; iz++) {
      const cx = (ix + 0.5) * VEG_TILE, cz = (iz + 0.5) * VEG_TILE, td = Math.hypot(cx - cam.x, cz - cam.z);
      if (td > R + VEG_TILE) continue;
      const k = ix + ':' + iz; let list = this.tiles.get(k);
      if (!list) { list = vegTile(ix, iz); this.tiles.set(k, list); }
      for (const it of list) {
        const d = Math.hypot(it.x - cam.x, it.z - cam.z), def = VEG[it.type], lr = R * lim[def.size];
        const keep = def.snap ? 1 - 0.6 * smooth(lr * 0.5, lr, d) : this.dens * this.adapt * (1 - 0.85 * smooth(lr * 0.25, lr, d));
        if (d > lr || it.rank > keep) continue;
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
    const cx = Math.floor(cam.x / CONE_CELL), cz = Math.floor(cam.z / CONE_CELL);
    for (let i = -3; i <= 5; i++) for (let j = -4; j <= 0; j++) { // cones only rise in volcanic regions
      const c = coneIn(cx + i, cz + j); if (!c) continue;
      const rg = BIOMES[biomeIndex(c.x)]; if (rg.h === 'volcanic' && rg.hp.cones) found.push(Object.assign({ erupt: !!rg.erupting }, c));
    }
    found.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    this.craters.forEach((cr, i) => {
      const c = found[i];
      cr.glow.visible = !!c; cr.smoke.forEach(s => { s.visible = !!c; });
      if (!c) return;
      const top = heightAt(c.x, c.z) + c.H * 0.05;
      cr.glow.position.set(c.x, top, c.z); const g = c.R * (c.erupt ? 1.1 : 0.55) * (0.9 + 0.1 * Math.sin(time * (c.erupt ? 7 : 3) + i)); cr.glow.scale.set(g, g, 1);
      cr.smoke.forEach((s, k) => {
        const ph = ((time * (c.erupt ? 0.12 : 0.06) + k / cr.smoke.length + i * 0.13) % 1), sz = c.R * (0.25 + ph * 0.7) * (c.erupt ? 1.6 : 1);
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
