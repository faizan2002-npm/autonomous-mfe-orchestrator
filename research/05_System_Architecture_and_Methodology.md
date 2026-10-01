# Chapter 5: System Architecture and Methodology

This chapter provides a comprehensive view of the system's architecture, technology stack, internal module design, inter-module communication patterns, and the software development methodology used to build the system.

## 5.1 Architectural Overview

The Autonomous Micro-Frontend Orchestrator follows a **layered, event-driven architecture** with four distinct tiers:

```mermaid
graph TB
    subgraph Tier1 [Tier 1: Infrastructure Layer]
        Docker[Docker Compose]
        PG[(PostgreSQL 15)]
        Redis[(Redis Cache)]
    end

    subgraph Tier2 [Tier 2: Backend Microservices - Simulated]
        US[User Service - Fastify :3001]
        OS[Order Service - Fastify :3002]
    end

    subgraph Tier3 [Tier 3: Agentic Control Plane]
        GW[API Gateway / Reverse Proxy :4000]
        OE[Observation Engine]
        CRE[Cognitive Reasoning Engine]
        EDE[Execution and Deployment Engine]
        VFS[Virtual File System]
    end

    subgraph Tier4 [Tier 4: Presentation Layer]
        MFE[Micro-Frontend Shell - React :5000]
        MFE1[User Dashboard MFE :5001]
        MFE2[Order History MFE :5002]
        DASH[Governance Dashboard - Next.js :6000]
    end

    Docker --> PG
    Docker --> Redis
    Docker --> US
    Docker --> OS
    Docker --> GW
    Docker --> MFE
    Docker --> DASH

    US -->|REST API| GW
    OS -->|REST API| GW
    GW --> OE
    OE -->|Normal| MFE
    OE -->|Drift Event| CRE
    CRE <-->|Read/Write| PG
    CRE -->|Generate| VFS
    VFS -->|Module Federation| EDE
    EDE -->|Hot Inject| MFE
    EDE -->|Canary Metrics| Redis
    MFE --> MFE1
    MFE --> MFE2
    DASH <-->|REST API| GW
    DASH <-->|Read| PG
```

## 5.2 Technology Stack (Detailed)

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend Shell** | React.js | 18.x | Micro-frontend host application |
| **Micro-Frontends** | React.js | 18.x | Independently deployable UI fragments |
| **Module Federation** | Webpack 5 | 5.x | Dynamic remote module loading for runtime patch injection |
| **Governance Dashboard** | Next.js | 14.x | Admin interface with SSR for fast initial load |
| **API Gateway** | NestJS (Fastify Engine) | 10.x / 4.x | Enterprise modular IoC/DI architecture + ultra-high performance reverse proxy |
| **Agentic AI** | LangChain.js / ReAct | 0.2.x | ReAct agent orchestration with tool calling |
| **LLM Provider** | Local (Ollama) + Llama 3/CodeLlama | latest | Code generation and schema reasoning (Zero cost, high privacy) |
| **LLM Provider (Alt)** | Local (Ollama) + DeepSeek Coder | latest | Fallback local model |
| **Database** | Supabase (PostgreSQL 15) | 15.x | Managed PostgreSQL with connection pooling & real-time telemetry events |
| **Cache** | Redis | 7.x | Contract cache, canary metrics, real-time counters |
| **ORM / Query Builder** | Drizzle ORM | 0.30.x | Ultra-lightweight type-safe SQL query builder (Zero-overhead, raw SQL latency) |
| **Migration Tool** | Drizzle Kit | 0.21.x | Isolated per-schema SQL migrations |
| **Syntax Validation** | esprima / @babel/parser | latest | AST parsing for generated code validation |
| **Containerization** | Docker + Docker Compose | 24.x / 2.x | Cross-platform deployment, service orchestration |
| **Package Manager** | pnpm (Workspaces) | 9.x | Strict dependency isolation, hard-linked store, monorepo workspace orchestration |
| **Language** | TypeScript | 5.x | Type safety across all modules |
| **Runtime** | Node.js | 20.x LTS | Server-side JavaScript runtime |

## 5.3 Module Decomposition

### 5.3.1 Module 1: Observation Engine

**Purpose:** Transparent middleware that intercepts, inspects, and classifies API traffic.

```mermaid
graph LR
    subgraph ObservationEngine [Observation Engine]
        PROXY[Reverse Proxy Layer]
        PARSER[Schema Parser]
        CACHE[Contract Cache]
        COMPARATOR[Jaccard Comparator]
        CLASSIFIER[Drift Classifier]
        LOGGER[Event Logger]
    end

    API_RESP[API Response] --> PROXY
    PROXY --> PARSER
    PARSER --> COMPARATOR
    CACHE --> COMPARATOR
    COMPARATOR -->|Dc greater than threshold| CLASSIFIER
    COMPARATOR -->|Dc less than threshold| PASSTHROUGH[Passthrough to MFE]
    CLASSIFIER --> LOGGER
    LOGGER -->|Write| DB[(PostgreSQL)]
    LOGGER -->|Emit| EVENT[Drift Event Bus]
```

**Internal Components:**

| Component | Responsibility | Technology |
|---|---|---|
| Reverse Proxy Layer | Intercepts HTTP traffic between frontend and backend | `@fastify/http-proxy` on Fastify |
| Schema Parser | Extracts and flattens JSON structure from API response bodies | Custom JSON traversal utility |
| Contract Cache | Holds the latest `API_CONTRACTS` in-memory for fast comparison | Redis (LRU eviction, 60s TTL refresh) |
| Jaccard Comparator | Computes $D_c$ between cached and observed schemas | Custom implementation (see Chapter 4, Section 4.3) |
| Drift Classifier | Categorizes drift type: `FIELD_RENAMED`, `FIELD_DELETED`, `TYPE_CHANGED`, etc. | Rule-based classification engine |
| Event Logger | Persists `DRIFT_EVENTS` to PostgreSQL and emits to internal event bus | Prisma ORM + Node.js EventEmitter |

**Key Algorithm — Schema Flattening:**

```typescript
function flattenSchema(obj: any, prefix: string = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenSchema(value, path).forEach(k => keys.add(k));
    } else {
      keys.add(`${path}:${typeof value}`);
    }
  }
  return keys;
}
```

### 5.3.2 Module 2: Cognitive Reasoning Engine

**Purpose:** LLM-powered agent that reasons about schema drift and generates adapter code.

```mermaid
graph TD
    subgraph LangChainAgent [LangChain Agent]
        INPUT[Drift Event Input]
        PROMPT[Prompt Construction]
        REASON[ReAct Reasoning Loop]
        TOOLS[Tool Invocations]
        VALIDATE[Syntax Validator]
        OUTPUT[Patch Output]
    end

    INPUT --> PROMPT
    PROMPT --> REASON
    REASON --> TOOLS
    TOOLS -->|schema_diff tool| DIFF[Schema Diff Analysis]
    TOOLS -->|code_gen tool| GEN[Adapter Code Generation]
    TOOLS -->|validate tool| VALIDATE
    VALIDATE -->|Pass| OUTPUT
    VALIDATE -->|Fail and attempt less than 3| REASON
    VALIDATE -->|Fail and attempt equals 3| ESCALATE[Escalate to Human]
```

**LangChain Agent Configuration:**

| Parameter | Value | Rationale |
|---|---|---|
| Agent Type | ReAct (Reasoning + Acting) | Enables multi-step reasoning with tool use |
| LLM Backend | Local Ollama (Llama 3 / CodeLlama) | Zero-cost, privacy-first local inference with high code accuracy |
| Temperature | 0.2 | Low creativity, high precision for code |
| Max Tokens | 2048 | Sufficient for adapter functions |
| Retry Strategy | Up to 3 attempts with error feedback | Iterative refinement on failure |
| Memory | ConversationBufferMemory (per-session) | Context within a single drift resolution |

**Agent Tools:**

| Tool Name | Input | Output | Purpose |
|---|---|---|---|
| `schema_diff` | Old schema JSON, New schema JSON | Structured diff object | Analyze exactly which fields changed and how |
| `generate_adapter` | Diff object, endpoint path | JavaScript function string | Generate the data transformation adapter |
| `validate_syntax` | JavaScript code string | `{ valid: boolean, errors: string[] }` | Parse with esprima to check syntax |
| `explain_change` | Diff object | Human-readable explanation | Generate reasoning trace for dashboard |

**Prompt Template:**

```
SYSTEM: You are a senior JavaScript/TypeScript engineer specializing in API
contract migration. Your task is to generate data adapter functions that
transform API response payloads from a NEW schema back to an EXPECTED schema.

Rules:
1. Output ONLY a single ES6 arrow function: (data) => ({ ... })
2. Handle null/undefined values gracefully with ?? operator
3. Preserve all fields that have not changed using spread operator
4. Do NOT import any external packages
5. Do NOT make any network requests
6. The function must be pure (no side effects)
7. Handle nested objects recursively
8. Handle arrays with .map() when element schema changes

CONTEXT:
- Endpoint: {endpoint_path}
- Expected Schema: {old_schema}
- Received Schema: {new_schema}
- Detected Changes: {diff_details}

Generate the adapter function:
```

### 5.3.3 Module 3: Execution and Deployment Engine

**Purpose:** Manages the lifecycle of generated patches — from virtual file system storage to canary deployment to promotion/rollback.

```mermaid
stateDiagram-v2
    [*] --> PatchReceived
    PatchReceived --> WrittenToVFS : Write adapter.js
    WrittenToVFS --> ModuleFederationExposed : Expose as remote module
    ModuleFederationExposed --> CanaryActive : Route 10% traffic
    CanaryActive --> Monitoring : Observe for 60s
    Monitoring --> Promoted : Error rate OK
    Monitoring --> RolledBack : Error rate exceeded
    Promoted --> [*]
    RolledBack --> [*]
```

**Webpack Module Federation Configuration (Host Shell):**

```javascript
// webpack.config.js (Micro-Frontend Shell - Host)
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'shell',
      remotes: {
        userDashboard: 'userDashboard@http://localhost:5001/remoteEntry.js',
        orderHistory: 'orderHistory@http://localhost:5002/remoteEntry.js',
        // Dynamically added by the Execution Engine:
        patchAdapter: `promise new Promise(resolve => {
          const remoteUrl = window.__PATCH_ADAPTER_URL__ || 'http://localhost:4000/patches/latest/remoteEntry.js';
          const script = document.createElement('script');
          script.src = remoteUrl;
          script.onload = () => resolve(window.patchAdapter);
          document.head.appendChild(script);
        })`
      },
      shared: ['react', 'react-dom'],
    }),
  ],
};
```

**Canary Routing Logic:**

```typescript
class CanaryRouter {
  private canaryPercentage: number;  // default: 10
  private patchAdapter: Function | null;

  routeRequest(apiResponse: any, endpoint: string): any {
    const isCanary = Math.random() * 100 < this.canaryPercentage;

    if (isCanary && this.patchAdapter) {
      try {
        const adapted = this.patchAdapter(apiResponse);
        this.recordMetric(endpoint, 'canary', null);
        return adapted;
      } catch (error) {
        this.recordMetric(endpoint, 'canary', error);
        return apiResponse; // Fallback to original on error
      }
    }

    return apiResponse; // Baseline cohort
  }
}
```

### 5.3.4 Module 4: Governance Dashboard

**Purpose:** Real-time administrative interface for monitoring, controlling, and auditing the autonomous system.

**Dashboard Pages:**

| Page | URL Path | Key Features |
|---|---|---|
| **Overview** | `/dashboard` | System health summary, active drifts count, patches deployed, uptime |
| **Drift Events** | `/dashboard/drifts` | Filterable/sortable table of all drift events; status badges; severity indicators |
| **Drift Detail** | `/dashboard/drifts/:id` | Side-by-side schema diff; AI reasoning trace; generated code with syntax highlighting |
| **Patches** | `/dashboard/patches` | All generated patches; confidence scores; deployment status; approve/reject/rollback buttons |
| **Canary Monitor** | `/dashboard/canary` | Real-time canary metrics; error rate charts; latency comparison graphs |
| **Services** | `/dashboard/services` | Registered microservices; OpenAPI spec sync status; contract count |
| **Configuration** | `/dashboard/config` | System thresholds (drift, confidence, canary %); LLM settings |
| **Audit Log** | `/dashboard/audit` | Complete governance log with actor, action, timestamp, and reason |
| **Login** | `/dashboard/login` | Authentication (email + password, bcrypt, JWT sessions) |

**Dashboard API Endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard/stats` | Aggregate statistics (total drifts, patches, success rate) |
| `GET` | `/api/dashboard/drifts` | List drift events with pagination, filtering, sorting |
| `GET` | `/api/dashboard/drifts/:id` | Drift event detail with schema diff |
| `GET` | `/api/dashboard/patches` | List all patches |
| `POST` | `/api/dashboard/patches/:id/approve` | Manually approve a pending patch |
| `POST` | `/api/dashboard/patches/:id/reject` | Manually reject a pending patch |
| `POST` | `/api/dashboard/patches/:id/rollback` | Manually rollback a promoted patch |
| `GET` | `/api/dashboard/canary/:patchId` | Canary metrics for a specific patch |
| `GET` | `/api/dashboard/services` | List registered microservices |
| `POST` | `/api/dashboard/services` | Register a new microservice |
| `GET` | `/api/dashboard/config` | Get system configuration |
| `PUT` | `/api/dashboard/config/:key` | Update a configuration value |
| `GET` | `/api/dashboard/audit` | Governance audit log |
| `POST` | `/api/auth/login` | Authenticate and receive JWT |
| `POST` | `/api/auth/logout` | Invalidate JWT |

## 5.4 Inter-Module Communication

```mermaid
sequenceDiagram
    participant FE as Micro-Frontend Shell
    participant GW as API Gateway :4000
    participant BE as Backend Service :3001
    participant OE as Observation Engine
    participant DB as PostgreSQL
    participant RD as Redis
    participant AI as LangChain Agent
    participant VFS as Virtual File System
    participant WMF as Module Federation
    participant DASH as Dashboard :6000

    FE->>GW: GET /api/v1/users/123
    GW->>BE: Forward request
    BE->>GW: 200 OK (JSON response)

    GW->>OE: Intercept response
    OE->>RD: Fetch cached contract for /api/v1/users
    RD-->>OE: Cached schema

    OE->>OE: Flatten + Jaccard comparison
    alt No Drift (Dc < 0.05)
        OE->>FE: Forward original response
    else Drift Detected (Dc >= 0.05)
        OE->>DB: INSERT DRIFT_EVENT
        OE->>AI: Invoke with old_schema + new_payload + diff

        AI->>AI: ReAct reasoning loop
        AI->>AI: Generate adapter function
        AI->>AI: Validate syntax (esprima)

        alt Compilation Success
            AI->>DB: INSERT AUTONOMOUS_PATCH (confidence: 0.89)
            AI->>VFS: Write adapter.js
            VFS->>WMF: Expose as federated module
            WMF->>FE: Hot-inject adapter

            loop Canary Window (60s)
                FE->>GW: API requests
                GW->>OE: Route 10% through adapter
                OE->>RD: Record canary metrics
            end

            OE->>RD: Read canary metrics
            alt Canary Pass
                OE->>FE: Promote to 100% traffic
                OE->>DB: UPDATE DRIFT_EVENT status=FIXED
                OE->>DB: INSERT GOVERNANCE_LOG (AUTO_APPROVE)
                OE->>DASH: Push notification
            else Canary Fail
                OE->>FE: Rollback adapter
                OE->>DB: UPDATE PATCH deployment_status=ROLLED_BACK
                OE->>DB: INSERT GOVERNANCE_LOG (AUTO_ROLLBACK)
                OE->>DASH: Alert notification
            end

        else Compilation Failed (3 retries exhausted)
            AI->>DB: INSERT AUTONOMOUS_PATCH (syntax_valid: false)
            AI->>DASH: Flag for human review
        end
    end
```

## 5.5 Deployment Architecture

```yaml
# docker-compose.yml
version: '3.9'

services:
  # --- Infrastructure ---
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: orchestrator
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  # --- Simulated Backend Microservices ---
  user-service:
    build: ./services/user-service
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://admin:${DB_PASSWORD}@postgres:5432/orchestrator

  order-service:
    build: ./services/order-service
    ports:
      - "3002:3002"
    environment:
      DATABASE_URL: postgresql://admin:${DB_PASSWORD}@postgres:5432/orchestrator

  # --- Agentic Control Plane ---
  api-gateway:
    build: ./gateway
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: postgresql://admin:${DB_PASSWORD}@postgres:5432/orchestrator
      REDIS_URL: redis://redis:6379
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      LLM_MODEL: llama3
      USER_SERVICE_URL: http://user-service:3001
      ORDER_SERVICE_URL: http://order-service:3002
    depends_on:
      - postgres
      - redis
      - user-service
      - order-service

  # --- Micro-Frontend Shell ---
  mfe-shell:
    build: ./frontend/shell
    ports:
      - "5000:5000"
    environment:
      API_GATEWAY_URL: http://api-gateway:4000

  user-dashboard-mfe:
    build: ./frontend/user-dashboard
    ports:
      - "5001:5001"

  order-history-mfe:
    build: ./frontend/order-history
    ports:
      - "5002:5002"

  # --- Governance Dashboard ---
  dashboard:
    build: ./dashboard
    ports:
      - "6000:6000"
    environment:
      DATABASE_URL: postgresql://admin:${DB_PASSWORD}@postgres:5432/orchestrator
      API_GATEWAY_URL: http://api-gateway:4000
    depends_on:
      - postgres
      - api-gateway

volumes:
  pgdata:
```

## 5.6 Project Directory Structure

```
autonomous-mfe-orchestrator/
├── docker-compose.yml
├── .env.example
├── README.md
│
├── services/                          # Simulated Backend Microservices
│   ├── user-service/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts               # Fastify server
│   │   │   ├── routes/
│   │   │   │   └── users.ts           # User CRUD endpoints
│   │   │   └── openapi.yaml           # OpenAPI 3.0 spec
│   │   └── tsconfig.json
│   │
│   └── order-service/
│       ├── Dockerfile
│       ├── package.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   │   └── orders.ts
│       │   └── openapi.yaml
│       └── tsconfig.json
│
├── gateway/                           # Agentic Control Plane
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma              # Database schema
│   ├── src/
│   │   ├── index.ts                   # Fastify server + proxy setup
│   │   ├── modules/
│   │   │   ├── observation/
│   │   │   │   ├── proxy.ts           # Reverse proxy middleware
│   │   │   │   ├── schemaParser.ts    # JSON schema flattener
│   │   │   │   ├── contractCache.ts   # Redis-backed contract cache
│   │   │   │   ├── jaccardComparator.ts  # Drift coefficient calculator
│   │   │   │   ├── driftClassifier.ts # Drift type classification
│   │   │   │   └── eventLogger.ts     # DB persistence + event emission
│   │   │   │
│   │   │   ├── reasoning/
│   │   │   │   ├── agent.ts           # LangChain ReAct agent setup
│   │   │   │   ├── tools/
│   │   │   │   │   ├── schemaDiff.ts  # Schema diff tool
│   │   │   │   │   ├── generateAdapter.ts  # Code generation tool
│   │   │   │   │   ├── validateSyntax.ts   # esprima validation tool
│   │   │   │   │   └── explainChange.ts    # Human-readable explanation tool
│   │   │   │   ├── prompts.ts         # Prompt templates
│   │   │   │   └── retryHandler.ts    # 3-attempt retry with feedback
│   │   │   │
│   │   │   ├── execution/
│   │   │   │   ├── virtualFS.ts       # In-memory file system for patches
│   │   │   │   ├── moduleFederation.ts  # Dynamic remote module exposure
│   │   │   │   ├── canaryRouter.ts    # Traffic splitting logic
│   │   │   │   └── canaryMonitor.ts   # Error rate tracking + promotion/rollback
│   │   │   │
│   │   │   └── governance/
│   │   │       ├── dashboardApi.ts    # REST API for dashboard
│   │   │       ├── authController.ts  # JWT authentication
│   │   │       └── configManager.ts   # Runtime config management
│   │   │
│   │   ├── lib/
│   │   │   ├── logger.ts             # Structured JSON logging
│   │   │   ├── redis.ts              # Redis client singleton
│   │   │   └── prisma.ts             # Prisma client singleton
│   │   │
│   │   └── types/
│   │       └── index.ts              # Shared TypeScript interfaces
│   │
│   └── tsconfig.json
│
├── frontend/                          # Micro-Frontend Applications
│   ├── shell/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── webpack.config.js          # Module Federation host config
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── bootstrap.tsx
│   │   │   └── components/
│   │   └── tsconfig.json
│   │
│   ├── user-dashboard/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── webpack.config.js          # Module Federation remote config
│   │   └── src/
│   │       ├── UserDashboard.tsx
│   │       └── components/
│   │
│   └── order-history/
│       ├── Dockerfile
│       ├── package.json
│       ├── webpack.config.js
│       └── src/
│           ├── OrderHistory.tsx
│           └── components/
│
├── dashboard/                         # Governance Dashboard (Next.js)
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Overview page
│   │   │   ├── drifts/
│   │   │   │   ├── page.tsx           # Drift events list
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx       # Drift detail + schema diff
│   │   │   ├── patches/
│   │   │   │   └── page.tsx           # Patches list + actions
│   │   │   ├── canary/
│   │   │   │   └── page.tsx           # Canary metrics
│   │   │   ├── services/
│   │   │   │   └── page.tsx           # Microservice registry
│   │   │   ├── config/
│   │   │   │   └── page.tsx           # System configuration
│   │   │   ├── audit/
│   │   │   │   └── page.tsx           # Governance audit log
│   │   │   └── login/
│   │   │       └── page.tsx           # Authentication
│   │   ├── components/
│   │   │   ├── SchemaDiffViewer.tsx
│   │   │   ├── CodeViewer.tsx
│   │   │   ├── CanaryChart.tsx
│   │   │   └── StatusBadge.tsx
│   │   └── lib/
│   │       └── api.ts                 # API client for gateway
│   └── tsconfig.json
│
└── docs/                              # Project Documentation
    ├── 01_Academic_Abstract.md
    ├── 02_System_Requirements.md
    ├── 03_Database_Schema.md
    ├── 04_Mathematical_Base.md
    ├── 05_Architecture.md
    ├── 06_Literature_Review.md
    ├── 07_Detailed_Design.md
    ├── 08_Testing_Strategy.md
    └── 09_Timeline_and_Risks.md
```

## 5.7 Software Development Methodology

The project follows an **Agile-Iterative** approach with 2-week sprints:

### 5.7.1 Development Phases

```mermaid
gantt
    title Development Phases
    dateFormat YYYY-MM-DD
    section Phase 1 - Foundation
    Infrastructure Setup (Docker, DB)     :p1, 2026-10-01, 14d
    Simulated Backend Services            :p2, after p1, 7d
    section Phase 2 - Core Engine
    Observation Engine                    :p3, after p2, 14d
    Cognitive Reasoning Engine            :p4, after p3, 21d
    section Phase 3 - Deployment
    Execution and Deployment Engine       :p5, after p4, 14d
    Module Federation Integration         :p6, after p5, 7d
    section Phase 4 - Dashboard
    Governance Dashboard                  :p7, after p6, 14d
    section Phase 5 - Testing and Polish
    Integration Testing                   :p8, after p7, 14d
    Evaluation and Metrics                :p9, after p8, 7d
    Documentation and Thesis              :p10, after p9, 14d
```

### 5.7.2 SDLC Model Justification

| Consideration | Why Agile-Iterative |
|---|---|
| **Uncertainty** | LLM code generation quality is uncertain; iterative testing reveals edge cases early |
| **Integration Complexity** | Modules must be tested together frequently (observation + reasoning + deployment) |
| **Feedback Loops** | Canary routing logic requires empirical tuning, not upfront specification |
| **Academic Timeline** | Fixed deadline requires working software at each phase boundary |

## 5.8 Security Architecture

| Threat | Mitigation |
|---|---|
| AI-generated XSS payloads | Code executed in `vm2` sandbox; AST analysis blocks `eval()`, `Function()`, DOM manipulation |
| Unauthorized dashboard access | JWT authentication with bcrypt password hashing; RBAC roles |
| LLM prompt injection via API payload | Payload is serialized to JSON string in prompt; not interpolated as instruction |
| Man-in-the-middle on internal traffic | Docker internal networking; no traffic leaves the compose network |
| Database injection | Prisma parameterized queries; no raw SQL |
