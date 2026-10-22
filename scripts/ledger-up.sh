#!/usr/bin/env bash
# Starts the owner's ledger database (Postgres, synthetic data) on the Zetaris compose network,
# so Zetaris can register it as a JDBC datasource. Password comes from CAUSEWAY_LEDGER_PASSWORD (.env).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
: "${CAUSEWAY_LEDGER_PASSWORD:?set CAUSEWAY_LEDGER_PASSWORD in .env}"
NET="${ZETARIS_DOCKER_NETWORK:-zetaris_default}"
ROOT="$(pwd -W 2>/dev/null || pwd)"
if docker ps -a --format '{{.Names}}' | grep -qx causeway-ledger; then
  docker start causeway-ledger >/dev/null
else
  docker run -d --name causeway-ledger --network "$NET" --memory 256m \
    -e POSTGRES_DB=causeway -e POSTGRES_USER=causeway -e POSTGRES_PASSWORD="$CAUSEWAY_LEDGER_PASSWORD" \
    -v "$ROOT/data/ledger:/seed:ro" -v "$ROOT/zetaris/ledger/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" \
    postgres:16-alpine >/dev/null
fi
for i in $(seq 1 30); do
  docker exec causeway-ledger pg_isready -U causeway -d causeway >/dev/null 2>&1 && break
  sleep 2
done
docker exec causeway-ledger psql -U causeway -d causeway -tAc "SELECT 'ledger rows: ' || count(*) FROM ledger_monthly"
