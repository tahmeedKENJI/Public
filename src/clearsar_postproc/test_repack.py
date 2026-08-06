"""Does re-zipping a Kaggle-extracted checkpoint produce a loadable .pt?

Simulates the exact damage: torch.save a checkpoint, unzip it the way Kaggle's
ingestion does (leaving a directory of members), repack it, and load it back.
"""
import json, shutil, zipfile, sys
from pathlib import Path

import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).parent))
from repack import repack_pt, find_unpacked_pt, looks_like_unpacked_pt

TMP = Path('/tmp/repack_test')
shutil.rmtree(TMP, ignore_errors=True)
TMP.mkdir(parents=True)


class Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.c = nn.Conv2d(3, 8, 3)
        self.f = nn.Linear(8, 2)
    def forward(self, x):
        return self.f(self.c(x).mean((2, 3)))


# ---- 1. a checkpoint shaped like ultralytics' -------------------------------
model = Tiny()
ckpt = {
    'epoch': 99,
    'best_fitness': 0.394,
    'model': model,                       # a pickled nn.Module, as ultralytics does
    'ema': None,
    'train_args': {'model': 'yolo11l.pt', 'imgsz': 1024, 'epochs': 100,
                   'name': 'yolo11_rfi', 'data': '/kaggle/working/yolo_ds/data.yaml'},
    'date': '2026-08-06',
    'big': torch.randn(256, 256),
}
orig = TMP / 'best.pt'
torch.save(ckpt, orig)
print(f'saved original    : {orig}  {orig.stat().st_size/1e6:.2f} MB')
print(f'is it a zip?      : {zipfile.is_zipfile(orig)}')
with zipfile.ZipFile(orig) as z:
    names = z.namelist()
print(f'archive members   : {len(names)}')
print('  ', sorted(n.split("/", 1)[-1] for n in names if "/data/" not in n)[:8])

# ---- 2. unzip the way Kaggle does -------------------------------------------
extracted_parent = TMP / 'kaggle_input' / 'YOLO_Phase_01'
extracted_parent.mkdir(parents=True)
with zipfile.ZipFile(orig) as z:
    z.extractall(extracted_parent)
# torch's archive root is the file stem, so this yields .../YOLO_Phase_01/best/
kdir = extracted_parent / 'best'
print(f'\nextracted to      : {kdir}')
print(f'  contents        : {sorted(p.name for p in kdir.iterdir())}')
print(f'  data/ entries   : {len(list((kdir/"data").iterdir()))}')
print(f'looks_like_unpacked_pt -> {looks_like_unpacked_pt(kdir)}')
print(f'find_unpacked_pt       -> {[str(p) for p in find_unpacked_pt(TMP/"kaggle_input")]}')

# no .pt file survives anywhere, which is what the notebook reported
pts = list((TMP / 'kaggle_input').rglob('*.pt'))
print(f'.pt files under the extracted tree: {len(pts)}   <- matches "found 0"')

# ---- 3. repack and load -----------------------------------------------------
rebuilt, n = repack_pt(kdir, TMP / 'repacked' / 'YOLO_Phase_01_best.pt')
print(f'\nrepacked          : {rebuilt}  {rebuilt.stat().st_size/1e6:.2f} MB  ({n} members)')

try:
    back = torch.load(rebuilt, map_location='cpu', weights_only=False)
except TypeError:
    back = torch.load(rebuilt, map_location='cpu')
print('torch.load        : OK')

# ---- 4. is it actually the same checkpoint? ---------------------------------
assert back['epoch'] == 99, back['epoch']
assert back['train_args'] == ckpt['train_args'], back['train_args']
assert torch.equal(back['big'], ckpt['big']), 'tensor payload differs'
sd_a, sd_b = ckpt['model'].state_dict(), back['model'].state_dict()
assert sd_a.keys() == sd_b.keys()
for k in sd_a:
    assert torch.equal(sd_a[k], sd_b[k]), f'weight mismatch in {k}'
print('train_args        :', back['train_args'])
print('epoch/fitness     :', back['epoch'], back['best_fitness'])
print(f'weights identical : {len(sd_a)}/{len(sd_a)} tensors bit-for-bit')

# ---- 5. and the model still runs --------------------------------------------
back['model'].eval()
with torch.no_grad():
    out_a = model(torch.ones(1, 3, 16, 16))
    out_b = back['model'](torch.ones(1, 3, 16, 16))
assert torch.allclose(out_a, out_b), 'forward pass differs'
print('forward pass      : identical output')
print('\nPASS — a Kaggle-extracted checkpoint repacks into a loadable .pt')
