#!/usr/bin/env bash
# Full build for Cloudflare Workers Builds (and local use). Works from any directory.
# Exports the backend snapshot (needs uv, installed here if missing), then builds the
# static frontend that the Worker serves from ../frontend/out.
set -euo pipefail
cd "$(dirname "$0")"
root="$(cd .. && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found, installing"
  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  else
    python3 -m pip install --user uv
  fi
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi
uv --version

(cd "$root/cloudflare" && npm ci)
(cd "$root/frontend" && npm ci)

# uv fetches Python 3.12 itself if the image does not have it
(cd "$root/backend" && uv run --python 3.12 python -m avrora.export "$root/cloudflare/src/snapshot.json")
(cd "$root/frontend" && STATIC_EXPORT=1 npm run build)
