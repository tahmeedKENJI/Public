'use strict';
/* ==========================================================================
   Sky and atmosphere: sky dome with sun/moon, stars and shooting stars, the
   ringed planet, aurora, billboard clouds and 3D weather particles.
   Colours come from the 2D BIOMES table and blend exactly as in the 2D envAt.
   ========================================================================== */

// Per-terrain light (3D only): sun colour/intensity, sky-fill colours, sun elevation, haze.
const LIGHT3D = {
  meadow:  { sun: '#fff1d6', sunI: 2.3, sky: '#bcdcff', gnd: '#5a7a3a', hemI: 1.0, elev: 0.62, haze: 1.0 },
  farm:    { sun: '#e6ebf0', sunI: 0.9, sky: '#c9d1db', gnd: '#6a6a48', hemI: 1.6, elev: 0.9, haze: 0.5 },
  desert:  { sun: '#ffe0ae', sunI: 2.6, sky: '#ffd6a0', gnd: '#b08850', hemI: 0.9, elev: 0.42, haze: 0.95 },
  tundra:  { sun: '#c4d4ff', sunI: 1.5, sky: '#7890cc', gnd: '#a0acc8', hemI: 1.3, elev: 0.5, haze: 0.9 },
  volcano: { sun: '#ff8a50', sunI: 1.4, sky: '#9a3a20', gnd: '#3a1a10', hemI: 0.95, elev: 0.3, haze: 0.55 },
  alien:   { sun: '#c8a8ff', sunI: 1.1, sky: '#6a48b0', gnd: '#3a2870', hemI: 1.05, elev: 0.45, haze: 0.8 },
};
const WEATHER_DENSITY = { clear: 0.12, rain: 0.95, dust: 0.55, snow: 0.8, ash: 0.7, spores: 0.35 };
const lin = (c, out = new THREE.Color()) => out.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

const SKY_VERT = `varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = `uniform vec3 uTop, uBot, uHor, uSunDir, uSunCol, uMoonDir, uMoonCol; uniform float uSunVis, uSunSize, uMoonVis, uMoonSize, uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float h = d.y;
  vec3 c = mix(uHor, uBot, smoothstep(-0.02, 0.14, h));
  c = mix(c, uTop, smoothstep(0.1, 0.75, h));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * uSunVis * (pow(sd, 8.0) * 0.18 * uHaze + pow(sd, 60.0) * 0.45 + smoothstep(cos(uSunSize), cos(uSunSize * 0.82), sd) * 3.0);
  float md = dot(d, uMoonDir);
  vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 d2 = normalize(uMoonDir + side * uMoonSize * 0.55 + vec3(0.0, uMoonSize * 0.35, 0.0));
  float disc = smoothstep(cos(uMoonSize), cos(uMoonSize * 0.9), md), cut = smoothstep(cos(uMoonSize * 0.86), cos(uMoonSize * 0.76), dot(d, d2));
  c = mix(c, uMoonCol * 1.4, disc * (1.0 - cut) * uMoonVis);
  c += uMoonCol * uMoonVis * pow(max(md, 0.0), 300.0) * 0.25;
  if (h < 0.0) c = mix(c, uHor * 0.85, smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = `attribute vec3 aCol; attribute float aSize, aPh; uniform float uTime, uA, uPx; varying vec3 vCol; varying float vA;
void main() { vCol = aCol; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = (projectionMatrix * p).xyww;
  float up = normalize(position).y; vA = uA * (0.55 + 0.45 * sin(uTime * 1.8 + aPh)) * smoothstep(-0.05, 0.12, up);
  gl_PointSize = aSize * uPx; }`;
const STAR_FRAG = `varying vec3 vCol; varying float vA;
void main() { vec2 q = gl_PointCoord - 0.5; float r = length(q); float a = smoothstep(0.5, 0.0, r); a += 0.35 * smoothstep(0.08, 0.0, min(abs(q.x), abs(q.y))) * smoothstep(0.5, 0.1, r);
  gl_FragColor = vec4(vCol * vA * a, 1.0); }`;

const AURORA_VERT = `uniform float uTime; varying vec2 vUv; varying float vW;
void main() { vUv = uv; vec3 p = position; float w = sin(uv.x * 18.0 + uTime * 0.35) * 0.5 + sin(uv.x * 47.0 - uTime * 0.5) * 0.2; vW = w;
  p.y += w * 0.05 * length(p.xz) * (1.0 - uv.y * 0.3); gl_Position = (projectionMatrix * modelViewMatrix * vec4(p, 1.0)).xyww; }`;
const AURORA_FRAG = `uniform vec3 uCol; uniform float uA; varying vec2 vUv; varying float vW;
void main() { float a = smoothstep(0.0, 0.25, vUv.y) * pow(1.0 - vUv.y, 1.5) * (0.65 + 0.35 * vW) * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  gl_FragColor = vec4(uCol * a * uA, 1.0); }`;

const CLOUD_VERT = `attribute vec3 iPos; attribute float iSize, iAlpha; uniform float uFade; varying vec2 vUv; varying float vA; varying float vDist;
void main() { vUv = uv; vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = iPos + (r * position.x + u * position.y) * iSize; vDist = distance(w, cameraPosition);
  vA = iAlpha * (1.0 - smoothstep(uFade * 0.6, uFade, vDist)) * smoothstep(iSize * 0.35, iSize * 1.3, vDist);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`;
const CLOUD_FRAG = `uniform sampler2D uTex; uniform vec3 uCol, uFogCol; uniform float uFogNear, uFogFar; varying vec2 vUv; varying float vA; varying float vDist;
void main() { float t = texture2D(uTex, vUv).a; vec3 c = uCol * mix(0.68, 1.06, smoothstep(0.15, 0.85, vUv.y));
  c = mix(c, uFogCol, smoothstep(uFogNear, uFogFar, vDist) * 0.85);
  gl_FragColor = vec4(c, t * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WX_VERT = `attribute vec4 aSeed; attribute float aEnd; uniform vec3 uCenter, uOff, uOff2, uStreak; uniform float uBox, uTime, uSize, uPx, uKind;
varying float vSeed; varying float vEnd;
void main() { vSeed = aSeed.w; vEnd = aEnd;
  vec3 wob = vec3(0.0);
  if (uKind == 1.0) wob = vec3(sin(uTime * 1.5 + aSeed.w * 9.0), 0.0, cos(uTime * 1.1 + aSeed.w * 7.0)) * uBox * 0.02;
  if (uKind == 4.0 || uKind == 0.0) wob = vec3(sin(uTime + aSeed.w * 7.0), sin(uTime * 0.7 + aSeed.w * 3.0) * 0.5, cos(uTime * 0.8 + aSeed.w * 5.0)) * uBox * 0.02;
  vec3 off = (uKind == 3.0 && aSeed.w < 0.25) ? uOff2 : uOff; // embers rise while ash falls
  vec3 local = mod(aSeed.xyz * uBox + off, uBox) - uBox * 0.5;
  vec3 w = uCenter + local + wob - uStreak * aEnd;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + 0.8 * fract(aSeed.w * 7.3)) * uPx / max(1.0, -mv.z);
}`;
const WX_FRAG = `uniform vec3 uColA, uColB; uniform float uA, uKind, uTime, uLine; varying float vSeed; varying float vEnd;
void main() {
  float a = uA; vec3 c = uColA;
  if (uLine < 0.5) { vec2 q = gl_PointCoord - 0.5; a *= smoothstep(0.5, 0.15, length(q)); }
  else a *= 1.0 - vEnd * 0.9;
  if (uKind == 3.0 && vSeed < 0.25) { c = uColB; a *= 0.6 + 0.4 * sin(uTime * 8.0 + vSeed * 50.0); }
  if (uKind == 4.0 && vSeed < 0.5) c = uColB;
  gl_FragColor = vec4(c, a);
}`;
const WX_KIND = { clear: 0, snow: 1, dust: 2, ash: 3, spores: 4, rain: 5 };

class Sky {
  constructor(scene, shared) {
    this.scene = scene; this.shared = shared;
    const u = this.u = {
      uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0.5, 0.5, -0.6).normalize() }, uSunCol: { value: new THREE.Color() }, uSunVis: { value: 1 }, uSunSize: { value: 0.03 },
      uMoonDir: { value: new THREE.Vector3(0.6, 0.45, -0.5).normalize() }, uMoonCol: { value: new THREE.Color('#eef3ff') }, uMoonVis: { value: 0 }, uMoonSize: { value: 0.03 }, uHaze: { value: 1 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.frustumCulled = false; this.dome.renderOrder = -10; scene.add(this.dome);

    // stars: varied colours and sizes, twinkling
    const N = 1600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const y = hash(i * 3 + 1) * 1.1 - 0.1, a = hash(i * 3 + 2) * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      const k = hash(i * 13 + 1), c = k < 0.14 ? [1, 0.84, 0.67] : k < 0.3 ? [0.7, 0.8, 1] : k < 0.34 ? [1, 0.6, 0.55] : [1, 1, 1];
      col.set(c, i * 3); size[i] = 1 + Math.pow(hash(i * 7 + 5), 4) * 4.5; ph[i] = hash(i * 11 + 3) * 6.28;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); sg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.starU = { uTime: shared.time, uA: { value: 0 }, uPx: { value: 1 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9; scene.add(this.stars);

    // shooting star
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0, 0, 0]), 3));
    this.shoot = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    this.shoot.frustumCulled = false; this.shoot.visible = false; this.shoot.renderOrder = -8; scene.add(this.shoot); this.shooting = null;

    // aurora ribbons
    this.aurora = [];
    for (let r = 0; r < 3; r++) {
      const g = new THREE.PlaneGeometry(1, 1, 96, 1), p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const t = uv.getX(i), v = uv.getY(i), a = (-0.45 + t * 1.1) * Math.PI + r * 0.25, R = 0.75 - r * 0.05;
        p.setXYZ(i, Math.cos(a) * R, 0.16 + r * 0.06 + v * 0.26, Math.sin(a) * R * 0.8 - 0.25);
      }
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uTime: shared.time, uCol: { value: new THREE.Color(r === 1 ? '#7aa0ff' : '#5affaa') }, uA: { value: 0 } },
        vertexShader: AURORA_VERT, fragmentShader: AURORA_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false }));
      m.frustumCulled = false; m.renderOrder = -7; m.visible = false; scene.add(m); this.aurora.push(m);
    }

    // ringed planet and its small moon
    this.planet = new THREE.Sprite(new THREE.SpriteMaterial({ map: makePlanetTexture(), transparent: true, depthWrite: false, fog: false }));
    this.planet.renderOrder = -6; this.planet.visible = false; scene.add(this.planet);
    this.moonlet = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeMoonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moonlet.renderOrder = -6; this.moonlet.visible = false; scene.add(this.moonlet);
    
    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.position.set(1, 1, 1); scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(this.hemi);
    this.fog = new THREE.Fog(0xffffff, 100, 5000); scene.fog = this.fog;
    this.flash = 0;

    this.clouds = new Clouds(scene, shared);
    this.weather = Object.keys(WX_KIND).map(k => new Weather(scene, k, shared));
    this.tmp = { a: new THREE.Color(), b: new THREE.Color() };
    this.fwd = new THREE.Vector3(1, 0, 0); this.tmpV = new THREE.Vector3(); this.tmpR = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0); this.planetDir = new THREE.Vector3(); this.moonletDir = new THREE.Vector3(); this.fwdInit = false;
  }
  // e = envAt(x), alt = camera altitude, dt, cam = camera; opts = { weather, wxQ, scale, dist }
  update(e, alt, dt, cam, o) {
    const u = this.u, k = clamp((alt - 600) / 9000, 0, 1); // altitude: fade toward space
    const top = mixA(envMix(e, 'skyTop'), [2, 4, 15], k), bot = mixA(envMix(e, 'skyBot'), [26, 35, 80], k * 0.9);
    lin(top, u.uTop.value); lin(bot, u.uBot.value);
    const la = LIGHT3D[e.a.key], lb = LIGHT3D[e.b.key], t = e.t, L = (key) => lerp(la[key], lb[key], t);
    const LC = (key) => mixA(rgb(la[key]), rgb(lb[key]), t);
    const hor = mixA(bot, [255, 255, 255], 0.08 * (1 - k));
    lin(hor, u.uHor.value);
    // sun, moon, planet
    // The key light comes from behind and to the right of the camera, so what you look at is lit;
    // the visible sun disc sits top-right of the view, like the 2D sun. Both follow the camera's
    // heading smoothly.
    const f = this.fwd; cam.getWorldDirection(this.tmpV); this.tmpV.y = 0; if (this.tmpV.lengthSq() < 1e-6) this.tmpV.set(1, 0, 0);
    this.tmpV.normalize(); f.lerp(this.tmpV, dt > 0 ? 1 - Math.exp(-dt * 2) : 0).normalize(); if (!this.fwdInit) { f.copy(this.tmpV); this.fwdInit = true; }
    const right = this.tmpR.crossVectors(f, this.up).normalize(), elev = L('elev');
    this.lightDir.copy(f).multiplyScalar(-0.35).addScaledVector(right, 0.6).addScaledVector(this.up, Math.tan(elev * 0.9) * 0.9).normalize();
    const sd = u.uSunDir.value.copy(f).multiplyScalar(0.85).addScaledVector(right, 0.5).addScaledVector(this.up, 0.3 + elev * 0.25).normalize();
    u.uMoonDir.value.copy(f).multiplyScalar(0.85).addScaledVector(right, 0.42).addScaledVector(this.up, 0.42).normalize();
    this.planetDir.copy(f).multiplyScalar(0.9).addScaledVector(right, 0.3).addScaledVector(this.up, 0.3).normalize();
    this.moonletDir.copy(f).multiplyScalar(0.9).addScaledVector(right, -0.45).addScaledVector(this.up, 0.45).normalize();
    const sunA = (e.a.sun ? 1 - t : 0) + (e.b !== e.a && e.b.sun ? t : 0), sunC = e.t < 0.5 ? (e.a.sun || e.b.sun) : (e.b.sun || e.a.sun);
    u.uSunVis.value = sunA; if (sunC) { lin(rgb(sunC.c), u.uSunCol.value); u.uSunSize.value = 0.012 + sunC.r * 0.0005; }
    const moonA = (e.a.moon ? 1 - t : 0) + (e.b !== e.a && e.b.moon ? t : 0); u.uMoonVis.value = moonA;
    u.uHaze.value = L('haze');
    this.dome.position.copy(cam.position); this.dome.scale.setScalar(cam.far * 0.9);
    this.stars.position.copy(cam.position); this.stars.scale.setScalar(cam.far * 0.85);
    const starA = clamp(Math.max(envNum(e, 'stars'), k * 1.3), 0, 1);
    this.starU.uA.value = starA; this.starU.uPx.value = Math.min(2, this.shared.dpr);
    this.stars.visible = starA > 0.01;
    this.updateShooting(starA, dt, cam);
    const aur = envFlag(e, 'aurora') * (1 - k * 0.5);
    this.aurora.forEach(m => { m.visible = aur > 0.02; m.material.uniforms.uA.value = 0.55 * aur; m.position.copy(cam.position); m.scale.setScalar(cam.far * 0.8); });
    const pl = envFlag(e, 'planet');
    for (const [s, d, size] of [[this.planet, this.planetDir, 0.34], [this.moonlet, this.moonletDir, 0.05]]) {
      s.visible = pl > 0.02; if (!s.visible) continue;
      s.material.opacity = pl; const R = cam.far * 0.8;
      s.position.copy(cam.position).addScaledVector(d, R); s.scale.set(R * size, R * size, 1);
    }
    // lights
    const shadowHaze = this.flash > 0 ? 1 + this.flash * 3 : 1;
    lin(LC('sun'), this.sun.color); this.sun.intensity = L('sunI') * (0.35 + 0.65 * Math.max(sunA, moonA, pl, 0.4)) * shadowHaze;
    lin(LC('sky'), this.hemi.color); lin(LC('gnd'), this.hemi.groundColor); this.hemi.intensity = L('hemI') * shadowHaze;
    // fog: thinner with altitude, thicker in rain and ash
    const haze = L('haze'), far = (5500 + alt * 4 + o.dist * 22) * haze * (1 + k * 3);
    lin(hor, this.fog.color); this.fog.near = far * 0.06; this.fog.far = far;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.clouds.update(e, cam, o, this.fog);
    this.updateWeather(e, alt, dt, cam, o);
  }
  updateShooting(starA, dt, cam) {
    if (!this.shooting && starA > 0.4 && Math.random() < dt * 0.25) {
      const a = Math.random() * Math.PI * 2, y = 0.3 + Math.random() * 0.4;
      this.shooting = { d: new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize(), m: new THREE.Vector3(Math.random() - 0.5, -0.3, Math.random() - 0.5).normalize(), life: 1 };
    }
    const s = this.shooting; this.shoot.visible = !!s;
    if (!s) return;
    s.life -= dt * 1.5; const l = 1 - s.life, R = cam.far * 0.8;
    const head = s.d.clone().addScaledVector(s.m, l * 0.35).normalize().multiplyScalar(R).add(cam.position);
    const tail = s.d.clone().addScaledVector(s.m, l * 0.35 - 0.12).normalize().multiplyScalar(R).add(cam.position);
    const p = this.shoot.geometry.attributes.position; p.setXYZ(0, head.x, head.y, head.z); p.setXYZ(1, tail.x, tail.y, tail.z); p.needsUpdate = true;
    const c = this.shoot.geometry.attributes.color, a = starA * Math.max(0, s.life); c.setXYZ(0, a, a, a); c.needsUpdate = true;
    if (s.life <= 0) this.shooting = null;
  }
  updateWeather(e, alt, dt, cam, o) {
    const scale = Math.min(o.scale, 8), fade = clamp(1 - (alt - 250 * scale) / (500 * scale), 0, 1);
    for (const w of this.weather) {
      let dens = 0;
      if (o.weather && fade > 0) { if (e.a.weather === w.kind) dens += 1 - e.t; if (e.b.weather === w.kind && e.b !== e.a) dens += e.t; }
      w.update(dens * WEATHER_DENSITY[w.kind] * fade * o.wxQ, cam, o.dist, dt);
    }
  }
}

class Clouds {
  constructor(scene, shared) {
    this.max = 500;
    const g = new THREE.InstancedBufferGeometry(); const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(1500 * 3), 3); this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(1500), 1); this.iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(1500), 1);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iSize', this.iSize); g.setAttribute('iAlpha', this.iAlpha); g.instanceCount = 0;
    this.u = { uTex: { value: makePuffTexture() }, uCol: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() }, uFogNear: { value: 0 }, uFogFar: { value: 1 }, uFade: { value: 3000 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh); this.key = '';
  }
  update(e, cam, o, fog) {
    const cover = envNum(e, 'cover'), s = Math.max(1, o.scale), cs = 160 * s, vs = 120 * s, Rc = Math.max(2200, o.dist * 16) * Math.min(1.6, s ** 0.3);
    const col = envMix(e, 'cloud'); lin(col, this.u.uCol.value); this.u.uFogCol.value.copy(fog.color); this.u.uFogNear.value = fog.near; this.u.uFogFar.value = fog.far * 1.2;
    this.u.uFade.value = Rc;
    const p = cam.position, key = [Math.floor(p.x / cs), Math.floor(p.y / vs), Math.floor(p.z / cs), Math.round(cover * 20), Math.round(Rc / 400), this.max].join(',');
    if (key === this.key) return; this.key = key;
    const cells = [];
    const x0 = Math.floor((p.x - Rc * 0.4) / cs), x1 = Math.floor((p.x + Rc) / cs), z0 = Math.floor((p.z - Rc * 0.7) / cs), z1 = Math.floor((p.z + Rc * 0.7) / cs);
    const y0 = Math.max(1, Math.floor((p.y - Rc * 0.35) / vs)), y1 = Math.min(40, Math.ceil((p.y + Rc * 0.35) / vs));
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) for (let cy = y0; cy <= y1; cy++) {
      const h = hash((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) | 0);
      if (h > cover * 0.55) continue;
      const wx = (cx + hash(cx * 31 + cy + cz * 7)) * cs, wy = (cy + hash(cy * 17 + cx)) * vs, wz = (cz + hash(cz * 13 + cx * 3)) * cs;
      if (Math.abs(wz) < cs * 0.5 && Math.abs(wy - p.y) < vs) continue; // don't park a cloud right on the flight line at the camera's height
      cells.push({ x: wx, y: wy, z: wz, h, d: Math.hypot(wx - p.x, wy - p.y, wz - p.z) });
    }
    cells.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const c of cells) {
      const puffs = 5 + Math.floor(c.h * 40) % 4, S = 30 * s * (0.8 + c.h * 3);
      if (n + puffs > this.max) break;
      for (let k = 0; k < puffs; k++) {
        const a = k / puffs * Math.PI * 2 + c.h * 9;
        this.iPos.setXYZ(n, c.x + Math.cos(a) * S * 1.1 * (k ? 1 : 0), c.y + Math.sin(a * 1.7) * S * 0.18 + (k ? 0 : S * 0.2), c.z + Math.sin(a) * S * 0.9 * (k ? 1 : 0));
        this.iSize.setX(n, S * (k ? 1.6 + hash(n + 5) * 0.8 : 2.6)); this.iAlpha.setX(n, 0.85); n++;
      }
    }
    this.mesh.geometry.instanceCount = n;
    this.iPos.needsUpdate = this.iSize.needsUpdate = this.iAlpha.needsUpdate = true;
  }
}

class Weather {
  constructor(scene, kind, shared) {
    this.kind = kind; const line = kind === 'rain' || kind === 'dust'; this.line = line;
    const N = this.N = kind === 'rain' ? 2200 : 1400, verts = line ? N * 2 : N;
    const seed = new Float32Array(verts * 4), end = new Float32Array(verts), r = rng(99 + WX_KIND[kind]);
    for (let i = 0; i < N; i++) { const s = [r(), r(), r(), r()]; for (let k = 0; k < (line ? 2 : 1); k++) { const v = line ? i * 2 + k : i; seed.set(s, v * 4); end[v] = k; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const C = { clear: ['#fffff0', '#fffff0'], rain: ['#e2eaf6', '#e2eaf6'], dust: ['#ebc387', '#ebc387'], snow: ['#ffffff', '#ffffff'], ash: ['#4a4444', '#ff9a3c'], spores: ['#7dffdc', '#ff8ce6'] }[kind];
    this.u = { uCenter: { value: new THREE.Vector3() }, uOff: { value: new THREE.Vector3() }, uOff2: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3() },
      uBox: { value: 60 }, uTime: shared.time, uSize: { value: 1 }, uPx: { value: 1 }, uKind: { value: WX_KIND[kind] }, uColA: { value: new THREE.Color(C[0]) }, uColB: { value: new THREE.Color(C[1]) },
      uA: { value: 1 }, uLine: { value: line ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: WX_VERT, fragmentShader: WX_FRAG, transparent: true, depthWrite: false, fog: false,
      blending: kind === 'spores' || kind === 'clear' ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.obj = line ? new THREE.LineSegments(g, mat) : new THREE.Points(g, mat);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 5; scene.add(this.obj);
    this.shared = shared;
  }
  update(dens, cam, dist, dt) {
    const n = Math.floor(this.N * clamp(dens, 0, 1));
    this.obj.visible = n > 0; if (!n) return;
    this.obj.geometry.setDrawRange(0, this.line ? n * 2 : n);
    const box = 50 * Math.pow(1.25, Math.round(Math.log(clamp(dist * 2.2, 50, 4000) / 50) / Math.log(1.25))), k = box / 60, u = this.u, t = this.shared.time.value; // box size is stepped, so the wrap rarely reshuffles
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    u.uCenter.value.copy(cam.position).addScaledVector(dir, box * 0.35);
    u.uBox.value = box; u.uPx.value = this.shared.px;
    const V = { clear: [0.4, -0.15, 0.2, 0.004], rain: [-1.6, -11, 0, 0], dust: [-16, 0.3, 1.5, 0], snow: [-0.8, -1.4, 0.3, 0.007], ash: [-0.8, -0.9, 0, 0.0045], spores: [0.2, 0.5, 0.1, 0.009] }[this.kind]; // velocity (per 60 m of box) and particle size (share of box)
    u.uVel.value.set(V[0] * k, V[1] * k, V[2] * k); u.uSize.value = V[3] * box;
    // particle drift and the box position are folded into a wrapped offset in doubles here,
    // so the shader's mod stays precise far from the origin and late in a flight
    const c = u.uCenter.value, v = u.uVel.value, wrap = (x) => ((x % box) + box) % box;
    u.uOff.value.set(wrap(-c.x + box * 0.5 + v.x * t), wrap(-c.y + box * 0.5 + v.y * t), wrap(-c.z + box * 0.5 + v.z * t));
    u.uOff2.value.set(wrap(-c.x + box * 0.5 + v.x * t), wrap(-c.y + box * 0.5 - v.y * 2.5 * t), wrap(-c.z + box * 0.5 + v.z * t));
    if (this.line) { // streak along the particles' motion relative to the camera
      const rel = u.uVel.value.clone().sub(this.shared.camVel);
      u.uStreak.value.copy(rel.multiplyScalar(this.kind === 'rain' ? 0.035 : 0.05));
      if (u.uStreak.value.length() > box * 0.1) u.uStreak.value.setLength(box * 0.1);
    }
    u.uA.value = { clear: 0.45, rain: 0.75, dust: 0.3, snow: 0.95, ash: 0.75, spores: 0.9 }[this.kind];
  }
}

function makePlanetTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), x = S / 2, y = S / 2, r = S * 0.22;
  const ring = (front) => { g.save(); g.translate(x, y); g.rotate(-0.3); g.strokeStyle = 'rgba(255,220,250,.75)'; g.lineWidth = 7;
    g.beginPath(); g.ellipse(0, 0, r * 1.75, r * 0.36, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(200,160,230,.5)'; g.lineWidth = 4; g.beginPath(); g.ellipse(0, 0, r * 1.95, r * 0.42, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); g.stroke(); g.restore(); };
  ring(false);
  const pg = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r); pg.addColorStop(0, '#ffc6f0'); pg.addColorStop(0.7, '#a15ac0'); pg.addColorStop(1, '#4e2478');
  g.fillStyle = pg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip(); g.globalAlpha = 0.18; g.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) g.fillRect(x - r, y - r * 0.8 + i * r * 0.3, r * 2, r * 0.07); g.restore();
  ring(true);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeMoonTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const gr = g.createRadialGradient(50, 50, 4, 64, 64, 60); gr.addColorStop(0, '#f2f8ff'); gr.addColorStop(1, '#9fb2cc');
  g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
  g.fillStyle = 'rgba(90,110,140,.35)'; [[44, 50, 10], [80, 76, 14], [70, 40, 7]].forEach(([a, b, r]) => { g.beginPath(); g.arc(a, b, r, 0, 7); g.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
