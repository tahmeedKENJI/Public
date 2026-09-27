#!/bin/sh
# Re-vendors three.js as one classic (non-module) script exposing the global THREE, so the game
# works from file:// and offline with no build step. Needs network once; run from this folder.
#   sh tools/vendor-three.sh 0.186.1
set -e
VER="${1:-0.186.1}"
TMP="$(mktemp -d)"
( cd "$TMP" && npm init -y >/dev/null && npm i "three@$VER" esbuild >/dev/null && echo "export * from 'three';" > entry.js &&
  npx esbuild entry.js --bundle --format=iife --global-name=THREE --minify --outfile=out.js )
{ echo "/* three.js r${VER#0.} (https://threejs.org), MIT License, see three.LICENSE. Bundled as a classic script exposing the global THREE by tools/vendor-three.sh. */"; cat "$TMP/out.js"; } > vendor/three.min.js
cp "$TMP/node_modules/three/LICENSE" vendor/three.LICENSE
rm -rf "$TMP"
echo "vendored three $VER"
