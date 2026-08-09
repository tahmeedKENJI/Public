"""Does resuming produce the same trajectory as training straight through?

Control : train N epochs continuously.
Test    : train the same run, snapshot last.pt mid-way, resume from it.

Both see identical data and identical config, so at any shared epoch the
metrics and learning rate should agree. A collapse at the resume boundary
would reproduce what the ClearSAR p2 run showed.
"""
import shutil, warnings
from pathlib import Path

import numpy as np
from PIL import Image

warnings.filterwarnings('ignore')
from ultralytics import YOLO

EPOCHS, SNAP_AT, IMGSZ, CLOSE_MOSAIC = 16, 11, 128, 6
T = Path('/tmp/resume_equiv')
shutil.rmtree(T, ignore_errors=True)


def make_data():
    """A learnable task: one bright rectangle on noise, at a random position."""
    rng = np.random.default_rng(0)
    for sp, n in (('train', 48), ('val', 24)):
        (T/'images'/sp).mkdir(parents=True); (T/'labels'/sp).mkdir(parents=True)
        for i in range(n):
            img = (rng.random((IMGSZ, IMGSZ, 3)) * 90).astype(np.uint8)
            bw, bh = rng.integers(24, 48), rng.integers(10, 20)
            x0, y0 = rng.integers(0, IMGSZ-bw), rng.integers(0, IMGSZ-bh)
            img[y0:y0+bh, x0:x0+bw] = 245
            Image.fromarray(img).save(T/'images'/sp/f'{i}.png')
            (T/'labels'/sp/f'{i}.txt').write_text(
                f"0 {(x0+bw/2)/IMGSZ:.6f} {(y0+bh/2)/IMGSZ:.6f} {bw/IMGSZ:.6f} {bh/IMGSZ:.6f}\n")
    (T/'data.yaml').write_text(
        f"path: {T}\ntrain: images/train\nval: images/val\nnc: 1\nnames:\n  0: RFI\n")


def read_csv(run_dir):
    """-> {epoch: (mAP50, mAP50-95, lr_pg0)}"""
    p = Path(run_dir)/'results.csv'
    if not p.exists():
        return {}
    lines = p.read_text().strip().splitlines()
    hdr = [h.strip() for h in lines[0].split(',')]
    def col(sub):
        return next((i for i, h in enumerate(hdr) if sub in h), None)
    ie, i50, i95, ilr = col('epoch'), col('mAP50(B)'), col('mAP50-95(B)'), col('lr/pg0')
    out = {}
    for ln in lines[1:]:
        f = ln.split(',')
        out[int(float(f[ie]))] = (float(f[i50]), float(f[i95]), float(f[ilr]))
    return out


def common(seed_run, **kw):
    return dict(data=str(T/'data.yaml'), imgsz=IMGSZ, batch=8, workers=0,
                close_mosaic=CLOSE_MOSAIC, seed=0, deterministic=True, verbose=False,
                plots=False, project=str(T/'runs'), name=seed_run, **kw)


make_data()

# ---------------- control: straight through ----------------
YOLO('yolo11n.yaml').train(epochs=EPOCHS, **common('control'))
control = read_csv(T/'runs'/'control')

# ---------------- test: snapshot then resume ----------------
SNAP = T/'snap_last.pt'
def snapshot(tr):
    if tr.epoch == SNAP_AT and not SNAP.exists():
        shutil.copy(tr.last, SNAP)

m = YOLO('yolo11n.yaml')
m.add_callback('on_fit_epoch_end', snapshot)
m.train(epochs=EPOCHS, **common('interrupted'))
before = read_csv(T/'runs'/'interrupted')

m2 = YOLO(str(SNAP))
m2.train(resume=str(SNAP), data=str(T/'data.yaml'))
after = read_csv(m2.trainer.save_dir)

print('\n' + '='*74)
print(f"{'epoch':>6} | {'CONTROL mAP50  mAP95      lr':<32} | {'RESUMED mAP50  mAP95      lr'}")
print('='*74)
for e in sorted(control):
    c = control[e]
    r = after.get(e) or before.get(e)
    src = 'resumed' if e in after else 'pre-snap'
    mark = ''
    if e in after and e - 1 == SNAP_AT:
        mark = '   <-- first resumed epoch'
    print(f'{e:>6} | {c[0]:>9.4f} {c[1]:>7.4f} {c[2]:>10.6f} | '
          f'{r[0]:>9.4f} {r[1]:>7.4f} {r[2]:>10.6f}  {src}{mark}')

first = SNAP_AT + 2
if first in control and first in after:
    d50 = after[first][0] - control[first][0]
    dlr = after[first][2] - control[first][2]
    print('\nat the first resumed epoch:')
    print(f'  mAP50 difference vs control : {d50:+.4f}')
    print(f'  lr difference vs control    : {dlr:+.8f} '
          f'(control {control[first][2]:.6f} vs resumed {after[first][2]:.6f})')
    print(f'\n  verdict: {"LR IS WRONG ON RESUME" if abs(dlr) > 1e-6 else "learning rate restored correctly"}')
