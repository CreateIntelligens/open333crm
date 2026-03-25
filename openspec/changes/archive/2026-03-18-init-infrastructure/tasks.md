## 1. Monorepo Initialization

- [x] 1.1 Initialize `pnpm` workspace with `packages` and `apps` directories
- [x] 1.2 Configure `pnpm-workspace.yaml` and root `package.json`
- [x] 1.3 Initialize `turbo.json` for task orchestration (build, lint, dev)

## 2. Infrastructure Setup

- [x] 2.1 Create `docker-compose.yml` with PostgreSQL (pgvector), Redis, and MinIO
- [x] 2.2 Create `Caddyfile` for reverse proxy and SSL
- [x] 2.3 Verify local services start correctly with `docker compose up -d`

## 3. Database Layer

- [x] 3.1 Create `packages/database` package
- [x] 3.2 Initialize Prisma schema with core entities (Contact, Conversation, Message, Case, Tag)
- [x] 3.3 Configure root command to run prisma migrations across the workspace

## 4. Automation & Rule Engine (Core)

- [x] 4.1 Implement/Integrate a JSON-based rule engine (e.g., `json-rules-engine`)
- [x] 4.2 Define the Fact schema for common CRM events (Message, Contact, Case)
- [x] 4.3 Create a utility to map `AutomationRule` JSON to the engine's format

## 5. Frontend & Backend Skeletons

- [x] 5.1 Create `apps/api` using Fastify skeleton
- [x] 5.2 Create `apps/web` using Next.js App Router skeleton
- [x] 5.3 Setup Tailwind CSS and `shadcn/ui` in `apps/web`
- [x] 5.4 Configure environment variables (`.env.example`)

## 6. CI Pipeline

- [x] 6.1 Create GitHub Actions workflow for automated linting and building
