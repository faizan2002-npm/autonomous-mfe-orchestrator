#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unique containers and Docker-assigned localhost ports avoid existing services,
# so tests never touch the Supabase or Upstash databases configured in .env.
run_id="fyp-test-$$"
cleanup() {
  docker rm -f "$run_id-postgres" "$run_id-redis" >/dev/null 2>&1 || true
}
trap cleanup EXIT
pnpm build
docker run -d --name "$run_id-postgres" -e POSTGRES_PASSWORD=integration -e POSTGRES_DB=fyp_integration -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
docker run -d --name "$run_id-redis" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$run_id-postgres" pg_isready -U postgres >/dev/null 2>&1 && docker exec "$run_id-redis" redis-cli ping >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo 'Integration services did not become ready within 60 seconds.' >&2
  exit 1
fi
pg_port=$(docker port "$run_id-postgres" 5432/tcp | cut -d: -f2)
redis_port=$(docker port "$run_id-redis" 6379/tcp | cut -d: -f2)
export TEST_DATABASE_URL="postgresql://postgres:integration@127.0.0.1:$pg_port/fyp_integration"
export TEST_REDIS_URL="redis://127.0.0.1:$redis_port"
# Gemini tests are skipped unless TEST_GEMINI_API_KEY is exported by the caller.
if [ "${TEST_SUITE:-all}" = nest ]; then
  pnpm --filter @orchestrator/integration-tests test:nest
  TEST_GATEWAY_SOURCE=true pnpm --filter @orchestrator/gateway exec tsx ../integration-tests/nest.test.mjs
else
  pnpm --filter @orchestrator/gateway test:integration
fi
