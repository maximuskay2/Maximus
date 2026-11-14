#!/usr/bin/env bash
# Build chat (and optionally accounts) on this machine, rsync to the Coolify VPS, rebuild images, restart.
# Usage:
#   ./deploy/coolify/push.sh           # chat only (usual)
#   ./deploy/coolify/push.sh --accounts
# Env (optional):
#   MAXIMUS_VPS=root@138.201.125.169
#   MAXIMUS_VPS_SRC=/opt/maximus/src
#   MAXIMUS_VPS_ENV=/opt/maximus/.env.production
#   MAXIMUS_VPS_HEALTH=https://app.meetnote.cc/api/health
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VPS="${MAXIMUS_VPS:-root@138.201.125.169}"
SRC="${MAXIMUS_VPS_SRC:-/opt/maximus/src}"
ENV_FILE="${MAXIMUS_VPS_ENV:-/opt/maximus/.env.production}"
HEALTH="${MAXIMUS_VPS_HEALTH:-https://app.meetnote.cc/api/health}"
WITH_ACCOUNTS=0
for arg in "$@"; do
  case "$arg" in
    --accounts) WITH_ACCOUNTS=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"
echo "==> build server + web"
pnpm build:server
pnpm exec vite build
test -f dist-server/maximus.js
test -f dist/index.html

echo "==> rsync → $VPS:$SRC"
rsync -az --delete --exclude '*.map' dist-server/ "$VPS:$SRC/dist-server/"
rsync -az --delete dist/ "$VPS:$SRC/dist/"
rsync -az \
  deploy/coolify/Dockerfile.chat \
  deploy/coolify/docker-compose.yml \
  .dockerignore \
  "$VPS:$SRC/deploy/coolify/"
rsync -az .dockerignore "$VPS:$SRC/.dockerignore"
if [[ "$WITH_ACCOUNTS" -eq 1 ]]; then
  rsync -az --delete \
    --exclude node_modules --exclude .git \
    accounts/ "$VPS:$SRC/accounts/"
  rsync -az package.json pnpm-lock.yaml pnpm-workspace.yaml "$VPS:$SRC/"
fi

SERVICES=chat
[[ "$WITH_ACCOUNTS" -eq 1 ]] && SERVICES="accounts accounts-cron chat"

echo "==> remote build + up ($SERVICES)"
ssh "$VPS" "set -euo pipefail
  if grep -qE '^(dist|dist-server)\$' '$SRC/.dockerignore' 2>/dev/null; then
    grep -v -E '^(dist|dist-server)\$' '$SRC/.dockerignore' > '$SRC/.dockerignore.tmp'
    mv '$SRC/.dockerignore.tmp' '$SRC/.dockerignore'
  fi
  cp -f '$ENV_FILE' '$SRC/deploy/coolify/.env'
  cd '$SRC/deploy/coolify'
  docker compose --env-file '$ENV_FILE' build $SERVICES
  docker compose --env-file '$ENV_FILE' up -d $SERVICES
  sleep 5
  docker compose --env-file '$ENV_FILE' ps
"

echo "==> health"
code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH" || true)"
echo "$HEALTH → $code"
[[ "$code" == "200" ]] || exit 1
echo "done"
