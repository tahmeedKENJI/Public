'use strict';
/* ==========================================================================
   Terrain: procedural heightmap, biome painting and a quadtree of LOD tiles.

   World axes: +x = distance flown, +y = altitude, z = sideways. 1 unit = 1 m.
   The flight line is z = 0. Within |z| < CORRIDOR the ground is exactly y = 0 (the
   physics ground). Hills and mountains rise on the far side (z < 0). The near side
   (z > 0, where the side-view camera sits) stays a broad, low plain for PLAIN_W
   metres before distant ranges, so no camera ever ends up inside a hill.
   ========================================================================== */

const CORRIDOR = 26, RAMP = 150, PLAIN_W = 4000;

/* ---------- noise ---------- */
const NOISE = (() => {
  const r = rng(20240927), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  return { perm, gx, gz };
})();
function noise2(x, z) { // gradient noise, roughly -1..1
  const { perm, gx, gz } = NOISE;
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, X = xi & 255, Z = zi & 255;
  const aa = perm[X + perm[Z]], ab = perm[X + perm[Z + 1]], ba = perm[X + 1 + perm[Z]], bb = perm[X + 1 + perm[Z + 1]];
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const n00 = gx[aa] * xf + gz[aa] * zf, n10 = gx[ba] * (xf - 1) + gz[ba] * zf;
  const n01 = gx[ab] * xf + gz[ab] * (zf - 1), n11 = gx[bb] * (xf - 1) + gz[bb] * (zf - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * w) * 1.42;
}
function fbm(x, z, oct) { // -1..1
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, z); n += a; const nx = 1.6 * x + 1.2 * z, nz = -1.2 * x + 1.6 * z; x = nx + 17.3; z = nz; a *= 0.5; }
  return s / n;
}
function ridged(x, z, oct) { // 0..1, sharp crests
  let s = 0, a = 0.5, w = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(noise2(x, z)); v *= v; v *= w; w = clamp(v * 2, 0, 1);
    s += v * a; n += a; const nx = 1.6 * x + 1.2 * z, nz = -1.2 * x + 1.6 * z; x = nx + 5.1; z = nz; a *= 0.5;
  }
  return s / n;
}
const hash2 = (ix, iz) => hash((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) | 0);
const fract = v => v - Math.floor(v);

/* ---------- feature fields shared by heights, paint and vegetation ---------- */
const forestAt = (x, z) => 0.5 + 0.5 * fbm(x / 420 + 3.3, z / 420 - 1.7, 3);

// Volcano cones sit on a grid of cells on the far side; each cell may hold one cone.
const CONE_CELL = 2600;
function coneIn(cx, cz) {
  const h = hash2(cx * 3 + 11, cz * 5 + 7);
  if (h > 0.72) return null;
  const x = (cx + 0.2 + 0.6 * hash2(cx, cz + 91)) * CONE_CELL, z = (cz + 0.2 + 0.6 * hash2(cx + 57, cz)) * CONE_CELL;
  if (z > -700) return null;
  const H = 420 + 700 * hash2(cx + 5, cz + 3), R = Math.min(H * 2.3, -z - CORRIDOR - 120);
  return R > 300 ? { x, z, H, R } : null;
}
function conesNear(x, z, out) {
  const cx = Math.floor(x / CONE_CELL), cz = Math.floor(z / CONE_CELL);
  out.length = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = coneIn(cx + i, cz + j); if (c) out.push(c); }
  return out;
}
const _cones = [];

// Alien spires: sharp needles on a grid of smaller cells.
const SPIRE_CELL = 360;
function spireIn(cx, cz) {
  const h = hash2(cx * 7 + 3, cz * 13 + 1);
  if (h > 0.55) return null;
  const x = (cx + 0.15 + 0.7 * hash2(cx + 1, cz + 77)) * SPIRE_CELL, z = (cz + 0.15 + 0.7 * hash2(cx + 33, cz + 2)) * SPIRE_CELL;
  const far = z < 0 ? -z : z - PLAIN_W;
  if (far < 60) return null;
  const H = (140 + 520 * hash2(cx + 9, cz + 4)) * clamp(far / 900, 0.35, 1), R = Math.min(20 + 55 * hash2(cx + 2, cz + 8), far - 30);
  return R > 8 ? { x, z, H, R } : null;
}

/* ---------- heights ---------- */
// Height of one terrain style at (x, z). d = distance into the hills (0 at the corridor edge),
// far = how far out we are, for distant ranges. Returns metres above the physics ground.
function styleHeight(key, x, z) {
  const left = z < 0;
  // on the near side, the land is a low plain until PLAIN_W, then distant ranges
  const d = left ? -z : 0, m = left ? smooth(CORRIDOR, CORRIDOR + RAMP, d) : 0;
  const far = left ? d : Math.max(0, z - PLAIN_W);
  const plain = left ? 0 : smooth(CORRIDOR, CORRIDOR + 300, z) * (1.2 + 1.2 * fbm(x / 260, z / 260, 3));
  switch (key) {
    case 'meadow': {
      const hills = 0.5 + 0.5 * fbm(x / 340, z / 340, 5);
      const rng_ = ridged(x / 2600 + 7.1, z / 2600, 5);
      return plain + m * (3 + 75 * hills * hills) + 1100 * rng_ * rng_ * smooth(900, 4500, far);
    }
    case 'farm': {
      const hills = 0.5 + 0.5 * fbm(x / 520, z / 520, 4);
      const back = 0.5 + 0.5 * fbm(x / 2200 - 4, z / 2200, 4);
      return plain * 0.6 + m * (2 + 22 * hills) + 420 * back * back * smooth(1000, 4200, far);
    }
    case 'desert': {
      const u = (x * 0.8 + z * 0.6) / 75 + 2.6 * fbm(x / 700, z / 700, 3);
      const s = fract(u), prof = s < 0.72 ? s / 0.72 : (1 - s) / 0.28; // gentle windward face, steep lee face
      const dune = prof * prof * (3 - 2 * prof) * (0.35 + 0.65 * (0.5 + 0.5 * fbm(x / 900, z / 900, 2)));
      const mm = 0.5 + 0.5 * fbm(x / 1500 + 9, z / 1500, 4);
      const mesa = smooth(0.56, 0.6, mm) * (160 + 60 * (0.5 + 0.5 * noise2(x / 3000, z / 3000)));
      const terrace = smooth(0.52, 0.56, mm) * 26;
      return plain * 1.5 + m * (2 + 30 * dune) + (mesa + terrace) * smooth(220, 900, far) + 600 * Math.pow(ridged(x / 3000, z / 3000, 4), 2) * smooth(3000, 7000, far);
    }
    case 'tundra': {
      const drift = 0.5 + 0.5 * fbm(x / 300, z / 300, 4);
      const mt = Math.pow(ridged(x / 1700 + 2, z / 1700, 6), 1.7);
      return plain + m * (4 + 28 * drift) + 1500 * mt * smooth(90, 1500, far);
    }
    case 'volcano': {
      let h = plain + m * (3 + 26 * (0.5 + 0.5 * fbm(x / 380, z / 380, 4))) + 420 * Math.pow(ridged(x / 1400, z / 1400, 5), 1.5) * smooth(120, 1600, far);
      if (left) for (const c of conesNear(x, z, _cones)) {
        const r = Math.hypot(x - c.x, z - c.z); if (r >= c.R) continue;
        const k = 1 - r / c.R; let v = c.H * Math.pow(k, 1.7);
        const cr = c.R * 0.13; if (r < cr) v -= c.H * 0.22 * Math.sqrt(1 - r / cr); // crater
        h = Math.max(h, v + 30 * noise2(x / 90, z / 90) * k);
      }
      return h;
    }
    case 'alien': {
      let h = plain + m * (4 + 46 * (0.5 + 0.5 * fbm(x / 420, z / 420, 4))) + 700 * Math.pow(ridged(x / 2400 + 1, z / 2400, 5), 2) * smooth(1500, 6000, far);
      const cx = Math.floor(x / SPIRE_CELL), cz = Math.floor(z / SPIRE_CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const s = spireIn(cx + i, cz + j); if (!s) continue;
        const r = Math.hypot(x - s.x, z - s.z); if (r >= s.R) continue;
        const k = 1 - r / s.R; h = Math.max(h, s.H * k * k * (0.6 + 0.4 * k));
      }
      return h;
    }
  }
  return 0;
}

let terrainScale = 1; // world scale of the current run: sets how wide the terrain blends are
function heightAt(x, z) {
  if (Math.abs(z) < CORRIDOR) return 0;
  const e = envAt(x, terrainScale);
  let h = styleHeight(e.a.key, x, z);
  if (e.t > 0) h = lerp(h, styleHeight(e.b.key, x, z), e.t);
  return h * smooth(CORRIDOR, CORRIDOR + 12, Math.abs(z));
}

/* ---------- paint ----------
   Vertex colours (sRGB 0..1) and glow per terrain style. out = { r, g, b, gr, gg, gb, rx, rz, rs }
   where g* is emissive glow and r* is a crop-row direction/strength for the shader. */
const HEXC = {};
const hx = h => HEXC[h] || (HEXC[h] = rgb(h).map(v => v / 255));
function mixInto(o, c, t) { o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; }
function setC(o, c) { o.r = c[0]; o.g = c[1]; o.b = c[2]; }
const CROPS = ['#c8ae4c', '#8ea53d', '#6d5838', '#d8c34a', '#a0ad4b', '#b8984a', '#7d9a3a', '#c9b86a'].map(hx);

function paintStyle(key, x, z, h, ny, o) {
  const b = BIOMES[BIOME_IX[key]];
  const n = fbm(x / 45, z / 45, 3), slope = 1 - ny, d = Math.abs(z);
  const inCorr = d < CORRIDOR + 6;
  o.gr = o.gg = o.gb = o.ga = 0; o.rs = 0;
  switch (key) {
    case 'meadow': {
      setC(o, hx('#5c9c3c')); mixInto(o, hx('#86bd5c'), 0.5 + 0.5 * n);
      mixInto(o, hx(b.ground), 0.25);
      const f = forestAt(x, z);
      if (z < -30 || z > 400) mixInto(o, hx('#2e5a26'), smooth(0.56, 0.72, f) * 0.85); // forests, where trees may grow
      if (d < 3.2 && x > -60 && x < 160) mixInto(o, hx('#8d7250'), smooth(3.2, 1.8, d) * smooth(160, 120, x));
      mixInto(o, hx('#7f776b'), smooth(0.4, 0.7, slope));
      mixInto(o, hx('#f2f6f8'), smooth(620, 700, h + n * 90) * smooth(0.25, 0.55, ny));
      break;
    }
    case 'farm': {
      const ca = 0.35, u = x * Math.cos(ca) - z * Math.sin(ca), v = x * Math.sin(ca) + z * Math.cos(ca);
      const fu = u / 84, fv = v / 58, cu = Math.floor(fu), cv = Math.floor(fv);
      const hc = hash2(cu, cv), crop = CROPS[Math.floor(hc * CROPS.length)];
      if (inCorr) { setC(o, hx(b.ground)); mixInto(o, hx('#8a9a42'), 0.5 + 0.5 * n); }
      else {
        setC(o, crop); mixInto(o, [0.35, 0.3, 0.2], 0.12 * (0.5 + 0.5 * n));
        const edge = Math.min(fract(fu), 1 - fract(fu)) * 84 < 2.4 || Math.min(fract(fv), 1 - fract(fv)) * 58 < 2.4;
        if (edge) setC(o, hx('#4b6a2c'));
        else { const along = hc < 0.5; o.rx = along ? Math.cos(ca) : Math.sin(ca); o.rz = along ? -Math.sin(ca) : Math.cos(ca); o.rs = hc > 0.12 ? 1 : 0; }
      }
      mixInto(o, hx('#6a7a4a'), smooth(20, 80, h));
      mixInto(o, hx('#7a7468'), smooth(0.45, 0.75, slope));
      break;
    }
    case 'desert': {
      setC(o, hx(b.ground)); mixInto(o, hx('#dcae68'), 0.5 + 0.5 * n);
      mixInto(o, hx('#f3d696'), 0.3 * (0.5 + 0.5 * noise2(x / 9, z / 9)));
      const band = 0.5 + 0.5 * Math.sin(h * 0.22 + noise2(x / 200, z / 200) * 2);
      const strata = band < 0.33 ? hx('#b3683b') : band < 0.66 ? hx('#c98a4f') : hx('#9c5634');
      const cliff = smooth(0.35, 0.6, slope) * smooth(12, 30, h);
      o.r += (strata[0] - o.r) * cliff; o.g += (strata[1] - o.g) * cliff; o.b += (strata[2] - o.b) * cliff;
      if (h > 150 && ny > 0.8) mixInto(o, hx('#c4884c'), 0.6);
      break;
    }
    case 'tundra': {
      setC(o, hx('#e9f1f6')); mixInto(o, hx('#cfdde8'), 0.5 + 0.5 * n);
      if (h < 6 && !inCorr) mixInto(o, hx('#a9cde0'), smooth(0.55, 0.8, 0.5 + 0.5 * noise2(x / 70, z / 70)) * 0.7); // frozen ponds
      const rock = smooth(0.42, 0.66, slope) * (1 - smooth(900, 1300, h) * 0.5 * ny);
      mixInto(o, hx('#4e5967'), rock);
      mixInto(o, hx('#6a7788'), rock * 0.3 * (0.5 + 0.5 * n));
      break;
    }
    case 'volcano': {
      setC(o, hx(b.ground)); mixInto(o, hx('#5a4a44'), 0.5 + 0.5 * n);
      mixInto(o, hx('#221917'), smooth(0.35, 0.65, slope));
      mixInto(o, hx('#332624'), smooth(80, 300, h) * 0.6);
      { // lava fields: the shader draws thin glowing cracks wherever this potential is set
        const field = smooth(0.05, 0.45, noise2(x / 260 + 3, z / 260)) * smooth(0.55, 0.85, ny) * (h < 80 ? 1 : 0.3) * (inCorr ? 0.6 : 1);
        if (field > 0) { mixInto(o, hx('#2e2220'), field * 0.5); o.gr = 1.6 * field; o.gg = 0.42 * field; o.gb = 0.07 * field; }
      }
      for (const c of conesNear(x, z, _cones)) { // glowing crater floors
        const r = Math.hypot(x - c.x, z - c.z), cr = c.R * 0.1;
        if (r < cr) { const k = 1 - r / cr; o.gr = Math.max(o.gr, 2.2 * k); o.gg = Math.max(o.gg, 0.7 * k); o.gb = Math.max(o.gb, 0.12 * k); o.ga = Math.max(o.ga, smooth(0, 0.3, k)); }
      }
      break;
    }
    case 'alien': {
      setC(o, hx(b.ground)); mixInto(o, hx('#5c3f9e'), 0.5 + 0.5 * n);
      mixInto(o, hx('#2d1d5c'), smooth(0.4, 0.7, slope));
      mixInto(o, hx('#c9a8ff'), smooth(200, 520, h) * 0.6);
      { // glowing veins, drawn by the shader where this potential is set
        const field = smooth(0.1, 0.5, noise2(x / 340 + 2, z / 340)) * smooth(0.4, 0.8, ny) * (inCorr ? 0.7 : 1);
        if (field > 0) { const pink = noise2(x / 900, z / 900) > 0.1; o.gr = (pink ? 1.3 : 0.2) * field; o.gg = (pink ? 0.3 : 1.2) * field; o.gb = (pink ? 1.1 : 0.9) * field; }
      }
      break;
    }
  }
}
const BIOME_IX = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));
const _pa = { r: 0, g: 0, b: 0, gr: 0, gg: 0, gb: 0, ga: 0, rx: 0, rz: 0, rs: 0 }, _pb = { r: 0, g: 0, b: 0, gr: 0, gg: 0, gb: 0, ga: 0, rx: 0, rz: 0, rs: 0 };
function paintAt(x, z, h, ny, o) {
  const e = envAt(x, terrainScale);
  paintStyle(e.a.key, x, z, h, ny, o);
  if (e.t > 0) {
    paintStyle(e.b.key, x, z, h, ny, _pb);
    const t = e.t;
    o.r = lerp(o.r, _pb.r, t); o.g = lerp(o.g, _pb.g, t); o.b = lerp(o.b, _pb.b, t);
    o.gr = lerp(o.gr, _pb.gr, t); o.gg = lerp(o.gg, _pb.gg, t); o.gb = lerp(o.gb, _pb.gb, t); o.ga = lerp(o.ga, _pb.ga, t);
    if (t > 0.5) { o.rx = _pb.rx; o.rz = _pb.rz; } o.rs = lerp(o.rs, _pb.rs, t);
  }
}
const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/* ---------- tiles ---------- */
const TILE_PERIOD = 960; // detail texture and crop rows repeat every 960 m, so tile offsets wrap exactly
function buildTileGeometry(x0, z0, size, N) {
  const step = size / N, M = N + 3, H = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) H[j * M + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const nv = (N + 1) * (N + 1), ns = 4 * N, total = nv + ns;
  const pos = new Float32Array(total * 3), nor = new Int8Array(total * 4), col = new Uint8Array(total * 4), glow = new Uint8Array(total * 4);
  const row = new Int8Array(total * 4), wuv = new Float32Array(total * 2);
  const ox = ((x0 % TILE_PERIOD) + TILE_PERIOD) % TILE_PERIOD, oz = ((z0 % TILE_PERIOD) + TILE_PERIOD) % TILE_PERIOD;
  const o = _pa;
  let maxH = -1e9, minH = 1e9;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, h = H[(j + 1) * M + i + 1];
    const hl = H[(j + 1) * M + i], hr = H[(j + 1) * M + i + 2], hd = H[j * M + i + 1], hu = H[(j + 2) * M + i + 1];
    let nx = hl - hr, ny = 2 * step, nz = hd - hu; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const lx = i * step, lz = j * step, x = x0 + lx, z = z0 + lz;
    pos[k * 3] = lx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = lz;
    nor[k * 4] = nx * 127; nor[k * 4 + 1] = ny * 127; nor[k * 4 + 2] = nz * 127;
    o.rx = 0; o.rz = 0;
    paintAt(x, z, h, ny, o);
    col[k * 4] = 255 * clamp(toLin(o.r), 0, 1); col[k * 4 + 1] = 255 * clamp(toLin(o.g), 0, 1); col[k * 4 + 2] = 255 * clamp(toLin(o.b), 0, 1); col[k * 4 + 3] = 255;
    glow[k * 4] = clamp(o.gr / 2.5, 0, 1) * 255; glow[k * 4 + 1] = clamp(o.gg / 2.5, 0, 1) * 255; glow[k * 4 + 2] = clamp(o.gb / 2.5, 0, 1) * 255; glow[k * 4 + 3] = clamp(o.ga, 0, 1) * 255;
    row[k * 4] = o.rx * 127; row[k * 4 + 1] = o.rz * 127; row[k * 4 + 2] = o.rs * 127;
    wuv[k * 2] = ox + lx; wuv[k * 2 + 1] = oz + lz;
    if (h > maxH) maxH = h; if (h < minH) minH = h;
  }
  // skirts: a strip hanging below each edge hides cracks between tiles of different LOD
  const skirt = 2 + size * 0.03, edge = [];
  for (let i = 0; i < N; i++) edge.push(i);                         // z0 edge
  for (let j = 0; j < N; j++) edge.push(j * (N + 1) + N);           // x1 edge
  for (let i = N; i > 0; i--) edge.push(N * (N + 1) + i);           // z1 edge
  for (let j = N; j > 0; j--) edge.push(j * (N + 1));               // x0 edge
  edge.forEach((src, s) => {
    const k = nv + s;
    pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - skirt; pos[k * 3 + 2] = pos[src * 3 + 2];
    for (let c = 0; c < 4; c++) { nor[k * 4 + c] = nor[src * 4 + c]; col[k * 4 + c] = col[src * 4 + c]; glow[k * 4 + c] = glow[src * 4 + c]; row[k * 4 + c] = row[src * 4 + c]; }
    wuv[k * 2] = wuv[src * 2]; wuv[k * 2 + 1] = wuv[src * 2 + 1];
  });
  const idx = new Uint16Array(N * N * 6 + ns * 6); let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  for (let s = 0; s < ns; s++) {
    const a = edge[s], b = edge[(s + 1) % ns], sa = nv + s, sb = nv + (s + 1) % ns;
    idx[q++] = a; idx[q++] = b; idx[q++] = sa; idx[q++] = b; idx[q++] = sb; idx[q++] = sa;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 4, true));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 4, true));
  g.setAttribute('aRow', new THREE.BufferAttribute(row, 4, true));
  g.setAttribute('aW', new THREE.BufferAttribute(wuv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minH - skirt, 0), new THREE.Vector3(size, maxH, size));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

// A tileable grey detail texture: small grit in R, large blotches in G.
function makeDetailTexture() {
  const S = 256, data = new Uint8Array(S * S * 4);
  const { perm, gx, gz } = NOISE;
  const pnoise = (x, y, P) => { // gradient noise whose lattice wraps every P cells, so it tiles exactly
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P, X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
    const h = (X, Y) => perm[(X & 255) + perm[Y & 255]];
    const g = (k, dx, dy) => gx[k] * dx + gz[k] * dy;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), w = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a0 = g(h(X0, Y0), xf, yf), a1 = g(h(X1, Y0), xf - 1, yf), b0 = g(h(X0, Y1), xf, yf - 1), b1 = g(h(X1, Y1), xf - 1, yf - 1);
    const A = a0 + (a1 - a0) * u, B = b0 + (b1 - b0) * u; return (A + (B - A) * w) * 1.42;
  };
  const per = (u, v, p, oct) => { let s = 0, a = 0.5, n = 0, f = 1; for (let o = 0; o < oct; o++) { s += a * pnoise(u * p * f + o * 7, v * p * f + o * 13, p * f); n += a; a *= 0.5; f *= 2; } return s / n; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, u = x / S, v = y / S;
    data[i] = clamp(128 + 150 * per(u, v, 16, 4), 0, 255);
    data[i + 1] = clamp(128 + 170 * per(u, v, 4, 4), 0, 255);
    const rv = 1 - Math.abs(per(u, v, 5, 3)); data[i + 2] = clamp(Math.pow(rv, 10) * 255 * 1.2, 0, 255); data[i + 3] = 255; // thin crack lines
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

function makeTerrainMaterial(detail, shared) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aGlow; attribute vec4 aRow; attribute vec2 aW; varying vec4 vGlow; varying vec3 vRow; varying vec2 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vRow = aRow.xyz; vW = aW;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail; uniform float uTime; varying vec4 vGlow; varying vec3 vRow; varying vec2 vW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 dA = texture2D(uDetail, vW / 5.0), dB = texture2D(uDetail, vW / 40.0);
        float fw = length(fwidth(vW));
        float det = mix(1.0, 0.72 + 0.56 * dA.r, 1.0 - smoothstep(1.5, 6.0, fw)) * (0.8 + 0.4 * dB.g);
        float ph = dot(vW, vRow.xy) * 6.2832 / 3.0, fr = length(vec2(dFdx(ph), dFdy(ph)));
        float rows = vRow.z * (1.0 - smoothstep(0.6, 2.2, fr)) * (0.5 + 0.5 * sin(ph));
        diffuseColor.rgb *= det * (1.0 - 0.28 * rows);
        float c1 = texture2D(uDetail, vW / 40.0).b, c2 = texture2D(uDetail, vW / 12.0 + 0.37).b;
        float mpp = length(fwidth(vW)); // metres per pixel: fade thin lines to their average cover when too small to see
        float l1 = mix(smoothstep(0.3, 0.7, c1), 0.16, smoothstep(1.0, 3.0, mpp * 6.4));
        float l2 = mix(smoothstep(0.4, 0.8, c2), 0.12, smoothstep(1.0, 3.0, mpp * 21.3)) * 0.55;
        float lines = max(l1, l2);
        float glowAmt = mix(lines, 1.0, vGlow.a);
        diffuseColor.rgb *= 1.0 - 0.75 * lines * step(0.02, dot(vGlow.rgb, vec3(1.0)));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow.rgb * 2.5 * glowAmt * (0.85 + 0.15 * sin(uTime * 2.3 + vW.x * 0.05));`);
  };
  return m;
}

/* The terrain: a quadtree of tiles around the camera. A node splits while the camera is
   closer than size * lodK. Tiles are built on the CPU under a per-frame time budget, nearest
   first; a node whose children are not all built yet is drawn itself, so there are no holes. */
class Terrain {
  constructor(scene, shared) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.mat = makeTerrainMaterial(makeDetailTexture(), shared);
    this.cache = new Map(); this.frame = 0; this.queue = [];
    this.q = { tileN: 32, lodK: 2.4, view: 32000, minSize: 64 };
    this.root = 8192; this.shadows = false;
  }
  setQuality(q) {
    const changed = q.tileN !== this.q.tileN;
    this.q = q; if (changed) this.clear();
    this.shadows = q.shadows > 0;
    for (const t of this.cache.values()) if (t.mesh) t.mesh.receiveShadow = this.shadows;
  }
  clear() { for (const t of this.cache.values()) if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); } this.cache.clear(); }
  key(size, ix, iz) { return size + ':' + ix + ':' + iz; }
  tile(size, ix, iz, build) {
    const k = this.key(size, ix, iz); let t = this.cache.get(k);
    if (!t) { t = { size, ix, iz, mesh: null, used: 0 }; this.cache.set(k, t); }
    t.used = this.frame;
    if (!t.mesh && build) this.build(t);
    return t;
  }
  build(t) {
    const g = buildTileGeometry(t.ix * t.size, t.iz * t.size, t.size, this.q.tileN);
    const m = new THREE.Mesh(g, this.mat);
    m.position.set(t.ix * t.size, 0, t.iz * t.size); m.matrixAutoUpdate = false; m.updateMatrix();
    m.receiveShadow = this.shadows; m.visible = false;
    this.group.add(m); t.mesh = m;
  }
  split(size, ix, iz, cam) {
    if (size <= this.q.minSize) return false;
    const x0 = ix * size, z0 = iz * size;
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size)), dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
    const dy = Math.max(0, cam.y - 150);
    return Math.hypot(dx, dy, dz) < size * this.q.lodK;
  }
  // Progressive refinement: a node's children are requested only once the node itself is built,
  // and a node is replaced by its children only when all four are built. So there is always
  // something to draw, and detail arrives level by level, nearest first.
  want(t, cam) {
    if (t.queued) return;
    const cx = (t.ix + 0.5) * t.size, cz = (t.iz + 0.5) * t.size;
    t.pri = Math.max(0, Math.hypot(cx - cam.x, cz - cam.z, Math.max(0, cam.y - 150)) - t.size * 0.7);
    t.queued = true; this.queue.push(t);
  }
  show(size, ix, iz, cam) {
    const t = this.tile(size, ix, iz, false);
    if (this.split(size, ix, iz, cam)) {
      const h = size / 2, kids = [];
      for (let c = 0; c < 4; c++) kids.push(this.tile(h, ix * 2 + (c & 1), iz * 2 + (c >> 1), false));
      if (kids.every(k => k.mesh)) { for (const k of kids) this.show(k.size, k.ix, k.iz, cam); return; }
      for (const k of kids) if (!k.mesh) this.want(k, cam);
    }
    t.mesh.visible = true; this.visibleCount++;
  }
  warm(cam, ms) { // refine the view synchronously, e.g. before the first frame
    const t0 = performance.now();
    do this.update(cam, 60); while (this.pending > 0 && performance.now() - t0 < ms);
  }
  update(cam, budgetMs) {
    this.frame++;
    for (const t of this.cache.values()) if (t.mesh) t.mesh.visible = false;
    const R = this.q.view + cam.y * 2, S = this.root;
    const ix0 = Math.floor((cam.x - R) / S), ix1 = Math.floor((cam.x + R) / S), iz0 = Math.floor((cam.z - R) / S), iz1 = Math.floor((cam.z + R) / S);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) this.tile(S, ix, iz, true); // roots always exist
    this.queue.length = 0;
    for (const t of this.cache.values()) t.queued = false;
    this.visibleCount = 0;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) this.show(S, ix, iz, cam);
    // build what is missing, nearest first, within the time budget
    this.queue.sort((a, b) => a.pri - b.pri);
    const t0 = performance.now();
    for (const t of this.queue) { if (performance.now() - t0 > budgetMs) break; this.build(t); }
    this.pending = this.queue.filter(t => !t.mesh).length;
    // forget tiles that have not been used for a while
    if (this.cache.size > 600 && this.frame % 30 === 0) {
      const old = [...this.cache.entries()].filter(([, t]) => this.frame - t.used > 120).sort((a, b) => a[1].used - b[1].used);
      for (const [k, t] of old.slice(0, this.cache.size - 500)) { if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); } this.cache.delete(k); }
    }
  }
}
