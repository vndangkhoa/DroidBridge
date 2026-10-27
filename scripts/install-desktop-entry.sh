#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_SRC="${PROJECT_ROOT}/droidbridge.desktop"
APPS_DIR="${HOME}/.local/share/applications"
DESKTOP_DEST="${APPS_DIR}/droidbridge.desktop"

mkdir -p "${APPS_DIR}"
chmod +x "${PROJECT_ROOT}/scripts/start-desktop.sh" "${PROJECT_ROOT}/scripts/start-web.sh"
cp "${DESKTOP_SRC}" "${DESKTOP_DEST}"
chmod +x "${DESKTOP_DEST}"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" || true
fi

echo "[DroidBridge] Installed Ubuntu desktop launcher to: ${DESKTOP_DEST}"
