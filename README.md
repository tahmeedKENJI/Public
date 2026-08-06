# ClearSAR Track-1 — post-processing (Track A)

Offline post-processing and diagnostics for the ESA Φ-lab ClearSAR Track-1 RFI
detector. Nothing here trains a model; everything operates on COCO-format
detections plus `instances_train.json`, so it runs on CPU in seconds.

## Layout

```
notebooks/clearsar_phase3_trackA.ipynb   Kaggle notebook: regenerate val predictions
                                         at two NMS settings, score them with the
                                         official metric, run the diagnostics
src/clearsar_postproc/audit_lib.py       fragmentation audit, FP decomposition,
                                         azimuth-cue test
tools/build_nb.py                        regenerates the notebook from audit_lib.py
```

The notebook inlines `audit_lib.py` so it is self-contained on Kaggle. Edit the
library, then re-run `python tools/build_nb.py` to rebuild the notebook — do not
hand-edit the inlined copy.

## Diagnostics

**Fragmentation audit.** For each ground-truth box, compares the IoU of the single
best detection against the IoU of the union of all detections assigned to it.
`union >> best` on the large class means one RFI event is being split across
several detections that NMS cannot merge, because the fragments do not overlap
each other. That is a post-processing problem with real headroom. Roughly equal
values mean the model predicts one systematically wrong extent, which is a
training problem.

**False-positive decomposition.** Splits confident false positives into fragments
sitting inside a ground-truth box, near-misses that are localisation error, and
detections nowhere near any ground truth. The three call for different fixes.

**Azimuth-cue test.** RFI is an event in time and time maps to image rows, so
annotations cluster in azimuth. That clustering is established in the labels, but
re-ranking can only work if the cue separates true from false positives *in the
predictions*. This reports that AUC directly; near 0.50 means no amount of
parameter tuning will help.

## Two NMS settings

The published runs used `iou=0.6`. Re-running NMS offline on those outputs can
only suppress further, never less, and fragments that NMS already deleted are
invisible to the audit. So the notebook also emits a loose set at `iou=0.9,
max_det=1000`. The tight set reproduces the published headline number and acts as
a correctness gate; the loose set is what the sweep operates on.
