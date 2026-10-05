# Cloud deployment: Vercel, Render, Grafana Cloud

| Piece | Where | Config |
| --- | --- | --- |
| `apps/dashboard`, `apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order` | Vercel, one project each | `apps/*/vercel.json` |
| `apps/api-gateway` (Docker) and `apps/report-service` | Render | `render.yaml` (Blueprint) |
| Gateway metrics and dashboard | Grafana Cloud | `grafana/gateway-dashboard.json` |
| Postgres / Redis | Supabase / Upstash (already hosted) | |

Order matters because each step needs URLs from the one before: migrate, Render, Vercel, then back to Render for CORS, then Grafana.

## 1. Database migrations

Add repository secrets `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST`
(GitHub > Settings > Secrets and variables > Actions), then run **Actions > Database Migrations > Run workflow**.
Locally, `pnpm build && pnpm db:migrate` does the same with your `.env`.

## 2. Render (gateway + report service)

1. Render > **New > Blueprint**, pick this repository. Render reads `render.yaml`.
2. Fill the prompted values from your `.env`: `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `REDIS_URL`,
   `ENCRYPTION_KEY`, `KEY_PEPPER` (the same ones your data was written with), `GEMINI_API_KEY` (may be empty).
   `ALLOWED_ORIGINS` and `APP_URL` can be `http://localhost:5100` for now; step 4 fixes them.
   For the report service, `GATEWAY_URL` is `https://mfe-orchestrator-gateway.onrender.com/api`
   (use the gateway's real URL) and `GATEWAY_API_KEY` is `REPORT_SERVICE_KEY` from `pnpm db:seed --write-env`.
3. `METRICS_TOKEN` is generated; copy it from the gateway's Environment tab for step 5.
4. Check `https://<gateway>.onrender.com/health/ready` returns 200: it pings Postgres and Redis.

Free instances sleep after 15 idle minutes, so the first request after a pause takes about a minute.

## 3. Vercel (four projects)

For each app, Vercel > **Add New > Project** > import this repository, set **Root Directory** to the app folder
(`apps/dashboard`, `apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order`) and leave the build settings to `vercel.json`.
Deploy the two remotes first so the shell can point at them.

| Project | Environment variables |
| --- | --- |
| mfe-user, mfe-order | `VITE_GATEWAY_URL`, `VITE_MFE_CONSUMER_KEY` |
| mfe-shell | `VITE_GATEWAY_URL`, `VITE_MFE_CONSUMER_KEY`, `VITE_MFE_USER_ENTRY=https://<mfe-user>.vercel.app/remoteEntry.js`, `VITE_MFE_ORDER_ENTRY=https://<mfe-order>.vercel.app/remoteEntry.js`, `VITE_DASHBOARD_URL` |
| dashboard | `VITE_GATEWAY_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SHELL_URL`, `VITE_MFE_CONSUMER_KEY` |

`VITE_GATEWAY_URL` is the gateway's Render URL. The remotes serve their chunks from their own production domain
(`VERCEL_PROJECT_PRODUCTION_URL`), so set `VITE_MFE_USER_URL` / `VITE_MFE_ORDER_URL` only if you add a custom domain.
`VITE_*` values are baked in at build time: redeploy after changing them.

## 4. Back to Render

On the gateway set `ALLOWED_ORIGINS` to the four Vercel URLs, comma-separated, and `APP_URL` to the dashboard URL.
In Supabase > Authentication > URL Configuration add the dashboard URL as Site URL and redirect URL.

## 5. Grafana Cloud

1. **Connections > Add new connection > Metrics Endpoint**. Scrape URL `https://<gateway>.onrender.com/metrics`,
   authentication **Bearer**, token = the gateway's `METRICS_TOKEN`, interval 60s.
2. **Dashboards > New > Import**, upload `grafana/gateway-dashboard.json`, pick the `grafanacloud-*-prom` data source.
3. Optional: **Testing & synthetics > Synthetics** HTTP checks on `/health/ready` (gateway) and `/health`
   (report service) also keep the free Render instances awake.
