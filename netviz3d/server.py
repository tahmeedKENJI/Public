#!/usr/bin/env python3
"""netviz3d — interactive 3D viewer for neural network model files.

    python server.py path/to/model.pt
    python server.py path/to/model.keras --port 8080
    python server.py model.pth --input-shape 1,3,32,32
    python server.py model.pt --standalone model_viz.html   # one portable file

Everything runs on 127.0.0.1. The model file is read, the graph is held in
memory, and the browser talks only to this process — nothing is uploaded and
nothing is written to disk unless you explicitly ask for --standalone or --json.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socket
import socketserver
import sys
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract  # noqa: E402

VIEWER = os.path.join(HERE, "viewer.html")
STATE = {"graph": None, "error": None, "source": None}


# --------------------------------------------------------------------------


def build_standalone(graph, out_path):
    """Bake the graph into the viewer so the result is one openable HTML file."""
    with open(VIEWER, "r", encoding="utf-8") as fh:
        html = fh.read()
    payload = json.dumps(graph, separators=(",", ":")).replace("</", "<\\/")
    inject = f"<script>window.__NETVIZ_GRAPH__ = {payload};</script>\n"
    marker = "<!--GRAPH_INJECT-->"
    html = html.replace(marker, inject) if marker in html else html.replace("</head>", inject + "</head>")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return out_path


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("NETVIZ_VERBOSE"):
            super().log_message(fmt, *args)

    # -- helpers ----------------------------------------------------------
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    # -- routes -----------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html", "/viewer.html"):
            try:
                with open(VIEWER, "rb") as fh:
                    return self._send(200, fh.read(), "text/html; charset=utf-8")
            except FileNotFoundError:
                return self._send(500, b"viewer.html is missing next to server.py", "text/plain")
        if path == "/api/graph":
            if STATE["error"]:
                return self._json(500, {"error": STATE["error"]})
            if STATE["graph"] is None:
                return self._json(404, {"error": "no model loaded"})
            return self._json(200, STATE["graph"])
        if path == "/api/health":
            return self._json(200, {"ok": True, "source": STATE["source"]})
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/load":
            return self._send(404, b"not found", "text/plain")
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as exc:
            return self._json(400, {"error": f"bad request: {exc}"})
        target = req.get("path")
        if not target:
            return self._json(400, {"error": "missing 'path'"})
        try:
            graph = extract.extract(target,
                                    input_shape=parse_shape(req.get("input_shape")),
                                    allow_unsafe=bool(req.get("allow_unsafe")),
                                    code=req.get("code"))
        except Exception as exc:
            return self._json(400, {"error": str(exc)})
        STATE.update(graph=graph, error=None, source=target)
        return self._json(200, graph)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


# --------------------------------------------------------------------------


def parse_shape(text):
    if not text:
        return None
    if isinstance(text, (list, tuple)):
        return [int(x) for x in text]
    return [int(x) for x in str(text).replace("x", ",").replace(" ", "").split(",") if x]


def free_port(preferred):
    for port in [preferred] + list(range(preferred + 1, preferred + 40)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port found")


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="netviz3d",
        description="Interactive 3D viewer for PyTorch / TensorFlow / Keras / ONNX model files.")
    ap.add_argument("model", nargs="?", help="model file or SavedModel directory")
    ap.add_argument("--input-shape", help="input shape for shape tracing, e.g. 1,3,224,224")
    ap.add_argument("--port", type=int, default=8017)
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser")
    ap.add_argument("--allow-unsafe-unpickle", action="store_true",
                    help="allow torch.load to execute pickled code; gives true dataflow and observed shapes")
    ap.add_argument("--code", metavar="model_def.py",
                    help="python file defining the model's classes, so a pickled nn.Module resolves")
    ap.add_argument("--standalone", metavar="OUT.html",
                    help="write a single self-contained HTML file instead of serving")
    ap.add_argument("--json", metavar="OUT.json", dest="json_out",
                    help="also dump the extracted graph as JSON")
    args = ap.parse_args(argv)

    if not args.model:
        ap.print_help()
        return 1

    print(f"[netviz3d] reading {args.model}")
    try:
        graph = extract.extract(args.model,
                                input_shape=parse_shape(args.input_shape),
                                allow_unsafe=args.allow_unsafe_unpickle,
                                code=args.code)
    except Exception as exc:
        print(f"\n[netviz3d] could not read the model:\n  {exc}\n", file=sys.stderr)
        return 2

    m = graph["meta"]
    print(f"[netviz3d] {m['framework']} · {m['format']} · {m['n_nodes']} layers · "
          f"{m['total_params']:,} parameters")
    for w in graph.get("warnings", []):
        print(f"[netviz3d] note: {w}")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(graph, fh, indent=1)
        print(f"[netviz3d] graph written to {args.json_out}")

    if args.standalone:
        out = build_standalone(graph, args.standalone)
        print(f"[netviz3d] standalone viewer written to {out}")
        print("[netviz3d] open it in any browser — no server, no network, no dependencies.")
        return 0

    STATE.update(graph=graph, error=None, source=args.model)
    port = free_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    with Server(("127.0.0.1", port), Handler) as httpd:
        print(f"[netviz3d] serving on {url}  (Ctrl-C to stop)")
        if not args.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[netviz3d] stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
