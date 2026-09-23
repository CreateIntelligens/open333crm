# AGENTS.md — Open333CRM

Omnichannel CRM monorepo. TypeScript end-to-end.

> **This file is the single source of truth for AI coding agents.**
> The files under [Tool-Specific Files](#tool-specific-files) are small, tool-specific supplements.
> Each one refers to this file. Do **not** copy project facts into them.
> Two copies of one fact diverge, and then the two files contradict each other.
> Put project-wide rules in this file only.

## Quick Commands

```bash
pnpm install                        # install deps
pnpm dev                            # turbo dev (api + web + workers)
pnpm --filter @open333crm/api dev   # API only (port 3001, tsx watch)
pnpm --filter @open333crm/web dev   # Web only (port 3000, needs sync:widget first)
pnpm build                          # turbo build
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

The `postgres-rls-tenant-isolation` skill (`.agents/skills/`) contains the wiring rules, the steps
to add a table, and the troubleshooting guide. Do not restate them here.

### CI gates

Two scripts check tenant isolation. With `--strict`, each script exits with code 1 when it finds a violation:

| Script | Rejects |
| ------ | ------- |
| `scripts/check-tenant-scoping.mjs` | a query on a tenant table with no `tenantId` reachable in scope |
| `scripts/check-prisma-admin-usage.mjs` | `prismaAdmin` used from a file outside the whitelist |

Run them without `--strict` to get a report instead of a failure.

> **No CI workflow runs these checks now.** `.github/workflows/ci.yml` ran both scripts with
> `--strict`, and also ran the RLS integration test `apps/api/src/__tests__/rls-isolation.test.ts`.
> Commit `4b384b7` deleted `ci.yml`. Commit `323deeb` restored only `deploy.yml`, which runs none
> of these checks. Until `ci.yml` is restored, run both scripts with `--strict` before you open a
> pull request.

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

## Module Structure

A module lives in `apps/api/src/modules/<name>/` and uses these file suffixes:

| Suffix | Role |
| ------ | ---- |
| `<name>.routes.ts` | HTTP boundary: Zod validation, guards, call a service, wrap the response |
| `<name>.service.ts` | Business logic and data access |
| `<name>.worker.ts`, `<name>.scheduler.ts` | Background work — see the Socket Event Routing section for which process runs them |

Five rules follow. Each one is the pattern the majority of this repo already uses.
Where a module does not follow a rule, that module is named under the rule.

### 1. A route handler does not query the database

A route handler validates input, checks permissions, calls a service, and returns.
Put the query in `<name>.service.ts`.

Five modules still hold inline `prisma.*` calls in their route files, listed here
from most to fewest: `auth`, `sla` (which has no service file at all), `channel`,
`portal`, `settings`.

### 2. A service receives its Prisma executor; it never imports one

Every exported service function takes the executor as its first parameter:

```ts
export async function listCases(prisma: TenantDb, tenantId: string, ...) { }
```

This is not a style preference. A service that reaches for a client itself picks
a connection the caller did not intend, and RLS then either leaks across tenants
or fails closed with no error. The "Prisma in shared packages" rule below is this
same rule applied to `packages/*`, where it has no exceptions.

### 3. One route file covers one resource

Split a route file when it passes roughly 15 routes, or as soon as it serves a
second resource — whichever comes first. `marketing` shows the target shape:
`marketing.routes.ts` and `material.routes.ts` over five services.

`platform/platform.routes.ts` is the module to learn from in both directions. Its
service layer is the best-decomposed in the repo: eleven services, one per concern,
and the route file holds almost no logic. Its route file is also the largest in the
repo by a wide margin, because it serves seven resources at once (tenants, plans,
platform users, usage, plan changes, trial, settings). Do not copy the route file.

### 4. Cross-module calls go through the other module's service

Import `../<other>/<other>.service.js`. Never import another module's `.routes.ts`.

Four imports today reach past the service layer: `ai/kb-autoreply.service.ts` imports
`automation/automation.worker.js`; `case/case.service.ts` and
`webhook/inbound-side-effects.ts` import `marketing/broadcast.tracking.js`; and
`webhook/inbound-side-effects.ts` imports `canvas/canvas.webhook.js`.

### 5. Channel differences go through the plugin registry

Resolve per-channel behaviour with `getChannelPlugin()`. Do not branch on
`channelType`. Adding a channel means registering a plugin in
`apps/api/src/index.ts`, not adding a branch.

### Scope

These rules govern new and modified code. They are not an instruction to refactor
the exceptions listed above. Fix one only when you are already changing that file
for another reason.

### Appendix: which SOLID principle each rule is

These are labels for the rules above. They are not an order to apply them, and no
rule depends on its principle name to be correct.

| Rule | Principle |
| ---- | --------- |
| 1, 3 | Single responsibility |
| 2 | Dependency inversion |
| 4 | Dependency inversion, interface segregation |
| 5 | Open-closed |

Liskov substitution has no rule of its own here. The closest thing in this codebase
is the contract every channel plugin implements, which rule 5 already covers.

## Conventions

- **CHANGELOG Maintenance (MANDATORY)**: Whenever implementing a feature (`feat`), bug fix (`fix`), architecture change, or completing an OpenSpec change/PR, you **MUST update `CHANGELOG.md`** under the latest release section (categorized into `Added`, `Changed`, `Fixed`, etc.). Never submit code changes without keeping `CHANGELOG.md` updated.
- **CHANGELOG Date Format (CRITICAL / MANDATORY)**: Every new or updated release section **MUST** use the date-only heading format `## [YYYY-MM-DD]`. **Never create or restore `## [Unreleased]`**. Keep existing historical version headings unchanged unless the user explicitly requests a history rewrite.
- **Validation**: Zod in API route handlers
- **Errors**: `throw new AppError(code, message, httpStatus)` (`apps/api/src/shared/utils/response.ts`) — no raw error returns
- **Multi-tenancy**: see the two-layer section above — both layers are mandatory
- **Soft-delete**: `isActive: false`, not hard DELETE (agents, channels, etc.)
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- **RBAC**: `ADMIN` > `SUPERVISOR` > `AGENT` — guards in `apps/api/src/guards/rbac.guard.ts`
- **ESM**: all packages have `"type": "module"` — enforced by `node scripts/check-workspace-esm.mjs --strict`.
  A package missing it compiles to CJS **without any error**, and Node's CJS→ESM interop then drops
  forwarded re-exports (`export { x } from './y.js'`) — they resolve to `undefined` at runtime.
  This caused CM-175 (every new contact's first message was silently dropped).
- **Prisma in shared packages**: never use the module-level `prisma` singleton from
  `@open333crm/database` inside `packages/*`. It is not tenant-bound (RLS — see CM-171/CM-172) and is
  the symbol lost by the interop issue above. Shared functions take a Prisma executor from the caller
  (`identity-stitcher.ts`, `tagging.service.ts`).

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

These paths hold tool-specific instructions and skills. Project-wide rules belong in this file.

| Path | Contents |
| ---- | -------- |
| `.agent/instructions.md` | Generic agent runners — `.agent/workflows/`, `.agent/skills/` |
| `.agents/skills/`, `.agents/workflows/` | OpenSpec skills and workflows, and the `postgres-rls-tenant-isolation` skill |
| `.codex/skills/` | Codex — OpenSpec skills and the `open333crm-cli` skill |
| `openspec/config.yaml` | OpenSpec context |

The repository has no Claude Code file. Claude Code reads neither `AGENTS.md` nor `.agents/skills/`
by default. To use them, create a `CLAUDE.md` that imports `@AGENTS.md`, and symlink each skill
directory into `.claude/skills/`.
