/* ============================================================
   Minimal complex FFT, enough to run a real k-space playground
   in the browser.  Radix-2, power-of-two sizes only, which is
   all we need for 128x128 and 256x256 demo images.
   Arrays are plain Float64Array pairs (re, im), row-major.
   ============================================================ */

/** In-place iterative radix-2 FFT of a single complex vector. */
function fft1d(re, im, inverse) {
  const n = re.length;
  if (n & (n - 1)) throw new Error("fft1d: length must be a power of two");

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k],           ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;            im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;  im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** 2D FFT over an h x w image held in row-major Float64Arrays. */
function fft2d(re, im, w, h, inverse) {
  const rr = new Float64Array(w), ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { rr[x] = re[y * w + x]; ri[x] = im[y * w + x]; }
    fft1d(rr, ri, inverse);
    for (let x = 0; x < w; x++) { re[y * w + x] = rr[x]; im[y * w + x] = ri[x]; }
  }
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { cr[y] = re[y * w + x]; ci[y] = im[y * w + x]; }
    fft1d(cr, ci, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = cr[y]; im[y * w + x] = ci[y]; }
  }
}

/** Swap quadrants so DC sits in the middle (or undoes the same). */
function fftshift(a, w, h) {
  const out = new Float64Array(a.length);
  const hw = w >> 1, hh = h >> 1;
  for (let y = 0; y < h; y++) {
    const sy = (y + hh) % h;
    for (let x = 0; x < w; x++) out[y * w + x] = a[sy * w + ((x + hw) % w)];
  }
  return out;
}

/** Magnitude image from a complex pair. */
function magnitude(re, im) {
  const m = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}

/**
 * Paint a real-valued array onto a canvas.
 * opts: { log:bool, gamma:num, max:num, invert:bool, tint:[r,g,b] }
 */
function paint(canvas, data, w, h, opts) {
  opts = opts || {};
  const ctx = canvas.getContext("2d");
  canvas.width = w; canvas.height = h;
  const img = ctx.createImageData(w, h);
  let v = data;
  if (opts.log) {
    v = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) v[i] = Math.log1p(data[i] * (opts.logGain || 1));
  }
  let max = opts.max;
  if (max == null) { max = 0; for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i]; }
  if (max <= 0) max = 1;
  const g = opts.gamma || 1;
  const tint = opts.tint;
  for (let i = 0; i < v.length; i++) {
    let t = Math.min(1, Math.max(0, v[i] / max));
    if (g !== 1) t = Math.pow(t, g);
    let val = t * 255;
    if (opts.invert) val = 255 - val;
    const o = i * 4;
    if (tint) {
      img.data[o]     = val * tint[0];
      img.data[o + 1] = val * tint[1];
      img.data[o + 2] = val * tint[2];
    } else {
      img.data[o] = img.data[o + 1] = img.data[o + 2] = val;
    }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return max;
}
