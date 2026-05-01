#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${TMPDIR:-/tmp}/trade-system-0-tauri.log"

cd "$ROOT_DIR"

echo "==> trade-system-0 desktop launcher"
echo "==> project: $ROOT_DIR"

echo "==> stopping stale trade-system-0 dev processes"
pkill -f "$ROOT_DIR/src-tauri/target/debug/trade-system-0" 2>/dev/null || true
pkill -f "$ROOT_DIR/node_modules/.bin/tauri" 2>/dev/null || true
pkill -f "$ROOT_DIR/node_modules/.bin/vite" 2>/dev/null || true

if lsof -tiTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "==> port 1420 is still busy; refusing to kill unrelated process"
  echo "    run: lsof -iTCP:1420 -sTCP:LISTEN -n -P"
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install Rust first:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo "  source \"\$HOME/.cargo/env\""
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found. Install Node.js first."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> node_modules missing; running npm install"
  npm install
fi

echo "==> writing log to $LOG_FILE"
echo "==> starting Tauri dev app"
echo "    keep this terminal open; press Ctrl+C to stop"

exec npm run tauri:dev 2>&1 | tee "$LOG_FILE"

