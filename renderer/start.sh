#!/bin/sh
set -eu

export WINEDEBUG=-all
export WINEPREFIX=/tmp/sakura-wine
export WINEARCH=win32

mkdir -p "$WINEPREFIX"

RCC_DIR="/opt/openpekora/RCCService/RCCService2020"
RENDERER_DIR="/opt/openpekora/game-renderer"

echo "[Sakura Renderer] Initializing Wine..."
xvfb-run -a wineboot --init >/tmp/sakura-wineboot.log 2>&1 || true

cd "$RCC_DIR"
echo "[Sakura Renderer] Starting RCCService 2020 on local port 64989..."
xvfb-run -a wine ./RCCService.exe \
  -Console -verbose -settingsfile Settings.json -port 64989 &
RCC_PID=$!

APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  kill "$RCC_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for attempt in $(seq 1 90); do
  if ! kill -0 "$RCC_PID" 2>/dev/null; then
    echo "[Sakura Renderer] RCCService exited during startup."
    tail -n 80 /tmp/sakura-wineboot.log 2>/dev/null || true
    exit 1
  fi

  if nc -z -w 1 127.0.0.1 64989; then
    READY=1
    break
  fi

  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "[Sakura Renderer] RCCService did not open port 64989."
  exit 1
fi

echo "[Sakura Renderer] RCCService is ready. Starting HTTP renderer..."
cd "$RENDERER_DIR"
node dist/Main.js &
APP_PID=$!

while kill -0 "$APP_PID" 2>/dev/null; do
  if ! kill -0 "$RCC_PID" 2>/dev/null; then
    echo "[Sakura Renderer] RCCService stopped. Shutting down the HTTP renderer."
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 5
done

wait "$APP_PID"
