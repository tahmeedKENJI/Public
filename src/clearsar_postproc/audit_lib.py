"""Track-A diagnostics: fragmentation audit, FP decomposition, azimuth-cue test.

Operates purely on COCO-format detections + GT. No pixels required.
"""
import numpy as np
from collections import defaultdict


# ---------------------------------------------------------------- geometry ---
def _xywh_to_xyxy(b):
    return b[0], b[1], b[0] + b[2], b[1] + b[3]


def iou_xywh(a, b):
    ax0, ay0, ax1, ay1 = _xywh_to_xyxy(a)
    bx0, by0, bx1, by1 = _xywh_to_xyxy(b)
    iw = min(ax1, bx1) - max(ax0, bx0)
    ih = min(ay1, by1) - max(ay0, by0)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def contained_frac(inner, outer):
    """Fraction of `inner`'s area that lies inside `outer`."""
    ax0, ay0, ax1, ay1 = _xywh_to_xyxy(inner)
    bx0, by0, bx1, by1 = _xywh_to_xyxy(outer)
    iw = min(ax1, bx1) - max(ax0, bx0)
    ih = min(ay1, by1) - max(ay0, by0)
    if iw <= 0 or ih <= 0:
        return 0.0
    return (iw * ih) / max(inner[2] * inner[3], 1e-9)


def union_box(boxes):
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return [x0, y0, x1 - x0, y1 - y0]


def size_class(b):
    a = b[2] * b[3]
    return "small" if a < 32 ** 2 else "medium" if a < 96 ** 2 else "large"


# ----------------------------------------------------------------- matching ---
def greedy_match(gts, dets, thr=0.5):
    """COCO-style greedy match, highest score first. Returns (gt_idx -> det_idx),
    and a list of det indices that matched nothing."""
    order = sorted(range(len(dets)), key=lambda i: -dets[i]["score"])
    gt_taken = {}
    det_matched = set()
    for di in order:
        best, best_iou = None, thr
        for gi, g in enumerate(gts):
            if gi in gt_taken:
                continue
            v = iou_xywh(dets[di]["bbox"], g)
            if v >= best_iou:
                best, best_iou = gi, v
        if best is not None:
            gt_taken[best] = di
            det_matched.add(di)
    return gt_taken, [i for i in range(len(dets)) if i not in det_matched]


def group(dets):
    by = defaultdict(list)
    for d in dets:
        by[d["image_id"]].append(d)
    return by


# ------------------------------------------------------- fragmentation audit ---
def fragmentation_audit(gt_by_img, det_by_img, score_thr=0.25, assign_iou=0.10):
    """For each GT: IoU of the single best detection vs IoU of the union of all
    detections assigned to it. union >> best  =>  fragmentation."""
    rows = defaultdict(lambda: {"n": 0, "best": [], "union": [], "nfrag": []})
    for iid, gts in gt_by_img.items():
        ds = [d for d in det_by_img.get(iid, []) if d["score"] >= score_thr]
        for g in gts:
            cls = size_class(g)
            assigned = [d["bbox"] for d in ds if iou_xywh(d["bbox"], g) >= assign_iou]
            best = max((iou_xywh(d["bbox"], g) for d in ds), default=0.0)
            uni = iou_xywh(union_box(assigned), g) if assigned else 0.0
            r = rows[cls]
            r["n"] += 1
            r["best"].append(best)
            r["union"].append(uni)
            r["nfrag"].append(len(assigned))
    out = {}
    for cls, r in rows.items():
        out[cls] = {
            "n_gt": r["n"],
            "mean_best_iou": float(np.mean(r["best"])),
            "mean_union_iou": float(np.mean(r["union"])),
            "delta": float(np.mean(r["union"]) - np.mean(r["best"])),
            "mean_dets_per_gt": float(np.mean(r["nfrag"])),
            "frac_gt_union_better_by_0.1": float(
                np.mean([u - b > 0.10 for u, b in zip(r["union"], r["best"])])),
        }
    return out


# ------------------------------------------------------- FP decomposition ---
def fp_decomposition(gt_by_img, det_by_img, score_thr=0.25, match_iou=0.5):
    """Split unmatched (false-positive) detections into interpretable buckets."""
    buckets = defaultdict(int)
    total = 0
    for iid, gts in gt_by_img.items():
        ds = [d for d in det_by_img.get(iid, []) if d["score"] >= score_thr]
        if not ds:
            continue
        _, unmatched = greedy_match(gts, ds, match_iou)
        for di in unmatched:
            total += 1
            b = ds[di]["bbox"]
            best_iou = max((iou_xywh(b, g) for g in gts), default=0.0)
            best_cont = max((contained_frac(b, g) for g in gts), default=0.0)
            if best_cont >= 0.70:
                buckets["fragment_inside_gt"] += 1
            elif best_iou > 0.0:
                buckets["localisation_error"] += 1
            else:
                buckets["spurious_no_overlap"] += 1
    return {"n_fp": total,
            **{k: {"n": v, "frac": v / max(total, 1)} for k, v in buckets.items()}}


# --------------------------------------------------------- azimuth-cue test ---
def _auc(pos, neg):
    """Mann-Whitney AUC. Higher score = more likely positive."""
    if not pos or not neg:
        return float("nan")
    allv = np.array(pos + neg, dtype=float)
    order = allv.argsort()
    ranks = np.empty(len(allv), dtype=float)
    ranks[order] = np.arange(1, len(allv) + 1)
    # average ranks over ties
    _, inv, cnt = np.unique(allv, return_inverse=True, return_counts=True)
    sums = np.zeros(len(cnt))
    np.add.at(sums, inv, ranks)
    ranks = (sums / cnt)[inv]
    n1 = len(pos)
    return float((ranks[:n1].sum() - n1 * (n1 + 1) / 2) / (n1 * len(neg)))


def azimuth_cue_test(gt_by_img, det_by_img, img_h,
                     low_thr=0.25, anchor_thr=0.50, match_iou=0.5):
    """Among LOW-confidence detections, does azimuth proximity to a HIGH-confidence
    detection separate true positives from false positives?

    Returns AUC. ~0.50 => the cue carries no information in the predictions and
    azimuth re-ranking cannot work, regardless of parameter choice.
    """
    pos, neg = [], []
    for iid, gts in gt_by_img.items():
        ds = det_by_img.get(iid, [])
        if not ds or not gts:
            continue
        H = img_h[iid]
        anchors = [d for d in ds if d["score"] >= anchor_thr]
        if not anchors:
            continue
        low = [d for d in ds if d["score"] < low_thr]
        if not low:
            continue
        # which low-conf dets are true positives against GT not already taken
        # by the confident detections?
        taken, _ = greedy_match(gts, anchors, match_iou)
        free = [g for gi, g in enumerate(gts) if gi not in taken]
        tp_idx, _ = greedy_match(free, low, match_iou)
        is_tp = set(tp_idx.values())
        acy = [a["bbox"][1] + a["bbox"][3] / 2 for a in anchors]
        for li, d in enumerate(low):
            yc = d["bbox"][1] + d["bbox"][3] / 2
            cue = -min(abs(yc - a) for a in acy) / H   # closer = higher score
            (pos if li in is_tp else neg).append(cue)
    return {"auc": _auc(pos, neg), "n_tp": len(pos), "n_fp": len(neg)}


# ------------------------------------------------------------- report ---
def report(gt_by_img, det_by_img, img_h, tag, score_thrs=(0.05, 0.25)):
    sc = np.array([d["score"] for v in det_by_img.values() for d in v])
    lines = [f"===== {tag} =====",
             f"images {len(det_by_img)}  detections {len(sc)}",
             "score distribution: " + "  ".join(
                 f"q{p}={np.percentile(sc, p):.4f}" for p in (50, 90, 99)) +
             f"   n>=0.25: {(sc >= 0.25).sum()}   n>=0.50: {(sc >= 0.50).sum()}"]
    if (sc >= 0.50).sum() < 200:
        lines.append("  [!] very few detections above the 0.50 anchor threshold — "
                     "the azimuth test below may be starved; thresholds need retuning.")
    for thr in score_thrs:
        lines.append(f"\n-- fragmentation audit @ score>={thr} "
                     f"(union of assigned dets vs best single det) --")
        lines.append(f"{'class':<8}{'n_gt':>6}{'best_IoU':>10}{'union_IoU':>11}"
                     f"{'delta':>8}{'dets/GT':>9}{'frac+0.1':>10}")
        fa = fragmentation_audit(gt_by_img, det_by_img, thr)
        for cls in ("small", "medium", "large"):
            if cls not in fa:
                continue
            r = fa[cls]
            lines.append(f"{cls:<8}{r['n_gt']:>6}{r['mean_best_iou']:>10.4f}"
                         f"{r['mean_union_iou']:>11.4f}{r['delta']:>+8.4f}"
                         f"{r['mean_dets_per_gt']:>9.2f}"
                         f"{r['frac_gt_union_better_by_0.1']:>10.3f}")
        fp = fp_decomposition(gt_by_img, det_by_img, thr)
        lines.append(f"\n-- false-positive decomposition @ score>={thr} "
                     f"(n_fp={fp['n_fp']}) --")
        for k in ("fragment_inside_gt", "localisation_error", "spurious_no_overlap"):
            v = fp.get(k, {"n": 0, "frac": 0.0})
            lines.append(f"  {k:<24}{v['n']:>7}  {v['frac']:>7.1%}")
    az = azimuth_cue_test(gt_by_img, det_by_img, img_h)
    lines.append(f"\n-- azimuth-cue prerequisite (low-conf TP vs FP) --")
    lines.append(f"  AUC = {az['auc']:.4f}   (0.50 = no information)  "
                 f"n_tp={az['n_tp']} n_fp={az['n_fp']}")
    if az["n_tp"] < 50:
        lines.append("  [!] n_tp too small to trust this AUC — test is starved, "
                     "not informative. Ignore the number.")
    return "\n".join(lines)
