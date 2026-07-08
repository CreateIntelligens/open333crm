# AGENTS.md — Open333CRM

Omnichannel CRM monorepo. TypeScript end-to-end.

## Quick Commands

```bash
pnpm install                        # install deps
pnpm dev                            # turbo dev (api + web + workers)
pnpm --filter @open333crm/api dev   # API only (port 3001, tsx watch)
pnpm --filter @open333crm/web dev   # Web only (port 3000, needs sync:widget first)
pnpm build                          # turbo build (set SKIP_ENV_VALIDATION=true in CI)
pnpm lint                           # turbo lint (ESLint 9 flat config)
pnpm db:generate                    # prisma generate
pnpm db:migrate -- --name <name>    # create migration
pnpm db:seed                        # seed database
```

**Run a single API test**: `pnpm --filter @open333crm/api test:case` or `tsx apps/api/src/__tests__/smoke.test.ts`
Tests use vitest imports but run via `tsx` directly — no vitest config file exists.

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

**Note**: `.claude/CLAUDE.md` and `.github/copilot-instructions.md` incorrectly say "React + Vite" for `apps/web`. It is Next.js (confirmed by `next.config.ts` and `package.json`).

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
- Import `PrismaClient` from `@open333crm/database`, **never** from `@prisma/client`
- **Never import Prisma enum types** (`AgentRole`, etc.) — use string literals:
  ```ts
  // Correct
  role: { in: ['ADMIN', 'SUPERVISOR'] }
  // Wrong — TS2305 error
  import { AgentRole } from '@prisma/client'
  ```

## Conventions

- **Validation**: Zod in API route handlers
- **Errors**: `throw new AppError(code, message, httpStatus)` — no raw error returns
- **Multi-tenancy**: every query must include `tenantId` in `where` clause
- **Soft-delete**: `isActive: false`, not hard DELETE (agents, channels, etc.)
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- **RBAC**: `ADMIN` > `SUPERVISOR` > `AGENT` — guards in `apps/api/src/guards/rbac.guard.ts`
- **ESM**: all packages have `"type": "module"`

## Environment Gotchas

- **API loads `.env` from project root** (3 levels up from `apps/api/src/index.ts`), not from `apps/api/.env`
- **Docker ports differ from defaults**: PostgreSQL → **5433** (not 5432), Redis → **6380** (not 6379)
- **Web dev requires pre-sync**: `pnpm --filter @open333crm/web dev` runs `sync:widget` and `sync:playcaptcha` automatically via its `dev` script
- **CI build needs**: `SKIP_ENV_VALIDATION=true` env var
- **Docker on macOS**: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`

## Monorepo Layout

```
apps/
  api/        # Fastify backend — entry: src/index.ts
  web/        # Next.js frontend — entry: src/app/page.tsx
  workers/    # BullMQ consumers — entry: src/index.ts
  cli/        # oclif CLI (npm: open333)
  widget/     # Embeddable webchat widget
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

## OpenSpec Workflow

Changes are tracked in `openspec/`. Use the OpenSpec skills for propose/apply/archive cycles. Archived changes: `openspec/changes/archive/`.

## Other Instruction Files

- `.claude/CLAUDE.md` — detailed architecture rules (socket routing, event bus, Prisma, RBAC)
- `.github/copilot-instructions.md` — similar content, slightly different wording
- `.agent/instructions.md` — same content as copilot-instructions
- `openspec/config.yaml` — OpenSpec context with architecture summary
