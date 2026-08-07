"""Offline post-processing operators for COCO-format detections.

Every operator takes and returns a flat list of detection dicts
({image_id, category_id, bbox[xywh], score}) so they compose freely.
"""
import numpy as np
from collections import defaultdict


def group(dets):
    by = defaultdict(list)
    for d in dets:
        by[d["image_id"]].append(d)
    return by


def _arrays(ds):
    b = np.array([d["bbox"] for d in ds], dtype=np.float64)
    s = np.array([d["score"] for d in ds], dtype=np.float64)
    xyxy = np.stack([b[:, 0], b[:, 1], b[:, 0] + b[:, 2], b[:, 1] + b[:, 3]], 1)
    return xyxy, s, b[:, 2] * b[:, 3]


def _pairwise(xyxy, area):
    """Returns (iou, ios) — ios is intersection over the SMALLER box."""
    x0 = np.maximum(xyxy[:, None, 0], xyxy[None, :, 0])
    y0 = np.maximum(xyxy[:, None, 1], xyxy[None, :, 1])
    x1 = np.minimum(xyxy[:, None, 2], xyxy[None, :, 2])
    y1 = np.minimum(xyxy[:, None, 3], xyxy[None, :, 3])
    inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
    union = area[:, None] + area[None, :] - inter
    iou = inter / np.maximum(union, 1e-9)
    ios = inter / np.maximum(np.minimum(area[:, None], area[None, :]), 1e-9)
    return iou, ios


def _emit(iid, xyxy, scores):
    out = []
    for (a, b, c, d), s in zip(xyxy, scores):
        out.append({"image_id": int(iid), "category_id": 1,
                    "bbox": [float(a), float(b), float(c - a), float(d - b)],
                    "score": float(s)})
    return out


# --------------------------------------------------------------------- NMS ---
def nms(dets, iou_thr=0.6, max_det=300, ios_thr=None):
    """Greedy NMS. If ios_thr is given, also suppress boxes whose intersection
    over their OWN area exceeds it against a kept higher-scoring box — this is
    the containment criterion, which plain IoU cannot express for nested boxes.
    """
    out = []
    for iid, ds in group(dets).items():
        xyxy, s, area = _arrays(ds)
        order = np.argsort(-s)
        xyxy, s, area = xyxy[order], s[order], area[order]
        iou, _ = _pairwise(xyxy, area)
        # containment of j inside i = inter / area[j]
        if ios_thr is not None:
            x0 = np.maximum(xyxy[:, None, 0], xyxy[None, :, 0])
            y0 = np.maximum(xyxy[:, None, 1], xyxy[None, :, 1])
            x1 = np.minimum(xyxy[:, None, 2], xyxy[None, :, 2])
            y1 = np.minimum(xyxy[:, None, 3], xyxy[None, :, 3])
            inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
            contain = inter / np.maximum(area[None, :], 1e-9)   # [i, j]
        keep, n = [], len(s)
        alive = np.ones(n, dtype=bool)
        for i in range(n):
            if not alive[i]:
                continue
            keep.append(i)
            if len(keep) >= max_det:
                break
            sup = iou[i] > iou_thr
            if ios_thr is not None:
                sup |= contain[i] > ios_thr
            sup[: i + 1] = False
            alive &= ~sup
        keep = np.array(keep, dtype=int)
        out += _emit(iid, xyxy[keep], s[keep])
    return out


# ---------------------------------------------------------------- soft-NMS ---
def soft_nms(dets, iou_thr=0.6, sigma=0.5, score_thr=1e-4, max_det=300,
             method="gaussian"):
    out = []
    for iid, ds in group(dets).items():
        xyxy, s, area = _arrays(ds)
        order = np.argsort(-s)
        xyxy, s, area = xyxy[order], s[order], area[order]
        iou, _ = _pairwise(xyxy, area)
        s = s.copy()
        keep = []
        idx = list(range(len(s)))
        while idx and len(keep) < max_det:
            j = max(idx, key=lambda k: s[k])
            if s[j] < score_thr:
                break
            keep.append(j)
            idx.remove(j)
            rest = np.array(idx, dtype=int)
            if rest.size == 0:
                break
            v = iou[j, rest]
            if method == "gaussian":
                s[rest] *= np.exp(-(v ** 2) / sigma)
            else:
                s[rest] *= np.where(v > iou_thr, 1 - v, 1.0)
            idx = [k for k in idx if s[k] >= score_thr]
        keep = np.array(keep, dtype=int)
        out += _emit(iid, xyxy[keep], s[keep])
    return out


# --------------------------------------------------------------------- WBF ---
def wbf(dets, iou_thr=0.55, max_det=300, score_mode="avg", conf_type="avg"):
    """Weighted Box Fusion: cluster overlapping boxes and replace each cluster
    with the score-weighted average of its members' coordinates.

    Unlike a union envelope, averaging can move a badly-placed top box toward
    better-localised lower-scoring ones.
    """
    out = []
    for iid, ds in group(dets).items():
        xyxy, s, _ = _arrays(ds)
        order = np.argsort(-s)
        xyxy, s = xyxy[order], s[order]
        clusters = []          # each: [running fused box, list of member idx]
        for i in range(len(s)):
            best, best_iou = -1, iou_thr
            for ci, (fb, _members) in enumerate(clusters):
                x0 = max(fb[0], xyxy[i, 0]); y0 = max(fb[1], xyxy[i, 1])
                x1 = min(fb[2], xyxy[i, 2]); y1 = min(fb[3], xyxy[i, 3])
                iw, ih = max(0.0, x1 - x0), max(0.0, y1 - y0)
                inter = iw * ih
                a1 = (fb[2] - fb[0]) * (fb[3] - fb[1])
                a2 = (xyxy[i, 2] - xyxy[i, 0]) * (xyxy[i, 3] - xyxy[i, 1])
                v = inter / max(a1 + a2 - inter, 1e-9)
                if v > best_iou:
                    best, best_iou = ci, v
            if best < 0:
                clusters.append([xyxy[i].copy(), [i]])
            else:
                clusters[best][1].append(i)
                m = np.array(clusters[best][1])
                w = s[m]
                clusters[best][0] = (xyxy[m] * w[:, None]).sum(0) / w.sum()
        boxes, scores = [], []
        for fb, m in clusters:
            w = s[np.array(m)]
            sc = w.mean() if conf_type == "avg" else w.max()
            boxes.append(fb)
            scores.append(sc)
        boxes = np.array(boxes)
        scores = np.array(scores)
        o = np.argsort(-scores)[:max_det]
        out += _emit(iid, boxes[o], scores[o])
    return out


# ------------------------------------------------------- geometry re-rank ---
def size_rerank(dets, img_wh, modes=(0.06, 0.32), tol=0.08, penalty=0.85):
    """Demote detections whose width matches neither mode of the bimodal
    width distribution. Rank-only: cannot change which boxes are present."""
    out = []
    for d in dets:
        W = img_wh[d["image_id"]][0]
        fw = d["bbox"][2] / W
        if not any(abs(fw - m) < tol for m in modes):
            d = {**d, "score": d["score"] * penalty}
        out.append(d)
    return out
