"""Builds the Track-A Kaggle notebook."""
import json, pathlib

AUDIT = pathlib.Path(__file__).with_name("audit_lib.py").read_text()
# strip the module docstring — it is re-stated in the notebook markdown
AUDIT = AUDIT.split('"""', 2)[2].lstrip("\n")

cells = []


def md(src):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": src.rstrip("\n")})


def code(src):
    cells.append({"cell_type": "code", "execution_count": None, "metadata": {},
                  "outputs": [], "source": src.rstrip("\n")})


md("""# ClearSAR Track-1 — Phase 3 · Track A diagnostics

**Read-only w.r.t. training.** This notebook does not train anything. It loads your
existing best checkpoints, regenerates val-fold predictions at two NMS settings, scores
them with the official metric, and runs three diagnostics that decide whether the
post-processing work is worth doing.

### Setup — attach two datasets, edit nothing
1. Your **ClearSAR dataset** (the one with the train PNGs and `instances_train.json`).
2. Your **runs dataset** (`q-clearsar-output-runs`) with the `best.pt` checkpoints.

Then **Settings → Accelerator = GPU**, **Internet = ON**, **Run All**.

There are no paths to fill in. The annotations, the train images and the checkpoints are
all located by searching `/kaggle/input`, so dataset slugs and internal folder layouts do
not matter. The first cell prints everything that is attached, so if something is missing
the listing shows it immediately.

### Why two NMS settings
The published run used `iou=0.6`, which has already merged overlapping boxes. Re-running
NMS offline on those outputs can only ever suppress *more*, never less — so a sweep over
`iou` above 0.6 would be impossible, and any fragments that NMS already deleted are
invisible to the fragmentation audit. So we also emit a **loose** set at `iou=0.9,
max_det=1000` that retains near-duplicates. The tight set reproduces your headline
number; the loose set is what the offline sweep will actually operate on.

### What to send back
The **full printed output** of every cell (that alone answers the go/no-go question),
plus the `*.json.gz` files listed at the end if you can upload them.""")

code('''# ============================== CONFIG ==============================
# Nothing here needs editing. Attach the two datasets and Run All — the
# annotations, the train images and the checkpoints are all located by
# searching /kaggle/input, so dataset slugs and folder layouts do not matter.
from pathlib import Path
import os, json

# Only set these if auto-discovery fails and the cell tells you to.
ANNOTATIONS_OVERRIDE  = None   # e.g. Path('/kaggle/input/<slug>/annotations/instances_train.json')
IMAGES_TRAIN_OVERRIDE = None   # e.g. Path('/kaggle/input/<slug>/images/train')
CKPT_PATHS            = []     # e.g. ['/kaggle/input/<slug>/YOLO_Phase_01/best/best.pt']

CONF        = 0.001
TIGHT_IOU, TIGHT_MAXDET = 0.60, 300   # reproduces the published E01/E04 numbers
LOOSE_IOU, LOOSE_MAXDET = 0.90, 1000  # retains fragments for the offline sweep
RUN_TTA     = True

KAGGLE_INPUT = Path('/kaggle/input')
WORK = Path('/kaggle/working'); WORK.mkdir(exist_ok=True)
OUT  = WORK/'trackA'; OUT.mkdir(exist_ok=True)
# ====================================================================

def _walk(root):
    """Yield (dir, files) under root, skipping hidden dirs.

    followlinks=True matters: Kaggle can mount dataset subdirectories as
    symlinks, and the default os.walk / glob behaviour silently skips them.
    """
    for r, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        yield Path(r), files

def print_tree(root, max_depth=4, max_entries=25):
    root = Path(root)
    for r, files in _walk(root):
        depth = len(r.relative_to(root).parts)
        if depth > max_depth:
            continue
        pad = '  ' * depth
        print(f'{pad}{r.name or str(root)}/')
        for f in sorted(files)[:max_entries]:
            try: sz = f'  {(r/f).stat().st_size/1e6:.1f} MB'
            except OSError: sz = ''
            print(f'{pad}  {f}{sz}')
        if len(files) > max_entries:
            print(f'{pad}  ... +{len(files)-max_entries} more files')

# ---- 1. show what is actually attached -----------------------------------
print('=== /kaggle/input ===')
if not KAGGLE_INPUT.exists():
    raise FileNotFoundError('/kaggle/input does not exist')
tops = sorted(KAGGLE_INPUT.iterdir())
if not tops:
    print('  (empty — no datasets attached)')
for d in tops:
    print(f'  {d.name}/')
    if d.is_dir():
        for s in sorted(d.iterdir())[:10]:
            extra = ''
            if s.is_dir():
                try: extra = f'  ({len(os.listdir(s))} entries)'
                except OSError: pass
            print(f'      {s.name}{"/" if s.is_dir() else ""}{extra}')

# ---- 2. locate instances_train.json --------------------------------------
if ANNOTATIONS_OVERRIDE:
    ANNOTATIONS = Path(ANNOTATIONS_OVERRIDE)
else:
    hits = [p/'instances_train.json' for p, files in _walk(KAGGLE_INPUT)
            if 'instances_train.json' in files]
    if not hits:
        raise FileNotFoundError(
            'instances_train.json not found anywhere under /kaggle/input.\\n'
            'The ClearSAR dataset is not attached — add it via Add Input (right panel).\\n'
            'See the listing above for what IS attached.')
    if len(hits) > 1:
        print(f'\\n[!] {len(hits)} candidates, using the first:')
        for h in hits: print('   ', h)
    ANNOTATIONS = hits[0]

coco_probe = json.loads(ANNOTATIONS.read_text())
print(f'\\nannotations  : {ANNOTATIONS}')
print(f'               {len(coco_probe["images"])} images, {len(coco_probe["annotations"])} boxes')

# ---- 3. locate the train images by looking for files the JSON names ------
if IMAGES_TRAIN_OVERRIDE:
    IMAGES_TRAIN = Path(IMAGES_TRAIN_OVERRIDE)
else:
    probe = [im['file_name'] for im in coco_probe['images'][:5]]
    IMAGES_TRAIN = None
    for p, files in _walk(KAGGLE_INPUT):
        if probe[0] in files and all((p/n).exists() for n in probe):
            IMAGES_TRAIN = p; break
    if IMAGES_TRAIN is None:
        raise FileNotFoundError(
            f'Could not find a directory containing the annotated images '
            f'(looked for {probe[0]}).\\nSet IMAGES_TRAIN_OVERRIDE above.')

n_png = len(list(IMAGES_TRAIN.glob("*.png")))
print(f'train images : {IMAGES_TRAIN}')
print(f'               {n_png} png files')
if n_png < len(coco_probe['images']):
    print(f'[!] fewer images ({n_png}) than annotation entries '
          f'({len(coco_probe["images"])}) — check this is the full train split.')''')

code("!pip -q install ultralytics pycocotools")

md("""## 1 · Discover the checkpoints and read what they were trained with

Every ultralytics checkpoint stores its `train_args`. That resolves — without guesswork —
the model family, the `imgsz` inference must match, and crucially whether the run trained
on `yolo_ds` (**plain RGB**) or `yolo_ds_comp` (**physics composite**), which determines
how we must preprocess the val images.

Expected here: **two YOLO runs**, `YOLO_Phase_01` on plain RGB (E01) and `Phase_02` on the
physics composite (E04) — both `yolo11l.pt` at `imgsz=1024`. The RT-DETR branch is kept
only as a fallback in case an older checkpoint turns up in the dataset.""")

code("""import torch, json, zipfile, os
from pathlib import Path
from collections import Counter

def load_ckpt(p):
    try:
        return torch.load(p, map_location='cpu', weights_only=False)
    except TypeError:
        return torch.load(p, map_location='cpu')

# ---------------------------------------------------------------------------
# Kaggle unpacks .pt files into directories.
#
# torch.save writes a ZIP archive, so Kaggle's ingestion sees the ZIP magic
# bytes and extracts it. What should be best.pt arrives as a directory named
# best/ holding data.pkl, data/0..N, version, byteorder and friends. Re-zipping
# those members restores a loadable checkpoint, with no re-upload needed.
#
# Entries must be STORED rather than deflated, and all members must sit under a
# single top-level directory, which is what torch treats as the archive root.
# ---------------------------------------------------------------------------
_HEAD = ['data.pkl', 'byteorder', 'version', '.format_version',
         '.storage_alignment', '.data/serialization_id']

def repack_pt(src_dir, out_path, arcroot=None):
    src, out = Path(src_dir), Path(out_path)
    # 'version' is mandatory — without it torch fails with a cryptic
    # hasRecord("version") error. The dotfiles are optional; torch loads fine
    # if Kaggle stripped them.
    missing = [n for n in ('data.pkl', 'version') if not (src/n).is_file()]
    if not (src/'data').is_dir(): missing.append('data/')
    if missing:
        raise FileNotFoundError(
            f'{src} is missing {missing}, so it cannot be rebuilt into a valid '
            f'checkpoint. Re-upload this run to Kaggle as a .tar.gz so it is not '
            f'unpacked, or point CKPT_PATHS at an intact .pt.')
    out.parent.mkdir(parents=True, exist_ok=True)
    arcroot = arcroot or out.stem
    members = [(src/n, n) for n in _HEAD if (src/n).is_file()]
    d = src/'data'
    if d.is_dir():
        for f in sorted(d.iterdir(), key=lambda q: (not q.name.isdigit(),
                        int(q.name) if q.name.isdigit() else q.name)):
            if f.is_file(): members.append((f, f'data/{f.name}'))
    known = {m[1] for m in members}
    for r, _dirs, files in os.walk(src, followlinks=True):
        for f in files:
            p = Path(r)/f
            rel = str(p.relative_to(src))
            if rel not in known: members.append((p, rel))
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
        for p, rel in members:
            z.write(p, str(Path(arcroot)/rel))
    return out, len(members)

CKPT_EXT = ('.pt', '.pth', '.ckpt')
MIN_CKPT_MB = 5.0        # a yolo11l checkpoint is ~50 MB; nothing smaller is one

# Inventory every file once: by extension, and every large file regardless of name.
ext_hist, big_files, found, unpacked = Counter(), [], [], []
for d, files in _walk(KAGGLE_INPUT):
    if 'data.pkl' in files and (d/'data').is_dir():
        unpacked.append(d)                      # an extracted checkpoint
    for f in files:
        p = d/f
        ext_hist[p.suffix.lower() or '(no extension)'] += 1
        try: mb = p.stat().st_size/1e6
        except OSError: continue
        if mb >= MIN_CKPT_MB: big_files.append((mb, str(p)))
        if f.lower().endswith(CKPT_EXT): found.append(str(p))

for d in sorted(unpacked):
    out_pt = WORK/'repacked'/f'{d.parent.name}_{d.name}.pt'
    if not out_pt.exists():
        _, n = repack_pt(d, out_pt)
        print(f'repacked (Kaggle had unzipped this checkpoint):\\n  {d}\\n'
              f'  -> {out_pt}  [{n} members, {out_pt.stat().st_size/1e6:.1f} MB]')
    found.append(str(out_pt))

if CKPT_PATHS:
    found = [str(p) for p in CKPT_PATHS]
    missing = [p for p in found if not Path(p).exists()]
    assert not missing, f'CKPT_PATHS entries do not exist: {missing}'
    print(f'using CKPT_PATHS override ({len(found)} file(s))')
found = sorted(found)
# drop last.pt when a sibling best.pt exists — otherwise every run is inferred twice
_best_dirs = {str(Path(p).parent) for p in found if Path(p).name == 'best.pt'}
_drop = [p for p in found if Path(p).name == 'last.pt' and str(Path(p).parent) in _best_dirs]
found = [p for p in found if p not in _drop]
for p in _drop:
    print(f'  [skip] {p}  (sibling best.pt present)')
print(f'found {len(found)} checkpoint file(s) under {KAGGLE_INPUT}\\n')

if not found:
    print('file types present:', dict(ext_hist.most_common(20)))
    print(f'\\nfiles >= {MIN_CKPT_MB} MB (checkpoints are ~50 MB, whatever they are named):')
    for mb, p in sorted(big_files, reverse=True)[:25]:
        print(f'  {mb:8.1f} MB  {p}')
    if not big_files:
        print('  (none — no file under /kaggle/input is big enough to be a checkpoint,')
        print('   so the runs dataset is almost certainly not attached)')
    print('\\n=== full tree of /kaggle/input ===')
    print_tree(KAGGLE_INPUT)
    raise SystemExit(
        'No checkpoints found. If a large file is listed above, set CKPT_PATHS in the '
        'config cell to point at it. Otherwise attach the runs dataset via Add Input.')

RUNS = []
for p in found:
    try:
        ck = load_ckpt(p)
    except Exception as e:
        print(f'  [skip] {p}\\n         {type(e).__name__}: {e}'); continue
    ta = ck.get('train_args', {}) or {}
    base  = str(ta.get('model', '')).lower()
    data  = str(ta.get('data', '')).lower()
    fam   = 'rtdetr' if 'rtdetr' in base or 'rtdetr' in str(ta.get('name','')).lower() else 'yolo'
    comp  = 'comp' in data
    imgsz = int(ta.get('imgsz', 1024) or 1024)
    name  = ta.get('name') or Path(p).parent.parent.name
    RUNS.append(dict(path=p, family=fam, composite=comp, imgsz=imgsz, name=str(name)))
    print(f'* {p}')
    print(f'    name={name}  base_model={ta.get("model")}  imgsz={imgsz}  epochs={ta.get("epochs")}')
    print(f'    data={ta.get("data")}')
    print(f'    -> family={fam.upper()}   input={"PHYSICS COMPOSITE" if comp else "PLAIN RGB"}\\n')

assert RUNS, ('No usable checkpoints found under /kaggle/input. Attach the runs dataset '
              '(q-clearsar-output-runs) via Add Input; see the listing in the config cell '
              'for what is currently attached.')
print('torch', torch.__version__)
import ultralytics; print('ultralytics', ultralytics.__version__)""")

md("""If any row above is mislabelled, override it here before continuing — otherwise leave
this cell exactly as it is and run it.""")

code("""# Manual override, e.g.  OVERRIDE = {'Phase_02': dict(family='rtdetr', composite=False)}
OVERRIDE = {}

for r in RUNS:
    for key, patch in OVERRIDE.items():
        if key in r['path'] or key == r['name']:
            r.update(patch); print(f'overridden {r["name"]} -> {patch}')
for r in RUNS:
    print(f'{r["name"]:<28} {r["family"]:<7} imgsz={r["imgsz"]:<5} '
          f'input={"composite" if r["composite"] else "rgb"}')""")

md("## 2 · Inlined ClearSAR helpers (identical to your Phase-1/2 notebooks)")

code('''import os, io
from collections import defaultdict
from contextlib import redirect_stdout
import numpy as np

RFI_CLASS_ID = 0
SMALL_MAX, MEDIUM_MAX = 32**2, 96**2

def _boxes_by_image(coco):
    d = defaultdict(list)
    for a in coco["annotations"]: d[a["image_id"]].append(a["bbox"])
    return d

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

def yolo_predictions_to_coco(image_id, boxes_xywh, scores):
    out=[]
    for (cx,cy,w,h), s in zip(boxes_xywh, scores):
        out.append({"image_id": int(image_id), "category_id": 1,
                    "bbox":[float(cx-w/2), float(cy-h/2), float(w), float(h)],
                    "score": float(s)})
    return out

from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
STAT_NAMES=["mAP","AP50","AP75","AP_small","AP_medium","AP_large",
            "AR1","AR10","AR100","AR_small","AR_medium","AR_large"]

def evaluate_map(gt_dict, dets, verbose=False):
    if not dets: return {n:0.0 for n in STAT_NAMES}
    with redirect_stdout(io.StringIO()):
        cg=COCO(); cg.dataset=gt_dict; cg.createIndex()
        cd=cg.loadRes([dict(d) for d in dets]); ev=COCOeval(cg,cd,iouType="bbox")
        ev.evaluate(); ev.accumulate()
        buf=io.StringIO()
        with redirect_stdout(buf): ev.summarize()
    if verbose: print(buf.getvalue())
    return dict(zip(STAT_NAMES,[float(x) for x in ev.stats]))

print("helpers ready")''')

md("## 3 · Physics composite (verbatim from your Phase-2 notebook, so pixels match exactly)")

code('''def _box_mean(a, ky, kx):
    H, W = a.shape
    ii = np.zeros((H+1, W+1), dtype=np.float64); ii[1:,1:] = a.cumsum(0).cumsum(1)
    y0 = np.clip(np.arange(H)-ky, 0, H)[:,None]; y1 = np.clip(np.arange(H)+ky+1, 0, H)[:,None]
    x0 = np.clip(np.arange(W)-kx, 0, W)[None,:]; x1 = np.clip(np.arange(W)+kx+1, 0, W)[None,:]
    tot = ii[y1,x1]-ii[y0,x1]-ii[y1,x0]+ii[y0,x0]
    return tot/np.maximum((y1-y0)*(x1-x0), 1)

def cyan_excess(rgb):
    r,g,b = rgb[...,0].astype(np.float64), rgb[...,1].astype(np.float64), rgb[...,2].astype(np.float64)
    return (g+b)/2.0 - r

def horizontal_structure(gray, kx=25, ky_band=1, ky_ctx=25):
    return np.maximum(_box_mean(gray, ky_band, kx) - _box_mean(gray, ky_ctx, kx), 0.0)

def to_uint8(x, lo=1.0, hi=99.0):
    a, b = np.percentile(x, [lo, hi]); b = b if b > a else a+1.0
    return np.clip((x-a)/(b-a)*255.0, 0, 255).astype(np.uint8)

def physics_composite(rgb):
    gray = rgb.astype(np.float64).mean(2)
    return np.stack([to_uint8(cyan_excess(rgb)),
                     to_uint8(horizontal_structure(gray)),
                     to_uint8(gray)], axis=-1)
print("composite ready")''')

md("""## 4 · Rebuild the exact val fold and stage the val images

The split is deterministic (seed 42) and asserted to be 2523 / 631 — the same fold both
your runs were validated on. Only the 631 val images are staged, so the composite pass is
quick.""")

code("""from PIL import Image

coco = json.loads(ANNOTATIONS.read_text())
train_ids, val_ids = stratified_split(coco, 0.2, 42)
assert (len(train_ids), len(val_ids)) == (2523, 631), (len(train_ids), len(val_ids))
val_gt = subset_coco(coco, val_ids)
img_h  = {i['id']: i['height'] for i in coco['images']}
print(f'val fold: {len(val_ids)} images, {len(val_gt["annotations"])} boxes')

VAL_RGB  = WORK/'val_rgb'
VAL_COMP = WORK/'val_comp'

def stage_rgb():
    VAL_RGB.mkdir(exist_ok=True)
    for iid in val_ids:
        dst = VAL_RGB/f'{iid}.png'
        if dst.exists() or dst.is_symlink(): dst.unlink()
        os.symlink((IMAGES_TRAIN/f'{iid}.png').resolve(), dst)
    return VAL_RGB

def stage_comp():
    VAL_COMP.mkdir(exist_ok=True)
    done = len(list(VAL_COMP.glob('*.png')))
    if done == len(val_ids):
        print('composites already staged'); return VAL_COMP
    for i, iid in enumerate(val_ids):
        rgb = np.array(Image.open(IMAGES_TRAIN/f'{iid}.png').convert('RGB'))
        Image.fromarray(physics_composite(rgb)).save(VAL_COMP/f'{iid}.png')
        if (i+1) % 200 == 0: print(f'  composited {i+1}/{len(val_ids)}')
    return VAL_COMP

src_rgb = stage_rgb(); print('staged RGB   ->', src_rgb, len(list(src_rgb.glob('*.png'))))
if any(r['composite'] for r in RUNS):
    src_comp = stage_comp(); print('staged COMP  ->', src_comp, len(list(src_comp.glob('*.png'))))
else:
    src_comp = None; print('no composite run detected — skipping composite staging')""")

md("""## 5 · Predict: tight (reproduces your published numbers) + loose (for the sweep)

For each checkpoint this runs up to four passes — {tight, loose} × {plain, TTA}. TTA is
skipped automatically if the model family doesn't support `augment=True`.""")

code("""import gzip, time
from ultralytics import YOLO
try:
    from ultralytics import RTDETR
except ImportError:
    RTDETR = None

def load_model(run):
    if run['family'] == 'rtdetr':
        assert RTDETR is not None, 'RTDETR unavailable in this ultralytics version'
        return RTDETR(run['path'])
    return YOLO(run['path'])

def predict(model, source, imgsz, iou, max_det, augment):
    dets = []
    for r in model.predict(source=str(source), conf=CONF, iou=iou, max_det=max_det,
                           imgsz=imgsz, augment=augment, stream=True, verbose=False):
        b = r.boxes
        if b is None or len(b) == 0: continue
        dets += yolo_predictions_to_coco(int(Path(r.path).stem),
                                         b.xywh.cpu().numpy(), b.conf.cpu().numpy())
    return dets

def save_gz(dets, path):
    slim = [{"image_id": d["image_id"], "category_id": 1,
             "bbox": [round(v, 3) for v in d["bbox"]],
             "score": round(d["score"], 6)} for d in dets]
    with gzip.open(path, 'wt') as f: json.dump(slim, f)
    return path.stat().st_size/1e6

ALL, META = {}, {}   # tag -> dets  /  tag -> which reference it should reproduce
for run in RUNS:
    src = (src_comp if run['composite'] else src_rgb)
    if src is None:
        print(f'[skip] {run["name"]}: composite source unavailable'); continue
    model = load_model(run)
    for setting, (iou, md_) in {'tight': (TIGHT_IOU, TIGHT_MAXDET),
                                'loose': (LOOSE_IOU, LOOSE_MAXDET)}.items():
        for aug in ([False, True] if RUN_TTA else [False]):
            aug_tag = 'tta' if aug else 'plain'
            tag = f"{run['name']}__{setting}__{aug_tag}"
            t0 = time.time()
            try:
                dets = predict(model, src, run['imgsz'], iou, md_, aug)
            except Exception as e:
                print(f'[skip] {tag}: {type(e).__name__}: {e}'); continue
            mb = save_gz(dets, OUT/f'{tag}.json.gz')
            ALL[tag] = dets
            META[tag] = dict(kind='comp' if run['composite'] else 'rgb',
                             setting=setting, aug=aug_tag)
            print(f'{tag:<48} {len(dets):>7} dets  {mb:>6.1f} MB  {time.time()-t0:>5.0f}s')
print('\\ndone:', len(ALL), 'prediction sets')""")

md("""## 6 · Official metric — the gate

Every **tight** run must reproduce its published score, because `tight` is exactly the
`iou=0.6, max_det=300` config those numbers came from:

| | plain | TTA |
|---|---|---|
| E01 RGB | 0.3940 | 0.4014 |
| E04 composite | 0.3837 | 0.3887 |

Four independent checks, not one. The RGB rows verify the checkpoint and the val split;
the composite rows additionally verify that the physics channels regenerated here are
pixel-identical to the ones the run was trained and validated on — if `to_uint8`'s
percentile normalisation drifts at all, the composite score will miss and its detections
cannot be trusted. A miss on any row is worth knowing about before anything downstream
is believed.""")

code("""rows = []
for tag, dets in ALL.items():
    r = evaluate_map(val_gt, dets); r['tag'] = tag; rows.append(r)

cols = ['mAP','AP50','AP75','AP_small','AP_medium','AP_large','AR100','AR_large']
print(f"{'run':<48}" + ''.join(f'{c:>10}' for c in cols))
print('-'*(48+10*len(cols)))
for r in sorted(rows, key=lambda x: x['tag']):
    print(f"{r['tag']:<48}" + ''.join(f"{r[c]:>10.4f}" for c in cols))

# published reference scores, keyed by (input, augmentation)
REF = {('rgb','plain'):  {'mAP':0.3940, 'AP50':0.6782, 'AP75':0.4079},
       ('rgb','tta'):    {'mAP':0.4014, 'AP50':0.6820, 'AP75':0.4129},
       ('comp','plain'): {'mAP':0.3837, 'AP50':0.6663, 'AP75':0.3889},
       ('comp','tta'):   {'mAP':0.3887, 'AP50':0.6709, 'AP75':0.3993}}
TOL = 0.002

print('\\n--- gate: do the tight runs reproduce their published scores? ---')
checked = hits = 0
for r in sorted(rows, key=lambda x: x['tag']):
    m = META.get(r['tag'])
    if not m or m['setting'] != 'tight':
        continue
    ref = REF.get((m['kind'], m['aug']))
    if ref is None:
        print(f"  {r['tag']:<48} no published reference — skipped"); continue
    checked += 1
    d = {k: r[k]-v for k, v in ref.items()}
    hit = all(abs(v) < TOL for v in d.values()); hits += hit
    print(f"  {r['tag']:<48} exp mAP={ref['mAP']:.4f}  "
          f"dmAP={d['mAP']:+.4f} dAP50={d['AP50']:+.4f} dAP75={d['AP75']:+.4f}  "
          f"{'MATCH' if hit else '<-- MISS'}")

print(f'\\n{hits}/{checked} tight runs reproduced within {TOL}')
if checked == 0:
    print('No tight runs were produced, so there was nothing to gate.')
elif hits == checked:
    print('GATE PASSED')
elif hits:
    print('GATE PARTIAL — some runs reproduce, some do not. The diagnostics below are\\n'
          'trustworthy only for the runs that matched. Send this output.')
else:
    print('GATE FAILED — nothing reproduces. Stop here and send this output; the\\n'
          'checkpoint, split, or preprocessing does not match the published runs.')""")

md("## 7 · Diagnostics")

code(AUDIT + '\nprint("audit lib ready")')

md("""### The three questions this answers

**Fragmentation.** `union_IoU` much greater than `best_IoU` on the large class means one
event is being split across several detections that NMS cannot merge, and the stack-merge
has real headroom. Roughly equal means the model predicts one systematically wrong extent
— a training problem, and the whole post-processing track is dead.

**FP decomposition.** Where the confident false positives actually live: inside a GT box
(fragments), partly overlapping (localisation error), or nowhere near one (spurious).
These three demand completely different fixes.

**Azimuth cue.** Whether azimuth proximity separates true from false positives *in the
predictions*. The handoff established the clustering in the labels, which is necessary but
not sufficient. An AUC near 0.50 means no `boost` value can help and Step 3 should be
skipped outright.""")

code("""gt_by_img = defaultdict(list)
for a in val_gt['annotations']:
    gt_by_img[a['image_id']].append(a['bbox'])

for tag in sorted(ALL):
    print(report(gt_by_img, group(ALL[tag]), img_h, tag))
    print()""")

md("## 8 · Files to send back")

code("""print('Upload these (or paste the printed output above if they are too large):\\n')
tot = 0
for p in sorted(OUT.glob('*.json.gz')):
    mb = p.stat().st_size/1e6; tot += mb
    print(f'  {p}   {mb:.1f} MB')
print(f'\\ntotal {tot:.1f} MB')
print('\\nThe loose/* files are the ones the offline sweep needs. The tight/* files are '
      'small and confirm the gate.')""")

nb = {"cells": cells,
      "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python",
                                  "name": "python3"},
                   "language_info": {"name": "python", "version": "3.11"}},
      "nbformat": 4, "nbformat_minor": 5}

out = pathlib.Path(__file__).with_name("clearsar_phase3_trackA.ipynb")
out.write_text(json.dumps(nb, indent=1))
print("wrote", out, out.stat().st_size, "bytes,", len(cells), "cells")
