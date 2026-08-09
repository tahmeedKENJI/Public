"""Do the METRICS survive a resume, or do they collapse at the boundary?

Control : train 16 epochs straight through.
Test    : train the same config, hard-stop at epoch 11, resume from last.pt.

Starts from pretrained weights so mAP is non-zero within a few epochs and the
comparison is meaningful. Mirrors the ClearSAR run: the restart point is past
the close_mosaic boundary.
"""
import shutil, warnings
from pathlib import Path

import numpy as np
from PIL import Image

warnings.filterwarnings('ignore')
from ultralytics import YOLO

EPOCHS, STOP_AFTER, IMGSZ, CLOSE_MOSAIC = 16, 11, 160, 6
T = Path('/tmp/resume_metrics')
shutil.rmtree(T, ignore_errors=True)


def make_data():
    rng = np.random.default_rng(0)
    for sp, n in (('train', 64), ('val', 32)):
        (T/'images'/sp).mkdir(parents=True); (T/'labels'/sp).mkdir(parents=True)
        for i in range(n):
            img = (rng.random((IMGSZ, IMGSZ, 3)) * 70).astype(np.uint8)
            bw, bh = int(rng.integers(40, 70)), int(rng.integers(20, 36))
            x0, y0 = int(rng.integers(0, IMGSZ-bw)), int(rng.integers(0, IMGSZ-bh))
            img[y0:y0+bh, x0:x0+bw] = 250
            Image.fromarray(img).save(T/'images'/sp/f'{i}.png')
            (T/'labels'/sp/f'{i}.txt').write_text(
                f"0 {(x0+bw/2)/IMGSZ:.6f} {(y0+bh/2)/IMGSZ:.6f} {bw/IMGSZ:.6f} {bh/IMGSZ:.6f}\n")
    (T/'data.yaml').write_text(
        f"path: {T}\ntrain: images/train\nval: images/val\nnc: 1\nnames:\n  0: RFI\n")


def read_csv(run_dir):
    p = Path(run_dir)/'results.csv'
    if not p.exists():
        return {}
    lines = p.read_text().strip().splitlines()
    hdr = [h.strip() for h in lines[0].split(',')]
    def col(s): return next((i for i, h in enumerate(hdr) if s in h), None)
    ie, i50, i95, ilr = col('epoch'), col('mAP50(B)'), col('mAP50-95(B)'), col('lr/pg0')
    out = {}
    for ln in lines[1:]:
        f = ln.split(',')
        out[int(float(f[ie]))] = (float(f[i50]), float(f[i95]), float(f[ilr]))
    return out


def cfg(name):
    return dict(data=str(T/'data.yaml'), imgsz=IMGSZ, batch=8, workers=0,
                close_mosaic=CLOSE_MOSAIC, seed=0, deterministic=True,
                verbose=False, plots=False, project=str(T/'runs'), name=name)


make_data()

print('### control: 16 epochs straight through')
YOLO('yolo11n.pt').train(epochs=EPOCHS, **cfg('control'))
control = read_csv(T/'runs'/'control')

print('\n### test: hard stop after epoch', STOP_AFTER)
class Stop(Exception): pass
def stopper(tr):
    if tr.epoch >= STOP_AFTER:
        raise Stop
m = YOLO('yolo11n.pt')
m.add_callback('on_fit_epoch_end', stopper)
try:
    m.train(epochs=EPOCHS, **cfg('interrupted'))
except Exception as e:
    print('   stopped:', type(e).__name__)
before = read_csv(T/'runs'/'interrupted')
LAST = T/'runs'/'interrupted'/'weights'/'last.pt'

import torch
ck = torch.load(LAST, map_location='cpu', weights_only=False)
print(f'   checkpoint: epoch={ck["epoch"]} target={ck["train_args"]["epochs"]} '
      f'ema={"yes" if ck.get("ema") is not None else "NO"} '
      f'model={"yes" if ck.get("model") is not None else "None"} '
      f'optimizer={"yes" if ck.get("optimizer") is not None else "NO"}')
del ck

print('\n### resume')
m2 = YOLO(str(LAST))
m2.train(resume=str(LAST), data=str(T/'data.yaml'))
after = read_csv(m2.trainer.save_dir)

print('\n' + '='*78)
print(f"{'epoch':>6} | {'CONTROL':>26} | {'INTERRUPTED / RESUMED':>26}")
print(f"{'':>6} | {'mAP50   mAP95        lr':>26} | {'mAP50   mAP95        lr':>26}")
print('='*78)
for e in sorted(control):
    c = control[e]
    if e in after:
        r, src = after[e], 'resumed'
    elif e in before:
        r, src = before[e], 'pre-stop'
    else:
        r, src = None, ''
    line = f'{e:>6} | {c[0]:>8.4f} {c[1]:>7.4f} {c[2]:>10.6f} |'
    if r:
        line += f' {r[0]:>8.4f} {r[1]:>7.4f} {r[2]:>10.6f}  {src}'
        if e == STOP_AFTER + 1:
            line += '  <-- FIRST RESUMED'
    print(line)

e0 = STOP_AFTER + 1
if e0 in control and e0 in after:
    print(f'\nfirst resumed epoch ({e0}):')
    print(f'  control mAP50 {control[e0][0]:.4f}   resumed mAP50 {after[e0][0]:.4f}   '
          f'delta {after[e0][0]-control[e0][0]:+.4f}')
    print(f'  control lr    {control[e0][2]:.6f}   resumed lr    {after[e0][2]:.6f}')
    last_before = before[STOP_AFTER][0]
    print(f'  mAP50 just before the stop: {last_before:.4f}  ->  after resume: {after[e0][0]:.4f} '
          f'({after[e0][0]-last_before:+.4f})')
    verdict = 'RESUME LOSES PROGRESS' if after[e0][0] < last_before * 0.7 else 'resume preserves progress'
    print(f'\n  VERDICT: {verdict}')
