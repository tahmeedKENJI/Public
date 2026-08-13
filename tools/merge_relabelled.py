#!/usr/bin/env python3
"""Merge a CVAT COCO export back into the full annotation file.

CVAT renumbers image_id and annotation id on export, so its output cannot be
dropped in directly: the ids would no longer be the ones the deterministic
seed-42 split and every recorded score depend on. This re-keys on file_name to
restore the original image ids, splices only the edited images back in, and
verifies that nothing else moved.

    python merge_relabelled.py \
        --original instances_train.json \
        --export   cvat_export/annotations/instances_default.json \
        --out      instances_train_v2.json

Prints a per-image diff of what gained and lost boxes, and refuses to write if
the untouched images are not byte-identical to the original.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text())


def norm_bbox(b, w, h, precision):
    x, y, bw, bh = (float(v) for v in b)
    # clip into the image; CVAT lets you drag a box past the edge
    x0, y0 = max(0.0, x), max(0.0, y)
    x1, y1 = min(float(w), x + bw), min(float(h), y + bh)
    bw, bh = max(0.0, x1 - x0), max(0.0, y1 - y0)
    if precision == 'int':
        x0, y0, bw, bh = round(x0), round(y0), round(bw), round(bh)
    return [x0, y0, bw, bh]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--original', required=True)
    ap.add_argument('--export', required=True, help='CVAT COCO export json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--precision', choices=['int', 'float'], default='int',
                    help="original dataset is integer-quantised; 'int' keeps that "
                         "convention (default)")
    ap.add_argument('--min-size', type=float, default=1.0,
                    help='drop boxes thinner than this after clipping (default 1px)')
    a = ap.parse_args()

    orig, exp = load(a.original), load(a.export)

    orig_by_name = {im['file_name']: im for im in orig['images']}
    unknown = [im['file_name'] for im in exp['images'] if im['file_name'] not in orig_by_name]
    if unknown:
        raise SystemExit(
            f'{len(unknown)} exported images are not in the original file, e.g. '
            f'{unknown[:5]}. CVAT renamed them, or this export is from another dataset.')

    # geometry must match, otherwise the tool resized the images and every
    # coordinate in the export is on a different scale
    resized = [(im['file_name'], (im.get('width'), im.get('height')),
                (orig_by_name[im['file_name']]['width'], orig_by_name[im['file_name']]['height']))
               for im in exp['images']
               if im.get('width') and (im['width'], im['height']) !=
               (orig_by_name[im['file_name']]['width'], orig_by_name[im['file_name']]['height'])]
    if resized:
        raise SystemExit(f'{len(resized)} images changed size, e.g. {resized[:3]}. '
                         'The export is not on the original pixel grid.')

    # export image_id -> original image id
    exp_id_to_orig = {im['id']: orig_by_name[im['file_name']]['id'] for im in exp['images']}
    edited = set(exp_id_to_orig.values())

    dims = {im['id']: (im['width'], im['height']) for im in orig['images']}
    orig_anns = defaultdict(list)
    for an in orig['annotations']:
        orig_anns[an['image_id']].append(an)

    new_anns = defaultdict(list)
    dropped_tiny = 0
    for an in exp['annotations']:
        iid = exp_id_to_orig[an['image_id']]
        w, h = dims[iid]
        bb = norm_bbox(an['bbox'], w, h, a.precision)
        if bb[2] < a.min_size or bb[3] < a.min_size:
            dropped_tiny += 1
            continue
        new_anns[iid].append(bb)

    # rebuild: untouched images keep their annotations verbatim
    out_anns, next_id = [], 1
    for im in orig['images']:
        iid = im['id']
        if iid in edited:
            for bb in new_anns.get(iid, []):
                out_anns.append({'id': next_id, 'category_id': 1, 'image_id': iid,
                                 'bbox': bb, 'area': bb[2] * bb[3], 'iscrowd': 0})
                next_id += 1
        else:
            for an in orig_anns.get(iid, []):
                out_anns.append({**an, 'id': next_id})
                next_id += 1

    merged = {'images': orig['images'], 'annotations': out_anns,
              'categories': orig['categories']}

    # ---- verification -------------------------------------------------
    merged_by_img = defaultdict(list)
    for an in out_anns:
        merged_by_img[an['image_id']].append(an)

    bad = []
    for im in orig['images']:
        iid = im['id']
        if iid in edited:
            continue
        before = [an['bbox'] for an in orig_anns.get(iid, [])]
        after = [an['bbox'] for an in merged_by_img.get(iid, [])]
        if before != after:
            bad.append(iid)
    if bad:
        raise SystemExit(f'untouched images changed: {bad[:10]} — refusing to write')

    assert len(merged['images']) == len(orig['images']), 'image list changed'

    # ---- report -------------------------------------------------------
    gained, lost, same, emptied = [], [], 0, []
    for iid in sorted(edited):
        b, aft = len(orig_anns.get(iid, [])), len(merged_by_img.get(iid, []))
        if aft > b: gained.append((iid, b, aft))
        elif aft < b: lost.append((iid, b, aft))
        else: same += 1
        if aft == 0 and b > 0: emptied.append(iid)

    print(f'edited images      : {len(edited)}')
    print(f'  boxes added      : {len(gained)} images  '
          f'(+{sum(aft-b for _, b, aft in gained)} boxes)')
    print(f'  boxes removed    : {len(lost)} images  '
          f'({sum(aft-b for _, b, aft in lost)} boxes)')
    print(f'  unchanged count  : {same} images')
    print(f'  now empty        : {len(emptied)} images {emptied[:10] if emptied else ""}')
    if dropped_tiny:
        print(f'  dropped as degenerate (<{a.min_size}px): {dropped_tiny}')
    print(f'\ntotal boxes  : {len(orig["annotations"])} -> {len(out_anns)} '
          f'({len(out_anns)-len(orig["annotations"]):+d})')
    print(f'total images : {len(merged["images"])} (unchanged)')
    print(f'untouched images verified byte-identical: '
          f'{len(orig["images"]) - len(edited)}')

    if lost:
        print('\nlargest removals:')
        for iid, b, aft in sorted(lost, key=lambda t: t[2]-t[1])[:10]:
            print(f'  image {iid}: {b} -> {aft}')

    Path(a.out).write_text(json.dumps(merged))
    print(f'\nwritten: {a.out}')


if __name__ == '__main__':
    main()
