# Autonomous Micro-Frontend Orchestrator

### An Agentic AI System for Real-Time API Contract Drift Detection, Cognitive Patch Generation, and Zero-Downtime Self-Healing in Decoupled Cloud-Native Architectures

---

## Table of Contents

| Chapter | Title | File |
|---|---|---|
| 1 | [Introduction (Abstract, Problem Statement, Objectives, Scope)](./research/01_Academic_Abstract_and_Problem_Statement.md) | `research/01_Academic_Abstract_and_Problem_Statement.md` |
| 2 | [System Requirements Specification](./research/02_System_Requirements_Specification.md) | `research/02_System_Requirements_Specification.md` |
| 3 | [Database Schema Design](./research/03_Database_Schema_Design.md) | `research/03_Database_Schema_Design.md` |
| 4 | [Formal Academic Core Mathematical Base](./research/04_Formal_Academic_Core_Mathematical_Base.md) | `research/04_Formal_Academic_Core_Mathematical_Base.md` |
| 5 | [System Architecture and Methodology](./research/05_System_Architecture_and_Methodology.md) | `research/05_System_Architecture_and_Methodology.md` |
| 6 | [Literature Review](./research/06_Literature_Review.md) | `research/06_Literature_Review.md` |
| 7 | [Detailed Design and Implementation](./research/07_Detailed_Design_and_Implementation.md) | `research/07_Detailed_Design_and_Implementation.md` |
| 8 | [Testing Strategy](./research/08_Testing_Strategy.md) | `research/08_Testing_Strategy.md` |
| 9 | [Project Timeline and Risk Analysis](./research/09_Project_Timeline_and_Risk_Analysis.md) | `research/09_Project_Timeline_and_Risk_Analysis.md` |
| 10 | [References](./research/10_References.md) | `research/10_References.md` |

---

## Quick Start (For Evaluators)

```bash
# 1. Clone the repository
git clone <repo-url>
cd autonomous-mfe-orchestrator

# 2. Copy environment variables
cp .env.example .env
# Edit .env and verify OLLAMA_BASE_URL (defaults to http://localhost:11434)

# 3. Install all dependencies across the monorepo
pnpm install

# 4. Start infrastructure with Docker Compose (PostgreSQL, Redis, Ollama)
docker compose up -d

# 5. Run database migrations via Drizzle Kit (Supabase / Postgres)
pnpm --filter @orchestrator/database run db:generate

# 6. Start development environment
pnpm dev

# System Endpoints:
# - Micro-Frontend Shell:              http://localhost:5000
# - API Gateway (NestJS + Fastify):    http://localhost:4000
# - Governance Dashboard:              http://localhost:6000
# - User Service (Backend):            http://localhost:3001
# - Order Service (Backend):           http://localhost:3002
```

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                                │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  Micro-Frontend Shell │    │  Governance Dashboard (Next.js)  │  │
│  │  (React + Module Fed) │    │  localhost:6000                   │  │
│  │  localhost:5000       │    │                                   │  │
│  └──────────┬───────────┘    └──────────────┬───────────────────┘  │
└─────────────┼───────────────────────────────┼─────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AGENTIC CONTROL PLANE (NestJS + Fastify)               │
│  ┌────────────────────────────────────────────────────────┐        │
│  │  NestJS Gateway — localhost:4000                        │        │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐ │        │
│  │  │ Observation   │ │ Cognitive    │ │ Canary Module  │ │        │
│  │  │ Module        │ │ Service      │ │ (Module Fed)   │ │        │
│  │  │ (Interceptor) │ │ (Ollama ReAct)│ │ (Traffic Route)│ │        │
│  │  └──────┬────────┘ └──────┬───────┘ └──────┬─────────┘ │        │
│  └─────────┼────────────────┼────────────────┼────────────┘        │
│            │                │                │                      │
│     ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐              │
│     │ Supabase PG  │  │ Redis      │  │ Virtual FS   │              │
│     │ (Drizzle ORM)│  │ (Cache)    │  │ (Patches)    │              │
│     └─────────────┘  └────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
              ▲                               ▲
              │                               │
┌─────────────┼───────────────────────────────┼─────────────────────┐
│             │   BACKEND MICROSERVICES       │                      │
│  ┌──────────┴──────────┐  ┌─────────────────┴──────────┐          │
│  │  User Service        │  │  Order Service              │          │
│  │  localhost:3001      │  │  localhost:3002              │          │
│  └─────────────────────┘  └────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

## License

This project is submitted as part of a Final Year Project (FYP) for academic evaluation.
