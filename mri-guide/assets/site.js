/* ============================================================
   Shared site chrome: chapter registry, top bar, prev/next nav,
   theme toggle.  Every page includes this and gets consistent
   navigation without hand-maintained links.
   ============================================================ */

const CHAPTERS = [
  { f: "ch01-nuclear-spin.html",      t: "Nuclear Spin and the Magnetic Moment",
    d: "Why hydrogen, what spin actually is, and where the magnetic moment comes from." },
  { f: "ch02-magnetization.html",     t: "Magnetization, Zeeman Splitting and Larmor Precession",
    d: "What B₀ does to a population of spins, and why the answer is a vector, not a wobbling top." },
  { f: "ch03-resonance.html",         t: "Resonance: RF Excitation and the Rotating Frame",
    d: "How a tiny oscillating field tips a magnetization that a huge static field is holding down." },
  { f: "ch04-relaxation.html",        t: "Relaxation: T1, T2, T2* and the Bloch Equations",
    d: "The two independent clocks that run after excitation, and the third that we can cheat." },
  { f: "ch05-echoes.html",            t: "Echoes: Recovering Phase You Thought You Had Lost",
    d: "Spin echo, gradient echo, stimulated echo — the central trick of the whole modality." },
  { f: "ch06-machine.html",           t: "The Machine: Magnet, Gradients, RF Chain, Shields",
    d: "What is physically in the room, why it is that shape, and what each part costs you." },
  { f: "ch07-spatial-encoding.html",  t: "Spatial Encoding: Slice, Frequency and Phase",
    d: "Turning one bulk signal from the whole body into a position-resolved measurement." },
  { f: "ch08-k-space.html",           t: "k-Space: The Domain the Scanner Actually Measures",
    d: "The single most useful mental picture in MRI, with a live Fourier playground." },
  { f: "ch09-acquisition.html",       t: "Signal Acquisition: Coils, Demodulation, Sampling, SNR",
    d: "From a microvolt in a loop of copper to numbers on a disk, and where noise enters." },
  { f: "ch10-reconstruction.html",    t: "From Signal to Image: Reconstruction and its Consequences",
    d: "The FFT, and everything that goes wrong when your samples are not what the FFT assumes." },
  { f: "ch11-pulse-sequences.html",   t: "Pulse Sequences: The Catalogue",
    d: "SE, GRE, IR, FLAIR, STIR, TSE, EPI, bSSFP — read as timing diagrams, not acronyms." },
  { f: "ch12-contrast.html",          t: "Contrast: TR, TE, TI and Why Tissues Look Different",
    d: "The signal equation, made tangible with a phantom you can re-weight in real time." },
  { f: "ch13-advanced-imaging.html",  t: "Beyond Anatomy: Diffusion, Perfusion, BOLD, MRA, MRS",
    d: "Encoding motion, oxygenation, flow and chemistry into the same phase you already control." },
  { f: "ch14-fast-imaging.html",      t: "Fast Imaging: Parallel, Compressed Sensing, Learned Recon",
    d: "How to skip most of k-space and still get an image — and what that costs." },
  { f: "ch15-artifacts-safety.html",  t: "Artifacts, Quality Assurance and Safety",
    d: "A field guide to every stripe, ghost and blackout, plus the reasons MRI can hurt people." },
  { f: "ch16-image-processing.html",  t: "The Image Processing Pipeline: DICOM to Analysis",
    d: "Where physics hands off to the pixels — bias fields, registration, segmentation, learning." },
];

const PARTS = [
  { at: 0,  n: "Part I",   t: "The Physics" },
  { at: 5,  n: "Part II",  t: "The Instrument" },
  { at: 6,  n: "Part III", t: "Making an Image" },
  { at: 10, n: "Part IV",  t: "Sequences and Contrast" },
  { at: 12, n: "Part V",   t: "Applications, Speed and Consequences" },
];

/* ---------- theme ---------- */
(function theme() {
  const saved = localStorage.getItem("mri-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

function toggleTheme() {
  const el = document.documentElement;
  const cur = el.getAttribute("data-theme");
  const dark = cur ? cur === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  el.setAttribute("data-theme", next);
  localStorage.setItem("mri-theme", next);
  window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
}

/* ---------- chrome injection ---------- */
function currentIndex() {
  const here = location.pathname.split("/").pop() || "index.html";
  return CHAPTERS.findIndex(c => c.f === here);
}

function buildChrome() {
  const i = currentIndex();

  const bar = document.createElement("nav");
  bar.className = "topbar";
  const num = i >= 0 ? `Chapter ${String(i + 1).padStart(2, "0")}` : "Contents";
  bar.innerHTML =
    `<a class="home" href="index.html">MRI · A Visual Study Guide</a>
     <span class="chapno">${num}</span>
     <span class="spacer"></span>
     ${i > 0 ? `<a href="${CHAPTERS[i-1].f}" title="${CHAPTERS[i-1].t}">← prev</a>` : ""}
     ${i >= 0 && i < CHAPTERS.length - 1 ? `<a href="${CHAPTERS[i+1].f}" title="${CHAPTERS[i+1].t}">next →</a>` : ""}
     <button class="ghost" onclick="toggleTheme()">◐ theme</button>`;
  document.body.prepend(bar);

  if (i >= 0) {
    const nav = document.createElement("nav");
    nav.className = "chapnav";
    const prev = CHAPTERS[i - 1], next = CHAPTERS[i + 1];
    nav.innerHTML =
      (prev ? `<a href="${prev.f}"><span class="dir">← Chapter ${i}</span><span class="ttl">${prev.t}</span></a>`
            : `<a href="index.html"><span class="dir">← Contents</span><span class="ttl">All chapters</span></a>`) +
      (next ? `<a class="next" href="${next.f}"><span class="dir">Chapter ${i + 2} →</span><span class="ttl">${next.t}</span></a>`
            : `<a class="next" href="index.html"><span class="dir">Contents →</span><span class="ttl">Back to the top level</span></a>`);
    const main = document.querySelector("main");
    (main || document.body).appendChild(nav);
  }

  const f = document.createElement("footer");
  f.className = "site";
  f.innerHTML = `MRI — A Visual Study Guide · compiled by <b>Tahmeed and Claude</b> · ` +
                `for personal study. Every figure is drawn in-page; nothing loads from the network.`;
  document.body.appendChild(f);
}

document.addEventListener("DOMContentLoaded", buildChrome);

/* ---------- helpers shared by widgets ---------- */

/** Read a CSS custom property as a concrete colour string. */
function cssv(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Wire a range input to an <output> and a callback. */
function slider(id, fmt, onchange) {
  const el = document.getElementById(id);
  if (!el) return null;
  const out = document.getElementById(id + "-out");
  const sync = () => {
    const v = parseFloat(el.value);
    if (out) out.textContent = fmt ? fmt(v) : v;
    if (onchange) onchange(v);
  };
  el.addEventListener("input", sync);
  sync();
  return el;
}

/** requestAnimationFrame loop that stops when the tab is hidden. */
function animate(fn) {
  let t0 = performance.now(), raf = null;
  function step(t) {
    fn((t - t0) / 1000, t / 1000);
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !raf) { t0 = performance.now(); raf = requestAnimationFrame(step); }
  });
}

/** Hi-DPI canvas setup. Returns a 2d context scaled to CSS pixels. */
function hidpi(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
