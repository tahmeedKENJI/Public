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

## Sweep results

All 8 uploaded detection sets reproduce the notebook scores to within 0.0001
(residual is the 3-decimal bbox rounding used to shrink the files).

Correctness check first: offline NMS at 0.6 applied to each loose set
reproduces the corresponding tight set to within 0.0007, so the offline
implementation matches ultralytics' inference-time NMS.

Protocol: the 631 val images are split deterministically in half. Every
configuration is scored on each half; the reported gain is held-out (tune on A,
measure on B, and the reverse, averaged).

| operator | cross-fold gain | verdict |
|---|---|---|
| NMS `iou` sweep, 0.30–0.75 | −0.0006 | dead — the curve peaks exactly at 0.60, already in use |
| containment suppression, 0.70–0.95 | −0.0236 | dead — badly negative |
| WBF, iou 0.45–0.65, avg and max | −0.0042 | dead |
| soft-NMS, gaussian | +0.0027 | positive |
| **soft-NMS, linear, iou 0.6** | **+0.0035** | **winner** |
| size re-rank on top | +0.0004 | marginal, within noise |

### Containment suppression was wrong

Suppressing detections nested inside a higher-scoring one cost −0.0236, the
worst result of the sweep. The nested boxes are not merely duplicate false
positives: many are correct detections of genuinely distinct events, consistent
with 13.8% of ground-truth boxes having a vertically adjacent same-x sibling.
Removing them costs more true positives than it gains precision.

### Why linear soft-NMS works, and it matches the diagnosis

`yolo11_rfi__loose__tta`, linear soft-NMS iou=0.6 versus the tight baseline:

```
            baseline   soft-NMS    delta
mAP           0.4013     0.4051   +0.0038
AP50          0.6820     0.6807   -0.0013
AP75          0.4114     0.4211   +0.0097
AR100         0.6444     0.6873   +0.0429
AP_large      0.3000     0.3008   +0.0008
```

The gain is concentrated in AP75 and AR100 while AP50 slightly drops. That is
exactly what the diagnosis predicted. Hard NMS *deletes* the better-localised
lower-scoring box; soft-NMS only *demotes* it, so it survives in the ranking and
can still match at a high IoU threshold. The problem was never merging — it was
that the right box was being thrown away.

Generalisation across all four runs, linear soft-NMS iou=0.6:

```
run                        baseline  soft-NMS    delta       A        B
yolo11_rfi__plain            0.3940    0.3965  +0.0025  +0.0023  +0.0031
yolo11_rfi__tta              0.4013    0.4051  +0.0038  +0.0036  +0.0040
yolo11_composite__plain      0.3837    0.3869  +0.0032  +0.0033  +0.0031
yolo11_composite__tta        0.3888    0.3918  +0.0030  +0.0031  +0.0031
```

Positive in all 8 fold-level measurements. Best configuration overall:
**yolo11_rfi (RGB) + TTA + linear soft-NMS iou=0.6 = 0.4051**.

## Track A conclusion

Net +0.0038 on the best pipeline, free at inference and requiring no retraining.
Real but small: three of the five ideas were refuted, including both of the
handoff's stated priorities. The remaining headroom is in training, not
post-processing, and the diagnosis points at localisation confidence — which is
what the P2 head and the `box=10.0` loss reweight target.

To apply it: run test inference at `iou=0.9, max_det=1000`, then linear
soft-NMS at 0.6 offline.
