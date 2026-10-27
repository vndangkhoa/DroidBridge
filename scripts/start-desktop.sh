#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

if [ ! -f "dist/index.html" ]; then
  echo "[DroidBridge] Building frontend bundle (dist/index.html missing)..."
  npm run build
fi

echo "[DroidBridge] Launching Ubuntu Desktop App (Electron)..."
exec npx electron . --no-sandbox "$@"
