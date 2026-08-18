# MRI — A Visual Study Guide

A self-contained, offline HTML study guide covering magnetic resonance imaging from nuclear
spin to the image-processing pipeline. Sixteen chapters plus an index.

Compiled by **Tahmeed and Claude**, for personal study.

## How to open

Unzip anywhere and open `index.html` in any modern browser. There is no build step, no server
and no network access: every figure is drawn in the page, and the simulations run in JavaScript
on the fly. It works equally well from a USB stick or a phone.

## Contents

```
index.html                     contents, quick-reference cards, standing resources
ch01-nuclear-spin.html         Part I  — nuclear spin and the magnetic moment
ch02-magnetization.html                  Zeeman splitting, Boltzmann, Larmor precession
ch03-resonance.html                      RF excitation, B1, the rotating frame, flip angles
ch04-relaxation.html                     T1, T2, T2*, the Bloch equations
ch05-echoes.html                         spin echo, gradient echo, CPMG, stimulated echoes
ch06-machine.html              Part II — magnet, cryogenics, shims, gradients, RF chain, shielding
ch07-spatial-encoding.html     Part III— slice selection, frequency and phase encoding
ch08-k-space.html                        k-space, trajectories, sampling relations
ch09-acquisition.html                    detection, demodulation, sampling, SNR
ch10-reconstruction.html                 the FFT, point spread function, gridding, corrections
ch11-pulse-sequences.html      Part IV — SE, TSE, IR, GRE, bSSFP, EPI, prep modules, vendor names
ch12-contrast.html                       TR, TE, TI and the signal equation
ch13-advanced-imaging.html     Part V  — diffusion, perfusion, BOLD, MRA, spectroscopy
ch14-fast-imaging.html                   parallel imaging, compressed sensing, learned recon
ch15-artifacts-safety.html               artifact field guide, QA, MR safety
ch16-image-processing.html               DICOM, normalisation, registration, ML pitfalls
assets/style.css               shared stylesheet (light and dark)
assets/site.js                 chapter registry, navigation, theme toggle
assets/fft.js                  radix-2 complex FFT used by the k-space demos
assets/phantom.js              synthetic head phantom and MR signal equations
```

## The interactive figures

These are not illustrations — they compute the physics:

- **Chapter 8** runs a real 2D FFT: edit k-space, see the image change.
- **Chapter 12** evaluates the spin-echo, inversion-recovery and spoiled-gradient-echo signal
  equations per pixel using published tissue relaxation times.
- **Chapter 14** solves the SENSE unfolding problem by least squares at every pixel, reports
  the g-factor, and runs an iterative sparsity-promoting reconstruction.
- **Chapter 15** generates each artifact by manipulating the actual k-space or image data.

## Caveats

The phantom is synthetic — ellipses assigned published relaxation times, not patient data.
Relaxation values follow Stanisz et al. (2005) and Wansapura et al. (1999) and vary by 10–20%
between studies; use them to reason about sequence design, not for quantitation. Nothing here
is clinical advice.

External links are provided for going further. Video links are deliberately YouTube *search*
queries rather than specific video IDs, so they do not rot.
