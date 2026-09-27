'use strict';
/* ==========================================================================
   The plane, assembled from modular procedural parts. Built in the 2D game's
   drawing units (the 2D plane is ~80-110 px long) and scaled by PLANE_UNIT to
   metres. Axes: nose along +x, up +y, wings along ±z.

   Each part is its own group with its own materials, so any combination works and
   the hangar can make one part glow. Within a look stage every level still changes
   something visible: livery stripes, bands or ribs, and size, as in the 2D game.
   ========================================================================== */

const PLANE_UNIT = 0.09; // the 2D plane is ~90 px on a 96 m wide view, about 7.5 m
const TAU = Math.PI * 2;

function planeGeo(p) { // identical to the 2D planeGeo
  const s = stageOf('frame', p.frame);
  const fam = s === 0 ? 'paper' : s >= 9 ? 'saucer' : 'tube';
  const hl = 37 + s * 1.6 + (p.frame % 5) * 0.5;
  const h = fam === 'paper' ? 8 : fam === 'saucer' ? 16 : 14 - (s >= 4 ? 2 : 0) - (s >= 6 ? 1 : 0);
  const k = fam === 'saucer' ? 0.8 : 1;
  return { s, fam, hl, h, noseX: hl * k, rearX: -hl * k, top: h / 2, bot: -h / 2 };
}

/* ---------- small builders ---------- */
function stdMat(color, o = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o));
  m.userData.baseEmissive = m.emissive.clone(); m.userData.baseEI = m.emissiveIntensity;
  return m;
}
const matFor = (M, key = 'base', o = {}) => stdMat(M[key], Object.assign({ roughness: M.rough, metalness: M.metal }, o));
function glowMat(color, intensity = 1.6, o = {}) { return stdMat('#000000', Object.assign({ emissive: color, emissiveIntensity: intensity, roughness: 0.4 }, o)); }
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; }
// A flat polygon in the XY plane, extruded `depth` along z and centred on z = 0.
function slab(pts, depth, bevel = 0.3) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g;
}
// Lathe around the x axis from profile points [x, r] (x ascending).
function latheX(pts, seg = 20) {
  const g = new THREE.LatheGeometry(pts.map(([x, r]) => new THREE.Vector2(Math.max(0.001, r), x)), seg);
  g.rotateZ(-Math.PI / 2); return g;
}
function capsuleX(len, r, seg = 16) { const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, seg); g.rotateZ(Math.PI / 2); return g; }
function cylX(r1, r2, len, seg = 16, open = false) { const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, open); g.rotateZ(-Math.PI / 2); return g; } // r1 at -x end, r2 at +x end
function band(r, len, color, x, y = 0, z = 0) { return mesh(cylX(r, r, len, 20), stdMat(color, { roughness: 0.5 }), x, y, z); }
function vcolor(g, fn) { // per-vertex colours from fn(x, y, z, nx, ny, nz) -> THREE.Color
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const c = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const C = h => new THREE.Color(h);
const lerpC = (a, b, t) => a.clone().lerp(b, clamp(t, 0, 1));
// top-lit gradient like the 2D vgrad(light, base, dark)
const grad3 = (M, ny) => ny > 0 ? lerpC(C(M.base), C(M.light), ny) : lerpC(C(M.base), C(M.dark), -ny);

let _flameMat = null;
function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Color('#fff3a0') }, uB: { value: new THREE.Color('#ff7b1c') }, uOp: { value: 1 } },
    vertexShader: 'varying float vT; varying float vR; void main(){ vT = uv.y; vR = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uA, uB; uniform float uOp; varying float vT; varying float vR;
      void main(){ float t = vT; vec3 c = mix(uA, uB, smoothstep(0.0, 0.45, t)); float a = (1.0 - smoothstep(0.35, 1.0, t)) * uOp; gl_FragColor = vec4(c * 1.6, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function flame(len, w) { // a cone pointing -x from the nozzle at x = 0
  const g = new THREE.ConeGeometry(w, len, 12, 1, true); g.translate(0, len / 2, 0); g.rotateZ(Math.PI / 2); // wide end at the nozzle, tip at -len
  const m = new THREE.Mesh(g, flameMaterial()); m.renderOrder = 3; m.userData.len = len; return m;
}

/* ---------- parts ---------- */
function buildBody(p, G) {
  const grp = new THREE.Group(), s = G.s, M = MAT[s], lv = p.frame % 5, { hl, h } = G;
  if (G.fam === 'paper') {
    const g = slab([[hl, 0], [-hl, 3], [-hl + 9, -h]], 0.5, 0.15);
    vcolor(g, (x, y) => lerpC(C(M.dark), C(M.light), (y + h) / (h + 3)));
    grp.add(mesh(g, matFor(M, 'base', { vertexColors: true, color: '#ffffff' })));
    const ink = stdMat(M.accent, { roughness: 0.9 });
    for (let k = 0; k < lv + 1; k++) for (const side of [1, -1]) { // homework scribbles, one more per level
      const m = mesh(new THREE.BoxGeometry(7.4, 0.5, 0.1), ink, -hl + 15.5 + k * 7, -1.6 - k * 0.15, side * 0.42); m.rotation.z = -0.29; grp.add(m);
    }
    return grp;
  }
  if (G.fam === 'saucer') {
    const rx = G.noseX, ry = 6.5, disc = new THREE.SphereGeometry(1, 48, 16); disc.scale(rx, ry, rx);
    vcolor(disc, (x, y) => grad3(M, y / ry));
    grp.add(mesh(disc, matFor(M, 'base', { vertexColors: true, color: '#ffffff' })));
    const belly = new THREE.SphereGeometry(1, 40, 8, 0, TAU, Math.PI * 0.55, Math.PI * 0.45); belly.scale(rx * 0.62, 5, rx * 0.62);
    grp.add(mesh(belly, matFor(M, 'dark'), 0, -1.5, 0));
    const dome = new THREE.SphereGeometry(1, 32, 12, 0, TAU, 0, Math.PI / 2); dome.scale(rx * 0.36, 13, rx * 0.36);
    grp.add(mesh(dome, stdMat('#9fd6f0', { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.72, emissive: '#1a5a80', emissiveIntensity: 0.3 }), 0, 2, 0));
    const n = 7 + lv, on = glowMat('#fffa7a', 2.2), off = glowMat(M.accent, 0.9), lights = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU, l = mesh(new THREE.SphereGeometry(1.7, 10, 8), off, Math.cos(a) * rx * 0.93, 0.6, Math.sin(a) * rx * 0.93); grp.add(l); lights.push(l); }
    grp.userData.lights = { lights, on, off };
    const ug = new THREE.Mesh(new THREE.CircleGeometry(rx * 0.9, 32), new THREE.MeshBasicMaterial({ color: s === 10 ? '#c77dff' : '#7dffa8', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ug.rotation.x = Math.PI / 2; ug.position.y = -7; grp.add(ug); grp.userData.under = ug;
    return grp;
  }
  // tube fuselage
  const nt = 12 + s * 2.2, rt = 11, R = h / 2, pts = [];
  for (let i = 0; i <= 96; i++) {
    const x = -hl + (2 * hl) * i / 96; let r = R;
    if (x < -hl + rt) r = R * (0.62 + 0.38 * Math.sqrt((x + hl) / rt));
    if (x > hl - nt) { const u = (x - (hl - nt)) / nt; r = R * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.1 * u) + 0.25 * (1 - u); }
    pts.push([x, r]);
  }
  pts.unshift([-hl, 0.001]);
  const g = latheX(pts, 40); g.scale(1, 1, 0.86);
  const accent = C(s === 7 ? '#3456a8' : M.accent), black = C('#1e1e1e'), win = C('#2a2f36');
  vcolor(g, (x, y, z, nx, ny) => {
    let c = grad3(M, ny);
    if (ny > 0.75) c.lerp(C('#ffffff'), 0.28);
    if (s === 7 && (y < -R * 0.18 || x > hl - nt * 0.55)) c = black.clone();
    if (s === 6 && Math.abs(y) < 1) c = C(M.accent);
    if (s === 8 && y < -R * 0.1 && y > -R * 0.1 - 1.4) c = C(M.accent);
    for (let k = 0; k < lv; k++) { const x0 = -hl + rt + 3 + k * 5; if (x > x0 && x < x0 + 2.4) c = accent.clone(); } // one livery stripe per level
    if (s >= 3 && s <= 4 && Math.abs(((x + hl) % 6) - 3) < 0.25 && y < R * 0.2) c.multiplyScalar(0.8); // panel lines
    if (s === 5 && y > 0.6 && y < 2.4 && Math.abs(z) > R * 0.5) for (let i = 0; i < 9; i++) { const wx = hl - nt - 16 - i * 5.5; if (x > wx && x < wx + 2) c = win.clone(); }
    return c;
  });
  grp.add(mesh(g, matFor(M, 'base', { vertexColors: true, color: '#ffffff' })));
  if (s >= 2 && s !== 7) { // canopy
    const cw = 8 + s * 0.5, cg = new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2); cg.scale(cw, 5.2, R * 0.72);
    grp.add(mesh(cg, stdMat(s === 8 ? '#b04dff' : '#5aa6e6', { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, emissive: s === 8 ? '#4a1070' : '#0a2a4a', emissiveIntensity: 0.4 }), hl - nt - 3, R - 0.5, 0));
  }
  if (s === 7) { const blk = stdMat('#111111'); for (let i = 0; i < 3; i++) for (const zz of [-1, 1]) grp.add(mesh(new THREE.BoxGeometry(2.4, 1.2, 1.4), blk, hl - nt + 3 + i * 3.4, R * 0.62, zz * 1.6)); }
  return grp;
}

function buildWings(p, G) {
  const grp = new THREE.Group(), W = p.wings, s = stageOf('wings', W), M = MAT[s], lv = W % 5;
  // the 2D span is a side-view depth; in 3D the wings need more reach to read as wings
  const span = (14 + W * 0.42) * (G.fam === 'saucer' ? 0.6 : 1) * 1.6;
  if (s === 0) { // folded paper wings: the classic dart
    const big = 14 + W * 1.2;
    for (const side of [1, -1]) {
      const sh = new THREE.Shape(); sh.moveTo(G.noseX - 1, 0); sh.lineTo(G.rearX - 2, side * (big + 4)); sh.lineTo(G.rearX + 10, side * 1); sh.closePath();
      const g = new THREE.ShapeGeometry(sh); g.rotateX(Math.PI / 2); g.computeVertexNormals();
      const m = mesh(g, matFor(M, 'base', { side: THREE.DoubleSide })); m.rotation.x = side * -0.12; grp.add(m);
      if (lv) for (let i = 0; i < lv; i++) { // a fold crease per level
        const f = 0.3 + i * 0.14, cz = side * (big + 4) * f, x0 = lerp(G.noseX - 1, G.rearX - 2, f);
        const c = mesh(new THREE.BoxGeometry(Math.max(2, (G.noseX - 1 - x0) * 0.7), 0.08, 0.35), stdMat(M.accent, { roughness: 0.9 }), x0 + (G.noseX - x0) * 0.35, side * -0.12 * cz + 0.1, cz * 0.98);
        grp.add(c);
      }
    }
    grp.userData.span = big + 4; grp.userData.y = 0;
    return grp;
  }
  const cx = -2, chord = 24 + s * 1.2 + lv * 0.6, delta = s >= 5 && s !== 8, sweep = s <= 3 ? 3 : (s - 2) * 4;
  const rootLE = cx + chord * (delta ? 0.75 : 0.5), rootTE = cx - chord * 0.5, tipChord = delta ? 5 : chord * (s <= 2 ? 0.9 : 0.55);
  const rz = G.h * 0.3, tz = span + rz;
  let tipTE = rootTE - sweep; if (s === 8) tipTE = rootTE + 8;
  const tipLE = tipTE + tipChord, y = G.fam === 'saucer' ? 0 : G.fam === 'paper' ? 0 : -G.h * 0.12, th = 1.1 + s * 0.08;
  const mat = s === 10 ? stdMat(M.base, { transparent: true, opacity: 0.82, emissive: M.accent, emissiveIntensity: 0.35, roughness: 0.2, side: THREE.DoubleSide }) : matFor(M);
  const accentMat = stdMat(M.accent, { roughness: 0.5, metalness: M.metal * 0.5 });
  for (const side of [1, -1]) {
    const sh = new THREE.Shape(); sh.moveTo(rootLE, side * rz); sh.lineTo(tipLE, side * tz); sh.lineTo(tipTE, side * tz); sh.lineTo(rootTE, side * rz); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 1 });
    g.translate(0, 0, -th / 2); g.rotateX(Math.PI / 2); g.computeVertexNormals();
    const w = mesh(g, mat, 0, y, 0); w.rotation.x = side * (s >= 2 && s <= 4 ? -0.05 : 0); grp.add(w);
    for (let i = 0; i < lv; i++) { // livery bands, one per level
      const f = 0.55 + i * 0.1, z = side * lerp(rz, tz, f), c = lerp(chord, tipChord, f), x = lerp(rootTE, tipTE, f) + c / 2;
      grp.add(mesh(new THREE.BoxGeometry(c * 0.94, th + 0.9, 1.6), accentMat, x, y, z));
    }
    if (s >= 7) { // winglet
      const wl = mesh(slab([[tipTE + 1, 0], [tipTE + tipChord * 0.8, 0], [tipTE - 1, 7]], 0.8, 0.2), matFor(M, 'dark'), 0, y, side * tz);
      grp.add(wl);
    }
    if (s >= 9) { // glowing leading edge
      const a = new THREE.Vector3(rootLE, y, side * rz), b = new THREE.Vector3(tipLE, y, side * tz), L = a.distanceTo(b);
      const e = mesh(new THREE.CylinderGeometry(0.45, 0.45, L, 6), glowMat(M.accent, 2.2), (a.x + b.x) / 2, y, (a.z + b.z) / 2);
      e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); grp.add(e);
    }
  }
  if (s === 2) { // biplane: upper wing on struts
    const uy = G.top + 9;
    grp.add(mesh(new THREE.BoxGeometry(chord + 4, 1.6, (tz) * 2), matFor(M), (rootLE + rootTE) / 2, uy, 0));
    const strut = stdMat('#6b4a2a', { roughness: 0.8 });
    for (const zz of [-1, 1]) for (const xx of [rootTE + 5, rootLE - 5]) { const st = mesh(new THREE.CylinderGeometry(0.5, 0.5, uy - y, 6), strut, xx, (uy + y) / 2, zz * tz * 0.72); grp.add(st); }
    for (let i = 0; i < lv; i++) grp.add(mesh(new THREE.BoxGeometry(chord + 4.4, 1.8, 1.6), accentMat, (rootLE + rootTE) / 2, uy, (i - (lv - 1) / 2) * 5));
  }
  grp.userData.span = tz; grp.userData.y = y;
  return grp;
}

function buildTail(p, G) {
  const grp = new THREE.Group(), T = p.tail; if (!T) return grp;
  const s = stageOf('tail', T), M = MAT[Math.min(10, s * 2)], lv = T % 4;
  const fh = 8 + T * 0.75, fc = 13 + s * 1.5, sw = 3 + s * 2.2;
  const x0 = G.rearX + 1, y0 = G.fam === 'saucer' ? G.top - 3 : G.top - 0.8;
  const pts = [[x0 + fc, 0], [x0 + fc * 0.45 - sw * 0.3, fh], [x0 - sw * 0.5, fh], [x0 - 2, 0]];
  const twin = s >= 3, fins = twin ? [-1, 1] : [0];
  const mat = matFor(M), accentMat = stdMat(M.accent, { roughness: 0.5 });
  for (const f of fins) {
    const fin = new THREE.Group(); fin.position.set(0, y0, f * G.h * 0.32); if (s >= 4) fin.rotation.x = -f * 0.32;
    fin.add(mesh(slab(pts, 1.1, 0.25), mat));
    for (let i = 0; i < lv; i++) { // a stripe per level
      const yy = fh - 2 - i * 3, t = yy / fh, xa = lerp(x0 - 2, x0 - sw * 0.5, t), xb = lerp(x0 + fc, x0 + fc * 0.45 - sw * 0.3, t);
      fin.add(mesh(new THREE.BoxGeometry(Math.max(1, xb - xa - 0.4), 1.4, 1.9), accentMat, (xa + xb) / 2, yy, 0));
    }
    if (s === 5) { // vector vanes: glowing trailing edge
      const a = new THREE.Vector3(x0 - sw * 0.5, fh, 0), b = new THREE.Vector3(x0 - 2, 0, 0), L = a.distanceTo(b);
      const e = mesh(new THREE.CylinderGeometry(0.4, 0.4, L, 6), glowMat('#7de8ff', 2.2), (a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); fin.add(e);
    }
    grp.add(fin);
  }
  // horizontal stabilisers
  const hs = 6 + T * 0.4, sy = G.fam === 'saucer' ? G.top - 2 : 0.5;
  for (const side of [1, -1]) {
    const sh = new THREE.Shape(); sh.moveTo(x0 + fc * 0.9, side * G.h * 0.3); sh.lineTo(x0 - sw * 0.4 + 2, side * (G.h * 0.3 + hs)); sh.lineTo(x0 - 4, side * (G.h * 0.3 + hs)); sh.lineTo(x0 - 1, side * G.h * 0.3); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 1 });
    g.translate(0, 0, -0.45); g.rotateX(Math.PI / 2); g.computeVertexNormals();
    grp.add(mesh(g, mat, 0, sy, 0));
  }
  return grp;
}

function buildNose(p, G) {
  const grp = new THREE.Group(), N = p.nose; if (!N) return grp;
  const s = stageOf('nose', N), lv = N % 4;
  const cols = [['#d8b07a', '#9a6d3c'], ['#555555', '#1d1d1d'], ['#eef2f6', '#8e99a6'], ['#eef2f6', '#8e99a6'], ['#f7dc8a', '#a8822e'], ['#dff8ff', '#6fb6d6']][s];
  const nl = 3 + N * 0.45, hh = G.fam === 'paper' ? 2.8 : G.fam === 'saucer' ? 3.5 : G.h * 0.4;
  const x = G.noseX - 3, y = G.fam === 'tube' ? -0.6 : G.fam === 'paper' ? -1.2 : 0;
  const pts = []; for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push([u * (nl + 3), hh * Math.pow(1 - u, 0.75) * (0.9 + 0.1 * (1 - u))]); }
  const g = latheX(pts, 20); vcolor(g, (a, b, c, nx, ny) => lerpC(C(cols[1]), C(cols[0]), 0.5 + 0.5 * ny));
  grp.add(mesh(g, stdMat('#ffffff', { vertexColors: true, roughness: s === 1 ? 0.9 : 0.35, metalness: s >= 2 && s <= 4 ? 0.7 : 0.1 }), x, y, 0));
  const rib = stdMat('#222222', { roughness: 0.6 });
  for (let i = 0; i < lv; i++) { // a rib per level
    const xx = 1.5 + i * 1.7, r = hh * Math.pow(1 - xx / (nl + 3), 0.75) + 0.15;
    const t = mesh(new THREE.TorusGeometry(r, 0.3, 6, 20), rib, x + xx, y, 0); t.rotation.y = Math.PI / 2; grp.add(t);
  }
  if (s >= 3) { // pitot spike
    const L = 5 + N * 0.3; grp.add(mesh(cylX(0.5, 0.35, L, 8), stdMat('#666666', { metalness: 0.8, roughness: 0.3 }), x + nl + 3 + L / 2, y, 0));
    grp.add(mesh(new THREE.SphereGeometry(1.2, 10, 8), stdMat('#e04b3b'), x + nl + 3 + L, y, 0));
  }
  if (s === 5) { // force shield
    const sh = new THREE.SphereGeometry(1, 24, 16, 0, TAU, 0, Math.PI / 2); sh.rotateZ(-Math.PI / 2); sh.scale(5, hh * 2.4 + 4, hh * 2.4 + 4);
    const m = new THREE.Mesh(sh, new THREE.MeshBasicMaterial({ color: '#96f0ff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x + nl + 5, y, 0); grp.add(m); grp.userData.shield = m;
  }
  return grp;
}

function buildEngine(p, G, wingY) {
  const grp = new THREE.Group(), E = p.engine; if (!E) return grp;
  const s = stageOf('engine', E), lv = E % 5, x = G.rearX;
  grp.userData.flames = []; grp.userData.stage = s;
  if (s <= 3) { // pusher propellers at the tail
    const px = x - 4, r = 6 + s * 3 + lv * 0.8, nb = [2, 2, 3, 4][s];
    if (s === 0) { // the rubber band, twisted under the body
      const pts = []; for (let i = 0; i <= 24; i++) { const xx = lerp(x + 2, x + G.hl * 1.9, i / 24); pts.push(new THREE.Vector3(xx, G.bot - 1.5 + (i % 2 ? 0.9 : -0.2), Math.sin(i * 1.3) * 0.5)); }
      grp.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.45, 5), stdMat('#8a5a3a', { roughness: 0.9 })));
    }
    if (s === 3) { // radial engine
      grp.add(mesh(cylX(5.5, 5.5, 6, 18), stdMat('#3a3a3a', { metalness: 0.7, roughness: 0.4 }), x, 0, 0));
      const cyl = stdMat('#555555', { metalness: 0.8, roughness: 0.35 });
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, c = mesh(new THREE.CylinderGeometry(1.2, 1.2, 4, 8), cyl, x, Math.cos(a) * 6, Math.sin(a) * 6); c.rotation.x = a; grp.add(c); }
    }
    grp.add(mesh(new THREE.ConeGeometry(2.6, 4, 12).rotateZ(Math.PI / 2), stdMat('#cfd4da', { metalness: 0.6, roughness: 0.3 }), px - 1, 0, 0));
    const prop = new THREE.Group(); prop.position.set(px, 0, 0);
    const bc = s === 0 ? '#c9b08a' : s === 1 ? '#8a5a2e' : '#4a4a4a', bm = stdMat(bc, { roughness: s <= 1 ? 0.8 : 0.4, metalness: s >= 2 ? 0.5 : 0 });
    for (let i = 0; i < nb; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, r, 2.6), bm); b.position.y = r / 2; const arm = new THREE.Group(); arm.rotation.x = i * TAU / nb; arm.add(b); b.castShadow = true; prop.add(arm); }
    const blur = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: '#5a5a5a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.y = Math.PI / 2; prop.add(blur);
    grp.add(prop); grp.userData.prop = prop; grp.userData.blur = blur; grp.userData.blades = bm;
    return grp;
  }
  const n = s === 6 ? 2 : s === 8 ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const ny = n === 1 ? 0 : n === 2 ? (i - 0.5) * 5.5 : Math.cos(i / 3 * TAU + Math.PI / 2) * 4, nz = n === 3 ? Math.sin(i / 3 * TAU + Math.PI / 2) * 4 : 0;
    const zz = n === 2 ? 0 : nz, yy = ny;
    if (s <= 6) { // jets
      const nl = 6 + lv * 0.6 + (s - 4) * 1.5, r = n > 1 ? 2.5 : 3.6 + (s - 4) * 0.5;
      grp.add(mesh(cylX(r, r + 1, nl + 2, 18), stdMat('#5a6068', { metalness: 0.85, roughness: 0.35 }), x - nl / 2 + 1, yy, zz));
      grp.add(mesh(cylX(r * 0.8, r * 0.8, 0.8, 18), stdMat('#1f2227', { roughness: 0.8 }), x - nl - 0.2, yy, zz));
      if (s >= 5) { const ab = mesh(new THREE.CircleGeometry(r * 0.78, 18), glowMat('#ffb347', 2), x - nl - 0.7, yy, zz); ab.rotation.y = -Math.PI / 2; grp.add(ab); grp.userData.ab = (grp.userData.ab || []).concat(ab); }
      const f = flame(26 + s * 6 + lv * 2, r * 0.95); f.position.set(x - nl - 0.5, yy, zz); grp.add(f); grp.userData.flames.push(f);
    } else if (s <= 8) { // rockets: copper bells
      const bl = 9 + lv * 0.6, br = n > 1 ? 3.6 : 5.5;
      const bell = latheX([[-bl, br], [-bl * 0.55, br * 0.72], [-3, 2.6], [1, 2.2]], 20);
      grp.add(mesh(bell, stdMat('#b87333', { metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }), x, yy, zz));
      const f = flame(50 + lv * 4, br * 0.9); f.position.set(x - bl, yy, zz); grp.add(f); grp.userData.flames.push(f);
    } else if (s === 9) { // ion drive
      const ring = mesh(new THREE.TorusGeometry(7 + lv * 0.5, 1.4, 10, 28), glowMat('#7fb8ff', 2.4), x - 4, 0, 0); ring.rotation.y = Math.PI / 2; grp.add(ring);
      grp.add(mesh(cylX(3.5, 4.5, 5, 16), stdMat('#9aa8c0', { metalness: 0.9, roughness: 0.25 }), x - 1, 0, 0));
      const f = flame(44 + lv * 3, 4); f.position.set(x - 5, 0, 0); grp.add(f); grp.userData.flames.push(f);
    } else { // plasma core
      const core = mesh(new THREE.SphereGeometry(5.5 + lv * 0.4, 20, 14), glowMat('#d68bff', 2.6), x - 4, 0, 0); grp.add(core); grp.userData.core = core;
      const halo = new THREE.Mesh(new THREE.SphereGeometry(8 + lv * 0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#9a40ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.set(x - 4, 0, 0); grp.add(halo); grp.userData.halo = halo;
      const f = flame(48 + lv * 3, 4.5); f.position.set(x - 6, 0, 0); grp.add(f); grp.userData.flames.push(f);
    }
  }
  return grp;
}

function buildFuel(p, G, wings) {
  const grp = new THREE.Group(), F = p.fuel; if (!F) return grp;
  const s = stageOf('fuel', F), lv = F % 5;
  if (s === 0) { // soda bottle strapped under the belly
    const len = 9 + F * 1.2, yb = G.bot - 2.6;
    grp.add(mesh(capsuleX(len, 2.4), stdMat('#3caa5a', { transparent: true, opacity: 0.85, roughness: 0.1 }), -4, yb, 0));
    grp.add(mesh(cylX(1.3, 1.3, 2.6, 10), stdMat('#e04b3b'), -4 + len / 2 + 0.6, yb, 0));
    grp.add(mesh(new THREE.TorusGeometry(2.55, 0.25, 4, 16).rotateY(Math.PI / 2), stdMat('#444444'), -6, yb, 0));
    return grp;
  }
  const cols = [null, ['#eef2f6', '#8e99a6'], ['#eef2f6', '#8e99a6'], ['#e9edf2', '#7d8896'], ['#e9edf2', '#7d8896'], ['#b5c1cf', '#556171'],
    ['#e6f8ff', '#79b8d6'], ['#ffc08a', '#c9561f'], ['#ffb3ef', '#b0209a'], ['#6a4d9a', '#1c1030'], ['#444444', '#000000']][s];
  const glowC = s >= 8 ? (s === 8 ? '#ff4fd8' : s === 9 ? '#9a5cff' : '#ffd23d') : null;
  const tank = (cx, cy, cz, len, th) => {
    const g = capsuleX(len, th / 2, 18); vcolor(g, (a, b, c, nx, ny) => lerpC(C(cols[1]), C(cols[0]), 0.5 + 0.5 * ny));
    const m = mesh(g, stdMat('#ffffff', { vertexColors: true, metalness: 0.5, roughness: 0.35, emissive: glowC || '#000000', emissiveIntensity: glowC ? 0.6 : 0 }), cx, cy, cz);
    grp.add(m); grp.add(mesh(new THREE.SphereGeometry(th * 0.42, 12, 8), stdMat('#ff7a3d'), cx + len / 2 - 1, cy, cz));
    if (glowC) (grp.userData.glows = grp.userData.glows || []).push(m);
    return m;
  };
  const len = 14 + F * 0.35, th = 4 + s * 0.35, by = G.bot - th / 2 - 1.5;
  grp.add(mesh(new THREE.BoxGeometry(3, 2, 1.2), stdMat('#333333'), -2.5, G.bot - 0.5, 0));
  tank(-2, by, 0, len, th);
  const bandM = stdMat('#333333', { roughness: 0.6 });
  for (let i = 0; i < lv; i++) grp.add(mesh(cylX(th / 2 + 0.12, th / 2 + 0.12, 1.2, 16), bandM, -2 - len * 0.3 + i * 3, by, 0)); // a band per level
  if (s >= 3 && s <= 4) { const wz = wings.userData.span * 0.55, wy = wings.userData.y - 3; for (const side of [1, -1]) { tank(-6, wy, side * wz, len * 0.55, th * 0.8); if (s === 4) tank(-6, wy, side * (wz + 5), len * 0.5, th * 0.7); } }
  if (s >= 5) for (const side of [1, -1]) tank(-G.hl * 0.35, G.bot + 1.2, side * G.h * 0.38, len * 0.7, th * 0.55);
  if (s === 6) { const frost = stdMat('#ffffff', { roughness: 1 }); for (let i = 0; i < 6; i++) grp.add(mesh(new THREE.SphereGeometry(0.5, 6, 4), frost, -2 - len * 0.35 + i * len * 0.14, by + (i % 2 ? 1 : -1) * th * 0.3, th * 0.45)); }
  return grp;
}

function buildMagnet(p, G) {
  const grp = new THREE.Group(), I = p.magnet; if (!I) return grp;
  const s = stageOf('magnet', I), lv = I % 5, sz = 0.9 + lv * 0.07 + s * 0.04;
  const x = G.fam === 'saucer' ? G.noseX * 0.45 : -G.hl * 0.02, y = G.fam === 'saucer' ? 3 : G.top - 0.5;
  const g = new THREE.Group(); g.position.set(x, y, 0); g.scale.setScalar(sz); grp.add(g);
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 6), stdMat('#555555', { metalness: 0.7 }), 0, 1.5, 0));
  const red = stdMat('#d63a3a', { roughness: 0.4 }), steel = stdMat('#d7dde4', { metalness: 0.9, roughness: 0.25 });
  switch (s) {
    case 0: g.add(mesh(new THREE.BoxGeometry(8, 3.5, 3), stdMat('#e04b3b'), 0, 3.6, 0)); g.add(mesh(new THREE.SphereGeometry(0.9, 8, 6), stdMat('#ffffff'), 0, 3.6, 1.6)); break;
    case 1: case 2: {
      const r = s === 1 ? 4 : 5, t = s === 1 ? 1.5 : 1.8;
      const hs = mesh(new THREE.TorusGeometry(r, t, 10, 20, Math.PI), red, 0, r + 5, 0); hs.rotation.z = Math.PI; g.add(hs);
      g.add(mesh(new THREE.BoxGeometry(3.2, 3.5, 3.2), steel, -r, r + 6.6, 0)); g.add(mesh(new THREE.BoxGeometry(3.2, 3.5, 3.2), steel, r, r + 6.6, 0)); break;
    }
    case 3: g.add(mesh(new THREE.CylinderGeometry(4, 4, 7, 16), stdMat('#b8733a', { metalness: 0.8, roughness: 0.35 }), 0, 6.5, 0));
      for (let i = 0; i < 5; i++) g.add(mesh(new THREE.TorusGeometry(4.1, 0.35, 6, 20).rotateX(Math.PI / 2), stdMat('#7a4a22'), 0, 3.6 + i * 1.45, 0)); break;
    case 4: case 5: {
      const dish = dz => {
        g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 6), stdMat('#555555'), 0, 3, dz));
        const d = mesh(new THREE.SphereGeometry(6, 20, 8, 0, TAU, 0, 0.9), stdMat('#e8ecf0', { metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide }), 0, 12, dz); d.rotation.z = Math.PI + 0.45; g.add(d);
        g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 6), stdMat('#6d7686'), 1, 9.5, dz)); g.add(mesh(new THREE.SphereGeometry(0.9, 8, 6), stdMat('#e04b3b'), 1.4, 12.3, dz));
      };
      dish(0); if (s === 5) dish(-9); break;
    }
    case 6: g.add(mesh(new THREE.CylinderGeometry(5, 3, 7, 16), stdMat('#6d7686', { metalness: 0.8, roughness: 0.3 }), 0, 6.5, 0));
      { const d = mesh(new THREE.CylinderGeometry(5, 5, 0.6, 20), glowMat('#7dffa8', 2), 0, 10.3, 0); g.add(d); g.userData.pulse = d; } break;
    case 7: { const o = mesh(new THREE.SphereGeometry(4, 20, 14), glowMat('#b88cff', 2.2), 0, 9, 0); g.add(o); g.userData.pulse = o; break; }
    case 8: { const r = mesh(new THREE.TorusGeometry(6, 0.9, 8, 28), glowMat('#ffd23d', 1.8, { metalness: 0.9 }), 0, 9, 0); r.rotation.x = Math.PI / 2; g.add(r); g.userData.wobble = r; g.add(mesh(new THREE.SphereGeometry(1.8, 12, 8), glowMat('#fff4b0', 2), 0, 9, 0)); break; }
    case 9: { const q = mesh(new THREE.OctahedronGeometry(4.5), glowMat('#7de8ff', 2), 0, 9, 0); g.add(q); g.userData.spin = q; break; }
    default: g.add(mesh(new THREE.SphereGeometry(4, 20, 14), stdMat('#05030a', { roughness: 0.1, metalness: 1 }), 0, 9, 0));
      { const r = mesh(new THREE.TorusGeometry(7.5, 0.7, 8, 32), glowMat('#ffd23d', 2), 0, 9, 0); r.rotation.set(Math.PI / 2 - 0.3, 0, 0.2); g.add(r); g.userData.spin = r; }
  }
  // coin sparkles orbiting the magnet
  const n = 1 + Math.floor(s / 3), sp = [];
  for (let i = 0; i < n; i++) { const m = mesh(new THREE.SphereGeometry(1.1, 8, 6), glowMat('#ffd646', 1.8)); grp.add(m); sp.push(m); }
  grp.userData.sparkles = { sp, x, y: y + 9 * sz, sz };
  grp.userData.g = g;
  return grp;
}

function buildReserve(p, G) {
  const grp = new THREE.Group(), R = p.reserve; if (!R) return grp;
  const s = stageOf('reserve', R), lv = R % 5;
  const cols = [['#bfe0ff', '#3d7fd6'], ['#a8d4ff', '#2f6fd6'], ['#a8d4ff', '#2f6fd6'], ['#e6fbff', '#58b8e0'], ['#f0c8ff', '#9a3fe0'], ['#c8ffe0', '#2fbf71'], ['#fff2b0', '#d9a21a']][s];
  const len = 12 + R * 0.45, th = 4.2 + s * 0.3, pods = s >= 2 ? 2 : 1, mats = [];
  for (let i = 0; i < pods; i++) {
    const cx = G.fam === 'saucer' ? -G.noseX * 0.35 : -G.hl * 0.4, cy = G.top + th / 2 - 1 + (G.fam === 'saucer' ? 1 : 0), cz = pods === 1 ? 0 : (i - 0.5) * th * 1.3;
    const g = capsuleX(len, th / 2, 16); vcolor(g, (a, b, c, nx, ny) => lerpC(C(cols[1]), C(cols[0]), 0.5 + 0.5 * ny));
    const m = stdMat('#ffffff', { vertexColors: true, metalness: 0.4, roughness: 0.3, emissive: '#7de8ff', emissiveIntensity: 0 });
    grp.add(mesh(g, m, cx, cy, cz)); mats.push(m);
    const w = stdMat('#ffffff', { roughness: 0.4 });
    for (let k = 0; k < lv; k++) grp.add(mesh(cylX(th / 2 + 0.1, th / 2 + 0.1, 0.9, 14), w, cx - len * 0.3 + k * 2.6, cy, cz)); // a band per level
    grp.add(mesh(new THREE.BoxGeometry(2.5, 2, 1), stdMat('#333333'), cx, cy - th / 2, cz));
  }
  grp.userData.mats = mats;
  return grp;
}

/* ---------- assembly ---------- */
const PART_ORDER = ['frame', 'wings', 'engine', 'fuel', 'tail', 'nose', 'magnet', 'reserve'];
function buildPlane(parts) {
  const G = planeGeo(parts), root = new THREE.Group(), model = new THREE.Group(); root.add(model);
  model.scale.setScalar(PLANE_UNIT);
  const wings = buildWings(parts, G);
  const groups = {
    frame: buildBody(parts, G), wings, engine: buildEngine(parts, G, wings.userData.y), fuel: buildFuel(parts, G, wings),
    tail: buildTail(parts, G), nose: buildNose(parts, G), magnet: buildMagnet(parts, G), reserve: buildReserve(parts, G),
  };
  for (const id of PART_ORDER) { groups[id].name = id; model.add(groups[id]); }
  // size the plane by its solid parts: flames, prop blur and glows would make it look far bigger
  const box = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isMesh && !o.material.isShaderMaterial && !o.material.transparent) box.expandByObject(o, false); });
  const radius = box.getSize(new THREE.Vector3()).length() / 2, center = box.getCenter(new THREE.Vector3());
  return { root, model, groups, G, radius, center, bottom: box.min.y, parts: Object.assign({}, parts), anim: (o) => animatePlane(groups, o) };
}
function disposePlane(pl) {
  pl.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
}

// o = { t, thrust, reserveOn, hl (part id to highlight), frozen (paused: no flicker) }
const HL_COL = new THREE.Color(1, 0.94, 0.62);
function animatePlane(g, o) {
  const t = o.t || 0;
  const e = g.engine.userData;
  if (e.prop) {
    e.prop.rotation.x = o.thrust ? t * 30 : 0.6;
    e.blur.visible = !!o.thrust; e.blades.transparent = !!o.thrust; e.blades.opacity = o.thrust ? 0.55 : 1;
  }
  if (e.flames) {
    const s = e.stage, fc = o.reserveOn ? ['#e8fdff', '#57d8ff'] : s === 10 ? ['#ffe6ff', '#b44dff'] : s === 9 ? ['#e6f4ff', '#4d8dff'] : s >= 7 ? ['#fff8e0', '#ff9a2e'] : ['#fff3a0', '#ff7b1c'];
    for (const f of e.flames) {
      f.visible = !!o.thrust;
      if (!o.thrust) continue;
      if (!o.frozen) { const k = 0.8 + Math.random() * 0.4; f.scale.set(k, 1, 1); }
      f.material.uniforms.uA.value.set(fc[0]); f.material.uniforms.uB.value.set(fc[1]);
    }
    if (e.ab) for (const a of e.ab) a.visible = !!o.thrust;
  }
  if (e.core) { const k = 1 + Math.sin(t * 8) * 0.1; e.core.scale.setScalar(k); e.halo.scale.setScalar(k); }
  const f = g.frame.userData;
  if (f.lights) f.lights.lights.forEach((l, i) => { l.material = Math.floor(t * 6 + i) % 3 === 0 ? f.lights.on : f.lights.off; });
  if (f.under) f.under.material.opacity = 0.28 + 0.1 * Math.sin(t * 3);
  const n = g.nose.userData; if (n.shield) n.shield.material.opacity = 0.22 + 0.12 * Math.sin(t * 6);
  const m = g.magnet.userData;
  if (m.g) {
    const gg = m.g.userData;
    if (gg.pulse) gg.pulse.material.emissiveIntensity = 1.6 + 0.8 * Math.sin(t * 6);
    if (gg.wobble) gg.wobble.scale.set(1, 1, 1 + 0.35 * Math.sin(t * 3));
    if (gg.spin) gg.spin.rotation.y = t * 2;
    const sp = m.sparkles; sp.sp.forEach((s, i) => { const a = t * 2 + i * 2.1; s.position.set(sp.x + Math.cos(a) * 11 * sp.sz, sp.y + Math.sin(a * 1.3) * 3, Math.sin(a) * 11 * sp.sz); s.material.emissiveIntensity = 1.2 + 0.7 * Math.sin(t * 5 + i); });
  }
  const fu = g.fuel.userData; if (fu.glows) fu.glows.forEach(x => { x.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 4); });
  const r = g.reserve.userData; if (r.mats) r.mats.forEach(x => { x.emissiveIntensity = o.reserveOn ? 1.2 : 0; });
  // highlight the selected part: a warm pulsing glow
  for (const id of PART_ORDER) {
    const on = o.hl === id, k = on ? 0.28 + 0.16 * Math.sin(t * 5) : 0;
    g[id].traverse(obj => {
      const mt = obj.material; if (!mt || !mt.userData || !mt.userData.baseEmissive) return;
      if (on) { mt.emissive.copy(mt.userData.baseEmissive).lerp(HL_COL, clamp(k * 2.4, 0, 1)); mt.emissiveIntensity = Math.max(mt.userData.baseEI, k * 2.2); }
      else if (mt.userData.hl) { mt.emissive.copy(mt.userData.baseEmissive); mt.emissiveIntensity = mt.userData.baseEI; }
      mt.userData.hl = on;
    });
  }
  // the reserve glow and magnet pulses above are set every frame; the highlight wins while selected
}
