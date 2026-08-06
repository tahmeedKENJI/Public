"""Rebuild a torch .pt file that Kaggle unpacked into a directory.

torch.save writes a ZIP archive. Kaggle's dataset ingestion sees the ZIP magic
bytes and extracts it, leaving a directory (data.pkl, data/0..N, version,
byteorder, .format_version, .storage_alignment, .data/serialization_id) where a
single .pt file should be. Re-zipping those members restores a loadable file.

Two details matter:
  * entries must be STORED, not deflated — torch's reader expects raw records
  * every member sits under one top-level directory inside the archive, which
    is what PyTorchStreamReader treats as the archive root
"""
import os
import zipfile
from pathlib import Path

# members torch writes outside data/, in the order the writer emits them
_HEAD = ["data.pkl", "byteorder", "version", ".format_version",
         ".storage_alignment", ".data/serialization_id"]


def looks_like_unpacked_pt(d):
    """True if directory `d` is an extracted torch archive."""
    d = Path(d)
    return (d / "data.pkl").is_file() and (d / "data").is_dir()


def find_unpacked_pt(root):
    """All directories under `root` that look like extracted checkpoints."""
    out = []
    for r, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = [x for x in dirs if not x.startswith(".")]
        if "data.pkl" in files and (Path(r) / "data").is_dir():
            out.append(Path(r))
    return sorted(out)


def repack_pt(src_dir, out_path, arcroot=None):
    """Re-zip an extracted checkpoint directory into a loadable .pt file."""
    src, out = Path(src_dir), Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    arcroot = arcroot or out.stem

    members = []                                  # (abs path, name in archive)
    for name in _HEAD:
        p = src / name
        if p.is_file():
            members.append((p, name))
    data = src / "data"
    if data.is_dir():
        # numeric order, so the archive mirrors what torch itself writes
        for f in sorted(data.iterdir(),
                        key=lambda q: (not q.name.isdigit(),
                                       int(q.name) if q.name.isdigit() else q.name)):
            if f.is_file():
                members.append((f, f"data/{f.name}"))
    # anything else that was in there, so nothing is silently dropped
    known = {m[1] for m in members}
    for r, dirs, files in os.walk(src, followlinks=True):
        for f in files:
            p = Path(r) / f
            rel = str(p.relative_to(src))
            if rel not in known:
                members.append((p, rel))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for p, rel in members:
            z.write(p, str(Path(arcroot) / rel))
    return out, len(members)
