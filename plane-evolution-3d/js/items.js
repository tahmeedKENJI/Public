'use strict';
/* ==========================================================================
   World items (instanced), particles, distance signposts, the BEST flag,
   the launch ramp and the plane's blob shadow.
   ========================================================================== */

// Item radius in metres. The 2D game draws items at clamp(camZ*1.6*scale, 7, 14) px; with the
// 2D zoom camZ = 1152 / Vw on a typical screen this is the same size in world units.
const itemSize = (scale, Vw) => clamp(1.6 * scale, 7 * Vw / 1152, 14 * Vw / 1152);

class Items {
  constructor(scene) {
    this.scene = scene;
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; scene.add(m); return m; };
    const coinGeo = new THREE.CylinderGeometry(1, 1, 0.2, 24); coinGeo.rotateX(Math.PI / 2);
    this.coin = inst(coinGeo, new THREE.MeshStandardMaterial({ color: '#ffcf3d', metalness: 0.35, roughness: 0.3, emissive: '#8a5c00', emissiveIntensity: 0.55 }), 2000);
    const rimGeo = new THREE.TorusGeometry(0.93, 0.1, 6, 24);
    this.coinRim = inst(rimGeo, new THREE.MeshStandardMaterial({ color: '#d99a10', metalness: 0.4, roughness: 0.35, emissive: '#5a3a00', emissiveIntensity: 0.5 }), 2000);
    const ringGeo = new THREE.TorusGeometry(1, 0.075, 8, 40); ringGeo.rotateY(Math.PI / 2);
    this.ring = inst(ringGeo, new THREE.MeshBasicMaterial({ color: '#3ff0ff' }), 300);
    const haloGeo = new THREE.TorusGeometry(1, 0.2, 8, 40); haloGeo.rotateY(Math.PI / 2);
    this.ringHalo = inst(haloGeo, new THREE.MeshBasicMaterial({ color: '#3ff0ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 300);
    this.fuel = inst(mergeParts([
      { g: new THREE.BoxGeometry(1.6, 2, 1.1), c: '#e8402f' }, { g: new THREE.BoxGeometry(1.64, 0.42, 1.14), c: '#ffffff' },
      { g: new THREE.CylinderGeometry(0.3, 0.3, 0.45, 10), c: '#333333', m: M(-0.3, 1.2, 0) }, { g: new THREE.BoxGeometry(0.9, 0.18, 0.18), c: '#333333', m: M(0.2, 1.08, 0) }]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), 300);
    this.birdBody = inst(mergeParts([
      { g: new THREE.SphereGeometry(0.5, 10, 8), c: '#2a2a2a', m: M(0, 0, 0, 0, 0, 0, 1.4, 0.55, 0.55) },
      { g: new THREE.SphereGeometry(0.28, 8, 6), c: '#2f2f2f', m: M(-0.75, 0.12, 0) },
      { g: new THREE.ConeGeometry(0.1, 0.35, 6), c: '#f5a623', m: M(-1.08, 0.1, 0, 0, 0, Math.PI / 2) },
      { g: new THREE.ConeGeometry(0.28, 0.6, 4), c: '#222222', m: M(0.85, 0, 0, 0, 0, -Math.PI / 2, 1, 1, 0.3) }]),
      new THREE.MeshLambertMaterial({ vertexColors: true }), 300);
    const wing = new THREE.Shape(); wing.moveTo(-0.35, 0); wing.lineTo(0.35, 0); wing.lineTo(0.15, 1.3); wing.lineTo(-0.2, 1.2); wing.closePath();
    const wg = new THREE.ShapeGeometry(wing); wg.rotateX(Math.PI / 2);
    const wingMat = new THREE.MeshLambertMaterial({ color: '#333333', side: THREE.DoubleSide });
    this.wingL = inst(wg, wingMat, 300); this.wingR = inst(wg, wingMat, 300);
    this.balloon = inst(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05 }), 300);
    this.balloonKnot = inst(new THREE.ConeGeometry(0.16, 0.3, 8), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 300);
    const str = new THREE.CylinderGeometry(0.02, 0.02, 1, 4); str.translate(0, -0.5, 0);
    this.string = inst(str, new THREE.MeshBasicMaterial({ color: '#555555' }), 300);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
  }
  hide() { for (const k of ['coin', 'coinRim', 'ring', 'ringHalo', 'fuel', 'birdBody', 'wingL', 'wingR', 'balloon', 'balloonKnot', 'string']) this[k].count = 0; }
  // Draw every untaken item with x in [x0, x1].
  update(world, taken, x0, x1, Vw, time) {
    const n = { coin: 0, ring: 0, fuel: 0, bird: 0, balloon: 0 }, sc = world.scale, s = itemSize(sc, Vw);
    const { m, q, e, p, s: S, c } = this;
    const put = (im, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) => { im.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), S.set(sx, sy, sz))); };
    for (let i = Math.max(0, Math.floor(x0 / world.CH)); i <= Math.floor(x1 / world.CH); i++) {
      const items = world.chunk(i);
      for (let j = 0; j < items.length; j++) {
        if (taken.has(i * 64 + j)) continue;
        const it = items[j];
        if (it.k === 'coin' && n.coin < 2000) { const a = time * 4 + it.x * 0.1; put(this.coin, n.coin, it.x, it.y, 0, 0, a, 0, s); put(this.coinRim, n.coin, it.x, it.y, 0, 0, a, 0, s); n.coin++; }
        else if (it.k === 'ring' && n.ring < 300) { put(this.ring, n.ring, it.x, it.y, 0, 0, 0, 0, s * 3); put(this.ringHalo, n.ring, it.x, it.y, 0, time * 2, 0, 0, s * 3); n.ring++; }
        else if (it.k === 'fuel' && n.fuel < 300) { put(this.fuel, n.fuel, it.x, it.y, 0, 0, time * 1.5 + it.x, Math.sin(time * 2 + it.x) * 0.15, s * 0.9); n.fuel++; }
        else if (it.k === 'bird' && n.bird < 300) {
          const f = Math.sin(time * 14 + it.ph) * 0.8, bs = s * 1.2, bob = Math.sin(time * 3 + it.ph) * s * 0.2;
          put(this.birdBody, n.bird, it.x, it.y + bob, 0, 0, 0, 0, bs);
          put(this.wingL, n.bird, it.x, it.y + bob, 0.2 * bs, f, 0, 0, bs); put(this.wingR, n.bird, it.x, it.y + bob, -0.2 * bs, Math.PI - f, 0, 0, bs); n.bird++;
        } else if (it.k === 'balloon' && n.balloon < 300) {
          const bob = Math.sin(time * 2 + it.ph) * s * 0.25, y = it.y + bob;
          put(this.balloon, n.balloon, it.x, y, 0, 0, 0, Math.sin(time + it.ph) * 0.08, s * 0.9, s * 1.15, s * 0.9);
          put(this.balloonKnot, n.balloon, it.x, y - s * 1.18, 0, Math.PI, 0, 0, s);
          put(this.string, n.balloon, it.x, y - s * 1.2, 0, 0, 0, Math.sin(time * 1.3 + it.ph) * 0.1, s, s * 1.8, s);
          c.setHSL(it.hue, 0.8, 0.62, THREE.SRGBColorSpace); this.balloon.setColorAt(n.balloon, c); this.balloonKnot.setColorAt(n.balloon, c);
          n.balloon++;
        }
      }
    }
    const set = (im, k) => { im.count = k; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; };
    set(this.coin, n.coin); set(this.coinRim, n.coin); set(this.ring, n.ring); set(this.ringHalo, n.ring); set(this.fuel, n.fuel);
    set(this.birdBody, n.bird); set(this.wingL, n.bird); set(this.wingR, n.bird); set(this.balloon, n.balloon); set(this.balloonKnot, n.balloon); set(this.string, n.balloon);
  }
}

/* ---------- particles: coin sparkles, dust, feathers, exhaust ---------- */
const PART_VERT = `attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vCol;
void main() { vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx / max(0.5, -mv.z); }`;
const PART_FRAG = `varying vec4 vCol; void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vCol.rgb, vCol.a * smoothstep(0.5, 0.2, r)); }`;
class Particles {
  constructor(scene, shared) {
    this.max = 400; this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(this.max * 3), 3); this.col = new THREE.BufferAttribute(new Float32Array(this.max * 4), 4); this.size = new THREE.BufferAttribute(new Float32Array(this.max), 1);
    [this.pos, this.col, this.size].forEach(a => a.setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('position', this.pos); g.setAttribute('aCol', this.col); g.setAttribute('aSize', this.size);
    this.u = { uPx: { value: 500 } };
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PART_VERT, fragmentShader: PART_FRAG, transparent: true, depthWrite: false }));
    this.pts.frustumCulled = false; this.pts.renderOrder = 4; scene.add(this.pts); this.shared = shared; this.c = new THREE.Color();
  }
  // p = { x, y, z, vx, vy, vz, life, c: '#hex' | css rgba string, a, r (radius, m), grow }
  add(p) { if (this.list.length >= this.max) this.list.shift(); p.z = p.z || 0; p.vz = p.vz || 0; if (p.a === undefined) p.a = 1; this.list.push(p); }
  clear() { this.list.length = 0; }
  update(dt) {
    for (const p of this.list) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 9.8 * dt * 0.3; p.life -= dt * 1.2; }
    this.list = this.list.filter(p => p.life > 0);
    this.u.uPx.value = this.shared.px;
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const p = this.list[i]; this.pos.setXYZ(i, p.x, p.y, p.z);
      this.c.set(p.c); this.col.setXYZW(i, this.c.r, this.c.g, this.c.b, clamp(p.life, 0, 1) * p.a);
      this.size.setX(i, p.r * 2 * (p.grow ? 2 - p.life : 1));
    }
    this.pts.geometry.setDrawRange(0, n);
    this.pos.needsUpdate = this.col.needsUpdate = this.size.needsUpdate = true;
  }
}

/* ---------- labels, signposts, BEST flag ---------- */
const LABELS = new Map();
function labelTexture(text, o = {}) {
  const key = text + '|' + (o.bg || '') + (o.fg || '');
  if (LABELS.has(key)) return LABELS.get(key);
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 44;
  g.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = 72;
  g.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = o.bg || 'rgba(20,24,34,.72)'; const r = 14;
  g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, 72, r); g.arcTo(w, 72, 0, 72, r); g.arcTo(0, 72, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
  g.fillStyle = o.fg || '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 38);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData = { aspect: w / 72 };
  if (LABELS.size > 80) { const [k0, t0] = LABELS.entries().next().value; t0.dispose(); LABELS.delete(k0); }
  LABELS.set(key, t); return t;
}

class Signs {
  constructor(scene) {
    this.pool = [];
    const postMat = new THREE.MeshLambertMaterial({ color: '#f4f4f4' }), postGeo = new THREE.BoxGeometry(1, 1, 1); postGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 24; i++) {
      const g = new THREE.Group(), post = new THREE.Mesh(postGeo, postMat); post.castShadow = true;
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); lab.center.set(0.5, 0);
      g.add(post); g.add(lab); g.visible = false; scene.add(g); this.pool.push({ g, post, lab, text: '' });
    }
    // BEST flag
    this.best = new THREE.Group();
    const pole = new THREE.Mesh(postGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' })); pole.castShadow = true;
    const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(1, -0.28); fs.lineTo(0, -0.56); fs.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(fs), new THREE.MeshLambertMaterial({ color: '#ffc233', side: THREE.DoubleSide, emissive: '#5a3a00' }));
    const blab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('BEST', { bg: '#ffc233', fg: '#4a2a00' }), transparent: true, depthWrite: false })); blab.center.set(0.5, 0);
    this.best.add(pole); this.best.add(flag); this.best.add(blab); this.best.visible = false; scene.add(this.best);
    Object.assign(this, { pole, flag, blab });
  }
  // Markers every "nice" distance, spaced like the 2D game's (at least 140 px apart on screen).
  update(x0, x1, Vw, best, time, markers = true) {
    let step = 10; for (const n of [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]) { step = n; if (n * 1152 / Vw >= 140) break; }
    const H = Vw * 0.07, zOff = -(3 + Vw * 0.05); let k = 0;
    for (let m = Math.max(1, Math.ceil(x0 / step)) * step; markers && m <= x1 && k < this.pool.length; m += step) {
      const s = this.pool[k++], text = fmtDist(m);
      s.g.visible = true; s.g.position.set(m, 0, zOff);
      s.post.scale.set(H * 0.035, H, H * 0.035);
      if (s.text !== text) { s.text = text; s.lab.material.map = labelTexture(text); s.lab.material.needsUpdate = true; }
      const lh = H * 0.28; s.lab.scale.set(lh * s.lab.material.map.userData.aspect, lh, 1); s.lab.position.y = H * 1.02;
    }
    for (; k < this.pool.length; k++) this.pool[k].g.visible = false;
    const show = best > 0 && best >= x0 && best <= x1;
    this.best.visible = show;
    if (show) {
      const BH = H * 2.4; this.best.position.set(best, 0, zOff);
      this.pole.scale.set(BH * 0.025, BH, BH * 0.025);
      this.flag.scale.set(BH * 0.5, BH * 0.5, 1); this.flag.position.set(0, BH, 0); this.flag.rotation.y = Math.sin(time * 2) * 0.25;
      const lh = BH * 0.14; this.blab.scale.set(lh * this.blab.material.map.userData.aspect, lh, 1); this.blab.position.set(BH * 0.18, BH * 1.04, 0);
    }
  }
}

function buildRamp() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: '#b77b47', roughness: 0.85 }), dark = new THREE.MeshStandardMaterial({ color: '#6b4526', roughness: 0.9 });
  const L = Math.hypot(9, 2.2), deck = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, 3.2), wood);
  deck.position.set(-3.5, 1.1 - 0.1, 0); deck.rotation.z = Math.atan2(2.2, 9); deck.castShadow = deck.receiveShadow = true; g.add(deck);
  for (let i = 0; i < 9; i++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.37, 3.22), dark); plank.position.set(-8 + i * 1.05 + 0.5, 0.1 + (i * 1.05 + 0.5) * 2.2 / 9 - 0.1, 0); plank.rotation.z = deck.rotation.z; g.add(plank); }
  for (let i = 1; i <= 3; i++) for (const z of [-1.3, 1.3]) {
    const x = -8 + i * 2.2 + 0.4, h = (x + 8) / 9 * 2.2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), dark); leg.position.set(x, h / 2, z); leg.castShadow = true; g.add(leg);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 0.12), dark);
  for (const z of [-1.55, 1.55]) { const r = rail.clone(); r.position.set(-3.5, 1.35, z); r.rotation.z = deck.rotation.z; g.add(r); }
  return g;
}

function makeBlobShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m;
}
