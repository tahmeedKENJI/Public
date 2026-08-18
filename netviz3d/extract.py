"""Model file -> normalized graph dict.

Supported inputs
    .pt .pth .bin .ckpt   PyTorch: pickled nn.Module, TorchScript archive, or a
                          plain state_dict / training checkpoint
    .safetensors          tensor index only -> architecture inferred (no deps)
    .keras                Keras 3 archive -> parsed straight from config.json
                          (no TensorFlow needed)
    .h5 .hdf5             Keras 2 -> model_config attribute (h5py if present,
                          otherwise a raw scan of the file)
    .json                 Keras architecture JSON
    <dir>                 TensorFlow SavedModel (needs tensorflow) or a
                          directory holding any of the above
    .onnx                 ONNX (needs the onnx package)

The result is a plain dict, JSON-serializable, described in README.md.
Nothing is written to disk and nothing leaves the machine.
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys
import zipfile

import knowledge

MAX_NODES = 6000


# ==========================================================================
# canonical op naming
# ==========================================================================

_KIND_BY_NAME = {
    "conv1d": "conv1d", "conv2d": "conv2d", "conv3d": "conv3d",
    "convolution1d": "conv1d", "convolution2d": "conv2d", "convolution3d": "conv3d",
    "separableconv1d": "conv1d", "separableconv2d": "conv2d",
    "depthwiseconv1d": "conv1d", "depthwiseconv2d": "conv2d",
    "convtranspose1d": "convtranspose1d", "convtranspose2d": "convtranspose2d",
    "convtranspose3d": "convtranspose3d",
    "conv1dtranspose": "convtranspose1d", "conv2dtranspose": "convtranspose2d",
    "conv3dtranspose": "convtranspose3d",
    "batchnorm1d": "batchnorm", "batchnorm2d": "batchnorm", "batchnorm3d": "batchnorm",
    "batchnormalization": "batchnorm", "syncbatchnorm": "batchnorm", "batchnorm": "batchnorm",
    "layernorm": "layernorm", "layernormalization": "layernorm",
    "groupnorm": "groupnorm", "groupnormalization": "groupnorm",
    "instancenorm1d": "instancenorm", "instancenorm2d": "instancenorm", "instancenorm3d": "instancenorm",
    "rmsnorm": "rmsnorm", "rmsnormalization": "rmsnorm", "t5layernorm": "rmsnorm",
    "unitnormalization": "layernorm",
    "relu": "relu", "relu6": "relu6", "gelu": "gelu", "silu": "silu", "swish": "silu",
    "sigmoid": "sigmoid", "tanh": "tanh", "leakyrelu": "leakyrelu", "elu": "elu",
    "mish": "mish", "hardswish": "hardswish", "prelu": "prelu", "selu": "selu",
    "softmax": "softmax", "logsoftmax": "softmax", "glu": "glu", "activation": "relu",
    "hardsigmoid": "sigmoid", "gelunew": "gelu", "quickgelu": "gelu",
    "maxpool1d": "maxpool", "maxpool2d": "maxpool", "maxpool3d": "maxpool",
    "maxpooling1d": "maxpool", "maxpooling2d": "maxpool", "maxpooling3d": "maxpool",
    "avgpool1d": "avgpool", "avgpool2d": "avgpool", "avgpool3d": "avgpool",
    "averagepooling1d": "avgpool", "averagepooling2d": "avgpool", "averagepooling3d": "avgpool",
    "adaptiveavgpool1d": "adaptiveavgpool", "adaptiveavgpool2d": "adaptiveavgpool",
    "adaptiveavgpool3d": "adaptiveavgpool", "adaptivemaxpool2d": "adaptivemaxpool",
    "globalaveragepooling1d": "globalavgpool", "globalaveragepooling2d": "globalavgpool",
    "globalmaxpooling2d": "globalmaxpool",
    "linear": "linear", "lazylinear": "linear", "dense": "linear", "bilinear": "linear",
    "einsumdense": "linear", "conv1x1": "conv2d",
    "embedding": "embedding", "embeddingbag": "embedding",
    "multiheadattention": "attention", "attention": "attention", "selfattention": "attention",
    "mha": "attention", "scaleddotproductattention": "attention",
    "lstm": "lstm", "gru": "gru", "rnn": "rnn", "simplernn": "rnn", "lstmcell": "lstm",
    "dropout": "dropout", "dropout1d": "dropout", "dropout2d": "dropout",
    "alphadropout": "dropout", "spatialdropout2d": "dropout",
    "flatten": "flatten", "unflatten": "reshape", "reshape": "reshape",
    "permute": "permute", "identity": "identity",
    "upsample": "upsample", "upsampling1d": "upsample", "upsampling2d": "upsample",
    "pixelshuffle": "upsample", "zeropadding2d": "padding", "constantpad2d": "padding",
    "reflectionpad2d": "padding", "add": "add", "concatenate": "concat", "concat": "concat",
    "multiply": "mul", "inputlayer": "input", "rescaling": "misc", "normalization": "misc",
}

_FAMILY = {
    "conv1d": "conv", "conv2d": "conv", "conv3d": "conv",
    "convtranspose1d": "conv", "convtranspose2d": "conv", "convtranspose3d": "conv",
    "batchnorm": "norm", "layernorm": "norm", "groupnorm": "norm",
    "instancenorm": "norm", "rmsnorm": "norm",
    "maxpool": "pool", "avgpool": "pool", "adaptiveavgpool": "pool",
    "adaptivemaxpool": "pool", "globalavgpool": "pool", "globalmaxpool": "pool",
    "linear": "linear", "embedding": "embedding",
    "attention": "attention", "lstm": "recurrent", "gru": "recurrent", "rnn": "recurrent",
    "dropout": "regular", "flatten": "shape", "reshape": "shape", "permute": "shape",
    "identity": "shape", "padding": "shape",
    "add": "merge", "concat": "merge", "mul": "merge",
    "upsample": "upsample", "input": "io", "output": "io",
}
for _a in knowledge.ACTS:
    _FAMILY.setdefault(_a, "activation")


def canon_kind(class_name: str) -> str:
    key = re.sub(r"[^a-z0-9]", "", (class_name or "").lower())
    if key in _KIND_BY_NAME:
        return _KIND_BY_NAME[key]
    for suffix, kind in (("conv2d", "conv2d"), ("conv1d", "conv1d"), ("attention", "attention"),
                         ("norm", "layernorm"), ("pool", "avgpool"), ("linear", "linear")):
        if key.endswith(suffix):
            return kind
    return key or "unknown"


def family_of(kind: str) -> str:
    return _FAMILY.get(kind, "activation" if kind in knowledge.ACTS else "misc")


# ==========================================================================
# graph assembly helpers
# ==========================================================================


class GraphBuilder:
    def __init__(self, framework, fmt, source):
        self.nodes = []
        self.edges = []
        self.groups = []
        self.warnings = []
        self.meta = {"framework": framework, "format": fmt, "source": os.path.basename(str(source))}
        self._ids = set()
        self.channels_last = framework == "keras"
        self.input_shape = None
        self.assume_shapes = False

    def add(self, nid, op, kind=None, params=None, in_shape=None, out_shape=None,
            n_params=0, path=None, name=None):
        base, i = nid, 2
        while nid in self._ids:
            nid = f"{base}#{i}"
            i += 1
        self._ids.add(nid)
        kind = kind or canon_kind(op)
        node = {
            "id": nid, "name": name or nid, "op": op, "kind": kind, "family": family_of(kind),
            "params": {k: v for k, v in (params or {}).items() if v is not None},
            "in_shape": list(in_shape) if in_shape else None,
            "out_shape": list(out_shape) if out_shape else None,
            "n_params": int(n_params or 0),
            "path": path or (nid.split(".") if "." in nid else [nid]),
        }
        self.nodes.append(node)
        return node

    def link(self, src, dst, kind="sequential", note=None):
        if src is None or dst is None or src == dst:
            return
        self.edges.append({"src": src, "dst": dst, "kind": kind, "note": note})

    def result(self):
        return finalize(self)


# --- derived quantities ---------------------------------------------------


def _prod(xs):
    out = 1
    for x in xs:
        out *= x if isinstance(x, int) and x > 0 else 1
    return out


_DISPLAY = {
    "conv1d": "Conv1d", "conv2d": "Conv2d", "conv3d": "Conv3d",
    "convtranspose1d": "ConvTranspose1d", "convtranspose2d": "ConvTranspose2d",
    "batchnorm": "BatchNorm", "layernorm": "LayerNorm", "groupnorm": "GroupNorm",
    "instancenorm": "InstanceNorm", "rmsnorm": "RMSNorm", "linear": "Linear",
    "embedding": "Embedding", "attention": "Attention", "maxpool": "MaxPool",
    "avgpool": "AvgPool", "adaptiveavgpool": "AdaptiveAvgPool", "globalavgpool": "GlobalAvgPool",
    "dropout": "Dropout", "flatten": "Flatten", "lstm": "LSTM", "gru": "GRU",
}

# state_dict entries that are buffers, not learnable parameters
_BUFFER_KEYS = {"running_mean", "running_var", "num_batches_tracked", "running_var_unbiased"}


# --- analytic shape propagation -------------------------------------------


def _out_spatial(dim, k, s, p, d=1, transposed=False):
    if dim is None:
        return None
    try:
        if transposed:
            return (dim - 1) * s - 2 * p + d * (k - 1) + 1
        return (dim + 2 * p - d * (k - 1) - 1) // s + 1
    except Exception:
        return None


def _first(v, default):
    if isinstance(v, (list, tuple)):
        return v[0] if v else default
    return v if v is not None else default


def propagate_shapes(nodes, edges, input_shape, channels_last=False, assume=False):
    """Fill in shapes the loader could not observe, by walking the chain.

    `assume=True` means hyperparameters missing from the source (stride, padding)
    are taken to be the conventional stride-1 / same-padding defaults. Nodes
    whose shape was produced that way are flagged so the viewer can mark them.
    """
    pred = {}
    for e in edges:
        pred.setdefault(e["dst"], []).append(e["src"])
    by_id = {n["id"]: n for n in nodes}
    ci = -1 if channels_last else 1

    cur = list(input_shape) if input_shape else None
    for n in nodes:
        if n.get("in_shape") is None:
            srcs = [by_id[s] for s in pred.get(n["id"], []) if s in by_id]
            up = next((s["out_shape"] for s in srcs if s.get("out_shape")), None)
            n["in_shape"] = up or cur
            if n["in_shape"]:
                n["shape_assumed"] = True
        if n.get("out_shape") is not None:
            cur = n["out_shape"]
            continue

        s, p, k = n["in_shape"], n["params"], n["kind"]
        out = None
        if s:
            s = list(s)
            if k.startswith("conv"):
                ks = _first(p.get("kernel_size"), 1)
                st = _first(p.get("stride"), 1 if assume else None)
                pd = p.get("padding")
                pd = (ks // 2 if assume else 0) if pd is None else _first(pd, 0)
                if not isinstance(pd, int):
                    pd = ks // 2
                st = 1 if st is None else st
                dl = _first(p.get("dilation"), 1) or 1
                out = list(s)
                trans = k.startswith("convtranspose")
                spatial_idx = range(2, len(s)) if not channels_last else range(1, len(s) - 1)
                for i in spatial_idx:
                    out[i] = _out_spatial(s[i], ks, st, pd, dl, trans)
                cout = p.get("out_channels")
                if cout:
                    out[ci] = cout
            elif k in {"maxpool", "avgpool"}:
                ks = _first(p.get("kernel_size") or p.get("pool"), 2)
                st = _first(p.get("stride"), ks) or ks
                pd = _first(p.get("padding"), 0) or 0
                out = list(s)
                for i in (range(2, len(s)) if not channels_last else range(1, len(s) - 1)):
                    out[i] = _out_spatial(s[i], ks, st, pd)
            elif k in {"adaptiveavgpool", "adaptivemaxpool"}:
                osz = p.get("output_size", 1)
                osz = _first(osz, 1) or 1
                out = list(s)
                for i in (range(2, len(s)) if not channels_last else range(1, len(s) - 1)):
                    out[i] = osz
            elif k in {"globalavgpool", "globalmaxpool"}:
                out = [s[0], s[ci]]
            elif k == "flatten":
                out = [s[0], _prod(s[1:])]
            elif k == "linear":
                fout, fin = p.get("out_features"), p.get("in_features")
                if not fout:
                    out = list(s)
                elif len(s) > 2 and fin and s[-1] != fin:
                    # the collapsing op is missing from the file; a dense layer
                    # always emits (batch, out_features) whatever preceded it
                    out = [s[0], fout]
                else:
                    out = s[:-1] + [fout]
            elif k == "embedding":
                out = list(s) + [p.get("embedding_dim")]
            elif k == "upsample":
                sc = _first(p.get("scale_factor"), 2) or 2
                out = list(s)
                for i in (range(2, len(s)) if not channels_last else range(1, len(s) - 1)):
                    out[i] = (s[i] * sc) if isinstance(s[i], int) else None
            else:
                out = list(s)  # shape-preserving: norms, activations, dropout, merges
        if out:
            n["out_shape"] = out
            n["shape_assumed"] = True
            cur = out


# Layers that own submodules but should still be drawn as a single unit --
# MultiheadAttention holds an out_proj Linear, LSTM holds its cells, and so on.
ATOMIC_KINDS = {"attention", "lstm", "gru", "rnn", "embedding"}


def _guess_input_shape(nodes):
    """A plausible input shape, read off the first layer that constrains it."""
    for n in nodes:
        p, k = n["params"], n["kind"]
        if k == "embedding":
            return [1, 32]
        if k == "conv2d" and p.get("in_channels"):
            return [1, p["in_channels"], 224, 224]
        if k == "conv1d" and p.get("in_channels"):
            return [1, p["in_channels"], 128]
        if k == "conv3d" and p.get("in_channels"):
            return [1, p["in_channels"], 8, 64, 64]
        if k == "linear" and p.get("in_features"):
            return [1, p["in_features"]]
        if k in {"lstm", "gru", "rnn"} and p.get("input_size"):
            return [1, 16, p["input_size"]]
    return None


def _geom(node, channels_last):
    """Drawable geometry for the viewer, framework layout resolved here."""
    s = node.get("out_shape") or node.get("in_shape")
    p = node["params"]
    if s and len(s) >= 2:
        body = [d for d in s[1:]]
        if len(body) == 3:
            c, h, w = (body[2], body[0], body[1]) if channels_last else (body[0], body[1], body[2])
            if all(isinstance(x, int) for x in (c, h, w)):
                return {"kind": "volume", "c": c, "h": h, "w": w}
        if len(body) == 4:
            c, d0, h, w = (body[3], body[0], body[1], body[2]) if channels_last else body[:4]
            if all(isinstance(x, int) for x in (c, h, w)):
                return {"kind": "volume", "c": c, "h": h, "w": w, "d": d0}
        if len(body) == 2 and all(isinstance(x, int) for x in body):
            return {"kind": "seq", "l": body[0], "d": body[1]}
        if len(body) == 1 and isinstance(body[0], int):
            return {"kind": "vector", "n": body[0]}
    c = (p.get("out_channels") or p.get("out_features") or p.get("num_features")
         or p.get("embedding_dim") or p.get("normalized_shape") or p.get("hidden_size"))
    c = _first(c, None)
    return {"kind": "abstract", "c": c if isinstance(c, int) else None}


def _macs(node):
    """Multiply-accumulates for one sample."""
    k, p = node["kind"], node["params"]
    out, inp = node.get("out_shape"), node.get("in_shape")
    try:
        if k.startswith("conv") and out:
            ks = p.get("kernel_size") or [1, 1]
            ks = ks if isinstance(ks, (list, tuple)) else [ks, ks]
            cin = p.get("in_channels") or (inp[1] if inp and len(inp) > 1 else 0)
            groups = p.get("groups", 1) or 1
            spatial = _prod(out[2:]) if len(out) > 2 else 1
            cout = p.get("out_channels") or (out[1] if len(out) > 1 else 0)
            return int(spatial * cout * (cin / groups) * _prod(list(ks)))
        if k == "linear" and out:
            fin = p.get("in_features") or (inp[-1] if inp else 0)
            fout = p.get("out_features") or out[-1]
            lead = _prod(out[1:-1]) if len(out) > 2 else 1
            return int(fin * fout * lead)
        if k == "attention" and inp and len(inp) >= 3:
            L, d = inp[-2], inp[-1]
            return int(4 * L * d * d + 2 * L * L * d)
        if k in {"lstm", "gru", "rnn"} and inp and len(inp) >= 3:
            L = inp[1]
            hs = p.get("hidden_size") or 0
            fin = inp[-1]
            g = {"lstm": 4, "gru": 3, "rnn": 1}[k]
            return int(L * g * (fin * hs + hs * hs))
    except Exception:
        pass
    return 0


def _receptive_field(nodes, edges):
    """Cumulative receptive field along the dominant path (conv/pool only)."""
    succ = {}
    for e in edges:
        succ.setdefault(e["src"], []).append(e["dst"])
    by_id = {n["id"]: n for n in nodes}
    rf, jump = 1, 1
    for n in nodes:  # topological-ish: nodes are appended in execution order
        p = n["params"]
        k = n["kind"]
        if k.startswith("conv") or k in {"maxpool", "avgpool"}:
            ks = p.get("kernel_size") or 1
            ks = ks[0] if isinstance(ks, (list, tuple)) else ks
            st = p.get("stride") or 1
            st = st[0] if isinstance(st, (list, tuple)) else st
            dl = p.get("dilation") or 1
            dl = dl[0] if isinstance(dl, (list, tuple)) else dl
            if not isinstance(ks, int) or not isinstance(st, int):
                continue
            eff = dl * (ks - 1) + 1 if isinstance(dl, int) else ks
            rf = rf + (eff - 1) * jump
            jump = jump * max(st, 1)
        n["rf"] = rf
    return by_id


def finalize(gb: GraphBuilder):
    nodes, edges = gb.nodes, gb.edges
    if len(nodes) > MAX_NODES:
        gb.warnings.append(f"model has {len(nodes)} nodes; truncated to {MAX_NODES} for display.")
        keep = {n["id"] for n in nodes[:MAX_NODES]}
        nodes = nodes[:MAX_NODES]
        edges = [e for e in edges if e["src"] in keep and e["dst"] in keep]

    # classify edges: a jump into a merge node is a residual, a fan-out is a
    # branch, anything pointing backwards is a recurrence
    order = {n["id"]: i for i, n in enumerate(nodes)}
    outdeg = {}
    for e in edges:
        outdeg[e["src"]] = outdeg.get(e["src"], 0) + 1
    for e in edges:
        if e["kind"] != "sequential":
            continue
        si, di = order.get(e["src"]), order.get(e["dst"])
        if si is None or di is None:
            continue
        if di < si:
            e["kind"] = "recurrent"
        elif nodes[di]["kind"] in {"add", "mul", "concat"} and di - si > 1:
            e["kind"] = "residual"
            e["note"] = ("Carries the block's input past it and adds it back, so gradient reaches "
                         "the earlier layers without passing through the block.")
        elif di - si > 1 or outdeg.get(e["src"], 1) > 1:
            e["kind"] = "branch"
            e["note"] = "The tensor forks here and is consumed by more than one layer."

    if any(n.get("out_shape") is None for n in nodes):
        ish = gb.input_shape
        if not ish:
            ish = _guess_input_shape(nodes)
            if ish:
                gb.warnings.append(
                    f"No input shape was supplied, so {tuple(ish)} was inferred from the first layer "
                    f"that constrains it. Spatial sizes in particular are a guess — pass "
                    f"--input-shape to draw the real ones.")
        propagate_shapes(nodes, edges, ish, gb.channels_last, gb.assume_shapes)
        gb.input_shape = gb.input_shape or ish
        if gb.assume_shapes and gb.input_shape:
            gb.warnings.append(
                "Shapes marked with ~ were computed, not observed: this file does not record "
                "stride or padding, so stride 1 and same-padding were assumed. Channel counts come "
                "from the real weight shapes and are exact.")

    for n in nodes:
        n["macs"] = _macs(n)
        n["geom"] = _geom(n, gb.channels_last)
    _receptive_field(nodes, edges)

    total_params = sum(n["n_params"] for n in nodes)
    total_macs = sum(n["macs"] for n in nodes)
    gb.meta.update({
        "total_params": total_params,
        "total_macs": total_macs,
        "n_nodes": len(nodes),
        "n_edges": len(edges),
        "channels_last": gb.channels_last,
    })
    ins = [n for n in nodes if n["kind"] == "input"] or nodes[:1]
    outs = [n for n in nodes if n["kind"] == "output"] or nodes[-1:]
    if ins:
        head = ins[0]
        gb.meta["input_shape"] = (head.get("out_shape") if head["kind"] == "input"
                                  else head.get("in_shape") or head.get("out_shape"))
    else:
        gb.meta["input_shape"] = None
    gb.meta["output_shape"] = (outs[0].get("out_shape") or outs[0].get("in_shape")) if outs else None

    # per-node explanations
    succ, pred = {}, {}
    for e in edges:
        succ.setdefault(e["src"], []).append(e["dst"])
        pred.setdefault(e["dst"], []).append(e["src"])
    by_id = {n["id"]: n for n in nodes}
    for i, n in enumerate(nodes):
        prv = by_id.get((pred.get(n["id"]) or [None])[-1])
        nxt = by_id.get((succ.get(n["id"]) or [None])[0])
        prv2 = by_id.get((pred.get(prv["id"]) or [None])[-1]) if prv else None
        ctx = {
            "index": i, "total": len(nodes),
            "ratio": i / max(len(nodes) - 1, 1),
            "prev_kind": prv["kind"] if prv else None,
            "next_kind": nxt["kind"] if nxt else None,
            "prev2_kind": prv2["kind"] if prv2 else None,
            "is_last": i == len(nodes) - 1,
            "in_block": len(n["path"]) > 2,
            "rf": n.get("rf") if n["kind"].startswith("conv") or n["family"] == "pool" else None,
            "param_share": 100.0 * n["n_params"] / total_params if total_params else None,
            "macs_share": 100.0 * n["macs"] / total_macs if total_macs else None,
        }
        n["explain"] = knowledge.explain(n, ctx)

    graph = {"meta": gb.meta, "nodes": nodes, "edges": edges,
             "groups": gb.groups, "warnings": gb.warnings}
    gb.meta["summary"] = knowledge.summarize(graph)
    return graph


def derive_groups(gb: GraphBuilder, depth=1):
    """Group nodes by their module-path prefix so the viewer can fold blocks."""
    buckets = {}
    for n in gb.nodes:
        if len(n["path"]) <= depth or n["path"][0] in ("functional", "input", "output"):
            continue
        key = ".".join(n["path"][:depth])
        buckets.setdefault(key, []).append(n["id"])
    gb.groups = [{"id": k, "label": k, "members": v}
                 for k, v in buckets.items() if len(v) > 1]


# ==========================================================================
# PyTorch
# ==========================================================================

_TORCH_ARGS = {
    "conv": ["in_channels", "out_channels", "kernel_size", "stride", "padding",
             "dilation", "groups", "output_padding"],
    "norm": ["num_features", "eps", "momentum", "affine", "track_running_stats",
             "normalized_shape", "num_groups", "num_channels", "elementwise_affine"],
    "pool": ["kernel_size", "stride", "padding", "dilation", "ceil_mode", "output_size"],
    "linear": ["in_features", "out_features"],
    "embedding": ["num_embeddings", "embedding_dim", "padding_idx"],
    "attention": ["embed_dim", "num_heads", "dropout", "batch_first"],
    "recurrent": ["input_size", "hidden_size", "num_layers", "bidirectional", "batch_first"],
    "regular": ["p", "inplace"],
    "activation": ["negative_slope", "inplace", "dim", "approximate"],
    "upsample": ["scale_factor", "mode", "size"],
    "shape": ["start_dim", "end_dim", "dims"],
}


def _torch_params(mod, kind):
    out = {}
    for name in _TORCH_ARGS.get(family_of(kind), []) + ["eps", "p"]:
        if hasattr(mod, name):
            v = getattr(mod, name)
            if isinstance(v, (int, float, bool, str)) or v is None:
                out[name] = v
            elif isinstance(v, (list, tuple)) and all(isinstance(x, (int, float)) for x in v):
                out[name] = list(v)
    if hasattr(mod, "bias"):
        out["bias"] = getattr(mod, "bias") is not None
    if hasattr(mod, "weight") and getattr(mod, "weight", None) is not None:
        try:
            out["weight_shape"] = list(mod.weight.shape)
        except Exception:
            pass
    return out


def _count_params(mod):
    try:
        return sum(p.numel() for p in mod.parameters(recurse=False))
    except Exception:
        return 0


def _guess_example_input(torch, model, input_shape):
    """Build a dummy input, guessing from the first parameterized layer if needed."""
    import torch.nn as nn
    if input_shape:
        shape = list(input_shape)
        first = None
        for m in model.modules():
            if isinstance(m, nn.Embedding):
                first = m
            break
        if isinstance(first, nn.Embedding):
            return torch.randint(0, max(first.num_embeddings - 1, 1), shape)
        return torch.randn(*shape)

    for m in model.modules():
        if isinstance(m, nn.Embedding):
            return torch.randint(0, max(m.num_embeddings - 1, 1), (1, 32))
        if isinstance(m, nn.Conv2d):
            return torch.randn(1, m.in_channels, 224, 224)
        if isinstance(m, nn.Conv1d):
            return torch.randn(1, m.in_channels, 128)
        if isinstance(m, nn.Conv3d):
            return torch.randn(1, m.in_channels, 8, 64, 64)
        if isinstance(m, nn.Linear):
            return torch.randn(1, m.in_features)
        if isinstance(m, (nn.LSTM, nn.GRU, nn.RNN)):
            return torch.randn(1, 16, m.input_size)
    return None


def _try_forward(torch, model, example):
    """Run a forward pass, retrying a few spatial sizes if the first fails."""
    import torch.nn as nn
    candidates = [example]
    if example is not None and example.dim() == 4:
        for s in (256, 299, 32, 64, 128, 512):
            candidates.append(torch.randn(example.shape[0], example.shape[1], s, s))
    last = None
    for c in candidates:
        if c is None:
            continue
        try:
            with torch.no_grad():
                model(c)
            return c, None
        except Exception as exc:
            last = exc
    return None, last


def _from_torch_module(model, source, input_shape, gb):
    import torch
    import torch.nn as nn

    model.eval()
    example = _guess_example_input(torch, model, input_shape)

    # --- attempt 1: fx symbolic trace (real dataflow, including residual adds)
    fx_graph = None
    try:
        from torch.fx import symbolic_trace
        traced = symbolic_trace(model)
        fx_graph = traced
    except Exception as exc:
        gb.warnings.append(f"torch.fx could not trace this model ({type(exc).__name__}); "
                           f"falling back to execution-order tracing, which does not show "
                           f"skip connections as edges.")

    shapes = {}
    if fx_graph is not None and example is not None:
        good, err = _try_forward(torch, model, example)
        if good is not None:
            example = good
            try:
                from torch.fx.passes.shape_prop import ShapeProp
                ShapeProp(fx_graph).propagate(example)
                for node in fx_graph.graph.nodes:
                    tm = node.meta.get("tensor_meta")
                    if tm is not None and hasattr(tm, "shape"):
                        shapes[node.name] = list(tm.shape)
            except Exception as exc:
                gb.warnings.append(f"shape propagation failed ({type(exc).__name__}); shapes omitted.")
        else:
            gb.warnings.append(
                "could not run a forward pass to record tensor shapes"
                + (f" (last error: {type(err).__name__}: {str(err)[:120]})" if err else "")
                + ". Pass --input-shape with the model's real input size to get shapes.")

    if fx_graph is not None:
        return _build_from_fx(fx_graph, model, shapes, gb)
    return _build_from_hooks(torch, model, example, gb)


_FX_FUNC_KIND = {
    "add": "add", "iadd": "add", "sub": "add", "mul": "mul", "imul": "mul",
    "cat": "concat", "concat": "concat", "relu": "relu", "gelu": "gelu", "silu": "silu",
    "sigmoid": "sigmoid", "tanh": "tanh", "softmax": "softmax", "flatten": "flatten",
    "adaptive_avg_pool2d": "adaptiveavgpool", "max_pool2d": "maxpool", "avg_pool2d": "avgpool",
    "dropout": "dropout", "interpolate": "upsample", "matmul": "linear", "reshape": "reshape",
    "view": "reshape", "permute": "permute", "transpose": "transpose", "contiguous": "identity",
    "scaled_dot_product_attention": "attention", "layer_norm": "layernorm", "linear": "linear",
    "pad": "padding", "chunk": "shape", "size": "skip", "getattr": "skip", "getitem": "skip",
    "unsqueeze": "unsqueeze", "squeeze": "squeeze", "mean": "avgpool",
}


def _build_from_fx(traced, model, shapes, gb):
    import torch.nn as nn
    mods = dict(model.named_modules())
    produced = {}          # fx node name -> our node id
    skipped = set()

    for fxn in traced.graph.nodes:
        nid = None
        if fxn.op == "placeholder":
            n = gb.add(f"input:{fxn.name}", "Input", kind="input",
                       out_shape=shapes.get(fxn.name), path=["input"], name=f"input ({fxn.name})")
            nid = n["id"]
        elif fxn.op == "call_module":
            mod = mods.get(fxn.target)
            if mod is None:
                continue
            cls = type(mod).__name__
            kind = canon_kind(cls)
            n = gb.add(fxn.target, cls, kind=kind, params=_torch_params(mod, kind),
                       out_shape=shapes.get(fxn.name), n_params=_count_params(mod),
                       path=fxn.target.split("."), name=fxn.target)
            nid = n["id"]
        elif fxn.op in {"call_function", "call_method"}:
            raw = getattr(fxn.target, "__name__", str(fxn.target))
            raw = raw.strip("_") or str(fxn.target)
            kind = _FX_FUNC_KIND.get(raw, None)
            if kind in (None, "skip"):
                skipped.add(fxn.name)
                continue
            params = {}
            if kind == "concat":
                params["dim"] = fxn.kwargs.get("dim", 1)
            n = gb.add(f"fn:{fxn.name}", raw, kind=kind, params=params,
                       out_shape=shapes.get(fxn.name), path=["functional", raw], name=raw)
            nid = n["id"]
        elif fxn.op == "output":
            n = gb.add("output", "Output", kind="output", in_shape=None,
                       out_shape=None, path=["output"], name="output")
            nid = n["id"]
        elif fxn.op == "get_attr":
            skipped.add(fxn.name)
            continue

        if nid is None:
            continue
        produced[fxn.name] = nid

        # edges from the fx argument graph, following through skipped nodes
        for arg in _fx_inputs(fxn):
            src = _resolve(arg, produced, skipped, traced)
            if src:
                gb.link(src, nid)

    # fill in in_shape from the upstream node's out_shape
    by_id = {n["id"]: n for n in gb.nodes}
    for e in gb.edges:
        dst, src = by_id.get(e["dst"]), by_id.get(e["src"])
        if dst and src and dst["in_shape"] is None:
            dst["in_shape"] = src["out_shape"]
        if src and dst:
            e["tensor_shape"] = src["out_shape"]
    for n in gb.nodes:
        if n["kind"] == "output" and n["in_shape"]:
            n["out_shape"] = n["in_shape"]
    derive_groups(gb, depth=1)
    return gb


def _fx_inputs(fxn):
    import torch.fx as fx
    out = []

    def walk(a):
        if isinstance(a, fx.Node):
            out.append(a)
        elif isinstance(a, (list, tuple)):
            for x in a:
                walk(x)
        elif isinstance(a, dict):
            for x in a.values():
                walk(x)

    walk(fxn.args)
    walk(fxn.kwargs)
    return out


def _resolve(arg, produced, skipped, traced):
    """Map an fx node to the nearest emitted node, hopping over skipped ones."""
    seen = set()
    stack = [arg]
    while stack:
        a = stack.pop(0)
        if a.name in produced:
            return produced[a.name]
        if a.name in seen:
            continue
        seen.add(a.name)
        if a.name in skipped:
            stack.extend(_fx_inputs(a))
    return None


def _build_from_hooks(torch, model, example, gb):
    """Fallback: record the true execution order and shapes with forward hooks."""
    import torch.nn as nn
    records = []
    handles = []

    def mk(name, mod):
        def hook(m, inp, out):
            def shp(t):
                try:
                    return list(t.shape)
                except Exception:
                    return None
            i = shp(inp[0]) if inp else None
            o = shp(out) if not isinstance(out, (tuple, list)) else shp(out[0])
            records.append((name, m, i, o))
        return hook

    leaves = [(n, m) for n, m in model.named_modules()
              if n and (not list(m.children()) or canon_kind(type(m).__name__) in ATOMIC_KINDS)]
    leaves = [(n, m) for n, m in leaves
              if not any(n.startswith(o + ".") for o, om in leaves
                         if canon_kind(type(om).__name__) in ATOMIC_KINDS)]
    for name, mod in leaves:
        handles.append(mod.register_forward_hook(mk(name, mod)))

    ran = False
    if example is not None:
        good, err = _try_forward(torch, model, example)
        ran = good is not None
        if not ran:
            gb.warnings.append("forward pass failed, so shapes are unavailable; the layer order "
                               "below is declaration order, not execution order. "
                               "Pass --input-shape to fix this.")
    for h in handles:
        h.remove()

    if not ran:
        records = [(n, m, None, None) for n, m in leaves]

    prev = None
    for name, mod, ish, osh in records:
        cls = type(mod).__name__
        kind = canon_kind(cls)
        n = gb.add(name, cls, kind=kind, params=_torch_params(mod, kind),
                   in_shape=ish, out_shape=osh, n_params=_count_params(mod),
                   path=name.split("."), name=name)
        gb.link(prev, n["id"])
        prev = n["id"]
    if records and records[0][2]:
        first = gb.add("input", "Input", kind="input", out_shape=records[0][2], path=["input"])
        gb.edges.insert(0, {"src": first["id"], "dst": gb.nodes[0]["id"], "kind": "sequential", "note": None})
        gb.nodes.insert(0, gb.nodes.pop())
    derive_groups(gb, depth=1)
    return gb


# --- state_dict / safetensors inference -----------------------------------


# --- structural unpickling ------------------------------------------------
#
# torch.save(model) pickles the object graph, so torch.load normally needs the
# original class definitions importable and executes whatever the file says.
# We want neither. Instead we unpickle with a find_class that resolves only a
# small allowlist of tensor-rebuilding helpers and turns every other global
# into an inert placeholder. Constructor attributes and the _modules tree are
# stored as plain instance state, so the placeholders still carry the full
# architecture -- class names, hyperparameters and parameter shapes -- without
# any of the model's own code being imported or run.

_PICKLE_ALLOW = {
    ("torch._utils", "_rebuild_tensor"),
    ("torch._utils", "_rebuild_tensor_v2"),
    ("torch._utils", "_rebuild_tensor_v3"),
    ("torch._utils", "_rebuild_parameter"),
    ("torch._utils", "_rebuild_parameter_with_state"),
    ("torch._utils", "_rebuild_meta_tensor_no_storage"),
    ("torch._utils", "_rebuild_sparse_tensor"),
    ("torch._utils", "_rebuild_device_tensor_from_numpy"),
    ("torch", "Size"), ("torch", "device"), ("torch", "dtype"), ("torch", "Tensor"),
    ("collections", "OrderedDict"), ("collections", "defaultdict"),
    ("builtins", "dict"), ("builtins", "list"), ("builtins", "set"),
    ("builtins", "tuple"), ("builtins", "frozenset"),
    ("__builtin__", "dict"), ("__builtin__", "list"), ("__builtin__", "set"),
}


class _Stub:
    """Stands in for a class we refuse to import. Records name and state."""
    __netviz_cls__ = "object"
    __netviz_mod__ = ""

    def __init__(self, *args, **kwargs):
        self.__netviz_args__ = args

    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        elif isinstance(state, tuple) and len(state) == 2:
            for part in state:
                if isinstance(part, dict):
                    self.__dict__.update(part)
        else:
            self.__netviz_state__ = state

    # pickle may extend containers through these
    def append(self, item):
        self.__dict__.setdefault("__netviz_items__", []).append(item)

    def __setitem__(self, key, value):
        self.__dict__.setdefault("__netviz_map__", {})[key] = value

    def __repr__(self):
        return f"<stub {self.__netviz_cls__}>"


_stub_cache = {}


def _stub_for(module, name):
    key = (module, name)
    if key not in _stub_cache:
        _stub_cache[key] = type(f"Stub_{name}", (_Stub,),
                               {"__netviz_cls__": name, "__netviz_mod__": module})
    return _stub_cache[key]


def _make_pickle_module():
    import pickle

    class StructuralUnpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if (module, name) in _PICKLE_ALLOW or (
                    module.startswith("torch") and name.endswith("Storage")):
                try:
                    return super().find_class(module, name)
                except Exception:
                    pass
            return _stub_for(module, name)

    class FakePickle:
        Unpickler = StructuralUnpickler
        UnpicklingError = pickle.UnpicklingError

        @staticmethod
        def load(f, **kw):
            return StructuralUnpickler(f, **kw).load()

        @staticmethod
        def loads(b, **kw):
            import io
            return StructuralUnpickler(io.BytesIO(b), **kw).load()

    return FakePickle


def _cls_name(obj):
    return getattr(obj, "__netviz_cls__", None) or type(obj).__name__


def _state(obj):
    return getattr(obj, "__dict__", {}) or {}


_STRUCT_ATTRS = ("in_channels", "out_channels", "kernel_size", "stride", "padding", "dilation",
                 "groups", "output_padding", "num_features", "eps", "momentum", "affine",
                 "normalized_shape", "num_groups", "num_channels", "elementwise_affine",
                 "in_features", "out_features", "num_embeddings", "embedding_dim", "padding_idx",
                 "embed_dim", "num_heads", "hidden_size", "input_size", "num_layers",
                 "bidirectional", "p", "inplace", "negative_slope", "dim", "output_size",
                 "scale_factor", "mode", "start_dim", "end_dim", "ceil_mode", "batch_first")


def _from_stub_tree(root, gb, input_shape):
    """Walk the (possibly stubbed) module tree and emit a chain of nodes."""
    prev = None
    seen = set()

    def leaf_params(st):
        n = 0
        for d in (st.get("_parameters") or {}).values():
            shape = getattr(d, "shape", None)
            if shape is not None:
                n += _prod(list(shape))
        return n

    def walk(obj, path):
        nonlocal prev
        if id(obj) in seen:
            return
        seen.add(id(obj))
        st = _state(obj)
        children = st.get("_modules") or {}
        if children and canon_kind(_cls_name(obj)) not in ATOMIC_KINDS:
            for name, child in children.items():
                if child is not None:
                    walk(child, path + [str(name)])
            return

        cls = _cls_name(obj)
        kind = canon_kind(cls)
        params = {}
        for a in _STRUCT_ATTRS:
            if a in st:
                v = st[a]
                if isinstance(v, (int, float, bool, str)) or v is None:
                    params[a] = v
                elif isinstance(v, (list, tuple)) and all(isinstance(x, (int, float)) for x in v):
                    params[a] = list(v)
        prm = st.get("_parameters") or {}
        if "weight" in prm and getattr(prm.get("weight"), "shape", None) is not None:
            w = list(prm["weight"].shape)
            params["weight_shape"] = w
            if kind.startswith("conv") and "out_channels" not in params:
                params["out_channels"], params["in_channels"] = w[0], w[1]
                params["kernel_size"] = w[2:]
            if kind == "linear" and "out_features" not in params:
                params["out_features"], params["in_features"] = w[0], w[1]
        params["bias"] = prm.get("bias") is not None

        name = ".".join(path) or cls
        n = gb.add(name, cls, kind=kind, params=params, n_params=leaf_params(st),
                   path=path or [cls], name=name)
        gb.link(prev, n["id"])
        prev = n["id"]

    walk(root, [])
    if gb.nodes and input_shape:
        head = gb.add("input", "Input", kind="input", out_shape=input_shape, path=["input"])
        gb.nodes.insert(0, gb.nodes.pop())
        gb.edges.insert(0, {"src": head["id"], "dst": gb.nodes[1]["id"],
                            "kind": "sequential", "note": None})
    derive_groups(gb, depth=1)
    return gb


def _structural_load(path):
    import torch
    pm = _make_pickle_module()
    for kwargs in ({"mmap": True}, {}):
        try:
            return torch.load(path, map_location="cpu", pickle_module=pm,
                              weights_only=False, **kwargs)
        except Exception as exc:
            last = exc
    raise last


def _infer_from_tensor_index(index, gb, note):
    """index: ordered list of (key, shape). Reconstruct a plausible layer chain."""
    gb.warnings.append(note)
    groups = {}
    order = []
    for key, shape in index:
        prefix, _, leaf = key.rpartition(".")
        prefix = prefix or key
        if prefix not in groups:
            groups[prefix] = {}
            order.append(prefix)
        groups[prefix][leaf] = shape

    prev = None
    for prefix in order:
        t = groups[prefix]
        w = t.get("weight")
        kind, params = None, {}
        nparams = sum(_prod(s) for k2, s in t.items() if k2 not in _BUFFER_KEYS)
        low = prefix.lower()

        if w is None:
            if "in_proj_weight" in t:
                kind = "attention"
                params = {"embed_dim": t["in_proj_weight"][1]}
            else:
                continue
        elif len(w) == 4:
            kind = "conv2d"
            params = {"out_channels": w[0], "in_channels": w[1], "kernel_size": [w[2], w[3]],
                      "bias": "bias" in t, "stride": None, "groups": 1}
        elif len(w) == 5:
            kind = "conv3d"
            params = {"out_channels": w[0], "in_channels": w[1], "kernel_size": w[2:], "bias": "bias" in t}
        elif len(w) == 3:
            kind = "conv1d"
            params = {"out_channels": w[0], "in_channels": w[1], "kernel_size": [w[2]], "bias": "bias" in t}
        elif len(w) == 2:
            if "embed" in low or "wte" in low or "wpe" in low or ("bias" not in t and w[0] > 4 * w[1]):
                kind = "embedding"
                params = {"num_embeddings": w[0], "embedding_dim": w[1]}
            else:
                kind = "linear"
                params = {"out_features": w[0], "in_features": w[1], "bias": "bias" in t}
        elif len(w) == 1:
            if "running_mean" in t or "running_var" in t:
                kind = "batchnorm"
                params = {"num_features": w[0], "affine": True}
            elif "ln" in low or "norm" in low or "layer_norm" in low:
                kind = "rmsnorm" if "bias" not in t else "layernorm"
                params = {"normalized_shape": w[0]}
            else:
                kind = "layernorm"
                params = {"normalized_shape": w[0]}
        if kind is None:
            continue
        n = gb.add(prefix, _DISPLAY.get(kind, kind.title()), kind=kind, params=params,
                   n_params=nparams, path=prefix.split("."), name=prefix)
        gb.link(prev, n["id"])
        prev = n["id"]
    derive_groups(gb, depth=1)
    return gb


def _flatten_state_dict(obj):
    """Pull a tensor dict out of a checkpoint, stripping DataParallel prefixes."""
    for key in ("state_dict", "model_state_dict", "model", "net", "module", "weights"):
        if isinstance(obj, dict) and key in obj and isinstance(obj[key], dict):
            obj = obj[key]
            break
    if not isinstance(obj, dict):
        return None
    items = []
    for k, v in obj.items():
        shape = getattr(v, "shape", None)
        if shape is None:
            continue
        k = k[7:] if k.startswith("module.") else k
        items.append((k, list(shape)))
    return items or None


def _from_torchscript(path, input_shape, gb):
    """ScriptModules reject forward hooks, so read the module tree directly."""
    import torch
    model = torch.jit.load(path, map_location="cpu")
    prev = None
    atomic_prefixes = []
    for name, mod in model.named_modules():
        cls = getattr(mod, "original_name", type(mod).__name__)
        if not name:
            continue
        if any(name.startswith(a + ".") for a in atomic_prefixes):
            continue
        if canon_kind(cls) in ATOMIC_KINDS:
            atomic_prefixes.append(name)
        elif list(mod.children()):
            continue
        kind = canon_kind(cls)
        params = {}
        for a in _STRUCT_ATTRS:
            try:
                v = getattr(mod, a)
            except Exception:
                continue
            if isinstance(v, (int, float, bool, str)):
                params[a] = v
            elif isinstance(v, (list, tuple)) and all(isinstance(x, (int, float)) for x in v):
                params[a] = list(v)
        npar = 0
        try:
            for pnm, pv in mod.named_parameters(recurse=False):
                npar += pv.numel()
                if pnm == "weight":
                    w = list(pv.shape)
                    params["weight_shape"] = w
                    if kind.startswith("conv"):
                        params.setdefault("out_channels", w[0])
                        params.setdefault("in_channels", w[1])
                        params.setdefault("kernel_size", w[2:])
                    elif kind == "linear":
                        params.setdefault("out_features", w[0])
                        params.setdefault("in_features", w[1])
                if pnm == "bias":
                    params["bias"] = True
        except Exception:
            pass
        params.setdefault("bias", False)
        n = gb.add(name, cls, kind=kind, params=params, n_params=npar,
                   path=name.split("."), name=name)
        gb.link(prev, n["id"])
        prev = n["id"]
    if input_shape and gb.nodes:
        head = gb.add("input", "Input", kind="input", out_shape=input_shape, path=["input"])
        gb.nodes.insert(0, gb.nodes.pop())
        gb.edges.insert(0, {"src": head["id"], "dst": gb.nodes[1]["id"], "kind": "sequential", "note": None})
    derive_groups(gb, depth=1)
    return gb


def from_pytorch(path, input_shape=None, allow_unsafe=False):
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        raise RuntimeError(
            "PyTorch is not installed, so .pt/.pth files cannot be read.\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cpu\n"
            "Tip: a .safetensors file needs no dependencies at all.")

    # 1. TorchScript archives carry serialized code, so they are self-describing
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
        if any(n.endswith("constants.pkl") for n in names) or any("/code/" in n for n in names):
            gb = GraphBuilder("pytorch", "TorchScript archive", path)
            gb.meta["extractor"] = "torch.jit module tree"
            gb.input_shape = input_shape
            gb.assume_shapes = True
            gb.warnings.append(
                "TorchScript archive: the module tree is exact, but this reader lists layers in "
                "declaration order rather than following the scripted control flow, so branches and "
                "skip connections are not drawn as separate edges.")
            return _from_torchscript(path, input_shape, gb).result()
    except (zipfile.BadZipFile, FileNotFoundError):
        pass
    except Exception:
        pass

    # 2. plain tensor dict / training checkpoint -- safe to load
    obj, is_pickled_object = None, False
    try:
        obj = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:
        is_pickled_object = True

    if not is_pickled_object:
        index = _flatten_state_dict(obj)
        if index:
            gb = GraphBuilder("pytorch", "state_dict / checkpoint", path)
            gb.meta["extractor"] = "parameter-shape inference"
            gb.input_shape = input_shape
            gb.assume_shapes = True
            _infer_from_tensor_index(
                index, gb,
                "This file holds weights only — no architecture. The layers below were inferred from "
                "parameter names and shapes, in the order they appear in the checkpoint. Activations, "
                "pooling, reshapes and skip connections leave no trace in a state_dict, so they are "
                "not shown. For the true graph, save the model object itself or export TorchScript.")
            return gb.result()
        raise RuntimeError(f"Loaded a {type(obj).__name__} from {path} with no tensors in it.")

    # 3. a pickled object. With --allow-unsafe-unpickle we can load it for real,
    #    which is the only path that yields true dataflow and observed shapes.
    if allow_unsafe:
        try:
            obj = torch.load(path, map_location="cpu", weights_only=False)
            if isinstance(obj, nn.Module):
                gb = GraphBuilder("pytorch", "pickled nn.Module", path)
                gb.meta["extractor"] = "torch.fx symbolic trace + shape propagation"
                gb.input_shape = input_shape
                return _from_torch_module(obj, path, input_shape, gb).result()
            index = _flatten_state_dict(obj)
            if index:
                gb = GraphBuilder("pytorch", "checkpoint", path)
                gb.meta["extractor"] = "parameter-shape inference"
                gb.input_shape, gb.assume_shapes = input_shape, True
                _infer_from_tensor_index(index, gb, "Weights only; layers inferred from parameter shapes.")
                return gb.result()
        except Exception as exc:
            note = (f"full unpickling failed ({type(exc).__name__}: {str(exc)[:160]}); "
                    f"fell back to structural reading.")
    else:
        note = None

    # 4. structural read: architecture without importing or running the file's code
    try:
        root = _structural_load(path)
    except Exception as exc:
        raise RuntimeError(
            f"Could not read {os.path.basename(path)}: {type(exc).__name__}: {str(exc)[:200]}\n"
            "If this is a pickled nn.Module whose class lives in your own code, pass --code "
            "path/to/model_def.py so the class can be resolved, or --allow-unsafe-unpickle.")

    if isinstance(root, dict):
        index = [(k, list(getattr(v, "shape", []) or []))
                 for k, v in root.items() if getattr(v, "shape", None) is not None]
        if index:
            gb = GraphBuilder("pytorch", "checkpoint", path)
            gb.meta["extractor"] = "parameter-shape inference"
            gb.input_shape, gb.assume_shapes = input_shape, True
            _infer_from_tensor_index(index, gb, "Weights only; layers inferred from parameter shapes.")
            return gb.result()

    gb = GraphBuilder("pytorch", "pickled nn.Module", path)
    gb.meta["extractor"] = "structural unpickling (model code not imported)"
    gb.input_shape = input_shape
    gb.assume_shapes = True
    if note:
        gb.warnings.append(note)
    gb.warnings.append(
        "Read without importing or executing the model's own code, so the class definitions were "
        "not needed. That gives exact layer types, hyperparameters and parameter shapes, but the "
        "order below is module declaration order and forward() was never run — branches, skip "
        "connections and functional ops (F.relu, +, torch.cat) are therefore not shown. Re-run with "
        "--allow-unsafe-unpickle, or point --code at the file defining the model class, to trace "
        "the real dataflow.")
    _from_stub_tree(root, gb, input_shape)
    if not gb.nodes:
        raise RuntimeError(f"No layers found in {path}.")
    return gb.result()


def from_safetensors(path, input_shape=None):
    with open(path, "rb") as fh:
        (n,) = struct.unpack("<Q", fh.read(8))
        header = json.loads(fh.read(n).decode("utf-8"))
    index = [(k, v["shape"]) for k, v in header.items()
             if k != "__metadata__" and isinstance(v, dict) and "shape" in v]
    gb = GraphBuilder("pytorch", "safetensors", path)
    gb.meta["extractor"] = "safetensors header (no framework needed)"
    gb.input_shape, gb.assume_shapes = input_shape, True
    _infer_from_tensor_index(
        index, gb,
        "safetensors stores tensors only. The layers below were inferred from parameter names and "
        "shapes; activations, pooling and skip connections are not recorded in this format.")
    return gb.result()


# ==========================================================================
# Keras / TensorFlow
# ==========================================================================

_KERAS_ARG_MAP = {
    "filters": "out_channels", "units": "out_features", "kernel_size": "kernel_size",
    "strides": "stride", "padding": "padding", "dilation_rate": "dilation", "groups": "groups",
    "use_bias": "bias", "rate": "p", "pool_size": "pool", "epsilon": "eps", "momentum": "momentum",
    "axis": "dim", "num_heads": "num_heads", "key_dim": "head_dim", "input_dim": "num_embeddings",
    "output_dim": "embedding_dim", "size": "scale_factor", "interpolation": "mode",
    "num_groups": "num_groups", "activation": "activation",
}


def _keras_shape_out(kind, params, ins, cfg):
    """Small shape propagator so .keras files give real shapes with no TF installed."""
    if not ins:
        return None
    s = list(ins)
    ch_last = True

    def pairs(v, d=1):
        if isinstance(v, (list, tuple)):
            return list(v)
        return [v if v is not None else d] * 2

    if kind in {"conv2d", "convtranspose2d"} and len(s) == 4:
        k = pairs(params.get("kernel_size"), 1)
        st = pairs(params.get("stride"), 1)
        pad = str(cfg.get("padding", "valid")).lower()
        h, w = s[1], s[2]
        if kind == "convtranspose2d":
            oh = h * st[0] if h else None
            ow = w * st[1] if w else None
        elif pad == "same":
            oh = -(-h // st[0]) if h else None
            ow = -(-w // st[1]) if w else None
        else:
            oh = (h - k[0]) // st[0] + 1 if h else None
            ow = (w - k[1]) // st[1] + 1 if w else None
        return [s[0], oh, ow, params.get("out_channels")]
    if kind in {"maxpool", "avgpool"} and len(s) == 4:
        k = pairs(cfg.get("pool_size", 2), 2)
        st = pairs(cfg.get("strides") or k, k[0])
        pad = str(cfg.get("padding", "valid")).lower()
        h, w = s[1], s[2]
        if pad == "same":
            oh = -(-h // st[0]) if h else None
            ow = -(-w // st[1]) if w else None
        else:
            oh = (h - k[0]) // st[0] + 1 if h else None
            ow = (w - k[1]) // st[1] + 1 if w else None
        return [s[0], oh, ow, s[3]]
    if kind in {"globalavgpool", "globalmaxpool"}:
        return [s[0], s[-1]]
    if kind == "flatten":
        return [s[0], _prod(s[1:])]
    if kind == "linear":
        return s[:-1] + [params.get("out_features")]
    if kind == "embedding":
        return s + [params.get("embedding_dim")]
    if kind == "upsample" and len(s) == 4:
        sc = pairs(cfg.get("size", 2), 2)
        return [s[0], (s[1] or 0) * sc[0] or None, (s[2] or 0) * sc[1] or None, s[3]]
    if kind == "reshape":
        return [s[0]] + list(cfg.get("target_shape", []))
    return s


def _keras_nparams(kind, params, ins, outs):
    try:
        if kind.startswith("conv") and ins and outs:
            k = params.get("kernel_size") or [1, 1]
            k = k if isinstance(k, (list, tuple)) else [k, k]
            cin, cout = ins[-1], params.get("out_channels") or outs[-1]
            g = params.get("groups", 1) or 1
            n = _prod(list(k)) * (cin // g) * cout
            return n + (cout if params.get("bias", True) else 0)
        if kind == "linear" and ins:
            fin = ins[-1]
            fout = params.get("out_features")
            return fin * fout + (fout if params.get("bias", True) else 0)
        if kind == "batchnorm" and ins:
            return 4 * ins[-1]
        if kind in {"layernorm", "groupnorm"} and ins:
            return 2 * ins[-1]
        if kind == "embedding":
            return params.get("num_embeddings", 0) * params.get("embedding_dim", 0)
    except Exception:
        pass
    return 0


def _from_keras_config(cfg, gb):
    """Walk a Keras model config (Sequential or Functional), flattening nested models."""
    layers = cfg.get("layers") or []
    prev = None
    shape_of = {}

    def emit(layer, parent=""):
        nonlocal prev
        cls = layer.get("class_name", "Layer")
        lc = layer.get("config", {}) or {}
        name = (parent + "/" if parent else "") + lc.get("name", cls)

        # nested Functional/Sequential -> recurse so blocks are not opaque
        if cls in {"Functional", "Sequential", "Model"} and lc.get("layers"):
            for sub in lc["layers"]:
                emit(sub, name)
            return

        kind = canon_kind(cls)
        params = {}
        for kk, vv in lc.items():
            if kk in _KERAS_ARG_MAP and vv is not None and not isinstance(vv, dict):
                params[_KERAS_ARG_MAP[kk]] = vv
        if cls in {"DepthwiseConv2D", "SeparableConv2D"}:
            params["groups"] = "depthwise"

        ins = None
        if kind == "input":
            bs = lc.get("batch_shape") or lc.get("batch_input_shape")
            ins = list(bs) if bs else None
            ins = [x if isinstance(x, int) else None for x in ins] if ins else None
            outs = ins
        else:
            bc = layer.get("build_config") or {}
            ins = bc.get("input_shape")
            if ins:
                ins = [x if isinstance(x, int) else None for x in ins]
            elif prev is not None:
                ins = shape_of.get(prev)
            if ins and kind.startswith("conv") and params.get("out_channels") is None:
                params["out_channels"] = lc.get("filters")
            if ins and kind == "conv2d":
                params["in_channels"] = ins[-1]
            if ins and kind == "linear":
                params["in_features"] = ins[-1]
            outs = _keras_shape_out(kind, params, ins, lc)

        npar = _keras_nparams(kind, params, ins, outs)
        node = gb.add(name, cls, kind=kind, params=params, in_shape=ins, out_shape=outs,
                      n_params=npar, path=name.split("/"), name=name)
        shape_of[node["id"]] = outs

        inbound = layer.get("inbound_nodes")
        linked = False
        if inbound:
            for src in _keras_inbound_names(inbound):
                sid = next((n["id"] for n in gb.nodes if n["name"].split("/")[-1] == src), None)
                if sid:
                    gb.link(sid, node["id"])
                    linked = True
        if not linked:
            gb.link(prev, node["id"])
        prev = node["id"]

        # Keras folds the activation into the layer config; surface it as its own node
        act = lc.get("activation")
        if isinstance(act, str) and act not in ("linear", "none", None) and kind != "input":
            an = gb.add(name + "/" + act, act.upper(), kind=canon_kind(act),
                        in_shape=outs, out_shape=outs, path=name.split("/") + [act],
                        name=name + " · " + act)
            gb.link(prev, an["id"])
            shape_of[an["id"]] = outs
            prev = an["id"]

    for layer in layers:
        emit(layer)
    derive_groups(gb, depth=1)
    return gb


def _keras_inbound_names(inbound):
    """Both Keras 2 and Keras 3 inbound_nodes layouts."""
    out = []

    def walk(x):
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict):
            if "keras_history" in x:
                kh = x["keras_history"]
                if isinstance(kh, (list, tuple)) and kh:
                    out.append(kh[0])
            else:
                for v in x.values():
                    walk(v)
        elif isinstance(x, (list, tuple)):
            if x and isinstance(x[0], str) and len(x) >= 3 and isinstance(x[1], int):
                out.append(x[0])
            else:
                for v in x:
                    walk(v)

    walk(inbound)
    return out


def from_keras_archive(path):
    with zipfile.ZipFile(path) as z:
        cfg = json.loads(z.read("config.json").decode("utf-8"))
        meta = {}
        try:
            meta = json.loads(z.read("metadata.json").decode("utf-8"))
        except KeyError:
            pass
    gb = GraphBuilder("keras", f"Keras {meta.get('keras_version', '3')} archive", path)
    gb.meta["extractor"] = "config.json (no TensorFlow required)"
    gb.meta["model_class"] = cfg.get("class_name")
    _from_keras_config(cfg.get("config", cfg), gb)
    return gb.result()


def from_keras_json(path_or_text, is_text=False):
    raw = path_or_text if is_text else open(path_or_text, "r", encoding="utf-8").read()
    cfg = json.loads(raw)
    if isinstance(cfg, dict) and "config" in cfg:
        top = cfg["config"]
    else:
        top = cfg
    gb = GraphBuilder("keras", "Keras architecture JSON", path_or_text if not is_text else "model_config")
    gb.meta["extractor"] = "architecture JSON"
    gb.meta["model_class"] = cfg.get("class_name") if isinstance(cfg, dict) else None
    _from_keras_config(top, gb)
    return gb.result()


def from_h5(path):
    cfg_text = None
    try:
        import h5py
        with h5py.File(path, "r") as f:
            raw = f.attrs.get("model_config")
            if raw is not None:
                cfg_text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
    except ImportError:
        pass
    if cfg_text is None:
        cfg_text = _scan_h5_for_config(path)
    if cfg_text is None:
        raise RuntimeError(
            "No architecture found in this .h5 file. It is probably a weights-only save "
            "(model.save_weights). Install h5py for a better read, or re-save with model.save('m.keras').")
    graph = from_keras_json(cfg_text, is_text=True)
    graph["meta"]["format"] = "Keras HDF5 (.h5)"
    graph["meta"]["source"] = os.path.basename(path)
    return graph


def _scan_h5_for_config(path, limit=64 * 1024 * 1024):
    """Pull the model_config JSON out of an HDF5 file without h5py.

    Keras stores it as a plain string attribute, so it sits in the file as
    readable text; find the opening brace and balance from there.
    """
    with open(path, "rb") as fh:
        blob = fh.read(limit)
    for marker in (b'{"class_name":', b'{"class_name": '):
        start = blob.find(marker)
        if start < 0:
            continue
        depth, i, in_str, esc = 0, start, False, False
        while i < len(blob):
            c = blob[i:i + 1]
            if in_str:
                if esc:
                    esc = False
                elif c == b"\\":
                    esc = True
                elif c == b'"':
                    in_str = False
            elif c == b'"':
                in_str = True
            elif c == b"{":
                depth += 1
            elif c == b"}":
                depth -= 1
                if depth == 0:
                    try:
                        return blob[start:i + 1].decode("utf-8")
                    except UnicodeDecodeError:
                        return None
            i += 1
    return None


def from_saved_model(path):
    # keras_metadata.pb often carries the same JSON config, readable without TF
    kmp = os.path.join(path, "keras_metadata.pb")
    if os.path.exists(kmp):
        cfg = _scan_h5_for_config(kmp)
        if cfg:
            g = from_keras_json(cfg, is_text=True)
            g["meta"]["format"] = "TensorFlow SavedModel (Keras metadata)"
            g["meta"]["source"] = os.path.basename(path.rstrip("/"))
            return g
    try:
        import tensorflow as tf
    except ImportError:
        raise RuntimeError(
            "This SavedModel has no Keras metadata, so TensorFlow is needed to read its graph.\n"
            "  pip install tensorflow-cpu\n"
            "Or re-save the model as model.save('model.keras'), which this tool reads with no dependencies.")
    model = tf.keras.models.load_model(path)
    cfg = json.loads(model.to_json())
    g = from_keras_json(json.dumps(cfg), is_text=True)
    g["meta"]["format"] = "TensorFlow SavedModel"
    g["meta"]["source"] = os.path.basename(path.rstrip("/"))
    return g


# ==========================================================================
# ONNX
# ==========================================================================


def from_onnx(path):
    try:
        import onnx
    except ImportError:
        raise RuntimeError("Reading .onnx needs the onnx package:  pip install onnx")
    m = onnx.load(path)
    g = m.graph
    gb = GraphBuilder("onnx", f"ONNX opset {m.opset_import[0].version if m.opset_import else '?'}", path)
    gb.meta["extractor"] = "onnx graph"

    def dims(vi):
        try:
            return [d.dim_value or None for d in vi.type.tensor_type.shape.dim]
        except Exception:
            return None

    shapes = {vi.name: dims(vi) for vi in list(g.value_info) + list(g.input) + list(g.output)}
    init = {i.name: list(i.dims) for i in g.initializer}
    producer = {}

    for vi in g.input:
        if vi.name in init:
            continue
        n = gb.add(f"input:{vi.name}", "Input", kind="input", out_shape=shapes.get(vi.name), path=["input"])
        producer[vi.name] = n["id"]

    for onode in g.node:
        attrs = {}
        for a in onode.attribute:
            if a.type == 2:
                attrs[a.name] = a.i
            elif a.type == 1:
                attrs[a.name] = round(a.f, 6)
            elif a.type == 7:
                attrs[a.name] = list(a.ints)
            elif a.type == 3:
                attrs[a.name] = a.s.decode("utf-8", "replace")
        kind = canon_kind(onode.op_type)
        params = dict(attrs)
        if "kernel_shape" in attrs:
            params["kernel_size"] = attrs["kernel_shape"]
        if "strides" in attrs:
            params["stride"] = attrs["strides"]
        if "pads" in attrs:
            params["padding"] = attrs["pads"][:1]
        if "dilations" in attrs:
            params["dilation"] = attrs["dilations"]
        if "group" in attrs:
            params["groups"] = attrs["group"]
        npar = sum(_prod(init[i]) for i in onode.input if i in init)
        w = next((init[i] for i in onode.input if i in init and len(init[i]) >= 2), None)
        if w is not None and kind.startswith("conv"):
            params.setdefault("out_channels", w[0])
            params.setdefault("in_channels", w[1] * (attrs.get("group", 1) or 1))
        if w is not None and kind == "linear":
            params.setdefault("out_features", w[0])
            params.setdefault("in_features", w[1])
        name = onode.name or f"{onode.op_type}_{len(gb.nodes)}"
        out_shape = shapes.get(onode.output[0]) if onode.output else None
        n = gb.add(name, onode.op_type, kind=kind, params=params, out_shape=out_shape,
                   n_params=npar, path=name.split("/"), name=name)
        for i in onode.input:
            if i in producer:
                gb.link(producer[i], n["id"])
        for o in onode.output:
            producer[o] = n["id"]

    by_id = {n["id"]: n for n in gb.nodes}
    for e in gb.edges:
        d, s = by_id.get(e["dst"]), by_id.get(e["src"])
        if d and s and d["in_shape"] is None:
            d["in_shape"] = s["out_shape"]
    derive_groups(gb, depth=1)
    return gb.result()


# ==========================================================================
# dispatch
# ==========================================================================


def load_model_code(py_path):
    """Execute a user module so pickled classes defined in it can be resolved.

    Only ever called when the user names the file explicitly with --code.
    """
    import importlib.util
    py_path = os.path.expanduser(py_path)
    spec = importlib.util.spec_from_file_location("_netviz_model_code", py_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_netviz_model_code"] = mod
    spec.loader.exec_module(mod)
    main = sys.modules.get("__main__")
    for name in dir(mod):
        if not name.startswith("_") and main is not None and not hasattr(main, name):
            setattr(main, name, getattr(mod, name))
    return mod


def extract(source, input_shape=None, allow_unsafe=False, code=None):
    source = os.path.expanduser(str(source))
    if not os.path.exists(source):
        raise RuntimeError(f"No such file or directory: {source}")
    if code:
        load_model_code(code)

    if os.path.isdir(source):
        if os.path.exists(os.path.join(source, "saved_model.pb")):
            return from_saved_model(source)
        for name in sorted(os.listdir(source)):
            if name.endswith((".keras", ".h5", ".pt", ".pth", ".onnx", ".safetensors")):
                return extract(os.path.join(source, name), input_shape, allow_unsafe)
        raise RuntimeError(f"{source} is a directory with no recognizable model file in it.")

    ext = os.path.splitext(source)[1].lower()
    if ext == ".keras":
        return from_keras_archive(source)
    if ext in (".h5", ".hdf5"):
        return from_h5(source)
    if ext == ".json":
        return from_keras_json(source)
    if ext == ".onnx":
        return from_onnx(source)
    if ext == ".safetensors":
        return from_safetensors(source, input_shape)
    if ext in (".pt", ".pth", ".bin", ".ckpt", ".pkl"):
        return from_pytorch(source, input_shape, allow_unsafe)

    # unknown extension: sniff the magic bytes
    with open(source, "rb") as fh:
        head = fh.read(8)
    if head.startswith(b"\x89HDF"):
        return from_h5(source)
    if head.startswith(b"PK"):
        try:
            with zipfile.ZipFile(source) as z:
                if "config.json" in z.namelist():
                    return from_keras_archive(source)
        except Exception:
            pass
        return from_pytorch(source, input_shape, allow_unsafe)
    raise RuntimeError(f"Unrecognized model format: {source}")
