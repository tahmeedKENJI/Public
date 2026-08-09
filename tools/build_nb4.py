"""Builds the Phase-4 training notebook (one experiment per run)."""
import json, pathlib

cells = []
def md(s): cells.append({"cell_type":"markdown","metadata":{},"source":s.rstrip("\n")})
def code(s): cells.append({"cell_type":"code","execution_count":None,"metadata":{},
                           "outputs":[],"source":s.rstrip("\n")})

md("""# ClearSAR Track-1 — Phase 4 · training experiments

Track A is closed: linear soft-NMS at `iou=0.6` is worth **+0.0038** and everything else
was refuted. The remaining headroom is in training, and the diagnosis says where.

### The diagnosis this targets

The model is **localisation-limited, not detection-limited**. For large objects the best
IoU available at score >= 0.05 is 0.669 but only 0.294 at score >= 0.25 — and since the
first candidate set contains the second, a well-localised detection provably exists and is
being outranked by a badly-localised one. AP75/AP50 = 0.60 against 0.75–0.80 for
well-localised COCO detectors.

### Scores to beat

| pipeline | plain | TTA |
|---|---|---|
| E01 RGB baseline | 0.3940 | 0.4014 |
| E01 RGB **+ linear soft-NMS 0.6** | 0.3965 | **0.4051** |

The right-hand column is the real bar: soft-NMS is free, so a new model only counts if it
beats **0.4051** after the same post-processing. This notebook reports both.

### One variable per run

Set `EXPERIMENT` below and run. Everything else is byte-identical to E01, so each result
is attributable to a single change.

| EXPERIMENT | change | why |
|---|---|---|
| `p2` | P2 detection head, stride 4 | median box is 19.8 px at imgsz 1024: 2.5 cells at stride 8, 5 at stride 4 |
| `loss` | `box=10.0, dfl=2.5` (from 7.5/1.5) | there is AP50 to spare and AP75 to gain |
| `aug` | `mosaic=0.5, scale=0.25, close_mosaic=30` | mild; see the note below |
| `p2_loss` | both of the first two | only after both win individually |

**On `aug`:** the handoff claimed the current setting silently discards 6.5% of boxes and
crushes the median box to 4.9 px. Measured directly, neither holds — worst-case median is
9.9 px (not 4.9), only 0.44% of boxes fall below the 2 px `wh_thr`, and since `E[s] = 1.0`
the *average* training box size is unchanged. Most box loss under mosaic is ordinary
cropping, which is by design. Run `p2` and `loss` first.""")

code("""# ============================== CONFIG ==============================
MODE       = 'train'       # 'train' | 'resume' | 'eval'
EXPERIMENT = 'p2'          # 'p2' | 'loss' | 'aug' | 'p2_loss' | 'baseline'
EPOCHS     = 100           # 100 does NOT fit Kaggle's 12h limit for p2 (~491 s/epoch)
BATCH      = None          # None = auto (4 for P2, else 8). Lower this on OOM.

# 'resume' and 'eval' need a checkpoint. Leave None to auto-discover any
# last.pt / best.pt under /kaggle/input, including ones Kaggle has unzipped
# into a directory.
CKPT = None
# ====================================================================
from pathlib import Path
import os, json, zipfile

KAGGLE_INPUT = Path('/kaggle/input')
WORK = Path('/kaggle/working'); WORK.mkdir(exist_ok=True)

def _walk(root):
    for r, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        yield Path(r), files

hits = [p/'instances_train.json' for p, f in _walk(KAGGLE_INPUT) if 'instances_train.json' in f]
assert hits, 'ClearSAR dataset not attached'
ANNOTATIONS = hits[0]
_probe = json.loads(ANNOTATIONS.read_text())
names = [im['file_name'] for im in _probe['images'][:5]]
IMAGES_TRAIN = next((p for p, f in _walk(KAGGLE_INPUT)
                     if names[0] in f and all((p/n).exists() for n in names)), None)
assert IMAGES_TRAIN, 'train images not found'
print('annotations :', ANNOTATIONS)
print('train images:', IMAGES_TRAIN, len(list(IMAGES_TRAIN.glob('*.png'))), 'png')
print('mode        :', MODE, '| experiment:', EXPERIMENT)

# --- checkpoint discovery, incl. archives Kaggle unpacked into directories ---
_HEAD = ['data.pkl', 'byteorder', 'version', '.format_version',
         '.storage_alignment', '.data/serialization_id']

def repack_pt(src, out):
    src, out = Path(src), Path(out)
    missing = [n for n in ('data.pkl', 'version') if not (src/n).is_file()]
    if not (src/'data').is_dir(): missing.append('data/')
    if missing: raise FileNotFoundError(f'{src} missing {missing}')
    out.parent.mkdir(parents=True, exist_ok=True)
    members = [(src/n, n) for n in _HEAD if (src/n).is_file()]
    for f in sorted((src/'data').iterdir(),
                    key=lambda q: (not q.name.isdigit(),
                                   int(q.name) if q.name.isdigit() else q.name)):
        if f.is_file(): members.append((f, f'data/{f.name}'))
    known = {m[1] for m in members}
    for r, _d, fs in os.walk(src, followlinks=True):
        for f in fs:
            p = Path(r)/f; rel = str(p.relative_to(src))
            if rel not in known: members.append((p, rel))
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
        for p, rel in members: z.write(p, str(Path(out.stem)/rel))
    return out

def find_checkpoints():
    found = []
    for d, files in _walk(KAGGLE_INPUT):
        for f in files:
            if f.lower().endswith(('.pt', '.pth')): found.append(Path(d)/f)
        if 'data.pkl' in files and (d/'data').is_dir():           # Kaggle unzipped it
            out = WORK/'repacked'/f'{d.parent.name}_{d.name}.pt'
            if not out.exists():
                repack_pt(d, out); print(f'repacked {d} -> {out}')
            found.append(out)
    return sorted(found)

if MODE in ('resume', 'eval'):
    if CKPT:
        CKPT = Path(CKPT)
    else:
        cands = find_checkpoints()
        assert cands, ('No checkpoint found under /kaggle/input. Attach the dataset '
                       'containing your run\\'s weights/last.pt.')
        print('checkpoints found:')
        for c in cands: print('   ', c, f'{c.stat().st_size/1e6:.1f} MB')
        pref = [c for c in cands if c.stem.endswith('last') or 'last' in c.name]
        CKPT = (pref or cands)[0]
    print(f'\\nusing checkpoint: {CKPT}')

    import torch
    try: _ck = torch.load(CKPT, map_location='cpu', weights_only=False)
    except TypeError: _ck = torch.load(CKPT, map_location='cpu')
    print(f"  trained epoch   : {_ck.get('epoch')}   (-1 means the run had finished)")
    print(f"  best_fitness    : {_ck.get('best_fitness')}")
    _ta = _ck.get('train_args', {}) or {}
    print(f"  epochs target   : {_ta.get('epochs')}   close_mosaic={_ta.get('close_mosaic')}")
    print(f"  box={_ta.get('box')} dfl={_ta.get('dfl')} batch={_ta.get('batch')} imgsz={_ta.get('imgsz')}")
    del _ck""")

code("!pip -q install ultralytics pycocotools")

md("## Helpers — identical split and metric to every previous phase")

code('''import io
from collections import defaultdict
from contextlib import redirect_stdout
import numpy as np

RFI_CLASS_ID = 0
SMALL_MAX, MEDIUM_MAX = 32**2, 96**2

def coco_bbox_to_yolo(bbox, W, H):
    x, y, w, h = bbox
    x0, y0 = max(0.0, min(float(x), W)), max(0.0, min(float(y), H))
    x1, y1 = max(0.0, min(x + w, float(W))), max(0.0, min(y + h, float(H)))
    return ((x0+x1)/2/W, (y0+y1)/2/H, max(0.0,x1-x0)/W, max(0.0,y1-y0)/H)

def yolo_predictions_to_coco(image_id, boxes_xywh, scores):
    return [{"image_id": int(image_id), "category_id": 1,
             "bbox": [float(cx-w/2), float(cy-h/2), float(w), float(h)], "score": float(s)}
            for (cx, cy, w, h), s in zip(boxes_xywh, scores)]

def _boxes_by_image(coco):
    d = defaultdict(list)
    for a in coco["annotations"]: d[a["image_id"]].append(a["bbox"])
    return d

def write_yolo_labels(coco, ids, labels_dir):
    labels_dir = Path(labels_dir); labels_dir.mkdir(parents=True, exist_ok=True)
    dims = {im["id"]: (im["width"], im["height"]) for im in coco["images"]}
    boxes, n = _boxes_by_image(coco), 0
    for iid in ids:
        W, H = dims[iid]; lines = []
        for bbox in boxes.get(iid, []):
            cx, cy, w, h = coco_bbox_to_yolo(bbox, W, H)
            if w > 0 and h > 0:
                lines.append(f"{RFI_CLASS_ID} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"); n += 1
        (labels_dir / f"{iid}.txt").write_text("\\n".join(lines) + ("\\n" if lines else ""))
    return n

def _link_images(ids, images_root, dst_dir):
    images_root, dst_dir = Path(images_root), Path(dst_dir); dst_dir.mkdir(parents=True, exist_ok=True)
    for iid in ids:
        dst = dst_dir / f"{iid}.png"
        if dst.exists() or dst.is_symlink(): dst.unlink()
        os.symlink((images_root / f"{iid}.png").resolve(), dst)

def build_yolo_dataset(coco, images_root, train_ids, val_ids, out_dir):
    out = Path(out_dir)
    _link_images(train_ids, images_root, out/"images/train")
    _link_images(val_ids,   images_root, out/"images/val")
    nb_tr = write_yolo_labels(coco, train_ids, out/"labels/train")
    nb_va = write_yolo_labels(coco, val_ids,   out/"labels/val")
    (out/"data.yaml").write_text(f"path: {out.resolve()}\\ntrain: images/train\\nval: images/val\\nnc: 1\\nnames:\\n  0: RFI\\n")
    print(f"YOLO dataset: {len(train_ids)} train ({nb_tr} boxes) / {len(val_ids)} val ({nb_va} boxes)")
    return out/"data.yaml"

def _cbucket(n): return "n0" if n==0 else "n1" if n==1 else "n2-3" if n<=3 else "n4-7" if n<=7 else "n8+"
def _sclass(a): return "s" if a<SMALL_MAX else "m" if a<MEDIUM_MAX else "l"
def _abucket(w,h):
    r=w/max(h,1); return "a_tall" if r<1.2 else "a_std" if r<1.8 else "a_wide"

def stratified_split(coco, val_frac=0.2, seed=42):
    bbi=_boxes_by_image(coco); feats={}
    for im in coco["images"]:
        anns=bbi.get(im["id"],[]); n=len(anns)
        dom="none" if n==0 else _sclass(max(b[2]*b[3] for b in anns))
        feats[im["id"]]=f"{_cbucket(n)}|{dom}|{_abucket(im['width'],im['height'])}"
    by=defaultdict(list)
    for iid,k in feats.items(): by[k].append(iid)
    rng=np.random.default_rng(seed); tr,va,carry=[],[],0.0
    for key in sorted(by):
        ids=sorted(by[key]); rng.shuffle(ids)
        exact=len(ids)*val_frac+carry; k=max(0,min(len(ids),int(round(exact)))); carry=exact-k
        va+=ids[:k]; tr+=ids[k:]
    return sorted(tr), sorted(va)

def subset_coco(coco, ids):
    s=set(ids)
    return {"images":[i for i in coco["images"] if i["id"] in s],
            "annotations":[a for a in coco["annotations"] if a["image_id"] in s],
            "categories":coco["categories"]}

from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
STAT_NAMES=["mAP","AP50","AP75","AP_small","AP_medium","AP_large","AR1","AR10","AR100","AR_small","AR_medium","AR_large"]
def evaluate_map(gt_dict, dets):
    if not dets: return {n:0.0 for n in STAT_NAMES}
    with redirect_stdout(io.StringIO()):
        cg=COCO(); cg.dataset=gt_dict; cg.createIndex()
        cd=cg.loadRes([dict(d) for d in dets]); ev=COCOeval(cg,cd,iouType="bbox")
        ev.evaluate(); ev.accumulate(); ev.summarize()
    return dict(zip(STAT_NAMES,[float(x) for x in ev.stats]))
print("helpers ready")''')

md("## The Track-A winner: linear soft-NMS, applied to every result below")

code('''def _soft_nms_image(xyxy, s, iou_thr=0.6, score_thr=1e-4, max_det=300):
    area = (xyxy[:,2]-xyxy[:,0]) * (xyxy[:,3]-xyxy[:,1])
    x0 = np.maximum(xyxy[:,None,0], xyxy[None,:,0]); y0 = np.maximum(xyxy[:,None,1], xyxy[None,:,1])
    x1 = np.minimum(xyxy[:,None,2], xyxy[None,:,2]); y1 = np.minimum(xyxy[:,None,3], xyxy[None,:,3])
    inter = np.clip(x1-x0,0,None) * np.clip(y1-y0,0,None)
    iou = inter / np.maximum(area[:,None]+area[None,:]-inter, 1e-9)
    s = s.copy(); keep = []; idx = list(range(len(s)))
    while idx and len(keep) < max_det:
        j = max(idx, key=lambda k: s[k])
        if s[j] < score_thr: break
        keep.append(j); idx.remove(j)
        rest = np.array(idx, dtype=int)
        if rest.size == 0: break
        v = iou[j, rest]
        s[rest] *= np.where(v > iou_thr, 1 - v, 1.0)      # linear decay
        idx = [k for k in idx if s[k] >= score_thr]
    k = np.array(keep, dtype=int)
    return xyxy[k], s[k]

def soft_nms(dets, iou_thr=0.6, max_det=300):
    by = defaultdict(list)
    for d in dets: by[d["image_id"]].append(d)
    out = []
    for iid, ds in by.items():
        b = np.array([d["bbox"] for d in ds], dtype=np.float64)
        s = np.array([d["score"] for d in ds], dtype=np.float64)
        xyxy = np.stack([b[:,0], b[:,1], b[:,0]+b[:,2], b[:,1]+b[:,3]], 1)
        o = np.argsort(-s); xyxy, s = xyxy[o], s[o]
        xyxy, s = _soft_nms_image(xyxy, s, iou_thr, max_det=max_det)
        out += [{"image_id": int(iid), "category_id": 1,
                 "bbox": [float(a), float(bb), float(c-a), float(d-bb)], "score": float(sc)}
                for (a,bb,c,d), sc in zip(xyxy, s)]
    return out
print("soft-nms ready")''')

md("## Dataset — same seed-42 split, asserted")

code("""coco = json.loads(ANNOTATIONS.read_text())
train_ids, val_ids = stratified_split(coco, 0.2, 42)
assert (len(train_ids), len(val_ids)) == (2523, 631), (len(train_ids), len(val_ids))
val_gt = subset_coco(coco, val_ids)
YOLO_DS = WORK/'yolo_ds'
data_yaml = build_yolo_dataset(coco, IMAGES_TRAIN, train_ids, val_ids, YOLO_DS)""")

md("""## Model and config

**ultralytics does not ship a P2 config for YOLO11** — 8.4.116 has only
`yolo26-p2.yaml`, `yolov8-p2.yaml` and `yolov8-ghost-p2.yaml`. So the cell writes one,
derived from `yolo11.yaml` by applying the `yolov8-p2.yaml` pattern: the neck is extended
one level further up to the P2/4 backbone feature (index 2), and `Detect` consumes four
scales instead of three.

Only the unscaled `yolo11-p2.yaml` needs to exist on disk; asking for `yolo11l-p2.yaml`
makes ultralytics parse the `l` scale from the name and load the shared file. Verified to
build at 26,116,368 parameters with strides `[4, 8, 16, 32]`, and to transfer 100% of the
pretrained backbone from `yolo11l.pt`. The stride-4 branch and the later neck layers train
from scratch, exactly as ultralytics' own `yolov8-p2` behaves.""")

code('''import ultralytics
from ultralytics import YOLO
print('ultralytics', ultralytics.__version__)

P2_YAML = """__P2_YAML__"""

# E01's config, unchanged. Each experiment edits exactly one group of keys.
cfg = dict(epochs=EPOCHS, imgsz=1024, patience=30, cos_lr=True, single_cls=True,
           degrees=0.0, shear=0.0, perspective=0.0, translate=0.1, scale=0.5,
           fliplr=0.5, flipud=0.5, hsv_h=0.0, hsv_s=0.3, hsv_v=0.4,
           mosaic=1.0, close_mosaic=15, mixup=0.0)
weights, model_yaml = 'yolo11l.pt', None

if EXPERIMENT in ('p2', 'p2_loss'):
    (WORK/'yolo11-p2.yaml').write_text(P2_YAML)      # ultralytics strips the scale letter
    model_yaml = str(WORK/'yolo11l-p2.yaml')         # ...and loads the file above
if EXPERIMENT in ('loss', 'p2_loss'):
    cfg.update(box=10.0, dfl=2.5)
if EXPERIMENT == 'aug':
    cfg.update(mosaic=0.5, scale=0.25, close_mosaic=30)

cfg['batch'] = BATCH if BATCH else (4 if model_yaml else 8)
RUN = f'yolo11l_{EXPERIMENT}'
print(f'\\nrun={RUN}  model={model_yaml or weights}  batch={cfg["batch"]}')
print('changed vs E01:', {k: v for k, v in cfg.items()
                          if k in ('box','dfl','mosaic','scale','close_mosaic','batch')})

if MODE == 'train':
    model = YOLO(model_yaml).load(weights) if model_yaml else YOLO(weights)
else:
    model = YOLO(str(CKPT))          # resume / eval: architecture comes from the ckpt

# Fail here rather than an hour into training if the head is not what we asked for.
strides = model.model.model[-1].stride.tolist()
n_params = sum(p.numel() for p in model.model.parameters())
print(f'strides={strides}  params={n_params:,}')
if EXPERIMENT in ('p2', 'p2_loss'):
    assert strides == [4.0, 8.0, 16.0, 32.0], f'expected a P2 head, got strides {strides}'
    print('P2 head confirmed: 4 detection scales, finest at stride 4')
else:
    assert strides == [8.0, 16.0, 32.0], strides''')

md("""### Train / resume

**Kaggle kills a session at 12 hours.** For `p2` at ~491 s/epoch that caps a fresh run at
roughly 85 epochs, so `EPOCHS = 100` cannot finish in one session. Either set `EPOCHS`
low enough to fit, or run to the limit and continue with `MODE = 'resume'`.

`last.pt` is written **every epoch** (`trainer.save_model` calls
`self.last.write_bytes(...)` unconditionally), and `best.pt` only when fitness improves,
so a killed run always leaves a checkpoint at its last completed epoch.

On resume ultralytics restores the training arguments from the checkpoint and only allows
a small whitelist to be overridden — `imgsz`, `batch`, `device`, `close_mosaic`,
`patience`, `save_dir` and a few others. **`epochs` is not on that list**, so a resumed run
always continues to the original target.""")

code("""if MODE == 'train':
    model.train(data=str(data_yaml), project=str(WORK/'runs'), name=RUN, **cfg)
elif MODE == 'resume':
    model.train(resume=str(CKPT), data=str(data_yaml))
else:
    print('MODE=eval — skipping training')""")

md("""## Score — raw and after soft-NMS, against both baselines

Predictions are made twice: at `iou=0.6` (comparable to the published baselines) and at
`iou=0.9, max_det=1000` (which soft-NMS then reduces offline, the Track-A winner).""")

code("""if MODE == 'eval':
    best = Path(CKPT)
else:
    best = Path(getattr(model, 'trainer', None) and model.trainer.save_dir
                or WORK/'runs'/RUN)/'weights'/'best.pt'
    if not best.exists():                      # resume may write to the ckpt's save_dir
        cands = sorted(WORK.rglob('weights/best.pt'), key=lambda p: p.stat().st_mtime)
        assert cands, 'no best.pt found after training'
        best = cands[-1]
print('scoring checkpoint:', best)
m = YOLO(str(best))
OUT = WORK/'phase4'; OUT.mkdir(exist_ok=True)

def predict(iou, max_det, augment):
    dets = []
    for r in m.predict(source=str(YOLO_DS/'images/val'), conf=0.001, iou=iou,
                       max_det=max_det, imgsz=cfg['imgsz'], augment=augment,
                       stream=True, verbose=False):
        b = r.boxes
        if b is None or len(b) == 0: continue
        dets += yolo_predictions_to_coco(int(Path(r.path).stem),
                                         b.xywh.cpu().numpy(), b.conf.cpu().numpy())
    return dets

REF = {('plain','raw'):0.3940, ('tta','raw'):0.4014,
       ('plain','soft'):0.3965, ('tta','soft'):0.4051}

import gzip
rows = []
for aug_tag, aug in (('plain', False), ('tta', True)):
    raw   = predict(0.6, 300, aug)
    loose = predict(0.9, 1000, aug)
    soft  = soft_nms(loose, iou_thr=0.6, max_det=300)
    for kind, dets in (('raw', raw), ('soft', soft)):
        r = evaluate_map(val_gt, dets)
        rows.append((aug_tag, kind, r, len(dets)))
        with gzip.open(OUT/f'{RUN}__{aug_tag}__{kind}.json.gz', 'wt') as f:
            json.dump([{**d, 'bbox':[round(v,3) for v in d['bbox']],
                        'score':round(d['score'],6)} for d in dets], f)

print(f"\\n=== {RUN} ===")
print(f"{'setting':<16}{'mAP':>9}{'E01 ref':>10}{'delta':>9}{'AP50':>9}{'AP75':>9}{'AP_l':>9}{'AR100':>9}")
print('-'*80)
for aug_tag, kind, r, n in rows:
    ref = REF[(aug_tag, kind)]
    print(f"{aug_tag+'/'+kind:<16}{r['mAP']:>9.4f}{ref:>10.4f}{r['mAP']-ref:>+9.4f}"
          f"{r['AP50']:>9.4f}{r['AP75']:>9.4f}{r['AP_large']:>9.4f}{r['AR100']:>9.4f}")

best_row = max(rows, key=lambda t: t[2]['mAP'])
print(f"\\nbest here: {best_row[0]}/{best_row[1]} = {best_row[2]['mAP']:.4f}")
print(f"bar to beat (E01 + soft-NMS, TTA): 0.4051  ->  "
      f"{'BEATS IT' if best_row[2]['mAP'] > 0.4051 else 'does not beat it'}")""")

md("""## What to send back

The final score table, plus the `changed vs E01` line so the run is identifiable. The
`.json.gz` files only matter if the model wins and we want to re-tune post-processing on it.

Then change `EXPERIMENT` and run again. Suggested order: **`p2`**, then **`loss`**, then
`p2_loss` only if both won individually.""")

p2_yaml_text = pathlib.Path(__file__).with_name("yolo11-p2.yaml").read_text()
assert '"""' not in p2_yaml_text, 'yaml would break the embedded string literal'
for c in cells:
    if c["cell_type"] == "code" and "__P2_YAML__" in c["source"]:
        c["source"] = c["source"].replace("__P2_YAML__", p2_yaml_text)

nb = {"cells": cells,
      "metadata": {"kernelspec": {"display_name":"Python 3","language":"python","name":"python3"},
                   "language_info": {"name":"python","version":"3.11"}},
      "nbformat": 4, "nbformat_minor": 5}
out = pathlib.Path(__file__).with_name("clearsar_phase4_training.ipynb")
out.write_text(json.dumps(nb, indent=1))
print("wrote", out, out.stat().st_size, "bytes,", len(cells), "cells")
