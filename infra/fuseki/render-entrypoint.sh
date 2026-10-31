#!/usr/bin/env bash
set -euo pipefail
: "$FUSEKI_ADMIN_PASSWORD"
export ADMIN_PASSWORD="$FUSEKI_ADMIN_PASSWORD"
exec /usr/bin/tini -- /docker-entrypoint.sh "$@"