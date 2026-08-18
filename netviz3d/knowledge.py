"""Explanation engine.

Turns a normalized graph node plus its context into the prose that the viewer
shows on hover and in the detail panel. Everything here is rule-based and
offline: no network calls, no model of any kind, just a knowledge base keyed on
the canonical op kind and conditioned on what sits around the node.

Each handler returns a dict with the keys the viewer renders:

    what        one or two sentences on what the op computes
    intuition   the same thing without the maths
    why_here    why this op sits at this point in *this* network -- the part
                generic visualizers cannot do, because it needs the neighbours,
                the shapes and the position in the stack
    shape       what happens to the tensor and why
    hyper       [{name, value, note}] one entry per hyperparameter that matters
    watch       [str] failure modes, common bugs, tuning notes
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _fmt_int(n):
    if n is None:
        return "?"
    if n >= 1_000_000_000:
        return f"{n / 1e9:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.2f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


def _spatial(shape):
    """(H, W) of an NCHW / NCL / NHWC-normalized shape, or None."""
    if not shape:
        return None
    if len(shape) == 4:
        return shape[2], shape[3]
    if len(shape) == 3:
        return shape[2], None
    return None


def _pair(v, default=None):
    if v is None:
        return default
    if isinstance(v, (list, tuple)):
        return list(v)
    return [v, v]


def _pos_word(ratio):
    if ratio < 0.15:
        return "at the very front of"
    if ratio < 0.4:
        return "in the early stages of"
    if ratio < 0.7:
        return "in the middle of"
    if ratio < 0.9:
        return "deep in"
    return "at the end of"


def _norm_name(kind):
    return {
        "batchnorm": "BatchNorm",
        "layernorm": "LayerNorm",
        "groupnorm": "GroupNorm",
        "instancenorm": "InstanceNorm",
        "rmsnorm": "RMSNorm",
    }.get(kind, "the normalization layer")


NORMS = {"batchnorm", "layernorm", "groupnorm", "instancenorm", "rmsnorm"}
ACTS = {
    "relu", "gelu", "silu", "sigmoid", "tanh", "leakyrelu", "elu", "mish",
    "hardswish", "prelu", "softmax", "glu", "relu6", "selu",
}
CONVS = {"conv1d", "conv2d", "conv3d", "convtranspose1d", "convtranspose2d", "convtranspose3d"}
POOLS = {"maxpool", "avgpool", "adaptiveavgpool", "adaptivemaxpool", "globalavgpool", "globalmaxpool"}


# --------------------------------------------------------------------------
# convolution
# --------------------------------------------------------------------------


def _conv(node, ctx):
    p = node.get("params", {})
    k = _pair(p.get("kernel_size"), [1, 1])
    stride = _pair(p.get("stride"), [1, 1])
    dil = _pair(p.get("dilation"), [1, 1])
    groups = p.get("groups", 1) or 1
    cin = p.get("in_channels")
    cout = p.get("out_channels")
    bias = p.get("bias", True)
    transposed = node["kind"].startswith("convtranspose")
    kstr = "×".join(str(x) for x in k)

    depthwise = groups and cin and groups == cin and cout and cout % cin == 0
    pointwise = all(x == 1 for x in k)

    # --- what -------------------------------------------------------------
    if transposed:
        what = (
            f"Transposed convolution: the gradient of a stride-{stride[0]} convolution used as a "
            f"forward pass. Each input position is multiplied by the {kstr} kernel and the results "
            f"are *summed into* an output grid that is larger than the input — so this is a learned "
            f"upsampler, not an inverse convolution."
        )
        intuition = (
            "Stamping: every input pixel stamps a small learned patch onto a bigger canvas, and "
            "overlapping stamps add up. That overlap is exactly where checkerboard artefacts come from."
        )
    elif depthwise:
        what = (
            f"Depthwise convolution: each of the {cin} input channels is filtered by its own "
            f"{kstr} kernel and no mixing happens across channels. Spatial filtering only."
        )
        intuition = (
            "One private stencil per channel. It is the cheap half of a depthwise-separable "
            "convolution — spatial structure here, channel mixing left to the 1×1 that follows."
        )
    elif pointwise:
        what = (
            f"1×1 convolution: at every spatial position independently, the {cin} channel values are "
            f"recombined by a learned {cout}×{cin} matrix. No spatial context at all — this is a "
            f"per-pixel fully-connected layer."
        )
        intuition = (
            "A channel mixer. It cannot see neighbouring pixels; all it does is decide which "
            "combinations of the existing feature maps are worth carrying forward."
        )
    else:
        what = (
            f"Slides {cout} learned {kstr} filters across the input. Each output value is a dot "
            f"product between one filter and the local patch, taken across all "
            f"{cin // groups if cin and groups else cin} input channels it can see — so each of the "
            f"{cout} output channels is a map of 'how strongly does my pattern occur here?'."
        )
        intuition = (
            f"A stack of {cout} pattern-matching stencils dragged over the image. Weight sharing is "
            f"the whole trick: the same stencil is reused at every position, so 'vertical edge' is "
            f"learned once and costs {k[0] * k[1] * (cin // groups if cin and groups else 1)} weights "
            f"instead of one weight per pixel."
        )

    # --- why here ---------------------------------------------------------
    rf = ctx.get("rf")
    ratio = ctx.get("ratio", 0.5)
    nxt = ctx.get("next_kind")
    prv = ctx.get("prev_kind")

    if ratio < 0.12 and not pointwise:
        why = (
            f"First convolution of the trunk. It turns the raw {cin}-channel input into {cout} "
            f"low-level feature channels — oriented edges, colour opponency, simple gradients. It is "
            f"first because everything deeper is assembled out of these primitives; there is nothing "
            f"cheaper that can be built directly from pixels."
        )
    elif pointwise and cin and cout and cout < cin:
        why = (
            f"Bottleneck. It squeezes {cin} channels down to {cout} before the expensive {kstr}-free "
            f"spatial work that follows, so the costly layer runs on {cin / cout:.1f}× less data. "
            f"Placed here because the cheapest place to cut width is immediately before the most "
            f"expensive operation, not after it."
        )
    elif pointwise and cin and cout and cout > cin:
        why = (
            f"Expansion / projection back up to {cout} channels. It restores the width the block "
            f"narrowed, so the residual stream keeps a consistent channel count and the skip "
            f"connection can be a plain add rather than a learned projection."
        )
    elif depthwise:
        why = (
            f"Placed as the spatial half of a separable block: the 1×1 convolutions around it handle "
            f"channel mixing, and this layer supplies the {kstr} spatial context they lack. Splitting "
            f"the job this way costs roughly {cin}× fewer multiplies than one dense {kstr} conv over "
            f"the same shapes."
        )
    else:
        rf_txt = (
            f" By this depth each output unit sees a {rf}×{rf}-pixel window of the original input, "
            f"which is the scale of feature it can possibly represent."
            if rf else ""
        )
        why = (
            f"Sits {_pos_word(ratio)} the network ({int(ratio * 100)}% of the way through)."
            f"{rf_txt} Convolutions this deep no longer see raw pixels — their inputs are already "
            f"feature maps, so they compose earlier detections into larger parts rather than "
            f"detecting texture directly."
        )

    if nxt in NORMS:
        why += f" It is followed immediately by {_norm_name(nxt)}, then a nonlinearity — the standard Conv→Norm→Act unit."

    # --- shape ------------------------------------------------------------
    ins, outs = node.get("in_shape"), node.get("out_shape")
    shape_bits = []
    si, so = _spatial(ins), _spatial(outs)
    if si and so and si[0] and so[0]:
        if so[0] < si[0]:
            shape_bits.append(
                f"Spatial {si[0]}×{si[1]} → {so[0]}×{so[1]}: the stride of {stride[0]} throws away "
                f"{(1 - (so[0] * so[1]) / (si[0] * si[1])) * 100:.0f}% of the positions, which is how "
                f"the network buys the compute for wider layers later."
            )
        elif so[0] > si[0]:
            shape_bits.append(f"Spatial {si[0]}×{si[1]} → {so[0]}×{so[1]}: upsampled by {so[0] / si[0]:.0f}×.")
        else:
            shape_bits.append(
                f"Spatial size is preserved ({si[0]}×{si[1]}) — the padding is chosen to exactly "
                f"offset the {kstr} kernel's shrinkage, so depth can be added without eroding resolution."
            )
    if cin and cout:
        if cout > cin:
            shape_bits.append(f"Channels {cin} → {cout} ({cout / cin:.2g}× wider): more feature types, each individually less spatially precise.")
        elif cout < cin:
            shape_bits.append(f"Channels {cin} → {cout} ({cin / cout:.2g}× narrower).")
        else:
            shape_bits.append(f"Channel count held at {cin}.")

    # --- hyperparameters --------------------------------------------------
    hyper = []
    if k[0] == 3 and not transposed:
        hyper.append({
            "name": "kernel_size", "value": kstr,
            "note": "3×3 is the default for a reason: two stacked 3×3 convs cover the same 5×5 "
                    "receptive field as one 5×5, with ~28% fewer parameters and an extra "
                    "nonlinearity in between.",
        })
    elif pointwise:
        hyper.append({"name": "kernel_size", "value": kstr,
                      "note": "1×1 — no spatial extent. Its only job is to change the channel count."})
    elif k[0] >= 5:
        hyper.append({"name": "kernel_size", "value": kstr,
                      "note": f"A large {kstr} kernel. Usually only worth it in the very first layer, "
                              f"where a wide view of raw pixels is cheap because the channel count is tiny."})
    else:
        hyper.append({"name": "kernel_size", "value": kstr, "note": "Spatial extent of each filter."})

    if stride[0] == 1:
        hyper.append({"name": "stride", "value": "1", "note": "Resolution-preserving: adds depth without losing detail."})
    else:
        hyper.append({
            "name": "stride", "value": "×".join(str(s) for s in stride),
            "note": f"Downsamples by {stride[0]}×. Every layer after this one costs "
                    f"{stride[0] ** 2}× less, which is why channel counts typically double at exactly "
                    f"this point — compute per stage stays roughly flat.",
        })

    pad = p.get("padding")
    if pad is not None:
        pp = _pair(pad, [0, 0])
        if isinstance(pp[0], str):
            note = "'same' padding — output keeps the input's spatial size."
        elif pp[0] == 0:
            note = "No padding: the output is smaller than the input and border pixels are seen by fewer filter positions than central ones."
        else:
            note = f"{pp[0]} px of zeros on each side, chosen to keep the spatial size fixed under a {kstr} kernel."
        hyper.append({"name": "padding", "value": str(pad), "note": note})

    if dil[0] > 1:
        eff = dil[0] * (k[0] - 1) + 1
        hyper.append({
            "name": "dilation", "value": str(dil[0]),
            "note": f"Spreads the kernel taps out so it spans {eff}×{eff} pixels while still using only "
                    f"{k[0] * k[1]} weights. Buys receptive field without downsampling — the standard "
                    f"move for segmentation, where output resolution must be preserved.",
        })

    if groups and groups > 1:
        hyper.append({
            "name": "groups", "value": str(groups),
            "note": (f"Depthwise: one filter per channel, no cross-channel mixing at all."
                     if depthwise else
                     f"Grouped: input and output channels are split into {groups} independent lanes "
                     f"that never talk to each other. Cuts parameters {groups}×."),
        })

    if bias is False:
        if nxt in NORMS:
            hyper.append({
                "name": "bias", "value": "False",
                "note": f"Deliberately off. {_norm_name(nxt)} immediately subtracts a per-channel mean, "
                        f"so any constant added here would be cancelled on the next line; the norm's own "
                        f"β already provides the offset.",
            })
        else:
            hyper.append({"name": "bias", "value": "False", "note": "No additive term."})

    # --- watch out --------------------------------------------------------
    watch = []
    if node.get("macs"):
        share = ctx.get("macs_share")
        watch.append(
            f"{_fmt_int(node['macs'])} multiply-accumulates"
            + (f" — {share:.1f}% of the whole model's arithmetic." if share else ".")
        )
    if transposed and stride[0] > 1 and k[0] % stride[0] != 0:
        watch.append(
            f"kernel {k[0]} is not divisible by stride {stride[0]}: the stamps overlap unevenly and "
            f"this layer will produce checkerboard artefacts. Resize+conv, or a kernel that is a "
            f"multiple of the stride, avoids it."
        )
    if pointwise and prv in CONVS:
        watch.append("Back-to-back convolutions with no nonlinearity between them collapse into a single linear map — check that an activation really is present.")
    return dict(what=what, intuition=intuition, why_here=why, shape=" ".join(shape_bits), hyper=hyper, watch=watch)


# --------------------------------------------------------------------------
# normalization
# --------------------------------------------------------------------------


def _norm(node, ctx):
    kind = node["kind"]
    p = node.get("params", {})
    nxt, prv = ctx.get("next_kind"), ctx.get("prev_kind")
    feats = p.get("num_features") or p.get("normalized_shape") or p.get("num_channels")

    if kind == "batchnorm":
        what = (
            f"For each of the {feats} channels, subtracts the mean and divides by the standard "
            f"deviation computed over the batch and every spatial position, then applies a learned "
            f"per-channel scale γ and shift β."
        )
        intuition = (
            "A thermostat on each feature map. Whatever the layers below drift towards, this pins the "
            "distribution back to a fixed scale before it reaches the nonlinearity."
        )
        watch = [
            "Statistics come from the batch: with batch size 1–2 they are noise, and accuracy collapses. "
            "GroupNorm or LayerNorm is the usual replacement in that regime.",
            "Train and eval behave differently — train uses batch statistics, eval uses the running "
            "averages. Forgetting .eval() is the single most common cause of 'perfect while training, "
            "broken at inference'.",
            "At inference it is a pure affine map per channel, so it can be folded into the preceding "
            "convolution's weights and costs nothing.",
        ]
    elif kind == "layernorm":
        what = (
            f"Normalizes each token/sample independently across its {feats} features to zero mean and "
            f"unit variance, then rescales with learned γ, β. No batch interaction whatsoever."
        )
        intuition = "Every token is put on the same footing before the next sublayer reads it — one token's scale can never affect another's."
        watch = [
            "Batch-size independent and identical in train and eval, which is why sequence models prefer it.",
            "Normalizing over the feature axis means a uniform shift of all features carries no "
            "information past this point.",
        ]
    elif kind == "groupnorm":
        g = p.get("num_groups")
        what = f"Splits the {feats} channels into {g} groups and normalizes within each group, per sample."
        intuition = f"A middle ground: LayerNorm if {g}=1, InstanceNorm if {g}={feats}. Groups let related channels share a scale without dragging in the batch."
        watch = ["Independent of batch size — the standard choice for detection and segmentation, where batches are small because images are large."]
    elif kind == "rmsnorm":
        what = "Divides by the root-mean-square of the features and applies a learned scale. Like LayerNorm but with no mean subtraction and no bias."
        intuition = "LayerNorm with the cheap half kept. In practice the re-centring turns out not to matter, so large models drop it."
        watch = ["Fewer operations and no mean pass, which is why recent LLMs use it in place of LayerNorm."]
    else:
        what = f"Normalizes activations ({kind}) and applies a learned affine correction."
        intuition = "Keeps the scale of the signal under control between layers."
        watch = []

    # placement reasoning
    if prv in CONVS and nxt in ACTS:
        why = (
            f"The middle of the canonical Conv → {_norm_name(kind)} → {nxt.upper()} unit. It sits here "
            f"so the nonlinearity always receives a well-scaled input: unnormalized pre-activations "
            f"drift as the layers below update, and a ReLU fed a distribution that has wandered "
            f"negative simply outputs zero and stops learning. Damping that drift is what allows a "
            f"high learning rate and makes very deep stacks trainable at all."
        )
    elif nxt in {"attention", "mha"} or (nxt == "linear" and ctx.get("in_block")):
        why = (
            "Pre-norm placement: the normalization is applied to the branch input, and the residual is "
            "added afterwards un-normalized. That keeps a clean identity path from input to output of "
            "the whole stack, which is why deep pre-norm transformers train stably without a "
            "carefully tuned warmup."
        )
    elif prv in {"add", "residual"}:
        why = (
            "Post-norm placement: normalization is applied after the residual add. This keeps every "
            "block's output on the same scale, but the identity path is normalized at every step, "
            "which is why post-norm transformers need learning-rate warmup to train."
        )
    elif prv in ACTS:
        why = (
            "Normalizing after the activation rather than before it — the less common ordering. It "
            "means the nonlinearity sees raw pre-activations, and the next layer sees a clean scale."
        )
    else:
        why = f"Rescales the signal before it is passed on, keeping activation magnitudes in a usable range at this depth."

    hyper = []
    if p.get("eps") is not None:
        hyper.append({"name": "eps", "value": str(p["eps"]), "note": "Added inside the square root so a zero-variance channel cannot divide by zero."})
    if p.get("momentum") is not None:
        hyper.append({"name": "momentum", "value": str(p["momentum"]),
                      "note": "Blend rate for the running mean/var used at inference. Low values track the true statistics more slowly but more smoothly."})
    if p.get("affine") is not None or p.get("elementwise_affine") is not None:
        v = p.get("affine", p.get("elementwise_affine"))
        hyper.append({"name": "affine", "value": str(v),
                      "note": "Learned γ and β let the layer undo its own normalization if that turns out to be what the loss wants — normalization constrains the optimizer, it does not remove capacity." if v else "No learned rescaling."})
    if p.get("num_groups"):
        hyper.append({"name": "num_groups", "value": str(p["num_groups"]), "note": "Channels per group = "
                      f"{feats // p['num_groups'] if feats else '?'}. Fewer groups → closer to LayerNorm; more → closer to InstanceNorm."})

    shape = "Shape is unchanged — normalization is element-wise once the statistics are computed."
    return dict(what=what, intuition=intuition, why_here=why, shape=shape, hyper=hyper, watch=watch)


# --------------------------------------------------------------------------
# activations
# --------------------------------------------------------------------------

_ACT_INFO = {
    "relu": (
        "max(0, x), applied to every element independently.",
        "A one-way valve: positive signal passes untouched, negative is discarded.",
        ["Dying ReLU: a unit whose pre-activation is always negative receives exactly zero gradient "
         "and can never recover. LeakyReLU/GELU exist to leave a small slope there.",
         "Cheap, non-saturating for x>0, and the reason deep networks stopped needing layerwise "
         "pretraining."],
    ),
    "gelu": (
        "x·Φ(x) — the input scaled by the probability that a standard normal falls below it. A smooth, "
        "non-monotonic relative of ReLU.",
        "A soft gate instead of a hard one: small negative values are damped rather than deleted, so "
        "gradient still flows there.",
        ["Standard in transformers. The smoothness matters most in networks trained with very large "
         "batches, where ReLU's kink makes the loss surface harder to optimize."],
    ),
    "silu": (
        "x·σ(x), also called Swish. Smooth, non-monotonic, unbounded above.",
        "Like GELU: a soft gate that lets a little negative signal through.",
        ["Slightly more expensive than ReLU but consistently a bit better in convolutional backbones."],
    ),
    "sigmoid": (
        "1/(1+e⁻ˣ), squashing any real number into (0, 1).",
        "A soft switch, reading out as a probability.",
        ["Saturates at both ends: |x|>6 gives a gradient near zero, so a stack of sigmoids vanishes "
         "the gradient. Fine as a final gate or output, bad as a hidden activation.",
         "If this is the model's output and the loss is BCEWithLogits, applying sigmoid here as well "
         "double-counts it — a very common bug."],
    ),
    "tanh": (
        "Zero-centred sigmoid, squashing to (−1, 1).",
        "A soft switch that can also say 'strongly negative'.",
        ["Saturates like sigmoid, but being zero-centred it keeps gradients better behaved. Standard "
         "inside LSTM/GRU cells for exactly that reason."],
    ),
    "leakyrelu": (
        "x for x>0, αx for x<0.",
        "A ReLU with a leak, so dead units can come back.",
        ["The leak is what keeps gradient alive on the negative side."],
    ),
    "softmax": (
        "Exponentiates and normalizes so the values along one axis sum to 1.",
        "Turns arbitrary scores into a competition: raising one score necessarily lowers the others.",
        ["If a cross-entropy loss follows, do NOT apply softmax here — those losses take raw logits "
         "and fuse the softmax internally for numerical stability. Applying it twice flattens the "
         "gradients and quietly costs accuracy.",
         "Only meaningful along a specific axis; check that axis matches the class/token dimension."],
    ),
    "elu": ("x for x>0, α(eˣ−1) below.", "Smooth on the negative side, pushing mean activation towards zero.", []),
    "hardswish": ("x·ReLU6(x+3)/6 — a piecewise-linear approximation of SiLU.", "SiLU's shape, made cheap for mobile hardware.", ["Chosen when integer/mobile inference speed matters more than the last fraction of accuracy."]),
    "relu6": ("min(max(0,x), 6).", "A ReLU with a ceiling.", ["The cap keeps activations in a small range so 8-bit quantization stays accurate."]),
    "mish": ("x·tanh(softplus(x)).", "A smoother, slightly more expensive SiLU.", []),
    "prelu": ("Leaky ReLU whose negative slope is learned rather than fixed.", "The network decides how much negative signal to keep.", []),
    "selu": ("Scaled ELU with constants chosen so activations self-normalize toward zero mean and unit variance.", "An activation that does the normalizer's job by itself.", ["Only self-normalizes with the matching lecun_normal init and AlphaDropout; mixing it with BatchNorm defeats the point."]),
}


def _act(node, ctx):
    kind = node["kind"]
    what, intuition, watch = _ACT_INFO.get(
        kind, (f"Element-wise {kind} nonlinearity.", "Bends the signal so stacked layers cannot collapse into one.", [])
    )
    prv = ctx.get("prev_kind")
    ratio = ctx.get("ratio", 0.5)

    if kind == "softmax" and ratio > 0.85:
        why = ("Final layer: converts the raw class scores into a probability distribution. "
               "Present here because this model is meant to be consumed as probabilities directly "
               "rather than handed to a logit-taking loss.")
    elif prv in NORMS:
        why = (f"Completes the {'Conv' if ctx.get('prev2_kind') in CONVS else 'Linear'} → "
               f"{_norm_name(prv)} → {kind.upper()} unit. It comes *after* the normalization so it "
               f"always operates on a standardized distribution — that is what keeps a predictable "
               f"fraction of units active instead of letting the whole layer saturate or die as "
               f"training shifts the scale.")
    elif prv in CONVS or prv == "linear":
        why = (f"Placed directly after {prv} because without a nonlinearity here, this layer and the "
               f"next would compose into a single linear map — every bit of depth on either side "
               f"would be wasted. This is the layer that makes the stack more expressive than one "
               f"big matrix.")
    else:
        why = ("Introduces the nonlinearity that separates the layers around it; consecutive linear "
               "operations without one are mathematically equivalent to a single linear operation.")

    hyper = []
    p = node.get("params", {})
    if p.get("negative_slope") is not None:
        hyper.append({"name": "negative_slope", "value": str(p["negative_slope"]), "note": "Gradient kept on the negative side, so units cannot die permanently."})
    if p.get("inplace"):
        hyper.append({"name": "inplace", "value": "True", "note": "Overwrites its input buffer to save memory. Safe only because nothing else reads that tensor — it breaks if the input is also fed to a skip connection."})
    if p.get("dim") is not None:
        hyper.append({"name": "dim", "value": str(p["dim"]), "note": "The axis the values are normalized along; everything else is treated as independent."})
    return dict(what=what, intuition=intuition, why_here=why,
                shape="Element-wise: shape is untouched, and no parameters are involved.",
                hyper=hyper, watch=list(watch))


# --------------------------------------------------------------------------
# pooling
# --------------------------------------------------------------------------


def _pool(node, ctx):
    kind = node["kind"]
    p = node.get("params", {})
    k = _pair(p.get("kernel_size"), [2, 2])
    stride = _pair(p.get("stride"), k)
    si, so = _spatial(node.get("in_shape")), _spatial(node.get("out_shape"))
    glob = kind.startswith("adaptive") or kind.startswith("global")
    if glob and so:
        glob = (so[0] or 1) == 1 and (so[1] or 1) in (1, None)

    if glob:
        what = ("Averages each channel over every remaining spatial position, collapsing the feature "
                "map to one number per channel."
                if "avg" in kind else
                "Takes the maximum of each channel over every spatial position.")
        intuition = ("Asks 'how much of this feature is in the image overall?' and throws away 'where'."
                     if "avg" in kind else
                     "Asks 'what is the strongest response for this feature anywhere in the image?'")
        why = (
            f"The bridge between the convolutional trunk and the classifier. It collapses "
            f"{f'{si[0]}×{si[1]}' if si else 'the spatial grid'} down to 1×1, so the classifier sees "
            f"only *what* was found and not *where*. Two consequences make this the standard design: "
            f"the network accepts any input resolution, and the classifier has "
            f"{f'{si[0] * si[1]}×' if si and si[0] else 'far'} fewer input features than flattening "
            f"would give it, removing the fully-connected layers that used to hold most of a CNN's "
            f"parameters and most of its overfitting."
        )
        watch = ["Averaging is a hard prior: it assumes the label depends on presence, not position. "
                 "For tasks where position matters (detection, segmentation) this layer is exactly what you must not use."]
    else:
        kstr = "×".join(str(x) for x in k)
        what = (f"Slides a {kstr} window with stride {stride[0]} and keeps the maximum in each window."
                if "max" in kind else
                f"Slides a {kstr} window with stride {stride[0]} and averages each window.")
        intuition = ("Keeps only the strongest evidence in each neighbourhood — a feature found one "
                     "pixel to the left produces the same output, which is where a CNN's small "
                     "translation tolerance comes from."
                     if "max" in kind else
                     "Blurs and shrinks: a smooth summary of each neighbourhood.")
        why = (
            f"Downsamples "
            f"{f'{si[0]}×{si[1]} → {so[0]}×{so[1]}' if si and so else f'by {stride[0]}×'} at the end of "
            f"this stage. Placed after the convolutions at this resolution rather than before them, so "
            f"they get to work at full detail first and only the summary is carried on. Every layer "
            f"downstream then costs {stride[0] ** 2}× less, which is what pays for the wider channels "
            f"that follow."
        )
        watch = ["Max-pooling has no parameters and no gradient except through the winning element; "
                 "many modern architectures drop it and use a stride-2 convolution instead, so the "
                 "downsampling filter is learned rather than fixed."]

    hyper = []
    if not glob:
        hyper.append({"name": "kernel_size", "value": "×".join(str(x) for x in k), "note": "Window size summarized into one value."})
        hyper.append({"name": "stride", "value": "×".join(str(x) for x in stride),
                      "note": "Equal to the kernel, so windows tile without overlap." if stride == k else "Windows overlap, giving a smoother but more expensive reduction."})
    if p.get("output_size") is not None:
        hyper.append({"name": "output_size", "value": str(p["output_size"]),
                      "note": "Adaptive: the window size is computed from the input so the output is always this size, whatever resolution comes in."})
    return dict(what=what, intuition=intuition, why_here=why,
                shape=(f"{si[0]}×{si[1]} → {so[0]}×{so[1]} spatially, channels untouched." if si and so else "Reduces spatial size, leaves channels alone."),
                hyper=hyper, watch=watch)


# --------------------------------------------------------------------------
# linear / embedding
# --------------------------------------------------------------------------


def _linear(node, ctx):
    p = node.get("params", {})
    fin, fout = p.get("in_features"), p.get("out_features")
    ratio = ctx.get("ratio", 0.5)
    is_last = ctx.get("is_last") or ratio > 0.95
    nxt = ctx.get("next_kind")

    what = (f"Full matrix multiply: every one of the {fout} outputs is a weighted sum of all {fin} "
            f"inputs, using a learned {fout}×{fin} weight matrix"
            f"{' plus a bias' if p.get('bias', True) else ' with no bias'}.")
    intuition = ("Every input can influence every output — no locality, no weight sharing. That is "
                 "maximum flexibility and also why this is usually where the parameters pile up.")

    if is_last and nxt in (None, "output", "softmax"):
        why = (f"The classifier head. {fout} outputs means {fout} class scores — one logit per class, "
               f"unnormalized. It is last because everything before it exists to build a "
               f"representation in which the classes are linearly separable; this layer is just the "
               f"final linear read-out of that representation."
               + ("" if nxt == "softmax" else
                  " No softmax follows, which is correct: cross-entropy losses take logits and apply "
                  "the softmax internally, in a numerically stable fused form."))
    elif ctx.get("prev_kind") in {"flatten", "globalavgpool", "adaptiveavgpool"}:
        why = (f"First layer after the spatial dimensions are gone. It mixes the {fin} pooled feature "
               f"values into {fout} task-specific ones — the point where 'what patterns are present' "
               f"is converted into 'what does that mean for the label'.")
    elif fin and fout and fout > fin * 2:
        why = (f"Expansion layer, widening {fin} → {fout} ({fout / fin:.1f}×). In a transformer MLP "
               f"this is the first of two projections: the model expands into a wider space, applies "
               f"the nonlinearity there where there is room to separate features, then projects back down.")
    elif fin and fout and fin > fout * 2:
        why = (f"Projection back down, {fin} → {fout}. It returns the signal to the residual stream's "
               f"width so the skip connection can add it without a shape mismatch.")
    else:
        why = f"A learned linear recombination of all {fin} features into {fout}, {_pos_word(ratio)} the network."

    hyper = [{"name": "in_features", "value": str(fin), "note": "Size of the incoming vector."},
             {"name": "out_features", "value": str(fout), "note": "Size of the outgoing vector."}]
    if p.get("bias") is False:
        hyper.append({"name": "bias", "value": "False", "note": "No offset term — usually because a normalization layer follows and would cancel it, or to save parameters in a very wide layer."})

    watch = []
    if node.get("n_params"):
        share = ctx.get("param_share")
        watch.append(f"{_fmt_int(node['n_params'])} parameters"
                     + (f" — {share:.1f}% of the model's total." if share else ".")
                     + " Dense layers carry weight count in proportion to in×out, so this is usually where a model gets fat.")
    if ctx.get("prev_kind") == "flatten":
        watch.append("Because the input was flattened, this layer's weight matrix is tied to one exact input resolution. Change the image size and it no longer fits — the reason global pooling replaced flatten in modern CNNs.")
    return dict(what=what, intuition=intuition, why_here=why,
                shape=f"(…, {fin}) → (…, {fout}); only the last axis changes.", hyper=hyper, watch=watch)


def _embedding(node, ctx):
    p = node.get("params", {})
    n, d = p.get("num_embeddings"), p.get("embedding_dim")
    return dict(
        what=f"A lookup table with {_fmt_int(n)} rows of {d} numbers. Each input integer id is replaced by its row — no arithmetic, just indexing.",
        intuition="A dictionary from symbol to vector. 'Learning an embedding' means moving those rows around until similar symbols end up near each other.",
        why_here="First layer of the model: it is what converts discrete ids (tokens, categories) into "
                 "the continuous vectors everything downstream requires. Nothing before it can be "
                 "differentiable, because there is nothing continuous to differentiate.",
        shape=f"(…) integers → (…, {d}) floats; one new trailing axis of width {d}.",
        hyper=[{"name": "num_embeddings", "value": str(n), "note": "Vocabulary size. Ids outside [0, n) are an index error, not a silent zero."},
               {"name": "embedding_dim", "value": str(d), "note": "Width of each vector — the model's whole capacity to distinguish one symbol from another."},
               {"name": "padding_idx", "value": str(p.get("padding_idx")), "note": "This row is fixed at zero and never receives gradient, so padded positions contribute nothing."} if p.get("padding_idx") is not None else None],
        watch=[f"{_fmt_int(node.get('n_params'))} parameters sit in this one table — in language models it is often the single largest layer, which is why the output projection frequently reuses (ties to) the same matrix."],
    )


# --------------------------------------------------------------------------
# attention / recurrent
# --------------------------------------------------------------------------


def _attention(node, ctx):
    p = node.get("params", {})
    h = p.get("num_heads") or p.get("heads")
    d = p.get("embed_dim") or p.get("d_model")
    hd = (d // h) if (h and d) else None
    return dict(
        what=(f"Multi-head self-attention. Each position emits a query, a key and a value; the query "
              f"is compared with every key by dot product, softmax turns those scores into weights, "
              f"and the output is the weighted average of the values. Done "
              f"{h if h else 'several'} times in parallel over {hd if hd else 'a slice of the'}-dimensional subspaces."),
        intuition=("Every token asks a question (query), every token advertises what it has (key), and "
                   "the answer is a blend of the tokens whose advert best matched the question. Heads "
                   "let one token ask several different questions at once — one head tracking syntax, "
                   "another coreference, and so on."),
        why_here=("This is the only layer in a transformer block where positions exchange information "
                  "at all — the MLP that follows works on each token independently. That division is "
                  "the entire architecture: attention moves information between positions, the MLP "
                  "processes it in place, and the residual stream carries it forward."),
        shape=f"(B, L, {d if d else 'D'}) → (B, L, {d if d else 'D'}). Length and width are preserved; what changes is that each position now holds a mix of the others.",
        hyper=[
            {"name": "num_heads", "value": str(h), "note": f"The {d}-dim space is split into {h} subspaces of {hd} each. More heads = more simultaneous relations, but each is lower-resolution — total width is fixed."} if h else None,
            {"name": "embed_dim", "value": str(d), "note": "Width of the residual stream this block reads from and writes back to."} if d else None,
            {"name": "dropout", "value": str(p.get("dropout")), "note": "Applied to the attention weights, randomly severing some token-to-token links during training."} if p.get("dropout") else None,
        ],
        watch=["Cost and memory grow with the square of sequence length — the attention matrix alone is L×L per head, which is what limits context windows.",
               "A causal mask (if this is a decoder) must set future positions to −inf *before* the softmax. Masking after it leaks information and is a classic silent bug."],
    )


def _recurrent(node, ctx):
    kind = node["kind"]
    p = node.get("params", {})
    hs = p.get("hidden_size")
    layers = p.get("num_layers", 1)
    bidir = p.get("bidirectional")
    gate_txt = {
        "lstm": "Three gates (forget, input, output) plus a separate cell state that is carried forward with additive updates.",
        "gru": "Two gates (reset, update) merged into a single hidden state — LSTM's behaviour with fewer parameters.",
        "rnn": "A single tanh update with no gating at all.",
    }.get(kind, "")
    return dict(
        what=f"Processes the sequence one step at a time, carrying a {hs}-dimensional hidden state forward. {gate_txt}",
        intuition="A running summary updated token by token. The gates decide, per step and per feature, what to keep from the past and what to overwrite.",
        why_here=("Handles the temporal dependency in the sequence. Unlike attention, its cost is linear "
                  "in length and its memory is a fixed-size vector — so it scales to long sequences but "
                  "must compress everything it has seen into those "
                  f"{hs} numbers, which is the bottleneck attention was invented to remove."),
        shape=f"(B, L, in) → (B, L, {hs * (2 if bidir else 1) if hs else '?'})" + (" — forward and backward passes concatenated." if bidir else "."),
        hyper=[
            {"name": "hidden_size", "value": str(hs), "note": "The entire memory of the layer. Everything the sequence contributed must fit here."},
            {"name": "num_layers", "value": str(layers), "note": "Stacked recurrent layers; each reads the outputs of the one below." if layers > 1 else "Single layer."},
            {"name": "bidirectional", "value": str(bool(bidir)), "note": "Runs a second pass right-to-left and concatenates. Only valid when the whole sequence is available up front — not for streaming or generation."} if bidir is not None else None,
        ],
        watch=["Vanishing/exploding gradients over long sequences are the reason for the gates (and for gradient clipping in the training loop).",
               "Sequential by construction: it cannot be parallelized across time the way attention can, which is the practical reason transformers displaced it."],
    )


# --------------------------------------------------------------------------
# shape ops, regularization, merges
# --------------------------------------------------------------------------


def _dropout(node, ctx):
    p = node.get("params", {}).get("p", node.get("params", {}).get("rate", 0.5))
    ratio = ctx.get("ratio", 0.5)
    where = ("just before the classifier, where the parameter count is highest and memorization is "
             "easiest" if ratio > 0.75 else "between blocks, so no single path through the network can be relied on")
    return dict(
        what=f"During training, zeroes each activation independently with probability {p} and scales the survivors by 1/(1−{p}) so the expected value is unchanged. At eval it is the identity.",
        intuition="Randomly knocking out units forces the network to spread each concept over many of them, because no individual unit is guaranteed to be there next step. It is ensemble averaging over exponentially many thinned networks, done cheaply.",
        why_here=f"Placed {where}. Dropout is regularization, not computation — removing it changes nothing about what the model *can* represent, only how much it overfits.",
        shape="Unchanged. Zero parameters.",
        hyper=[{"name": "p", "value": str(p), "note": f"{float(p) * 100:.0f}% of activations dropped per step. Too high and the signal is destroyed; too low and it does nothing. 0.1–0.5 is the usual band." if isinstance(p, (int, float)) else "Drop probability."}],
        watch=["Active in train mode only — if evaluation looks noisy or nondeterministic, .eval() was probably not called.",
               "Largely displaced by BatchNorm and heavy data augmentation in convolutional nets; still standard in transformers."],
    )


def _flatten(node, ctx):
    ins = node.get("in_shape")
    n = 1
    if ins:
        for d in ins[1:]:
            n *= d if isinstance(d, int) else 1
    return dict(
        what="Reinterprets the tensor's memory as one long vector per sample. No arithmetic, no parameters — just a change of index bookkeeping.",
        intuition="The 3D block of feature maps is unrolled into a single row of numbers so a dense layer can read it.",
        why_here="The seam between the convolutional part of the network, which thinks in feature maps, and the dense part, which thinks in vectors. Spatial structure is not destroyed here so much as forgotten: after this point nothing knows which numbers were neighbours.",
        shape=f"{ins} → (…, {_fmt_int(n)}) — {_fmt_int(n)} values per sample.",
        hyper=[],
        watch=[f"Locks the model to this exact input resolution: the following dense layer has weights for exactly {_fmt_int(n)} inputs. Global average pooling is the resolution-independent alternative."],
    )


def _reshape(node, ctx):
    return dict(
        what=f"{node['op']}: rearranges how the tensor is indexed without changing any values.",
        intuition="Same numbers, different mental picture of their arrangement.",
        why_here="Adapts the layout produced upstream to the layout the next layer expects — e.g. splitting a width into heads, or moving the channel axis.",
        shape=f"{node.get('in_shape')} → {node.get('out_shape')}. Element count is identical.",
        hyper=[{"name": k, "value": str(v), "note": ""} for k, v in (node.get("params") or {}).items()],
        watch=["Free at runtime if the result stays contiguous; forces a copy if it does not."],
    )


def _merge(node, ctx):
    kind = node["kind"]
    if kind in {"add", "residual"}:
        return dict(
            what="Adds two tensors element-wise: the block's output plus the input that bypassed it.",
            intuition="A bypass lane. The block only has to learn the *change* it wants to make, and if the best change is none, driving its weights to zero is enough — an identity is free.",
            why_here=("The residual join. Its real job is the backward pass: because addition passes "
                      "gradient through unchanged, there is a direct path from the loss to every early "
                      "layer that skips this block entirely. That is what made networks past ~20 layers "
                      "trainable, and it is why a 50-layer ResNet outperforms a 20-layer plain net "
                      "instead of degrading."),
            shape="Both inputs must have identical shape; output matches. If the block changed the channel count or stride, a 1×1 projection on the skip path is what makes them line up.",
            hyper=[], watch=["Shapes must match exactly — a mismatch here is the most common error when editing a residual architecture."],
        )
    if kind in {"concat", "cat"}:
        return dict(
            what=f"Concatenates its inputs along axis {node.get('params', {}).get('dim', 1)}, stacking their channels side by side.",
            intuition="Keeps both sources intact rather than blending them, and lets the next layer decide how to weigh them.",
            why_here="Joins paths that carry different information — typically a high-resolution early feature map with a deeper, semantically richer one (U-Net skips, DenseNet, feature-pyramid fusion). Concatenation preserves both; addition would force them to share a representation.",
            shape="Channel counts add; all other dimensions must match exactly.",
            hyper=[], watch=["Widens the tensor, so the following layer's input channel count is the sum — a frequent source of shape errors when a branch is edited."],
        )
    return dict(what=f"{node['op']}: combines several tensors element-wise.", intuition="Merges two paths into one.",
                why_here="Rejoins branches of the graph.", shape=f"{node.get('out_shape')}", hyper=[], watch=[])


def _upsample(node, ctx):
    p = node.get("params", {})
    return dict(
        what=f"Increases spatial resolution by {p.get('scale_factor', '2')}× using {p.get('mode', 'nearest')} interpolation. No learned parameters.",
        intuition="Blowing the picture up. It invents no new detail — it only restores a grid the network can paint on.",
        why_here="The decoder side: after downsampling built semantic depth, resolution has to be rebuilt to produce a dense, per-pixel output. Fixed interpolation is used rather than a transposed convolution because it cannot produce checkerboard artefacts.",
        shape=f"{node.get('in_shape')} → {node.get('out_shape')}, channels unchanged.",
        hyper=[{"name": "mode", "value": str(p.get("mode", "nearest")), "note": "'nearest' is blocky but exact; 'bilinear' is smooth but slightly blurs edges."},
               {"name": "scale_factor", "value": str(p.get("scale_factor")), "note": "Resolution multiplier per spatial axis."}],
        watch=["Usually paired with a convolution straight after, to clean up the interpolation and mix in the skip connection."],
    )


def _io(node, ctx):
    if node["kind"] == "input":
        return dict(
            what=f"The model's input tensor, shape {node.get('out_shape')}.",
            intuition="What you hand the network.",
            why_here="Entry point of the graph.",
            shape=f"{node.get('out_shape')}" + (" — (batch, channels, height, width)." if node.get("out_shape") and len(node["out_shape"]) == 4 else ""),
            hyper=[], watch=["Values are expected pre-normalized to whatever statistics the model was trained on; feeding raw 0–255 pixels to a model trained on standardized inputs degrades it silently."],
        )
    return dict(
        what=f"The model's output, shape {node.get('in_shape') or node.get('out_shape')}.",
        intuition="What comes back out.",
        why_here="Exit point of the graph.",
        shape=f"{node.get('in_shape') or node.get('out_shape')}",
        hyper=[], watch=["Check whether these are logits or probabilities before choosing a loss."],
    )


def _generic(node, ctx):
    p = node.get("params", {})
    return dict(
        what=f"{node['op']} — no dedicated entry in this tool's knowledge base, so the description below is drawn from the recorded shapes and arguments only.",
        intuition="",
        why_here=f"Sits {_pos_word(ctx.get('ratio', 0.5))} the network, between {ctx.get('prev_kind') or 'the input'} and {ctx.get('next_kind') or 'the output'}.",
        shape=f"{node.get('in_shape')} → {node.get('out_shape')}",
        hyper=[{"name": k, "value": str(v), "note": ""} for k, v in list(p.items())[:12]],
        watch=[],
    )


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------

_HANDLERS = {}
for _k in CONVS:
    _HANDLERS[_k] = _conv
for _k in NORMS:
    _HANDLERS[_k] = _norm
for _k in ACTS:
    _HANDLERS[_k] = _act
for _k in POOLS:
    _HANDLERS[_k] = _pool
_HANDLERS.update({
    "linear": _linear, "embedding": _embedding, "attention": _attention, "mha": _attention,
    "lstm": _recurrent, "gru": _recurrent, "rnn": _recurrent,
    "dropout": _dropout, "flatten": _flatten,
    "reshape": _reshape, "permute": _reshape, "transpose": _reshape, "view": _reshape, "squeeze": _reshape, "unsqueeze": _reshape,
    "add": _merge, "residual": _merge, "concat": _merge, "cat": _merge, "mul": _merge,
    "upsample": _upsample, "interpolate": _upsample,
    "input": _io, "output": _io,
})


def explain(node, ctx):
    """Return the explanation dict for one node."""
    fn = _HANDLERS.get(node.get("kind"), _generic)
    try:
        out = fn(node, ctx)
    except Exception as exc:  # never let a knowledge-base bug break the graph
        out = _generic(node, ctx)
        out["watch"] = list(out.get("watch") or []) + [f"(explanation engine error: {exc})"]
    out["hyper"] = [h for h in (out.get("hyper") or []) if h]
    out["watch"] = [w for w in (out.get("watch") or []) if w]
    return out


# --------------------------------------------------------------------------
# whole-model narrative
# --------------------------------------------------------------------------


def summarize(graph):
    """A short paragraph about the model as a whole, shown in the overview panel."""
    nodes = graph["nodes"]
    kinds = [n["kind"] for n in nodes]
    n_conv = sum(1 for k in kinds if k in CONVS)
    n_lin = sum(1 for k in kinds if k == "linear")
    n_attn = sum(1 for k in kinds if k in {"attention", "mha"})
    n_res = sum(1 for e in graph["edges"] if e.get("kind") == "residual")
    n_norm = sum(1 for k in kinds if k in NORMS)

    bits = []
    plural = lambda n, w: f"{n} {w}" + ("" if n == 1 else "s")
    if n_attn:
        bits.append(f"a transformer-style stack ({plural(n_attn, 'attention layer')})")
    elif n_conv >= 2:
        bits.append(f"a convolutional network ({plural(n_conv, 'conv layer')}"
                    + (f", {plural(n_lin, 'dense layer')}" if n_lin else "") + ")")
    elif n_lin:
        bits.append(f"a feed-forward network ({plural(n_lin, 'dense layer')})")
    else:
        bits.append("a small network")

    if n_res:
        bits.append(f"{plural(n_res, 'residual connection')}, so gradients reach the early layers directly")
    if n_norm:
        bits.append(plural(n_norm, "normalization layer"))

    meta = graph.get("meta", {})
    tp = meta.get("total_params")
    head = f"This is {bits[0]}"
    if len(bits) > 1:
        head += " with " + ", ".join(bits[1:])
    head += "."
    if tp:
        head += f" {_fmt_int(tp)} parameters in total"
        if meta.get("total_macs"):
            head += f", {_fmt_int(meta['total_macs'])} multiply-accumulates per forward pass"
        head += "."

    # where the weight and the compute sit
    if nodes:
        pn = max(nodes, key=lambda n: n.get("n_params") or 0)
        if pn.get("n_params"):
            head += f" The heaviest layer by parameters is {pn['name']} ({_fmt_int(pn['n_params'])})"
            cn = max(nodes, key=lambda n: n.get("macs") or 0)
            if cn.get("macs") and cn["id"] != pn["id"]:
                head += f", while most arithmetic happens in {cn['name']} ({_fmt_int(cn['macs'])} MACs)"
            head += " — parameters and compute rarely peak in the same place, because early layers are small but run at high resolution."
    return head
