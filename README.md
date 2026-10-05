# Autonomous Micro-Frontend Orchestrator

### An Agentic AI System for Real-Time API Contract Drift Detection, Cognitive Patch Generation, and Zero-Downtime Self-Healing in Decoupled Cloud-Native Architectures

A gateway that sits between micro-frontends and their backend services. It learns the shape of every API response, notices when an upstream service changes that shape (a renamed field, a flattened object, a changed type), generates a small adapter that translates the new shape back to the old one, proves the adapter works, and rolls it out to a slice of traffic before a human promotes it. The frontend keeps working while the backend team catches up.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Organizations, Consumers and Keys](#organizations-consumers-and-keys)
- [Notifications](#notifications)
- [Promotion Policies](#promotion-policies)
- [OpenAPI Contracts](#openapi-contracts)
- [Testing](#testing)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Frontend](#frontend)
- [Demo: Watch It Heal](#demo-watch-it-heal)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture](#architecture)

---

## How It Works

Applications call their upstream services through the gateway at `/api/v1/:service/*`, identified by a consumer API key. Successful JSON responses feed the healing loop, which runs per **contract**: organization + consumer + service + HTTP method + normalized path. `/users/1` and `/users/2` share one contract, and two consumers of the same endpoint each have their own.

1. **Observe.** The response is flattened into `path:type` tokens (`profile.bio:string`). A consumer's first response for an endpoint becomes its baseline, stored in Postgres and cached in Redis.
2. **Detect.** Each response is scored with the drift coefficient `Dc = 1 − |Se ∩ So| / |Se ∪ So|` (one minus the Jaccard similarity of expected and observed tokens). If the consumer has **pinned** the fields it depends on, only those count. Above the org's drift threshold, a drift event is recorded and classified (`FIELD_RENAMED`, `FIELD_DELETED`, `TYPE_CHANGED`, `FIELD_ADDED`). Missing fields or type changes are *breaking*. Each distinct drifted shape is recorded once, not on every request.
3. **Generate.** For breaking drift, Google Gemini (the org's own key, or the platform's) writes a pure JavaScript adapter. Without a key, or if Gemini is unavailable, a deterministic fallback maps renamed fields by name, including nested ones (`avatar_url` → `profile.avatarUrl`).
4. **Verify.** The adapter must parse as a single function, pass an AST check that blocks `eval`, `Function`, network and prototype access, run in a VM sandbox within 50 ms, and actually restore the expected contract. Adapters that fail are stored as *rejected* with the reason, and never reach traffic.
5. **Canary.** The verified patch serves the org's canary share of that consumer's requests. Patched responses carry `x-orchestrator-healed: true`, and per-patch traffic is counted.
6. **Govern.** A reviewer promotes the patch to 100% or rolls it back from the dashboard. Every decision is audited under the reviewer's verified identity.

> Node's `vm` module limits what an adapter can reach but is not a security boundary for hostile code. The AST check and sandbox are defence in depth, not isolation.

## Organizations, Consumers and Keys

**Organizations** are fully isolated tenants. Anyone can sign up and create one (they become its **owner**) and invite others by email:

| Role | Can |
|---|---|
| Owner | Everything, including managing owners and admins. An org always keeps at least one owner. |
| Admin | Services, consumers, keys, members (reviewers and viewers) and settings |
| Reviewer | Preview, promote and roll back patches; pin contract fields; test services |
| Viewer | Read-only |

Non-members get `404` for an organization, so its existence never leaks.

**Services** are the upstream APIs an organization registers (name, base URL, optional health path, timeout and encrypted upstream headers such as service credentials). Base URLs that resolve to private, loopback, link-local or cloud-metadata addresses are refused, and the check is repeated on every connection (DNS rebinding cannot bypass it). `ALLOW_PRIVATE_UPSTREAMS=true` lifts this for local development.

**Consumers** are the applications calling those services, either frontend or backend. Each consumer is granted the services it may call and gets its own contracts. That lets a web app and a billing worker reading the same API heal independently, and a consumer can pin the fields it actually uses so irrelevant changes are ignored.

**API keys** identify a consumer in the `x-orchestrator-key` header:

| Key | Prefix | Where | Restriction |
|---|---|---|---|
| Publishable | `pk_` | Browser code (frontend consumers) | Only accepted from its allowed origins |
| Secret | `sk_` | Servers (backend-to-backend) | Keep in environment variables |

Keys are shown once, stored only as peppered HMACs, revocable instantly and rate-limited per key (`RATE_LIMIT_PER_MINUTE`). The gateway forwards a safe set of client headers (`authorization`, `accept`, tracing headers, `idempotency-key`) and the service's own configured headers, which take precedence.

```bash
# A backend calling order-service through the gateway
curl -H "x-orchestrator-key: $ORCHESTRATOR_KEY" http://localhost:4000/api/v1/order-service/orders/9821
```

## Notifications

Reviewers hear about work that needs them the moment it happens:

| Event | Default channels (reviewers and up) |
|---|---|
| Breaking drift | inbox, email, push |
| Patch awaiting review | inbox, email, push |
| Patch rejected / rolled back | inbox, email |
| Patch promoted | inbox |

Viewers only get inbox entries. Each member can change their channels per organization under **Notifications → Preferences**, enable **push on this device**, and send themselves a test. Invitations are emailed as well as shown as copyable links.

- **Email** is pluggable through `EMAIL_PROVIDER`:
  - `resend` uses the Resend HTTP API;
  - `smtp` uses Nodemailer with any `smtp://` or `smtps://` server;
  - `log` prints mail to the gateway log and is the default for development.
- **Web push** uses VAPID. Generate keys with `npx web-push generate-vapid-keys`. The dashboard's service worker (`public/sw.js`) shows the alert and opens the patch on click. Subscriptions that push services report as gone (404/410) are pruned automatically.
- **Slack and webhooks** are organization-wide and admin-managed under **Notifications → Integrations**. Slack gets Block Kit messages with a review link. Webhooks are signed: `x-orchestrator-signature: t=<unix>,v1=<hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. The `whsec_…` secret is shown once. Every delivery also carries `x-orchestrator-event` and `x-orchestrator-delivery` headers. Webhook URLs are stored encrypted and SSRF-guarded.

Every external delivery goes through a durable Postgres outbox (`notification_deliveries`):
- Workers claim rows with `FOR UPDATE SKIP LOCKED`, so any number of gateway instances can share the outbox.
- Failures retry with exponential backoff (30 s, 1 min, 2 min…), up to six attempts. Permanent 4xx failures stop immediately.
- Admins see the delivery log and can **redeliver** any entry.
- The in-app bell updates live over the event stream, and each member's stream carries only their own notifications.

## Promotion Policies

Reviewers don't have to promote every patch by hand. A **promotion policy** promotes a canary patch to 100% once it has proven itself, and rolls it back when its adapter keeps failing.

| Rule | Meaning |
|---|---|
| Canary requests ≥ *n* | Healed canary requests required before promotion |
| Minutes in canary ≥ *m* | Minimum time since the patch was deployed |
| Adapter failures ≤ *x%* | Highest failure rate that still allows promotion; above it, a reviewer must decide |
| Generators | Which engines' patches may auto-promote (Gemini, rule-based fallback) |
| Roll back at ≥ *y%* after *k* requests | Optional automatic rollback, only once the rate is based on enough traffic |

How policies are applied:
- **Scope.** A policy covers the whole organization, one service, one consumer, or one service for one consumer. The most specific enabled policy wins. Without a policy, patches wait for a reviewer.
- **Evaluation.** The evaluator runs every 30 s, under a Redis lock so that only one gateway instance evaluates at a time.
- **Audit trail.** Decisions go through the same paths as a reviewer's. The audit records `policy:<name>` with the reasoning, and the evidence (requests, failures, time window) is kept in `canary_metrics`.
- **Notifications.** Members are notified with "promoted by policy" or "rolled back by policy".

The **Policies** page shows every canary patch with its progress toward the thresholds and the policy's next step. `pnpm db:seed` adds a conservative `Default` policy to the Demo Organization: 50 requests, 30 minutes, no failures, and rollback at 25% after 20 requests.

## OpenAPI Contracts

By default, a consumer's contract for an endpoint is learned from its first response. Import a service's **OpenAPI 3.x or Swagger 2.0** document (JSON or YAML; pasted, uploaded, or fetched from a URL by the gateway through the SSRF guard) and contracts start from what the API *declares* instead:

- Each operation's JSON 2xx response schema becomes `path:type` tokens. These are the same tokens the gateway extracts from real responses. Parsing resolves `$ref`, `allOf`, first `oneOf`/`anyOf` variants, nullable types (3.0 `nullable` and 3.1 type arrays), enums, nested arrays, and server/`basePath` prefixes.
- A consumer's **first request** to a declared endpoint is checked against the spec, so an upstream that already deviates is caught immediately rather than becoming the baseline. Undeclared endpoints are still learned from traffic.
- *Only required properties* is an option for APIs that legitimately omit optional fields.
- The service page compares every consumer contract with the spec: declared fields missing from the contract, and contract fields the spec doesn't declare. A reviewer can **use the spec as the contract**, which creates a new contract version and keeps the old one.

## Testing

The project has a multi-tier testing strategy: unit tests with Jest, integration tests against disposable Docker containers, and end-to-end tests with Playwright.

```bash
pnpm test                    # Unit tests (Jest + node:test, per-package)
pnpm test:jest:coverage      # With coverage report (70-90% thresholds per module)
pnpm test:integration        # Integration tests (Docker Postgres + Redis, ~10 min)
pnpm test:e2e                # End-to-end tests (Playwright + Chrome, ~5 min)
pnpm test:all                # Full ladder: build → lint → unit → integration → e2e
```

**Test suites:**
- **Unit**: `packages/core`, `crypto`, `api-gateway` services; dashboard components
- **Integration**: Multi-module flows with real DB/Redis: tenancy isolation, key auth, SSRF guard, RBAC, notifications outbox, policies, OpenAPI baselines
- **E2E**: User workflows (services, consumers, notifications, contracts, drift)

Each test:
- Uses disposable Docker containers (never touches real Supabase/Upstash)
- Starts with fresh state and cleans up after itself
- Runs in parallel via Jest (`maxWorkers: 50%`)

GitHub Actions runs all tests on every push and PR, with Codecov integration for coverage reporting.

See `TEST-GUIDE.md` for detailed testing strategies, writing new tests, and debugging.

## Tech Stack

| Layer | Technology |
|---|---|
| Gateway | NestJS 10 on Fastify, TypeScript (ESM), Server-Sent Events |
| Database | Supabase Postgres via Drizzle ORM (`postgres.js`), migrations with Drizzle Kit |
| Auth | Supabase Auth (sign-up, sign-in, password reset); the gateway verifies access tokens against the project's JWKS (`jose`) |
| Cache | Upstash Redis (`ioredis`, TLS): baselines, key lookups, rate limits, canary counters |
| Secrets | AES-256-GCM at rest, HMAC-SHA256 key hashing (`packages/crypto`) |
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
| `ENCRYPTION_KEY`, `KEY_PEPPER` | Generate each with `openssl rand -base64 32`. Never change them once data exists. |
| `ALLOW_PRIVATE_UPSTREAMS` | `true` for local development (the demo services run on localhost) |
| `GEMINI_API_KEY` | Google AI Studio → **Get API key** (optional) |

Use the pooler host rather than the direct `db.<ref>.supabase.co` host, which only works over IPv6 on free projects.

```bash
# 3. Create the schema in Supabase
pnpm build
pnpm db:migrate

# 4. Optional: a ready-made Demo Organization with services, consumers and keys,
#    plus an owner invitation for you (open the printed link after signing up)
pnpm db:seed --write-env --owner you@example.com

# 5. Start everything in watch mode
pnpm dev
```

Open http://localhost:5100, **create an account** and either accept your invitation or create an organization in the onboarding wizard.

| App | URL |
|---|---|
| Governance dashboard | http://localhost:5100 |
| Micro-frontend shell (host) | http://localhost:5000 |
| User / order micro-frontends (remotes) | http://localhost:5001 · http://localhost:5002 |
| API gateway | http://localhost:4000 |
| User / order services | http://localhost:3001 · http://localhost:3002 |

> Supabase's built-in email service is heavily rate limited. For real sign-ups, configure custom SMTP under Authentication → Emails, or turn off email confirmation while developing.
>
> macOS can reserve port 5000 for AirPlay Receiver (System Settings → General → AirDrop & Handoff). Turn it off if the shell fails to start.

## Frontend

### Governance dashboard (`apps/dashboard`)

Sign up, sign in and reset passwords through Supabase Auth. New users go through an **onboarding wizard**:
1. Create the organization.
2. Register the first service and test the connection.
3. Create a consumer and its key, shown once with browser/Node/curl snippets.
4. Invite reviewers.

An **org switcher** moves between organizations. Everything lives under `/o/:orgSlug` and updates live over Server-Sent Events.

| Page | What it shows |
|---|---|
| **Overview** | Health and drift KPIs, drift events per hour, live activity feed, service health, patches awaiting promotion |
| **Services** | Registered upstreams with health; detail view with configuration (write-only upstream headers), connection test, contracts per consumer with a field-pinning editor, OpenAPI import with spec-vs-contract comparison, and recent drift |
| **Consumers & keys** | Frontend and backend consumers, the services each may call, keys (issue once, revoke, last used, allowed origins) |
| **Drift Events** | Filterable history; detail view with the drift coefficient and a field-by-field schema diff |
| **Patches** | Canary / active / rejected / rolled back / superseded; detail view with the adapter code, generator, sandbox preview, canary traffic, lifecycle and audit trail, plus **Promote** and **Roll back** |
| **Policies** | Canary patches with progress toward their policy and its next step; organization-, service- and consumer-scoped promotion and rollback rules |
| **Audit Log** | Every automatic and human patch decision with reviewer and notes |
| **Demo Lab** | Chaos switches, a request sender (with a consumer key and canary routing), and a live pipeline view |
| **Notifications** | Inbox; per-event email/push preferences, push on this device and a test send; Slack and webhook integrations with a delivery log and redelivery (admins) |
| **Members** | Members and roles, invitations with copyable single-use links |
| **Activity** | Administrative trail: members, keys, services, settings (admins) |
| **Settings** | Per-org drift threshold, canary share, Gemini model and bring-your-own Gemini key (encrypted, never shown back) |

The UI hides actions your role can't perform; the API enforces the same rules.

### Micro-frontend shell (`apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order`)

The shell is a Module Federation **host** that loads two independently served **remotes** at runtime from their `remoteEntry.js`: `ProfileCard` (user-service) and `OrderCard` (order-service). They call the gateway with the `acme-portal` publishable key (`VITE_MFE_CONSUMER_KEY`, written by `pnpm db:seed --write-env`). Each card is written strictly against the contract its backend had when it was built, so upstream drift makes it genuinely crash. The shell isolates each crash in its own error boundary.

Header controls:
- **Canary / Sampled / Baseline:** which traffic group the shell's requests join.
- **Auto-refresh:** re-fetches every 3 s, so you can watch a card heal.

## Demo: Watch It Heal

After `pnpm db:seed --write-env --owner you@example.com` and `pnpm dev`, accept the invitation, open **Demo Lab** in the Demo Organization and the shell side by side.

1. In the shell, choose **Baseline**. Both cards render.
2. In Demo Lab, switch **user-service** to its drifted schema. The profile card crashes (`firstName` became `first_name`, `profile` was flattened).
3. Send a request with **Force canary** (the demo key is prefilled). The pipeline shows drift detected → patch generated → canary deployed.
4. In the shell, choose **Canary**. The profile card renders again, marked *Self-healed by gateway*. On **Baseline** it still crashes: only canary traffic is patched.
5. Open the patch, run the sandbox preview, and click **Promote**. Baseline traffic heals too, and the audit log records your email.
6. Repeat with **order-service**. Its drift also restructures the line-item array, which the rule-based fallback cannot repair, so this one needs Gemini. Without a key, the patch appears under *Rejected* with the reason.

Rolling a patch back makes the gateway forget that drift, so the next drifted response triggers healing again and the demo can be repeated.

## Configuration

All configuration is validated once at startup. An invalid or missing value stops the gateway with a message naming the variable. Drift threshold, canary share and Gemini settings below are platform defaults; each organization can override them in **Settings**.

| Variable | Default | Purpose |
|---|---|---|
| `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST` | *required* | Supabase credentials, stored once. The app connects through the transaction pooler (port 6543) and migrations through the session pooler (port 5432) |
| `SUPABASE_DB_NAME` | `postgres` | Database name |
| `DATABASE_URL` / `DIRECT_URL` | *built from the keys above* | Optional full connection strings that override the app / migration URL |
| `SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co` | Supabase Auth issuer whose signing keys the gateway trusts |
| `ENCRYPTION_KEY` | *required* | 32-byte base64 key for secrets at rest (service headers, BYO Gemini keys) |
| `KEY_PEPPER` | *required* | 32-byte base64 pepper for API-key and invitation-token hashes |
| `ALLOW_PRIVATE_UPSTREAMS` | `false` | Allow service URLs on private/loopback addresses (local development only) |
| `APP_URL` | `http://localhost:5100` | Dashboard URL used in invitation links |
| `RATE_LIMIT_PER_MINUTE` | `600` | Proxied requests per consumer key per minute |
| `EMAIL_PROVIDER` | `log` | `log`, `resend` or `smtp` |
| `EMAIL_FROM` | `MFE Orchestrator <onboarding@resend.dev>` | Sender of notification and invitation emails |
| `RESEND_API_KEY` | *unset* | Required when `EMAIL_PROVIDER=resend` |
| `SMTP_URL` | *unset* | Required when `EMAIL_PROVIDER=smtp`, e.g. `smtps://user:pass@smtp.example.com:465` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | *unset* | Web push keys (`npx web-push generate-vapid-keys`); both or neither |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact for push services (`mailto:` or `https:`) |
| `ALLOWED_ORIGINS` | the four local frontend origins | Browser origins allowed to call the management API (consumer traffic is governed by key origins) |
| `REDIS_URL` | *required* | Upstash Redis (`rediss://`) |
| `GEMINI_API_KEY` | *unset* | Platform Gemini key; when unset (and the org has none), only the fallback generates adapters |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Default Gemini model |
| `DRIFT_SIMILARITY_THRESHOLD` | `0.15` | Default drift coefficient (0–1) above which a response counts as drifted |
| `CANARY_TRAFFIC_PERCENTAGE` | `10` | Default share of traffic (0–100) a new patch receives before promotion |
| `GATEWAY_PORT` | `4000` | Gateway port |
| `USER_SERVICE_PORT` / `ORDER_SERVICE_PORT` | `3001` / `3002` | Demo service ports |
| `USER_SERVICE_URL` / `ORDER_SERVICE_URL` | `http://localhost:3001` / `:3002` | Base URLs `pnpm db:seed` registers for the demo services |
| `VITE_GATEWAY_URL` | `http://localhost:4000` | Gateway URL used by the frontends |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | *required for the dashboard* | Supabase Auth for the dashboard |
| `VITE_MFE_CONSUMER_KEY` | *from `pnpm db:seed`* | Publishable key the demo shell and Demo Lab use |
| `REPORT_SERVICE_KEY` | *from `pnpm db:seed`* | Secret key of the demo backend consumer |
| `VITE_DASHBOARD_URL`, `VITE_SHELL_URL` | local ports | Cross-links between the dashboard and the shell |
| `VITE_MFE_USER_ENTRY`, `VITE_MFE_ORDER_ENTRY` | `http://localhost:5001/remoteEntry.js`, `:5002` | Where the shell loads each remote from |

Remote Postgres connections use TLS automatically, and prepared statements are disabled on Supabase's transaction pooler (port 6543), which does not support them. All `VITE_*` values are compiled into browser code, so only publishable keys belong there.

## API Reference

### Consumer traffic (`x-orchestrator-key`)

| Method | Path | Notes |
|---|---|---|
| `ANY` | `/api/v1/:service/*` | Forwarded to the org service's base URL + `/api/v1/*` |
| `GET` | `/patches/remoteEntry.js?service=&key=pk_…` | Registers the consumer's live adapters for a service on `window.__MFE_ORCHESTRATOR_PATCHES__[service]`, keyed by `"METHOD /path"` |

Responses: `401` missing/unknown/revoked key, `403` wrong origin or service not granted, `404` service not registered in the key's organization, `429` rate limited. Send `x-mfe-canary: true` or `false` to force canary routing; otherwise requests are sampled at the org's canary share. Promoted patches apply to all traffic.

### Account (`Authorization: Bearer <Supabase access token>`)

| Method | Path | Notes |
|---|---|---|
| `GET` / `POST` | `/api/orgs` | Your organizations / create one (`{ name, slug }`; you become owner) |
| `GET` | `/api/invitations/:token` | Invitation preview (no sign-in needed) |
| `POST` | `/api/invitations/:token/accept` | Join; the signed-in email must match the invitation |
| `GET` | `/api/push/config` | Whether web push is enabled, and the VAPID public key (no sign-in needed) |
| `POST`, `DELETE` | `/api/push/subscriptions` | Register / remove this browser's push subscription |

### Organization (`/api/orgs/:orgSlug`, member role in brackets)

| Method | Path | Notes |
|---|---|---|
| `GET` / `PATCH` | `/` | Settings [viewer] / update name, threshold, canary %, Gemini model or key [admin] |
| `GET`, `PATCH`, `DELETE` | `/members`, `/members/:id` | List [viewer], change role [admin; owners for owner/admin], remove [admin] or leave [self] |
| `GET`, `POST`, `DELETE` | `/invitations`, `/invitations/:id` | Pending invitations, invite (`{ email, role }`, returns `acceptUrl`), revoke [admin] |
| `GET` | `/activity` | Administrative trail [admin] |
| `GET`, `POST`, `PATCH`, `DELETE` | `/services`, `/services/:id` | Service registry [viewer read, admin write] |
| `POST` | `/services/:id/test` | Connection test [reviewer] |
| `GET`, `PUT`, `DELETE` | `/services/:id/openapi` | Imported spec, declared operations and contract comparisons [viewer] / import `{ document \| url, requiredOnly? }` or remove [admin] |
| `POST` | `/services/:id/openapi/adopt` | `{ contractId }`: re-baseline a consumer contract on the spec [reviewer] |
| `GET`, `POST`, `PATCH`, `DELETE` | `/consumers`, `/consumers/:id` | Consumers and service grants [viewer read, admin write] |
| `POST`, `DELETE` | `/consumers/:id/keys`, `/consumers/:id/keys/:keyId` | Issue (`{ type, allowedOrigins? }`, key returned once) / revoke [admin] |
| `GET` | `/governance/stats`, `/config`, `/services`, `/services/:name`, `/audits` | Read models [viewer] |
| `GET` | `/governance/drift-events?service=&consumerId=&type=&limit=&cursor=`, `/drift-events/:id` | Drift history and detail [viewer] |
| `GET` | `/governance/patches?status=&service=&consumerId=`, `/patches/:id` | Patches and detail [viewer] |
| `PUT` | `/governance/contracts/:id/pins` | `{ required: [...], ignored: [...] }` [reviewer] |
| `POST` | `/governance/patches/:id/preview`, `/promote`, `/rollback` | Sandbox preview; decisions `{ serviceName, notes? }` [reviewer] |
| `GET` | `/governance/events` | Server-Sent Events for this organization only [viewer] |
| `GET`, `POST` | `/notifications`, `/notifications/read` | Your inbox (`unreadCount`, newest first) / mark read (`{ ids? }`, all when omitted) [viewer] |
| `GET`, `PUT` | `/notifications/preferences` | Your channels per event (`{ preferences: [{ event, channels }] }`) [viewer] |
| `POST` | `/notifications/test` | Send yourself a test email and push [viewer] |
| `GET`, `POST`, `PATCH`, `DELETE` | `/notifications/endpoints`, `/notifications/endpoints/:id` | Slack and webhook integrations; webhook signing secret returned once [admin] |
| `POST` | `/notifications/endpoints/:id/test` | Queue a test delivery [admin] |
| `GET`, `POST` | `/notifications/deliveries?endpointId=`, `/notifications/deliveries/:id/redeliver` | Delivery log and redelivery [admin] |
| `GET`, `POST`, `PATCH`, `DELETE` | `/policies`, `/policies/:id` | Promotion policies [viewer read, admin write] |
| `GET` | `/policies/outlook` | Each canary patch, its governing policy and what it will do next [viewer] |
| `GET`, `POST` | `/demo/services`, `/demo/services/:name/chaos` | Chaos switch of demo upstreams [viewer / reviewer] |

Only `CANARY` patches can be promoted and only live (`CANARY` or `ACTIVE`) patches can be rolled back; anything else returns `409`. Reviewers recorded in audits come from the verified token, never the request body.

## Architecture

```
┌──────────────────────────────┐      ┌───────────────────────────────┐
│ MFE Shell (host)       :5000 │      │ Governance Dashboard    :5100 │
│  ├─ mfe-user remote    :5001 │      │  Supabase Auth sign-in        │
│  └─ mfe-order remote   :5002 │      │  SSE live updates             │
└──────────────┬───────────────┘      └───────────────┬───────────────┘
               │ /api/v1/:service/* + consumer key     │ /api/orgs/:org/* (Bearer token + role)
               ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ API Gateway (NestJS + Fastify)                                 :4000 │
│                                                                      │
│  proxy ──► observation ──► healing ──► cognitive (Gemini, verify)    │
│    │                                      │                          │
│    └──────────► canary ◄──────────────────┘ ◄── governance ◄── auth  │
│  orgs · services (SSRF guard) · consumers & keys (rate limit)       │
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

Every row belongs to an organization, and every query is scoped by it. Postgres is the source of truth for live patches. Each gateway instance keeps an in-memory copy for routing and reloads it from the database on startup. Live events are in-process, so with several gateway instances each dashboard sees the events of the instance it is connected to.

### Repository layout

| Path | Responsibility |
|---|---|
| `apps/api-gateway/src/config` | Validated, typed `GatewayConfig` built once at startup |
| `apps/api-gateway/src/auth` | Supabase JWT verification (JWKS), `AuthGuard`, `OrgGuard` and role requirements |
| `apps/api-gateway/src/orgs` | Organizations, members, invitations, per-org settings, activity log |
| `apps/api-gateway/src/services` | Per-org service registry with SSRF protection and encrypted upstream headers |
| `apps/api-gateway/src/consumers` | Consumers, API keys, service grants, key authentication and rate limiting |
| `apps/api-gateway/src/common` | Contract identity, SSRF guard, validation helpers |
| `apps/api-gateway/src/cli/seed.ts` | `pnpm db:seed`: demo organization, consumers and keys |
| `apps/api-gateway/src/events` | In-process event bus feeding the SSE stream |
| `apps/api-gateway/src/proxy` | Forwards requests, triggers observation, applies live patches |
| `apps/api-gateway/src/observation` | Contract baselines, drift detection, drift event recording |
| `apps/api-gateway/src/healing` | Background generate → deploy pipeline, one run at a time per contract |
| `apps/api-gateway/src/cognitive` | Gemini adapter generation, fallback adapter, verification and persistence |
| `apps/api-gateway/src/canary` | Live patch registry, traffic routing and counters, promotion and rollback |
| `apps/api-gateway/src/governance` | Read models for the dashboard and audited promote/rollback decisions |
| `apps/api-gateway/src/demo` | Chaos controls for an organization's demo upstreams |
| `apps/api-gateway/src/database`, `redis` | Connection lifecycle for Supabase and Upstash |
| `apps/dashboard` | Governance dashboard (React + Vite) |
| `apps/mfe-shell`, `apps/mfe-user`, `apps/mfe-order` | Module Federation host and remotes |
| `apps/integration-tests` | Tests against real Postgres and Redis, plus Gemini when a key is given |
| `apps/e2e` | Playwright browser test with a local stand-in for Supabase Auth |
| `packages/core` | Pure drift engine: flattening, drift coefficient, diff, classification |
| `packages/adapter-runtime` | AST validator and VM sandbox for adapters |
| `packages/database` | Drizzle schema, SQL migrations, connection factory |
| `packages/crypto` | AES-256-GCM secret sealing, HMAC key/token hashing, API key generation |
| `packages/shared-types` | Domain enums and the API response types shared by the gateway and the frontends |
| `packages/config` | Connection settings shared by the gateway and Drizzle Kit |
| `packages/upstream-client`, `gemini-client` | HTTP clients for upstream services and the Gemini API |
| `services/user-service`, `order-service` | Mock backends with a chaos switch |

### Database

Created by the migrations in `packages/database/migrations` (pre-tenancy data is moved into a "Demo Organization"):

| Table | Holds |
|---|---|
| `organizations` | Tenants and their pipeline overrides (threshold, canary %, Gemini model, encrypted BYO Gemini key) |
| `org_members`, `org_invitations` | Memberships with roles; single-use, email-bound, expiring invitations (token hashes only) |
| `org_activity` | Administrative audit trail |
| `service_registries` | Each org's upstream services, base URLs, encrypted headers, health and last OpenAPI import |
| `consumers`, `consumer_keys`, `consumer_services` | Applications, their API keys (hashes only) and the services they may call |
| `api_contracts` | Baseline schema tokens per consumer contract, with optional field pins |
| `drift_events` | Each detected drift with its coefficient, diff and classification |
| `patch_registries` | Generated adapters and their lifecycle (`VALIDATED` → `CANARY` → `ACTIVE`, or `FAILED` / `SUPERSEDED` / `ROLLED_BACK`) |
| `governance_audits` | Automatic and human decisions with reasoning |
| `notifications`, `notification_preferences` | Per-member inbox and channel choices |
| `notification_endpoints`, `push_subscriptions` | Org Slack/webhook integrations (encrypted URLs and secrets) and members' browser push subscriptions |
| `notification_deliveries` | Outbox of email, push, Slack and webhook deliveries with attempts and errors |
| `service_operations` | Response contracts declared by each service's imported OpenAPI document |
| `promotion_policies` | Automatic promotion and rollback rules per org, service and consumer scope |
| `canary_metrics` | Evidence behind each automatic policy decision (live canary counters are in Redis) |

## Testing

```bash
pnpm build && pnpm test     # unit tests for every package, including the dashboard (Vitest)
pnpm test:nest              # Nest wiring, auth and CORS against disposable Postgres + Redis containers
pnpm test:integration       # full suite against disposable containers
pnpm test:e2e               # Playwright: dashboard + MFE shell + gateway in a real browser
```

The integration and e2e commands need Docker. The Gemini tests run only when `TEST_GEMINI_API_KEY` is exported (optionally `TEST_GEMINI_MODEL`); otherwise they are skipped.

The e2e test drives Google Chrome through three journeys:
- signed-out redirects;
- a new user's onboarding (organization, service, consumer key that works through the gateway);
- an invited owner joining the seeded Demo Organization, where drift crashes the profile card, a canary request heals it, the notification bell lights up live, the Policies page shows the seeded policy gathering evidence, the patch is previewed and promoted, and the audit records the reviewer.

Stop `pnpm dev` first, since it uses the same ports.

The integration suite covers tenant isolation (non-members get 404, keys can't cross organizations), every key check, roles and invitations, per-consumer contracts with pinning, revocation and restart recovery. A notifications suite covers:
- invitation email;
- role-based inbox fan-out and preferences;
- signed webhooks verified by a local receiver;
- encrypted, VAPID-signed web push to a local HTTPS push service, with pruning of gone subscriptions;
- outbox retry and redelivery.

An OpenAPI suite covers:
- import from a URL (YAML) and inline JSON;
- rejection of invalid documents;
- first-response drift for consumers starting from the spec;
- comparison with learned contracts, and adoption as a new contract version.

A policies suite covers:
- scoping (most specific wins), validation and roles;
- automatic promotion and rollback through the audited paths;
- evidence snapshots;
- the Redis lock, which lets exactly one of two concurrent evaluators run.

Integration and e2e tests always start their own throwaway containers and never touch the Supabase or Upstash databases in `.env`. Auth tests sign tokens with a locally generated key served from a local JWKS endpoint.

## License

This project is submitted as part of a Final Year Project (FYP) for academic evaluation.
