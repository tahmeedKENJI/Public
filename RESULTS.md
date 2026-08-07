# Track A diagnostics — results

Run on the 631-image val fold, both checkpoints, 8 prediction sets.
Gate: 4/4 tight runs reproduced their published scores to four decimals
(RGB 0.3940 / 0.4014, composite 0.3837 / 0.3887), so the pipeline — including
the regenerated physics composite — is exact.

## Headline: both of the handoff's priority-1 and priority-2 ideas are dead

### Fragmentation is not happening

The audit compares, per ground-truth box, the IoU of the best single detection
against the IoU of the union of every detection assigned to it. Union far above
best would mean one event split across several boxes that NMS cannot merge.

`yolo11_rfi__tight__plain`, score >= 0.25:

```
class     n_gt  best_IoU  union_IoU   delta  dets/GT  frac+0.1
small      916    0.5473     0.5085 -0.0388     0.86     0.004
medium     785    0.6224     0.6157 -0.0067     1.00     0.025
large      151    0.2936     0.2997 +0.0061     0.48     0.033
```

Delta is at or below zero in every size class of every one of the 8 runs. Merging
makes localisation *worse*, because the detections assigned to a box sprawl
beyond it rather than tiling it. Only 3.3% of large boxes would gain more than
0.1 IoU from a union.

**Do not build the stack-merge.** The AP_large gap is not fragmentation.

### The azimuth cue carries no information in the predictions

AUC separating true from false positives among low-confidence detections, across
all 8 runs: 0.5052, 0.5119, 0.5075, 0.5361, 0.4818, 0.4837, 0.4727, 0.4936.
Mean 0.499, with n_tp between 681 and 806 — a real measurement, not a starved
one, and the guard did not fire.

Azimuth clustering is real in the *labels* (2.3x tighter than chance) but does
not separate true from false positives in the *predictions*. No choice of
`boost`, `tol` or `anchor_conf` can help. **Skip azimuth re-ranking.**

## What is actually wrong

### For large objects, the well-localised box exists but is ranked below a bad one

Same run, large class, at two score thresholds:

```
score >= 0.05 :  best_IoU 0.6690   dets/GT 1.38
score >= 0.25 :  best_IoU 0.2936   dets/GT 0.48
```

The score >= 0.05 candidate set contains the >= 0.25 set, so this gap can only
mean one thing: a detection with 0.67 IoU against the large ground-truth box
exists, scored somewhere between 0.05 and 0.25, while the top-scoring detection
on that same object sits at 0.29 IoU. The model finds the right extent and then
ranks it below the wrong one.

That is consistent with AP_large 0.2707 against AR_large 0.7007. It is a ranking
and localisation-confidence problem, not a detection problem and not a merging
problem.

### Most confident false positives are nested inside a ground-truth box

At score >= 0.25, `fragment_inside_gt` — an unmatched detection with at least
70% of its area inside some ground-truth box — accounts for 50–71% of all false
positives in every run.

IoU-based NMS structurally cannot remove these. A small box nested inside a large
kept box has low IoU with it, so no NMS threshold suppresses it. Removing them
needs a containment criterion (intersection over the *smaller* box), not IoU.

## What survives, and what is new

| idea | status |
|---|---|
| stack-merge / union of fragments | **dead** — delta <= 0 everywhere |
| azimuth re-ranking | **dead** — AUC 0.499 over 8 runs |
| NMS `iou` sweep | live — loose (0.9) scores 0.3504 vs tight (0.6) 0.3940, so suppression helps; below 0.6 is untested |
| WBF | live and **untested** — the audit measured *union* (min/max envelope), the worst case. WBF averages coordinates weighted by score, which is exactly the operation that could pull a top-ranked bad box toward the better-localised low-scoring one |
| containment suppression (IoS) | **new** — directly targets the 50–71% nested-FP bucket that IoU-NMS cannot touch |

## Other observations

- TTA helps at tight (+0.0074 RGB, +0.0050 composite) but hurts badly at loose
  (0.3504 -> 0.3294), because it multiplies duplicates that `iou=0.9` will not merge.
- The composite remains worse than RGB (0.3837 vs 0.3940), reproducing exactly.
- Detection counts: tight 28–30k, loose 80–92k, loose+TTA 157–168k over 631 images.

## Validation available

Applying NMS at 0.6 offline to a loose set should approximately reproduce the
corresponding tight set. That is a free correctness check on the offline NMS
implementation before any of its results are believed.
