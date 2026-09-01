# AGENTS.md — Open333CRM

Omnichannel CRM monorepo. TypeScript end-to-end.

> **This file is the single source of truth for AI coding agents.**
> `.claude/CLAUDE.md`, `.github/copilot-instructions.md` and `.agent/instructions.md` are small,
> tool-specific supplements. Each one refers to this file. Do **not** copy project facts into them.
> Two copies of one fact diverge, and then the two files contradict each other.
> Put project-wide rules in this file only.

## Quick Commands

```bash
pnpm install                        # install deps
pnpm dev                            # turbo dev (api + web + workers)
pnpm --filter @open333crm/api dev   # API only (port 3001, tsx watch)
pnpm --filter @open333crm/web dev   # Web only (port 3000, needs sync:widget first)
pnpm build                          # turbo build (set SKIP_ENV_VALIDATION=true in CI)
pnpm lint                           # turbo lint (ESLint 9 flat config) — NOT enforced in CI yet
pnpm db:generate                    # prisma generate
pnpm db:migrate -- --name <name>    # create migration
pnpm db:seed                        # seed database
```

**Run a single API test**: `pnpm --filter @open333crm/api test:case` or `tsx apps/api/src/__tests__/smoke.test.ts`
Tests use vitest imports but run via `tsx` directly. No vitest config file exists.
`apps/api/package.json` contains the other test scripts (`test:broadcast`, `test:erasure`, `test:data-export`, …).

## Tech Stack (Verified)

| Layer    | Tech                                 | Location            |
| -------- | ------------------------------------ | ------------------- |
| API      | Fastify 5 + TypeScript (ESM)         | `apps/api`          |
| Frontend | **Next.js 15** + React 19 + Tailwind | `apps/web`          |
| Workers  | BullMQ consumers (separate process)  | `apps/workers`      |
| CLI      | oclif (`open333` npm package)        | `apps/cli`          |
| Database | PostgreSQL 16 + Prisma 6             | `packages/database` |
| Queue    | Redis + BullMQ                       | `apps/workers`      |
| Realtime | Socket.IO (on Fastify)               | `apps/api`          |

## Multi-Tenancy: Two Enforcement Layers (Critical)

**Two layers enforce tenant isolation. You must satisfy both.**

**Layer 1, application**: every query against a tenant table must include `tenantId` in `where`.
**Layer 2, Postgres RLS**: 71 of 78 tables have `ENABLE` and `FORCE ROW LEVEL SECURITY`.
Their `tenant_isolation` policy reads the session variable `app.current_tenant`. The 7 tables
without RLS are the platform-layer tables (`tenants`, `plans`, `platform_users`, `platform_audit_logs`,
`platform_settings`, `model_pricings`, `trial_signups`).

### Which Prisma client to use

| Client | Connection | When |
| ------ | ---------- | ---- |
| `fastify.prisma` | `app_tenant`, RLS enforced | default for tenant-scoped work |
| `request.tenantPrisma` | `app_tenant`, bound to `request.agent.tenantId` | inside authenticated request handlers. Throws when unauthenticated |
| `withTenant(prisma, tenantId, fn)` | runs `fn` in a transaction with `app.current_tenant` set | background jobs and any path needing an explicit tenant |
| `fastify.prismaAdmin` | `app_admin`, **BYPASSRLS** | whitelist only: platform console, auth, schedulers, OAuth callbacks, public webhooks |

`withTenant` sets the session variable with `SET LOCAL` inside the transaction. The variable
therefore cannot leak to the next request on a pooled connection. Queries inside `fn` **must** use
the `tx` that `withTenant` passes in. An outer client uses a different connection. On that
connection the variable is unset, so RLS returns no rows (fail-closed).

The `postgres-rls-tenant-isolation` skill (`.claude/skills/`) contains the wiring rules, the steps
to add a table, and the troubleshooting guide. Do not restate them here.

### CI gates that fail the build

Both run with `--strict` in `.github/workflows/ci.yml` and fail the build:

| Script | Rejects |
| ------ | ------- |
| `scripts/check-tenant-scoping.mjs` | a query on a tenant table with no `tenantId` reachable in scope |
| `scripts/check-prisma-admin-usage.mjs` | `prismaAdmin` used from a file outside the whitelist |

Run them locally without `--strict` to get a report instead of a failure.

## Architecture: Socket Event Routing (Critical)

Two paths — pick the right one:

**Path A — Direct emit** (API process, inline):

```ts
fastify.io.to(room).emit(event, data);
```

Use when: event is the direct result of the current HTTP request, data already in DB, room is known, no extra queries needed.

**Path B — Async queue** (eventBus → BullMQ → workers → Redis pub/sub):

```ts
eventBus.publish("case.assigned", { tenantId, payload }); // API process
// → notificationQueue.add(job)  // BullMQ
// → apps/workers consume → publishSocketEvent(redis, room, event, data)
```

Use when: recipients need DB lookup, side-effect that shouldn't block response, background job origin.

**Workers are a separate process** — they CANNOT access `fastify.io`. Emit via Redis pub/sub:

```ts
await redisPublisher.publish(
  "socket:emit",
  JSON.stringify({ room, event, data }),
);
```

`eventBus` (`apps/api/src/events/event-bus.ts`) is an in-process EventEmitter only — no Redis connection.

## Prisma Rules

- Schema: `packages/database/prisma/schema.prisma`
- In application code, get the client from Fastify (`fastify.prisma`, `request.tenantPrisma`,
  `fastify.prismaAdmin`). See the table above. Do **not** construct your own `PrismaClient`,
  because a client you construct yourself bypasses the RLS wiring. Four files construct one
  legitimately: `packages/database/src/client.ts`, `apps/api/src/plugins/prisma.plugin.ts`,
  `apps/api/src/lib/tenant-db.ts` and `apps/workers/src/index.ts`.
- `@open333crm/database` re-exports everything from `@prisma/client` (`export * from '@prisma/client'`),
  so prefer importing types and enums from `@open333crm/database` to keep one import surface.
- Prefer string literals over enum imports for `where` filters. Most of the codebase uses string
  literals:

  ```ts
  role: { in: ['ADMIN', 'SUPERVISOR'] }
  ```

  Importing the generated enum is *not* an error, despite what older versions of this file claimed.
  `packages/database/prisma/seed.ts` and `apps/api/src/modules/platform/platform.routes.ts` both
  import enums and typecheck cleanly.

## Conventions

- **CHANGELOG Maintenance (MANDATORY)**: Whenever implementing a feature (`feat`), bug fix (`fix`), architecture change, or completing an OpenSpec change/PR, you **MUST update `CHANGELOG.md`** under the latest release section (categorized into `Added`, `Changed`, `Fixed`, etc.). Never submit code changes without keeping `CHANGELOG.md` updated.
- **Validation**: Zod in API route handlers
- **Errors**: `throw new AppError(code, message, httpStatus)` (`apps/api/src/shared/utils/response.ts`) — no raw error returns
- **Multi-tenancy**: see the two-layer section above — both layers are mandatory
- **Soft-delete**: `isActive: false`, not hard DELETE (agents, channels, etc.)
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- **RBAC**: `ADMIN` > `SUPERVISOR` > `AGENT` — guards in `apps/api/src/guards/rbac.guard.ts`
- **ESM**: all packages have `"type": "module"`

## Environment Gotchas

- **Docker Compose reads `.env.api` / `.env.web` / `.env.workers`** from the repo root. Copy each one
  from the matching `.env.*.example`. `docker-compose.dev.yml` and `docker-compose.yml` load these
  three files.
- **Running the API directly on the host** (`pnpm --filter @open333crm/api dev`, no Docker) loads a
  root `.env` instead. `apps/api/src/index.ts` resolves that path 3 levels up. The API does **not**
  read `apps/api/.env`. That file is only a template.
- **Docker ports differ from defaults**: PostgreSQL → **5433** (not 5432), Redis → **6380** (not 6379)
- **Next.js compiles `NEXT_PUBLIC_*` values into the browser bundle.** Never set such a value to a
  Compose service name such as `api:3001`. The browser cannot resolve a Compose service name.
  Use `http://localhost:3001/api` locally.
- **`PLATFORM_JWT_SECRET` enables the platform control plane (`/admin/*`).** Without that variable,
  `/api/v1/platform/auth/login` returns 503 `PLATFORM_DISABLED`.
- **Web dev requires pre-sync**: `pnpm --filter @open333crm/web dev` runs `sync:widget` and `sync:playcaptcha` automatically via its `dev` script
- **CI build needs**: `SKIP_ENV_VALIDATION=true` env var
- **Docker on macOS**: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`

## Monorepo Layout

```text
apps/
  api/          # Fastify backend — entry: src/index.ts
  web/          # Next.js frontend — entry: src/app/page.tsx
  workers/      # BullMQ consumers — entry: src/index.ts
  video-worker/ # Video processing worker (separate process)
  cli/          # oclif CLI (npm: open333)
  widget/       # Embeddable webchat widget
packages/
  database/   # Prisma schema, migrations, seed
  shared/     # Shared types and utilities
  core/       # Shared utilities
  types/      # TypeScript type definitions
  ui/         # React UI components (shadcn/ui)
  automation/ # Automation engine (json-rules-engine)
  brain/      # AI/LLM integration (Ollama)
  channel-plugins/ # LINE, Facebook, WebChat plugins
  kb-ingest/  # Knowledge base ingestion
```

## Database Docs

| You want | Read |
| -------- | ---- |
| Field definitions, types, constraints (source of truth) | `packages/database/prisma/schema.prisma` |
| Table relations and what each table stores | `docs/ref/DATABASE-ERD.md` |
| Why the schema is shaped this way, index strategy, known drift | `docs/16_DB_SCHEMA.md` |

## OpenSpec Workflow

Changes are tracked in `openspec/`. Use the OpenSpec skills for propose/apply/archive cycles. Archived changes: `openspec/changes/archive/`.
**CRITICAL**: When completing or archiving an OpenSpec change, always ensure that `CHANGELOG.md` is updated with all user-facing features, improvements, and fixes.

## Tool-Specific Files

These add only what is specific to one tool. Project-wide rules belong in this file.

| File | Scope |
| ---- | ----- |
| `.claude/CLAUDE.md` | Claude Code — skills and slash commands under `.claude/` |
| `.github/copilot-instructions.md` | GitHub Copilot — commit trailer, `.github/prompts/` |
| `.agent/instructions.md` | Generic agent runners — `.agent/workflows/` |
| `openspec/config.yaml` | OpenSpec context |
