#!/usr/bin/env bash
# Tab Tree is a Chrome extension: there is no server to keep running.
# Build the unpacked extension once so a fresh session can load it immediately.
set -euo pipefail

if [ ! -f .output/chrome-mv3/manifest.json ]; then
  pnpm build
fi

echo "Tab Tree extension ready at .output/chrome-mv3 (load it from chrome://extensions)."
