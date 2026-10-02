#!/usr/bin/env bash
# Browser end-to-end test of the dashboard, the Module Federation shell and the gateway.
# Uses disposable Postgres/Redis containers and a local stand-in for Supabase Auth, so it
# never touches the Supabase or Upstash databases configured in .env. Needs Docker and Google Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
for port in 3001 3002 4000 5000 5001 5002 5100 54399; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use; stop 'pnpm dev' before running the e2e test." >&2
    exit 1
  fi
done
run_id="fyp-e2e-$$"
cleanup() {
  docker rm -f "$run_id-postgres" "$run_id-redis" >/dev/null 2>&1 || true
}
trap cleanup EXIT
pnpm build
docker run -d --name "$run_id-postgres" -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=fyp_e2e -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
docker run -d --name "$run_id-redis" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for attempt in {1..60}; do
  if docker exec "$run_id-postgres" pg_isready -U postgres >/dev/null 2>&1 && docker exec "$run_id-redis" redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg_port=$(docker port "$run_id-postgres" 5432/tcp | cut -d: -f2)
redis_port=$(docker port "$run_id-redis" 6379/tcp | cut -d: -f2)
export E2E_DATABASE_URL="postgresql://postgres:e2e@127.0.0.1:$pg_port/fyp_e2e"
export E2E_REDIS_URL="redis://127.0.0.1:$redis_port"
DATABASE_URL="$E2E_DATABASE_URL" DIRECT_URL="$E2E_DATABASE_URL" pnpm db:migrate
pnpm --filter @orchestrator/e2e test:e2e "$@"
