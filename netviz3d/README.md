# netviz3d

Turn a trained model file into an interactive 3D diagram you can interrogate —
the kind of figure a paper would print, except every box, arrow and
hyperparameter explains itself when you point at it, and any layer can be
opened up to watch it actually operate.

Point it at a `.pt`, `.pth`, `.keras`, `.h5`, `.safetensors`, SavedModel or
`.onnx` file. It reads the architecture, works out the tensor shapes, and
serves a page on `127.0.0.1`.

```
python server.py path/to/model.pt                       # from a model file
python server.py --code model_def.py --class MyNet      # from your class alone
```

**If you have the model class in a `.py` file, that is all you need.** A
checkpoint only carries trained numbers, and numbers do not change the
architecture — pass one only if you want the diagram labelled with the real
trained model.

---

## Install

The viewer itself has **no dependencies at all** — no CDN, no npm, no
JavaScript libraries. The reader needs only what the file format itself
requires:

| Your file | What you need |
| --- | --- |
| `.keras`, `.safetensors`, `.h5` (usually), `.json` | nothing — Python 3.8+ standard library |
| `.pt`, `.pth`, `.bin`, `.ckpt` | `pip install torch` (CPU build is fine) |
| SavedModel without Keras metadata | `pip install tensorflow-cpu` |
| `.onnx` | `pip install onnx` |

---

## Use

```bash
python server.py model.pt                       # read, serve, open a browser
python server.py model.keras --port 8080
python server.py model.pth --input-shape 1,3,32,32
python server.py model.pt  --standalone viz.html   # one portable HTML file
```

| Flag | Meaning |
| --- | --- |
| `--input-shape 1,3,224,224` | the model's real input size. Without it the tool guesses from the first layer, which gets channel counts right but spatial sizes only approximately. |
| `--standalone OUT.html` | bake the graph into a single self-contained HTML file. No server, no network, opens with a double-click, works forever. |
| `--code model_def.py` | the Python file defining your model class. This is the best input there is: the class *is* the architecture, so no model file is needed at all. |
| `--class MyNet` | which class in `--code` to use. Auto-detected when the file defines only one. Takes constructor arguments: `--class "MyNet(num_classes=7)"`. |
| `--allow-unsafe-unpickle` | let `torch.load` execute the pickled file. Off by default. Gives the best result for saved `nn.Module` files. |
| `--json OUT.json` | also dump the extracted graph. |
| `--port`, `--no-browser` | server options. |

### In the viewer

- **drag** orbit · **shift**+drag pan · **wheel** zoom
- **hover** a layer or an arrow for a summary; **click** for the full panel
- **`E`** or *Expand layer* — open the animated 3D explainer for that layer
- **`←` `→`** step through the network · **`F`** fit · **`Esc`** close
- left rail: filter layers, toggle labels/arrows/grid, orthographic view,
  spacing, and recolour by layer type, parameter count, compute cost or depth.
  Clicking a legend row hides that family.

The right-hand panel gives, per layer: input and output shape, parameter count
and share, MACs and share, the receptive field accumulated up to that point,
and prose covering *what it does*, *the intuition*, **why it sits at that
point in this particular network**, how the shape changes, every
hyperparameter with a note on what it actually buys you, and the failure modes
worth knowing.

The *why it sits here* text is conditioned on the layer's neighbours, its
shapes and its position in the stack — so a 1×1 convolution that narrows
channels is described as a bottleneck, a `bias=False` before a BatchNorm is
explained as redundant-and-cancelled, and a LayerNorm before an attention
block is identified as pre-norm placement with the reason that matters.

---

## Nothing is written to your disk, nothing leaves your machine

The page stores nothing: no `localStorage`, no cookies, no cache, no
downloads. The server binds to `127.0.0.1` only, reads your model file, holds
the graph in memory, and serves it to your own browser. There is no CDN link
and no outbound request anywhere in the code — the 3D renderer is written from
scratch against a 2D canvas.

The two exceptions are the ones you ask for explicitly on the command line:
`--standalone` and `--json` write the file you name.

---

## How much of the architecture is really in your file

This is the part most visualizers gloss over. What can be recovered depends
entirely on the format, and the viewer tells you which case you are in via the
banner at the top and the `~` marker on any shape it had to compute rather
than observe.

| Format | Layers & hyperparameters | Dataflow (branches, skips) | Shapes |
| --- | --- | --- | --- |
| `torch.save(model)` **+** `--allow-unsafe-unpickle` (or `--code`) | exact | **exact** — traced with `torch.fx`, functional ops and residual adds included | **observed** from a real forward pass |
| `torch.save(model)`, default | exact | declaration order only | computed |
| TorchScript `.pt` | exact | declaration order only | computed |
| `state_dict` / checkpoint / `.safetensors` | only layers that own weights | none | computed, channels exact |
| `.keras` / `.h5` / SavedModel | exact | exact for Functional models | computed exactly |
| `.onnx` | exact | exact | exact where the file records them |

Two consequences worth internalising:

**A `state_dict` is not an architecture.** Activations, pooling, reshapes and
skip connections own no parameters, so they leave no trace whatsoever in a
weights file. The tool reconstructs the layers that do have weights, in
checkpoint order, and says so in the banner. Stride and padding are not stored
either, so spatial sizes there assume stride 1 and same-padding. Channel
counts, being read directly off the weight tensors, are exact.

**Pickled `nn.Module` files normally need your source code.** By default this
tool avoids that: it unpickles *structurally*, resolving only a short
allowlist of tensor-rebuilding helpers and replacing every other class with an
inert placeholder. Your model's code is neither imported nor executed, yet the
recorded instance state still yields exact layer types, hyperparameters and
parameter shapes. That is safer than a plain `torch.load` and it works on
files whose defining code you do not have — but `forward()` never runs, so
branches and functional ops (`F.relu`, `+`, `torch.cat`) are invisible. Add
`--code` or `--allow-unsafe-unpickle` when you want the real graph.

---

## What "expand layer" shows

Selecting a layer and pressing **E** opens an animated 3D explainer built for
that layer's type, with a running caption describing the step on screen:

- **Convolution** — the kernel sliding across the input volume position by
  position, the patch it covers, and the single output value each stop
  produces. Stride, padding, dilation, groups and weight sharing are all read
  off the real layer.
- **Linear** — one output row at a time, its matrix row lit up and fanning in
  from every input.
- **Pooling** — the window, the value that wins, and the cells discarded.
- **Global pooling** — each feature map collapsing to one number.
- **Activation** — the function's curve, with values mapping through it
  element by element, and where the gradient dies.
- **Normalization** — the four stages: raw distribution, re-centred,
  re-scaled, then γ and β applied.
- **Attention** — one query at a time: dotted against every key, softmaxed
  into weights, then mixing the value vectors into the output.
- **Embedding** — the lookup table with the indexed row copied out.
- **Flatten** — the volume unrolling into a vector in memory order.
- **Dropout** — a fresh random mask each step, and the survivor rescaling.
- **Residual add / concat** — the two paths joining, and why the gradient path
  matters.
- **Recurrent** — the hidden state threading through timesteps.

Anything without a purpose-built scene falls back to a shape-in/shape-out
diagram rather than pretending.

---

## Files

```
server.py       CLI, local HTTP server, standalone-HTML builder
extract.py      model file -> normalized graph (format dispatch, shape propagation)
knowledge.py    the explanation engine: per-layer prose, conditioned on context
viewer.html     the whole front end — 3D renderer, UI and layer scenes, no dependencies
```

`extract.extract(path, input_shape=None, allow_unsafe=False, code=None)` is
importable on its own and returns the graph as a plain dict:

```python
{"meta":  {framework, format, extractor, total_params, total_macs,
           input_shape, output_shape, channels_last, summary},
 "nodes": [{id, name, op, kind, family, params, in_shape, out_shape,
            n_params, macs, rf, geom, shape_assumed, explain}],
 "edges": [{src, dst, kind: sequential|residual|branch|recurrent, note}],
 "groups": [...], "warnings": [...]}
```

---

## Limits

- Very large graphs are truncated to 6000 nodes for display.
- The layout is a layered DAG: the main path runs along X and branches fan out
  in Z. Models with heavy parallel structure read less cleanly than mostly
  sequential ones.
- MACs cover convolutions, dense layers, attention and recurrence; elementwise
  operations are not counted.
- Expanded scenes draw a corner of each tensor, not the whole thing — a
  56×56×256 volume rendered literally is noise. The caption always states what
  fraction is on screen.
- TensorFlow is only needed for SavedModel directories that carry no Keras
  metadata; everything else in the TF family is read straight from JSON.
