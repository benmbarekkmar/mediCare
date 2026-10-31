#!/usr/bin/env bash
set -euo pipefail
: "$FUSEKI_ADMIN_PASSWORD"
export ADMIN_PASSWORD="$FUSEKI_ADMIN_PASSWORD"
if command -v tini >/dev/null 2>&1; then
  exec tini -- /docker-entrypoint.sh "$@"
fi
exec /docker-entrypoint.sh "$@"