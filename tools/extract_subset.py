#!/usr/bin/env python3
"""Cut a relabelling subset out of the full COCO file.

Writes a folder of images plus a COCO json containing only those images and
their annotations, which is what CVAT expects when you import annotations onto
a task. Importing the full json onto a partial task leaves thousands of
annotations pointing at images the task does not contain.

    python extract_subset.py \
        --coco   instances_train.json \
        --images data/images/train \
        --ids    to_fix.txt \
        --out    relabel_batch1

`--ids` accepts a file with one image id per line (blank lines and #comments
ignored), or a comma-separated list on the command line.
"""
import argparse
import json
import shutil
from pathlib import Path


def parse_ids(spec):
    p = Path(spec)
    if p.exists():
        raw = [ln.split('#')[0].strip() for ln in p.read_text().splitlines()]
    else:
        raw = spec.split(',')
    ids, bad = [], []
    for tok in raw:
        tok = tok.strip()
        if not tok:
            continue
        # tolerate '1260.png' as well as '1260'
        tok = tok[:-4] if tok.lower().endswith('.png') else tok
        try:
            ids.append(int(tok))
        except ValueError:
            bad.append(tok)
    if bad:
        raise SystemExit(f'could not parse these as image ids: {bad[:10]}')
    return sorted(set(ids))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--coco', required=True, help='full instances_train.json')
    ap.add_argument('--images', required=True, help='folder holding the PNGs')
    ap.add_argument('--ids', required=True, help='id list file, or comma-separated ids')
    ap.add_argument('--out', required=True, help='output folder to create')
    ap.add_argument('--link', action='store_true',
                    help='symlink images instead of copying (saves disk, but CVAT '
                         'upload needs real files — copy unless you know why)')
    a = ap.parse_args()

    coco = json.loads(Path(a.coco).read_text())
    want = parse_ids(a.ids)

    by_id = {im['id']: im for im in coco['images']}
    missing = [i for i in want if i not in by_id]
    if missing:
        raise SystemExit(f'{len(missing)} ids are not in the coco file, e.g. {missing[:10]}')

    keep = set(want)
    images = [im for im in coco['images'] if im['id'] in keep]
    anns = [an for an in coco['annotations'] if an['image_id'] in keep]

    out = Path(a.out)
    img_dir = out / 'images'
    img_dir.mkdir(parents=True, exist_ok=True)

    src_root = Path(a.images)
    absent = []
    for im in images:
        src = src_root / im['file_name']
        if not src.exists():
            absent.append(im['file_name']); continue
        dst = img_dir / im['file_name']
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        if a.link:
            dst.symlink_to(src.resolve())
        else:
            shutil.copy2(src, dst)
    if absent:
        raise SystemExit(f'{len(absent)} image files not found under {src_root}, '
                         f'e.g. {absent[:5]}')

    subset = {'images': images, 'annotations': anns, 'categories': coco['categories']}
    sub_path = out / 'subset_instances.json'
    sub_path.write_text(json.dumps(subset))

    empty = sum(1 for im in images if not any(an['image_id'] == im['id'] for an in anns))
    print(f'subset written to {out}')
    print(f'  images      : {len(images)}  -> {img_dir}')
    print(f'  annotations : {len(anns)}    -> {sub_path}')
    print(f'  images with no boxes: {empty}')
    print(f'  boxes per image: min {min((sum(1 for an in anns if an["image_id"]==i["id"]) for i in images), default=0)}'
          f'  max {max((sum(1 for an in anns if an["image_id"]==i["id"]) for i in images), default=0)}')
    print(f'\nUpload {img_dir} to CVAT as a task, then import {sub_path.name} '
          f'as "COCO 1.0" annotations.')
    print('When you export, keep the original file names — merge_relabelled.py '
          'matches on them to restore your image ids.')


if __name__ == '__main__':
    main()
