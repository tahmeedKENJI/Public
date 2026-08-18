/* ============================================================
   A synthetic head phantom with real tissue parameters, so the
   contrast demos compute actual MR signal instead of colouring
   in a picture.  Tissue values are representative 1.5 T numbers
   (see the reference table in Chapter 12).
   ============================================================ */

const TISSUES = {
  //                  T1 ms  T2 ms  proton density (relative)
  air:      { T1:    1, T2:   1, pd: 0.00, name: "Air / background" },
  fat:      { T1:  260, T2:  80, pd: 1.00, name: "Subcutaneous fat" },
  skull:    { T1:  550, T2:  40, pd: 0.15, name: "Cortical bone / marrow mix" },
  wm:       { T1:  650, T2:  80, pd: 0.75, name: "White matter" },
  gm:       { T1:  900, T2: 100, pd: 0.85, name: "Grey matter" },
  csf:      { T1: 4000, T2: 2000, pd: 1.00, name: "CSF" },
  muscle:   { T1:  870, T2:  47, pd: 0.80, name: "Muscle" },
  lesion:   { T1: 1200, T2: 180, pd: 0.90, name: "Oedematous lesion" },
  vessel:   { T1: 1200, T2: 250, pd: 0.95, name: "Blood (venous)" },
};

const TISSUE_KEYS = Object.keys(TISSUES);

/** Ellipse list defining the phantom. Later entries overwrite earlier. */
const PHANTOM_ELLIPSES = [
  // cx, cy, rx, ry, rot(deg), tissue      -- coordinates in [-1,1]
  [ 0.00,  0.00, 0.82, 0.94,  0, "fat"    ],  // scalp / subcutaneous rim
  [ 0.00,  0.00, 0.78, 0.90,  0, "skull"  ],  // skull table
  [ 0.00,  0.00, 0.72, 0.85,  0, "gm"     ],  // brain, cortical ribbon
  [ 0.00,  0.02, 0.62, 0.75,  0, "wm"     ],  // deep white matter
  [-0.22,  0.00, 0.10, 0.26,  8, "csf"    ],  // left lateral ventricle
  [ 0.22,  0.00, 0.10, 0.26, -8, "csf"    ],  // right lateral ventricle
  [ 0.00,  0.30, 0.05, 0.10,  0, "csf"    ],  // third ventricle region
  [-0.40, -0.30, 0.13, 0.10, 25, "gm"     ],  // deep grey nucleus
  [ 0.40, -0.30, 0.13, 0.10,-25, "gm"     ],
  [ 0.34,  0.38, 0.11, 0.08, 15, "lesion" ],  // the thing you are looking for
  [-0.55,  0.45, 0.04, 0.04,  0, "vessel" ],
  [ 0.00,  0.80, 0.34, 0.10,  0, "muscle" ],  // posterior neck musculature
];

/**
 * Build a label map of size n x n.  Returns Uint8Array of indices
 * into TISSUE_KEYS.
 */
function buildPhantom(n) {
  const lbl = new Uint8Array(n * n);
  const airIdx = TISSUE_KEYS.indexOf("air");
  lbl.fill(airIdx);
  for (const [cx, cy, rx, ry, rot, tis] of PHANTOM_ELLIPSES) {
    const idx = TISSUE_KEYS.indexOf(tis);
    const th = rot * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j < n; j++) {
      const y = (j / (n - 1)) * 2 - 1;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        const dx = x - cx, dy = y - cy;
        const u = ( dx * ct + dy * st) / rx;
        const v = (-dx * st + dy * ct) / ry;
        if (u * u + v * v <= 1) lbl[j * n + i] = idx;
      }
    }
  }
  return lbl;
}

/** Spin-echo signal magnitude.  All times in ms. */
function signalSE(t, TR, TE) {
  return t.pd * (1 - Math.exp(-TR / t.T1)) * Math.exp(-TE / t.T2);
}

/** Inversion recovery (magnitude-reconstructed) spin echo. */
function signalIR(t, TR, TE, TI) {
  const mz = 1 - 2 * Math.exp(-TI / t.T1) + Math.exp(-TR / t.T1);
  return t.pd * Math.abs(mz) * Math.exp(-TE / t.T2);
}

/** Spoiled gradient echo with flip angle alpha (degrees), decay by T2*. */
function signalSPGR(t, TR, TE, alphaDeg, T2starFactor) {
  const a = alphaDeg * Math.PI / 180;
  const E1 = Math.exp(-TR / t.T1);
  const T2s = t.T2 * (T2starFactor == null ? 0.6 : T2starFactor);
  return t.pd * Math.sin(a) * (1 - E1) / (1 - Math.cos(a) * E1) * Math.exp(-TE / T2s);
}

/** Render a signal-per-tissue lookup through the label map onto a canvas. */
function renderPhantom(canvas, lbl, n, signalOf, opts) {
  opts = opts || {};
  const lut = TISSUE_KEYS.map(k => signalOf(TISSUES[k], k));
  let max = 0;
  for (const s of lut) if (s > max) max = s;
  if (opts.fixedMax) max = opts.fixedMax;
  if (max <= 0) max = 1;
  const buf = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) buf[i] = lut[lbl[i]];
  paint(canvas, buf, n, n, { max: max, gamma: opts.gamma || 1 });
  return max;
}
