# ClearSAR Track-1 — worklog

**Where we are:** Track A (post-processing) is complete and closed. The best
measured pipeline is **0.4051** on the 631-image val fold, up from 0.3940 at the
start of this session. All remaining headroom is in training.

**Metric:** COCO mAP@[0.50:0.95], official pycocotools, deterministic seed-42
stratified split (2523 train / 631 val), reproduced exactly.

---

## Score ledger

| pipeline | plain | TTA |
|---|---|---|
| E01 RGB (yolo11_rfi) | 0.3940 | 0.4014 |
| E04 composite (yolo11_composite) | 0.3837 | 0.3887 |
| E01 RGB + linear soft-NMS 0.6 | 0.3965 | **0.4051** |
| E04 composite + linear soft-NMS 0.6 | 0.3869 | 0.3918 |

**Best known configuration: RGB checkpoint + TTA + linear soft-NMS iou=0.6 = 0.4051.**
Inference at `conf=0.001, iou=0.9, max_det=1000`, then soft-NMS offline.

---

## Worklog

| # | task | status | result |
|---|---|---|---|
| 1 | E01 RGB baseline, YOLO11-L, imgsz 1024, 100 ep | done | 0.3940 / 0.4014 TTA |
| 2 | E04 physics-composite input | done | 0.3837 — **worse by 0.0103**, channel is r=0.66 redundant with luminance |
| 3 | Are the invisible boxes label errors? | done | **No.** AUC 0.720 ± 0.055 vs size-matched controls; ~11% are genuine error candidates |
| 4 | Recover checkpoints from Kaggle | done | Kaggle unzipped the `.pt` files (torch archives) into directories; repack verified bit-for-bit against real torch |
| 5 | Regenerate val predictions, 2 NMS settings × 2 aug | done | 8 sets, gate reproduced all 4 published scores to 4 decimals |
| 6 | Fragmentation audit | done | **Refuted.** union_IoU ≤ best_IoU in every size class of all 8 runs |
| 7 | FP decomposition | done | 50–71% of confident FPs nested inside a GT box |
| 8 | Azimuth-cue test | done | **Refuted.** AUC 0.499 over 8 runs, n_tp 681–806 |
| 9 | NMS `iou` sweep 0.30–0.75 | done | **Refuted.** −0.0006; curve peaks at the 0.60 already in use |
| 10 | Containment (IoS) suppression | done | **Refuted.** −0.0236, worst in sweep |
| 11 | WBF, iou 0.45–0.65, avg + max | done | **Refuted.** −0.0042 |
| 12 | Soft-NMS, gaussian + linear | done | **+0.0035 cross-fold**, positive in all 8 fold-level measurements |
| 13 | Size-prior re-rank | done | +0.0004 — within noise, optional |
| 14 | **Test-set submission with winning config** | **open** | not started; unknown whether any submission has ever been made |
| 15 | **P2 head (stride 4)** | **open** | highest-value remaining item |
| 16 | **Loss reweight `box=10.0, dfl=2.5`** | **open** | AP50 to spare, AP75 to gain |
| 17 | **Augmentation fix** `mosaic=0.5, scale=0.25, close_mosaic=30` | **open** | current config silently drops 6.5% of boxes |
| 18 | 5-channel RGB + physics | open, low priority | predicted near-neutral for the same redundancy reason as #2 |

---

## The diagnosis, in one paragraph

The model is **localisation-limited, not detection-limited**. AP75/AP50 = 0.60
against 0.75–0.80 for well-localised COCO detectors. For large objects, the best
IoU available at score ≥ 0.05 is 0.669 but only 0.294 at score ≥ 0.25 — since
the first candidate set contains the second, a well-localised detection provably
exists and is being outranked by a badly-localised one. Soft-NMS helps precisely
because it *demotes* that box instead of *deleting* it: the gain lands in AP75
(+0.0097) and AR100 (+0.0429) while AP50 slips 0.0013. Merging operators all
failed because the problem was never combining boxes, it was discarding the
right one.

---

## Refuted — do not revisit

| idea | why it died |
|---|---|
| Fragmentation / stack-merge | union ≤ best single in all 8 runs |
| Azimuth re-ranking | AUC 0.499; the cue is real in labels, absent in predictions |
| NMS threshold tuning | already optimal at 0.60 |
| Containment suppression | −0.0236; nested boxes are often correct detections of distinct events |
| WBF | −0.0042 both score modes |
| Physics composite input | −0.0103, reproduced twice |
| Dropping the invisible boxes | they are real and in the official test GT; caps mAP near 0.31 |
| dB / log domain | h-struct(dB) AUC 0.387, worse than chance |
| Larger imgsz, ensembling | no gain; upsampling a 520 px source adds no information |
| Anchor refitting | YOLO11 is anchor-free |
| Seam snapping | only 12.7% of boxes have both x-edges on a seam |

---

## Next

1. **Bank the +0.0038** — test-set submission with RGB + TTA + linear soft-NMS 0.6.
2. **P2 head retrain.** Median box is 19.8 px after letterbox to 1024: 2.5 cells
   at stride 8, 5 cells at stride 4. Aimed straight at the localisation limit.
3. **Loss reweight and augmentation fix**, one run each so the ablation stays clean.

Items 2 and 3 are GPU-hours; item 1 is minutes. They can run in parallel.
