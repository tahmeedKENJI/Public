"""Post-processing sweep with an honest held-out protocol.

The val fold is split deterministically in half. Every configuration is scored
on each half separately; the reported number is the held-out one (tune on A ->
report B, tune on B -> report A, average the two). In-fold gains are quoted
alongside only to show how much of the apparent lift is overfitting.
"""
import gzip, io, json, sys, time
from contextlib import redirect_stdout

import numpy as np
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

sys.path.insert(0, '.')
from ops import nms, soft_nms, wbf, size_rerank

D = 'trackA/trackA'
STAT = ["mAP", "AP50", "AP75", "AP_small", "AP_medium", "AP_large",
        "AR1", "AR10", "AR100", "AR_small", "AR_medium", "AR_large"]

val_gt = json.load(open('val_gt.json'))
val_ids = sorted(im['id'] for im in val_gt['images'])
FOLD_A = set(val_ids[0::2])
FOLD_B = set(val_ids[1::2])


def sub_gt(ids):
    return {"images": [i for i in val_gt['images'] if i['id'] in ids],
            "annotations": [a for a in val_gt['annotations'] if a['image_id'] in ids],
            "categories": val_gt['categories']}


GT = {'A': sub_gt(FOLD_A), 'B': sub_gt(FOLD_B), 'all': val_gt}
IMG_WH = {i['id']: (i['width'], i['height']) for i in val_gt['images']}


def ev(dets, which='all'):
    ds = dets if which == 'all' else [d for d in dets if d['image_id'] in
                                      (FOLD_A if which == 'A' else FOLD_B)]
    if not ds:
        return {n: 0.0 for n in STAT}
    with redirect_stdout(io.StringIO()):
        cg = COCO(); cg.dataset = GT[which]; cg.createIndex()
        cd = cg.loadRes([dict(d) for d in ds])
        e = COCOeval(cg, cd, iouType="bbox")
        e.evaluate(); e.accumulate(); e.summarize()
    return dict(zip(STAT, [float(x) for x in e.stats]))


def load(tag):
    return json.loads(gzip.open(f'{D}/{tag}.json.gz', 'rt').read())


def run_sweep(source, configs, label):
    """configs: list of (name, callable(dets)->dets). Returns list of rows."""
    rows = []
    for name, fn in configs:
        t0 = time.time()
        out = fn(source)
        r = {'name': name,
             'A': ev(out, 'A')['mAP'], 'B': ev(out, 'B')['mAP'],
             'all': ev(out, 'all'), 'n': len(out), 't': time.time() - t0}
        rows.append(r)
        print(f"  {name:<38} A={r['A']:.4f} B={r['B']:.4f} all={r['all']['mAP']:.4f} "
              f"({r['n']:>6} dets, {r['t']:.0f}s)", flush=True)
    return rows


def held_out(rows, baseline_a, baseline_b):
    """Pick the winner on A, report its B score, and vice versa."""
    best_a = max(rows, key=lambda r: r['A'])
    best_b = max(rows, key=lambda r: r['B'])
    gain_b = best_a['B'] - baseline_b      # chosen on A, measured on B
    gain_a = best_b['A'] - baseline_a      # chosen on B, measured on A
    return best_a, best_b, (gain_a + gain_b) / 2
