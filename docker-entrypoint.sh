#!/bin/sh
# Bring the database up to date, then exec the Node app. Fails fast if the database
# is unreachable or migrations don't apply — better than booting against a stale schema.
#
# Uses the dbmate binary shipped with the npm dependency. Expects a clean DATABASE_URL
# (no Prisma-style ?schema=...; include ?sslmode=disable if your Postgres has no TLS).

set -e

DBMATE="node_modules/.bin/dbmate --no-dump-schema"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "==> Waiting for database…"
for i in $(seq 1 30); do
  if node_modules/.bin/dbmate status >/dev/null 2>&1; then
    echo "    reachable."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    still unreachable after 60s — aborting." >&2
    exit 1
  fi
  sleep 2
done

# Idempotent: dbmate create errors if the DB already exists — swallow it.
echo "==> Ensuring database exists…"
node_modules/.bin/dbmate create 2>/dev/null || true

echo "==> Running migrations…"
$DBMATE up

echo "==> Starting Node app…"
exec "$@"
