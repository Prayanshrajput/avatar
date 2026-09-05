#!/usr/bin/env bash
# Expose this app on a public URL via a Cloudflare quick tunnel.
#
# Usage:
#   ./scripts/tunnel.sh           # production build + start (recommended for sharing)
#   ./scripts/tunnel.sh --dev     # `next dev` behind the tunnel (HMR, needs allowedDevOrigins)
#   PORT=3001 ./scripts/tunnel.sh
#
# Why prod by default: Next 16's blockCrossSiteDEV rejects cross-origin /_next/*
# and the /_next/hmr websocket with a raw "Unauthorized" write, which cloudflared
# surfaces as `malformed HTTP response "Unauthorized"`. That guard is dev-only, so
# `next start` has no origin problem at all -- nothing to allowlist, no restart
# dance when the quick-tunnel hostname changes, and it serves far faster.
#
# --dev works too, but only because next.config.ts allowlists *.trycloudflare.com.
# The dev server reads that config at boot, so ALWAYS start the server before (or
# restart it after) changing allowedDevOrigins -- a stale process is what produces
# the Unauthorized errors even with a correct config.
#
# NOTE: a quick tunnel is public and unauthenticated. Anyone with the URL can drive
# your local /api/* routes, and those spend your Tripo/Gemini/Anthropic credits.
# Keep it short-lived. For a stable hostname + access control, use a named tunnel:
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps

set -euo pipefail

PORT="${PORT:-3000}"
MODE=prod
for arg in "$@"; do
  case "$arg" in
    --dev) MODE=dev ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v cloudflared >/dev/null 2>&1 || {
  echo "error: cloudflared not found -- install with: brew install cloudflared" >&2
  exit 1
}

cd "$(dirname "$0")/.."

# Refuse to start on an occupied port: cloudflared would happily proxy to whatever
# other process owns it, which looks like the app misbehaving.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $PORT is already in use. Stop it first:" >&2
  echo "  lsof -nP -iTCP:$PORT -sTCP:LISTEN" >&2
  exit 1
fi

APP_PID=""
TUNNEL_PID=""
cleanup() {
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  [[ -n "$APP_PID" ]] && kill "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ "$MODE" == prod ]]; then
  echo "==> next build"
  npx next build
  echo "==> next start -p $PORT"
  npx next start -H 0.0.0.0 -p "$PORT" &
else
  echo "==> next dev -p $PORT (origin allowlist comes from next.config.ts)"
  npx next dev -H 0.0.0.0 -p "$PORT" &
fi
APP_PID=$!

# cloudflared retries a dead origin forever and only logs "connection refused",
# so wait for a real listener before handing out a URL.
echo -n "==> waiting for http://localhost:$PORT "
for _ in $(seq 1 120); do
  if curl -sS -o /dev/null -m 2 "http://localhost:$PORT" 2>/dev/null; then break; fi
  kill -0 "$APP_PID" 2>/dev/null || { echo; echo "error: app exited before listening." >&2; exit 1; }
  printf .
  sleep 1
done
echo " up"

echo "==> cloudflared tunnel --url http://localhost:$PORT"
cloudflared tunnel --url "http://localhost:$PORT" &
TUNNEL_PID=$!

# Block until either process dies, then let the EXIT trap stop the other.
#
# `wait -n` would say this in one line, but it needs bash 4 and macOS still ships
# bash 3.2 -- where it fails as "invalid option", and under `set -e` that failure
# tears the whole script down through cleanup(), killing the tunnel the moment it
# starts. Polling is the portable equivalent.
while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
  sleep 1
done
