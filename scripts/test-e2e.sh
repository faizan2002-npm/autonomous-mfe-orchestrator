#!/usr/bin/env bash
# Browser end-to-end test of the dashboard, the Module Federation shell and the gateway.
# Uses disposable Postgres/Redis containers and a local stand-in for Supabase Auth, so it
# never touches the Supabase or Upstash databases configured in .env. Needs Docker and Google Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
for port in 3001 3002 3003 4000 5000 5001 5002 5100 54399; do
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
# Fresh secrets per run, shared by the seed and the gateway under test.
export ENCRYPTION_KEY="$(openssl rand -base64 32)" KEY_PEPPER="$(openssl rand -base64 32)"
seed_output=$(DATABASE_URL="$E2E_DATABASE_URL" REDIS_URL="$E2E_REDIS_URL" APP_URL=http://localhost:5100 \
  node apps/api-gateway/dist/cli/seed.js --owner e2e-reviewer@example.test)
export VITE_MFE_CONSUMER_KEY="$(sed -n 's/^VITE_MFE_CONSUMER_KEY=//p' <<<"$seed_output")"
export E2E_OWNER_INVITE="$(sed -n 's/^Owner invitation for [^:]*: //p' <<<"$seed_output")"
# The demo org's upstreams are test fixtures (apps/e2e/fixtures/demo-upstream.mjs): register them
# and grant the seeded consumers access, as an admin would in the dashboard.
docker exec -i "$run_id-postgres" psql -q -v ON_ERROR_STOP=1 -U postgres -d fyp_e2e <<'SQL'
INSERT INTO service_registries (org_id, service_name, endpoint_url, description, health_path)
SELECT id, s.name, s.url, s.description, '/health'
FROM organizations, (VALUES
  ('user-service', 'http://localhost:3001', 'Mock user profiles with a chaos switch'),
  ('order-service', 'http://localhost:3002', 'Mock orders with a chaos switch')
) AS s(name, url, description)
WHERE slug = 'demo'
ON CONFLICT DO NOTHING;
INSERT INTO consumer_services (consumer_id, service_id)
SELECT c.id, r.id
FROM consumers c
JOIN organizations o ON o.id = c.org_id AND o.slug = 'demo'
JOIN service_registries r ON r.org_id = o.id
WHERE c.name = 'acme-portal' OR (c.name = 'report-service' AND r.service_name = 'order-service')
ON CONFLICT DO NOTHING;
SQL
pnpm --filter @orchestrator/e2e test:e2e "$@"
