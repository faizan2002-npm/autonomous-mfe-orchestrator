# Autonomous Micro-Frontend Orchestrator

### An Agentic AI System for Real-Time API Contract Drift Detection, Cognitive Patch Generation, and Zero-Downtime Self-Healing in Decoupled Cloud-Native Architectures

A gateway that sits between micro-frontends and their backend services. It learns the shape of every API response, notices when an upstream service changes that shape (a renamed field, a flattened object, a changed type), generates a small adapter that translates the new shape back to the old one, proves the adapter works, and rolls it out to a slice of traffic before a human promotes it. The frontend keeps working while the backend team catches up.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Frontend](#frontend)
- [Demo: Watch It Heal](#demo-watch-it-heal)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Testing](#testing)

---

## How It Works

Every request to `/api/v1/:service/*` flows through the gateway. Successful JSON responses feed the healing loop, which runs per **contract** (service + HTTP method + normalized path, so `/users/1` and `/users/2` share one contract).

1. **Observe.** The response is flattened into `path:type` tokens (`profile.bio:string`). The first response seen for a contract becomes its baseline, stored in Postgres and cached in Redis.
2. **Detect.** Each response is scored with the drift coefficient `Dc = 1 − |Se ∩ So| / |Se ∪ So|` (one minus the Jaccard similarity of expected and observed tokens). Above `DRIFT_SIMILARITY_THRESHOLD`, a drift event is recorded and classified (`FIELD_RENAMED`, `FIELD_DELETED`, `TYPE_CHANGED`, `FIELD_ADDED`). Missing fields or type changes are *breaking*. Each distinct drifted shape is recorded once, not on every request.
3. **Generate.** For breaking drift, Google Gemini writes a pure JavaScript adapter. Without an API key, or if Gemini is unavailable, a deterministic fallback maps renamed fields by name, including nested ones (`avatar_url` → `profile.avatarUrl`).
4. **Verify.** The adapter must parse as a single function, pass an AST check that blocks `eval`, `Function`, network and prototype access, run in a VM sandbox within 50 ms, and actually restore the expected contract. Adapters that fail are stored as *rejected* with the reason, and never reach traffic.
5. **Canary.** The verified patch serves `CANARY_TRAFFIC_PERCENTAGE` of requests. Patched responses carry `x-orchestrator-healed: true`, and per-patch traffic is counted.
6. **Govern.** A signed-in reviewer promotes the patch to 100% or rolls it back from the dashboard. Every decision is written to an audit trail under the reviewer's verified identity.

> Node's `vm` module limits what an adapter can reach but is not a security boundary for hostile code. The AST check and sandbox are defence in depth, not isolation.

## Tech Stack

| Layer | Technology |
|---|---|
| Gateway | NestJS 10 on Fastify, TypeScript (ESM), Server-Sent Events |
| Database | Supabase Postgres via Drizzle ORM (`postgres.js`), migrations with Drizzle Kit |
| Auth | Supabase Auth; the gateway verifies access tokens against the project's JWKS (`jose`) |
| Cache | Upstash Redis (`ioredis`, TLS) |
| Patch generation | Google Gemini API (default `gemini-3.5-flash-lite`) with a deterministic fallback |
| Adapter safety | `@babel/parser` AST validation, Node `vm` sandbox |
| Dashboard | React 19, Vite, Tailwind CSS + shadcn/ui, TanStack Query, React Router, Recharts |
| Micro-frontends | React + Vite with Module Federation (`@module-federation/vite`) |
| Demo services | Fastify mock user and order services with a chaos switch |
| Monorepo | pnpm workspaces |

## Quick Start

**Prerequisites:** Node.js 20+, pnpm 9+, a [Supabase](https://supabase.com/dashboard) project, a free [Upstash](https://console.upstash.com) Redis database, and optionally a [Gemini API key](https://aistudio.google.com/apikey).

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to find it |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase → project → **Connect**: the part after `postgres.` in the pooler URL |
| `SUPABASE_DB_PASSWORD` | The database password chosen when the project was created |
| `SUPABASE_POOLER_HOST` | Supabase → project → **Connect**: the pooler host, e.g. `aws-0-ap-south-1.pooler.supabase.com` |
| `REDIS_URL` | Upstash → database → **Connect** → *TCP*, the `rediss://` URL |
| `VITE_SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → **API Keys** → *Publishable key* (safe to expose) |
| `GEMINI_API_KEY` | Google AI Studio → **Get API key** (optional) |

Use the pooler host rather than the direct `db.<ref>.supabase.co` host, which only works over IPv6 on free projects.

```bash
# 3. Create the schema in Supabase
pnpm db:migrate

# 4. Build the shared packages once, then start everything in watch mode
pnpm build
pnpm dev
```

**5. Create a reviewer account:** Supabase → Authentication → Users → **Add user** (email + password). The dashboard has no self-signup; only accounts you create can sign in.

| App | URL |
|---|---|
| Governance dashboard | http://localhost:5100 |
| Micro-frontend shell (host) | http://localhost:5000 |
| User / order micro-frontends (remotes) | http://localhost:5001 · http://localhost:5002 |
| API gateway | http://localhost:4000 |
| User / order services | http://localhost:3001 · http://localhost:3002 |

> macOS can reserve port 5000 for AirPlay Receiver (System Settings → General → AirDrop & Handoff). Turn it off if the shell fails to start.

## Frontend

### Governance dashboard (`apps/dashboard`)

A signed-in console for reviewers. Data comes from the gateway's governance API and refreshes live over Server-Sent Events.

| Page | What it shows |
|---|---|
| **Overview** | Health and drift KPIs, drift events per hour, live activity feed, service health, patches awaiting promotion |
| **Services** | Each upstream service, its learned contract baselines (schema tokens) and recent drift |
| **Drift Events** | Filterable history; detail view with the drift coefficient and a field-by-field schema diff |
| **Patches** | Canary / active / rejected / rolled back / superseded; detail view with the adapter code, generator (Gemini or fallback), sandbox before/after preview, canary traffic, lifecycle and audit trail, plus **Promote** and **Roll back** |
| **Audit Log** | Every automatic and human decision with reviewer and notes |
| **Demo Lab** | Chaos switches for the mock services, a request sender with canary routing, and a live pipeline view (drift → patch → canary → promotion) |
| **Settings** | Read-only gateway configuration and the signed-in user |

### Micro-frontend shell (`apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order`)

The shell is a Module Federation **host** that loads two independently served **remotes** at runtime from their `remoteEntry.js`: `ProfileCard` (user-service) and `OrderCard` (order-service). Each card is written strictly against the contract its backend had when it was built, so upstream drift makes it genuinely crash. The shell isolates each crash in its own error boundary.

Header controls:
- **Canary / Sampled / Baseline:** which traffic group the shell's requests join.
- **Auto-refresh:** re-fetches every 3 s, so you can watch a card heal.

The shell owns the Tailwind design system and scans the remotes' sources, so the remotes ship no CSS of their own.

## Demo: Watch It Heal

With `pnpm dev` running, open the dashboard's **Demo Lab** and the shell side by side.

1. In the shell, choose **Baseline**. Both cards render.
2. In Demo Lab, switch **user-service** to its drifted schema. The profile card crashes (`firstName` became `first_name`, `profile` was flattened).
3. Send a request with **Force canary**. The pipeline shows drift detected → patch generated → canary deployed.
4. In the shell, choose **Canary**. The profile card renders again, marked *Self-healed by gateway*. On **Baseline** it still crashes: only canary traffic is patched.
5. Open the patch, run the sandbox preview, and click **Promote**. Baseline traffic heals too, and the audit log records your email.
6. Repeat with **order-service**. Its drift also restructures the line-item array, which the rule-based fallback cannot repair, so this one needs Gemini. Without a key, the patch appears under *Rejected* with the reason.

Rolling a patch back makes the gateway forget that drift, so the next drifted response triggers healing again and the demo can be repeated.

## Configuration

All configuration is validated once at startup. An invalid or missing value stops the gateway with a message naming the variable.

| Variable | Default | Purpose |
|---|---|---|
| `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST` | *required* | Supabase credentials, stored once. The app connects through the transaction pooler (port 6543) and migrations through the session pooler (port 5432) |
| `SUPABASE_DB_NAME` | `postgres` | Database name |
| `DATABASE_URL` / `DIRECT_URL` | *built from the keys above* | Optional full connection strings that override the app / migration URL |
| `SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co` | Supabase Auth issuer whose signing keys the gateway trusts |
| `ALLOWED_ORIGINS` | the four local frontend origins | Browser origins allowed to call the gateway (CORS) |
| `REDIS_URL` | *required* | Upstash Redis (`rediss://`) for caches and canary counters |
| `GEMINI_API_KEY` | *unset* | Gemini API key; when unset, only the deterministic fallback generates adapters |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model used to generate adapters |
| `DRIFT_SIMILARITY_THRESHOLD` | `0.15` | Drift coefficient (0–1) above which a response counts as drifted |
| `CANARY_TRAFFIC_PERCENTAGE` | `10` | Share of traffic (0–100) a new patch receives before promotion |
| `GATEWAY_PORT` | `4000` | Gateway port |
| `USER_SERVICE_PORT` / `ORDER_SERVICE_PORT` | `3001` / `3002` | Demo service ports |
| `USER_SERVICE_URL` / `ORDER_SERVICE_URL` | `http://localhost:3001` / `:3002` | Upstreams the gateway proxies to |
| `VITE_GATEWAY_URL` | `http://localhost:4000` | Gateway URL used by the frontends |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | *required for the dashboard* | Supabase Auth for dashboard sign-in |
| `VITE_DASHBOARD_URL`, `VITE_SHELL_URL` | local ports | Cross-links between the dashboard and the shell |
| `VITE_MFE_USER_ENTRY`, `VITE_MFE_ORDER_ENTRY` | `http://localhost:5001/remoteEntry.js`, `:5002` | Where the shell loads each remote from |

Remote Postgres connections use TLS automatically, and prepared statements are disabled on Supabase's transaction pooler (port 6543), which does not support them. All `VITE_*` values are compiled into browser code, so never put secrets in them.

## API Reference

### Proxy (public)

| Method | Path | Notes |
|---|---|---|
| `ANY` | `/api/v1/:service/*` | Forwarded to `<service>/api/v1/*`. Registered services: `user-service`, `order-service` |

Send `x-mfe-canary: true` or `false` to force canary routing. Without the header, requests are sampled at `CANARY_TRAFFIC_PERCENTAGE`; promoted patches apply to all traffic. The `x-orchestrator-healed` response header is exposed to browsers.

### Governance (requires `Authorization: Bearer <Supabase access token>`)

| Method | Path | Returns / body |
|---|---|---|
| `GET` | `/api/governance/stats` | KPI counts |
| `GET` | `/api/governance/config` | Public configuration (never secrets) |
| `GET` | `/api/governance/services`, `/services/:name` | Services, contract baselines, recent drift |
| `GET` | `/api/governance/drift-events?service=&type=&limit=&cursor=` | Paginated drift history |
| `GET` | `/api/governance/drift-events/:id` | Drift detail with schema diff and observed payload |
| `GET` | `/api/governance/patches?status=&service=`, `/patches/:id` | Patches; detail includes adapter, audits and canary traffic |
| `POST` | `/api/governance/patches/:id/preview` | Runs the adapter on its source payload in the sandbox (read-only) |
| `POST` | `/api/governance/patches/:id/promote` | `{ "serviceName": "user-service", "notes"?: "..." }` |
| `POST` | `/api/governance/patches/:id/rollback` | Same as promote |
| `GET` | `/api/governance/audits?limit=` | Audit trail |
| `GET` | `/api/governance/events` | Server-Sent Events: `drift.detected`, `patch.generated`, `patch.rejected`, `patch.deployed`, `patch.promoted`, `patch.rolledBack`, `request.proxied` |
| `GET` | `/api/governance/overview` | Raw recent rows (kept for compatibility) |

Only `CANARY` patches can be promoted and only live (`CANARY` or `ACTIVE`) patches can be rolled back; anything else returns `409`. The reviewer recorded in the audit is taken from the verified token, never from the request body.

### Demo (requires a token)

| Method | Path | Body |
|---|---|---|
| `GET` | `/api/demo/services` | – (chaos state of each mock service) |
| `POST` | `/api/demo/services/:name/chaos` | `{ "mutated": true }` |

### Module Federation patches (public)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/patches/:serviceName/remoteEntry.js` | Registers the service's live adapters on `window.__MFE_ORCHESTRATOR_PATCHES__[serviceName]`, keyed by `"METHOD /path"` |

## Architecture

```
┌──────────────────────────────┐      ┌───────────────────────────────┐
│ MFE Shell (host)       :5000 │      │ Governance Dashboard    :5100 │
│  ├─ mfe-user remote    :5001 │      │  Supabase Auth sign-in        │
│  └─ mfe-order remote   :5002 │      │  SSE live updates             │
└──────────────┬───────────────┘      └───────────────┬───────────────┘
               │ /api/v1/:service/* (public)           │ /api/governance/*, /api/demo/* (Bearer token)
               ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ API Gateway (NestJS + Fastify)                                 :4000 │
│                                                                      │
│  proxy ──► observation ──► healing ──► cognitive (Gemini, verify)    │
│    │                                      │                          │
│    └──────────► canary ◄──────────────────┘ ◄── governance ◄── auth  │
│                   │                                                  │
│  events (rxjs) ◄──┴── every stage publishes; governance streams SSE  │
└──────┬──────────────────────┬──────────────────────┬─────────────────┘
       ▼                      ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│ Supabase     │      │ Upstash      │      │ Google Gemini    │
│ Postgres +   │      │ Redis        │      │ API (optional)   │
│ Auth (JWKS)  │      │ caches,      │      └──────────────────┘
└──────────────┘      │ canary stats │
       ▲              └──────────────┘
       │ proxied upstream calls
┌──────┴───────────────────────────────────┐
│ User Service :3001    Order Service :3002 │
└───────────────────────────────────────────┘
```

Postgres is the source of truth for live patches. Each gateway instance keeps an in-memory copy for routing and reloads it from the database on startup. Live events are in-process, so with several gateway instances each dashboard sees the events of the instance it is connected to.

### Repository layout

| Path | Responsibility |
|---|---|
| `apps/api-gateway/src/config` | Validated, typed `GatewayConfig` built once at startup |
| `apps/api-gateway/src/auth` | Supabase JWT verification (JWKS) and the `AuthGuard` |
| `apps/api-gateway/src/events` | In-process event bus feeding the SSE stream |
| `apps/api-gateway/src/proxy` | Forwards requests, triggers observation, applies live patches |
| `apps/api-gateway/src/observation` | Contract baselines, drift detection, drift event recording |
| `apps/api-gateway/src/healing` | Background generate → deploy pipeline, one run at a time per contract |
| `apps/api-gateway/src/cognitive` | Gemini adapter generation, fallback adapter, verification and persistence |
| `apps/api-gateway/src/canary` | Live patch registry, traffic routing and counters, promotion and rollback |
| `apps/api-gateway/src/governance` | Read models for the dashboard and audited promote/rollback decisions |
| `apps/api-gateway/src/demo` | Chaos controls for the mock services |
| `apps/api-gateway/src/database`, `redis` | Connection lifecycle for Supabase and Upstash |
| `apps/dashboard` | Governance dashboard (React + Vite) |
| `apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order` | Module Federation host and remotes |
| `apps/integration-tests` | Tests against real Postgres and Redis, plus Gemini when a key is given |
| `apps/e2e` | Playwright browser test with a local stand-in for Supabase Auth |
| `packages/core` | Pure drift engine: flattening, drift coefficient, diff, classification |
| `packages/adapter-runtime` | AST validator and VM sandbox for adapters |
| `packages/database` | Drizzle schema, SQL migrations, connection factory |
| `packages/shared-types` | Domain enums and the API response types shared by the gateway and the frontends |
| `packages/config` | Connection settings shared by the gateway and Drizzle Kit |
| `packages/upstream-client`, `gemini-client` | HTTP clients for upstream services and the Gemini API |
| `services/user-service`, `order-service` | Mock backends with a chaos switch |

### Database

Six tables, created by the migrations in `packages/database/migrations`:

| Table | Holds |
|---|---|
| `service_registries` | Known upstream services and their health (`HEALTHY`, `DRIFTING`, …) |
| `api_contracts` | Baseline schema tokens per contract |
| `drift_events` | Each detected drift with its coefficient, diff and classification |
| `patch_registries` | Generated adapters and their lifecycle (`VALIDATED` → `CANARY` → `ACTIVE`, or `FAILED` / `SUPERSEDED` / `ROLLED_BACK`) |
| `governance_audits` | Automatic and human decisions with reasoning |
| `canary_metrics` | Reserved; canary traffic is currently counted in Redis |

## Testing

```bash
pnpm build && pnpm test     # unit tests for every package, including the dashboard (Vitest)
pnpm test:nest              # Nest wiring, auth and CORS against disposable Postgres + Redis containers
pnpm test:integration       # full suite against disposable containers
pnpm test:e2e               # Playwright: dashboard + MFE shell + gateway in a real browser
```

The integration and e2e commands need Docker. The Gemini tests run only when `TEST_GEMINI_API_KEY` is exported (optionally `TEST_GEMINI_MODEL`); otherwise they are skipped.

The e2e test drives Google Chrome through the full journey: drift crashes the profile card, a canary request heals it, a reviewer previews and promotes the patch, and the audit records them. Stop `pnpm dev` first, since it uses the same ports.

Integration and e2e tests always start their own throwaway containers and never touch the Supabase or Upstash databases in `.env`. Auth tests sign tokens with a locally generated key served from a local JWKS endpoint.

## License

This project is submitted as part of a Final Year Project (FYP) for academic evaluation.
