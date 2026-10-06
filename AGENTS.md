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
pnpm lint                           # turbo lint (ESLint 9 flat config), not run by CI
pnpm test                           # unit tests in every package (Vitest, no services needed)
pnpm test:feature                   # feature tests, need postgres + redis from docker-compose.dev.yml
pnpm test:all                       # both suites
pnpm db:generate                    # prisma generate
pnpm db:migrate -- --name <name>    # create migration
pnpm db:seed                        # seed database
```

To run some tests only, filter by file name: `pnpm --filter @open333crm/api test -- case.service`.
Step 2 of the [Development Workflow](#development-workflow) tells where tests go and how to write them.

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

## Development Workflow

Every change goes through four steps in this order:

1. Write down the behavior (spec).
2. Write a test that fails until the behavior exists.
3. Write the code. Obey the structure rules.
4. Check the definition of done.

Some changes skip step 1 or step 2. This table tells which steps each type of change needs:

| Change | Step 1: open an OpenSpec change? | Step 2: write a failing test first? |
| ------ | -------------------------------- | ----------------------------------- |
| A new feature, or a change in behavior that users, API clients or other modules can see | Yes | Yes |
| A bug fix that restores behavior an existing spec already describes | No | Yes. The first test reproduces the bug |
| A refactor with no behavior change | No | No. The tests that cover the code must pass before and after the change. If no test covers the code, first add a test that passes on the current code |
| A dependency update | No | No. Run `pnpm test`. Also run `pnpm test:feature` if the dependency is used for the database or Redis |
| A change to docs or OpenSpec files only | No | No. Run each command that the change adds or changes. Make sure that each path and link in the change exists |

### Step 1 — Spec the behavior (SDD)

Plan changes in `openspec/`. Use the OpenSpec skills in `.agents/skills/`:
`openspec-propose`, `openspec-apply-change` and `openspec-archive-change`.

The table at the start of this section tells when to open a change.

Each requirement in a spec has `#### Scenario:` blocks. Write each scenario as **WHEN** / **THEN**.

- Write each scenario so that a test can check it. Name the input and the result that a caller can see.
- Give each scenario at least one test. Name the test after the scenario.
- In `tasks.md`, put the test task for a scenario before its implementation task.

`openspec/config.yaml` gives these rules to the OpenSpec skills.

### Step 2 — Write the failing test first (TDD)

1. Write a test for the scenario or for the bug.
2. Run the test. It must fail on an assertion. An import error or a missing service is not the
   correct failure.
3. Write the smallest change that makes the test pass.
4. Improve the code. Keep all tests green.

For a bug fix, the first test reproduces the bug.

**Where a test goes.** Each package keeps its tests in `tests/`. Tests import source through
`#src/`, which the `imports` field in the package's `package.json` defines.

| Suite | Directory | Use it when the code under test |
| ----- | --------- | ------------------------------- |
| unit | `tests/unit/`, with the same structure as `src/` | runs without PostgreSQL or Redis |
| feature | `tests/feature/` (only `apps/api` has one) | needs PostgreSQL or Redis |

**Unit tests inject their dependencies.** A service receives its Prisma executor as a parameter
(structure rule 2). Thus a unit test can give the service a mock object. The mock implements
only the model methods that the service calls. `apps/api/tests/unit/modules/case/case.service.test.ts`
shows this pattern.

Use `node:assert/strict` for assertions, as most existing tests do. Some older tests import
`node:assert`. Its `assert.equal` compares with `==`. Do not copy those tests.

**Component tests render React in jsdom.** Only `apps/web` has them. They use
`@testing-library/react`. Name the file `*.test.tsx` and write `// @vitest-environment jsdom` on
its first line. Other unit tests run in Node.
`apps/web/tests/unit/components/settings/role-permission-matrix.test.tsx` shows this pattern.

- Replace `#src/lib/api.js` with `vi.mock()`. A component test does not send HTTP requests.
- To check that an element does not exist, use `assert.ok(element === null)`. Do not give a DOM
  node to `assert.equal()`. When that assertion fails, `node:assert` serializes the whole jsdom
  tree, and the test worker runs out of memory.
- A mocked hook must return the same function on each render, as `useCallback` does in the real
  provider. If it returns a new function, an effect that depends on the function can run
  without end.

**Feature tests do not use the development database.** `apps/api/tests/setup/` does these steps:

- It creates a separate test database and applies all migrations.
- It inserts the fixture tenants.
- It stops the run if a connection points to a host that is not local.

Keep the data of each test separate from other tests. Use one of these two methods:

- Run the test in a transaction, and roll back the transaction at the end
  (`tests/feature/modules/identity-binding/identity-binding.test.ts`).
- Put a unique mark on each row that the test creates. Delete the marked rows in `afterAll`
  (`tests/feature/modules/tenant-audit/tenant-audit.test.ts`).

**Test behavior, not source text.** Some tests read a source file and assert that a string is in
it. These tests fail after a rename or a move, even when the behavior stays the same. Write this
type of test only for a guarantee that a behavior test cannot reach. An example is "this route
calls the service inside `withTenant`".

**When an existing test fails, do not change the assertion before you know which side is correct.**

1. Find the commit that changed the behavior (`git log -S '<string>'`).
2. If the commit changed the behavior on purpose, update the test. Name that commit in your
   commit message.
3. If the change was not on purpose, the test found a bug. Fix the code.

### Step 3 — Follow the structure rules (SOLID)

A module is in `apps/api/src/modules/<name>/`. It uses these file suffixes:

| Suffix | Role |
| ------ | ---- |
| `<name>.routes.ts` | HTTP boundary: Zod validation, guards, call a service, wrap the response |
| `<name>.service.ts` | Business logic and data access |
| `<name>.worker.ts`, `<name>.scheduler.ts` | Background work. The Socket Event Routing section tells which process runs them |

Each rule below is the pattern that most of this repo uses. Each rule tells why it exists and how
to find code that breaks it.

The rules apply to new and changed code. Existing code that breaks a rule is not a template.
Do not copy it. Do not refactor it only to obey the rule. Fix it when you change that file for
a different reason.

#### 1. A route handler does not query the database

A route handler validates input, checks permissions, calls a service, and returns. Put the
query in `<name>.service.ts`.

- **Why**: a test can reach a query in a route only through the HTTP layer, with the plugins
  and guards of the route registered. A unit test can call a query in a service directly, with
  a mock executor.
- **Check**: `grep -nE '(prisma|tenantPrisma|prismaAdmin|\btx)\.[a-zA-Z]+\.(find|create|update|delete|upsert|count|aggregate|groupBy)' apps/api/src/modules/*/*.routes.ts`
- **Existing exceptions**: `docs/ref/system/AUDIT.md`, ARCH-01.

#### 2. A service receives its Prisma executor and never imports one

Each exported service function takes the executor as its first parameter:

```ts
export async function listCases(prisma: TenantDb, tenantId: string, ...) { }
```

- **Why**: a service that gets a client by itself can use a connection that the caller did not
  select. RLS then shows data of other tenants, or returns no rows and no error. A unit test also
  cannot run that service without a database. The "Prisma in shared packages" convention below
  is this rule for `packages/*`.
- **Check**: `grep -rnE "new PrismaClient|import \{[^}]*\bprisma\b[^}]*\} from '@open333crm/database'" apps/api/src/modules packages/*/src`
- **Existing exceptions**: the Canvas engine and unused services in `packages/core`.
  `docs/ref/system/AUDIT.md`, RLS-01.

#### 3. One route file covers one resource

Split a route file when it has more than approximately 15 routes. Also split it when it starts
to serve a second resource. `marketing` shows the target shape: `marketing.routes.ts` and
`material.routes.ts`, each over separate services.

- **Why**: a route file for many resources mixes their guards, schemas and plugin options. A
  change for one resource can then break the other resources.
- **Check**: `grep -cE "\.(get|post|put|patch|delete)(<[^>]*>)?\(\s*['\"]/" apps/api/src/modules/*/*.routes.ts | sort -t: -k2 -rn | head`
- **Existing exceptions**: some route files break this rule. `platform/platform.routes.ts` breaks
  it the most. This file does not list them, because a split costs much work. Do not copy their
  shape. Before you split `platform.routes.ts`, read SEC-03 in `docs/ref/system/AUDIT.md`. The
  rate limit of that file is registered inside its route function.

#### 4. Cross-module calls go through the other module's service

Import the `.service.ts` of the other module, or a helper file of that module. Do not import the
`.routes.ts`, `.worker.ts` or `.scheduler.ts` of another module.

- **Why**: route, worker and scheduler files are entry points. `apps/api/src/index.ts` connects
  them to the application. Their exports serve that connection, not other modules. Their authors
  can change them and not know about an import in a different module. A service is the
  interface of a module to other modules.
- **Check**: `grep -rnE "from '\.\./[a-z-]+/[a-zA-Z.-]+\.(routes|worker|scheduler)\.js'" apps/api/src/modules`
- **Existing exceptions**: `docs/ref/system/AUDIT.md`, ARCH-02.

#### 5. Channel differences go through the plugin registry

Get the behavior for each channel from `getChannelPlugin()`. Do not branch on `channelType`.
To add a channel, register a plugin. Do not add a branch.

Register the plugin in both processes:

- `registerChannelPlugin()` in `apps/api/src/index.ts`.
- The `pluginRegistry` map in `apps/workers/src/index.ts`.

The workers map does not read the shared registry. Thus a plugin that only the API registers
cannot send messages from automation rules.

- **Why**: each branch on `channelType` is one more location where a new channel must be added
  by hand. If a developer forgets one location, it fails and shows no error.
- **Check**: `grep -rnE "channelType (===|!==)|case '(LINE|FB|THREADS|WEBCHAT)'" apps/api/src apps/workers/src`
- **Existing exceptions**: many modules still branch on `channelType` or call the API of a
  channel directly. This file does not list them, because a move into plugins costs much work.
  Do not copy them. `docs/ref/modules/CHANNEL-PLUGINS.md` tells where they are and how to add a
  channel.

#### Appendix: which SOLID principle each rule is

These names are labels for the rules above. They do not give an order to apply the rules. No
rule needs its principle name to be correct.

| Rule | Principle |
| ---- | --------- |
| 1, 3 | Single responsibility |
| 2 | Dependency inversion |
| 4 | Dependency inversion, interface segregation |
| 5 | Open-closed |

Liskov substitution has no rule here. The nearest equivalent in this codebase is the contract that
each channel plugin implements. Rule 5 covers that contract.

### Step 4 — Check the definition of done

No CI workflow runs these checks (see CI gates below). Run them yourself before you open a pull
request:

- [ ] `pnpm test` passes.
- [ ] `pnpm test:feature` passes, if you changed the database, Redis, RLS or a feature test.
- [ ] `node scripts/check-tenant-scoping.mjs --strict` and
      `node scripts/check-prisma-admin-usage.mjs --strict` show no violation that your change
      added. `docs/ref/system/AUDIT.md` records the violations that already exist on `main`.
- [ ] `CHANGELOG.md` has an entry for each `feat`, `fix` or architecture change (see Conventions).
- [ ] All OpenSpec tasks of the change have a check mark. Archive the change when all tasks are done.
- [ ] Each delta spec uses `MODIFIED` for a requirement that already exists in `openspec/specs/`.
      Use `ADDED` only for a new requirement. An `ADDED` requirement that changes an existing one
      makes the main spec contradict itself after the archive.
- [ ] You archive with `openspec archive` or the `openspec-archive-change` skill. Do not move a
      change into `archive/` or copy its specs into `openspec/specs/` by hand. A hand copy can
      leave a main spec in a format that the CLI cannot read.

      When the archive creates a new main spec, the CLI writes its `## Purpose` as
      "TBD - created by archiving change …". `openspec validate --strict` does not reject this
      text. Replace it with the purpose of the spec. This command must print nothing:
      `grep -rl "TBD - created by archiving" openspec/specs`
- [ ] To remove a whole main spec (`openspec/specs/<name>/`), first check whether its capability
      is still planned:
      1. If the capability is still planned, move the requirements of the spec into a change as an
         `ADDED` delta spec.
      2. If the capability is not planned, delete the spec only in one of these cases:
         - The product does not have the capability that the spec describes.
         - Another spec or document now covers that capability.
         - The spec records a one-time change, not behavior that the system keeps.

      Removing a whole spec is the only time that you delete a directory under `openspec/specs/`
      by hand. A delta spec cannot do this: `openspec archive` stops when a spec has no
      requirements left. In the pull request description, give the reason for each removed spec.
      If a spec or document replaces it, name that spec or document.
- [ ] `openspec validate --specs --strict` passes, if your change touches `openspec/`. All main
      specs pass this command on `main`. With `--strict`, a warning also fails the command. A
      common warning is a `## Purpose` section shorter than 50 characters.
- [ ] If your change fixes an item in `docs/ref/system/AUDIT.md` completely or in part, update
      that item, add an entry to `docs/ref/system/AUDIT-REVIEWS.md`, and update each feature or
      module document under `docs/ref/` that describes the changed behavior.

## Multi-Tenancy: Two Enforcement Layers (Critical)

**Two layers enforce tenant isolation. Your code must satisfy both.**

**Layer 1, application**: each query on a tenant table must include `tenantId` in `where`.

**Layer 2, Postgres RLS**: all tables have `ENABLE` and `FORCE ROW LEVEL SECURITY`, except the
platform-layer tables. These tables are `tenants`, `plans`, `platform_users`, `platform_audit_logs`,
`platform_settings`, `model_pricings` and `trial_signups`. The `tenant_isolation` policy reads the
session variable `app.current_tenant`. A new tenant table needs its own migration that enables
RLS. The skill named below gives the steps.

### Which Prisma client to use

| Client | Connection | When |
| ------ | ---------- | ---- |
| `fastify.prisma` | `app_tenant`, RLS enforced | default for tenant-scoped work |
| `request.tenantPrisma` | `app_tenant`, bound to `request.agent.tenantId` | inside authenticated request handlers. Throws an error when the request is not authenticated |
| `withTenant(prisma, tenantId, fn)` | runs `fn` in a transaction with `app.current_tenant` set | background jobs and each path that needs an explicit tenant |
| `fastify.prismaAdmin` | `app_admin`, **BYPASSRLS** | whitelist only: platform console, auth, schedulers, OAuth callbacks, public webhooks |

`withTenant` sets the session variable with `SET LOCAL` inside the transaction. Thus the variable
cannot go to the next request on a pooled connection.

Queries inside `fn` **must** use the `tx` that `withTenant` gives. An outer client uses a
different connection. On that connection the variable is not set, so RLS returns no rows
(fail-closed).

The `postgres-rls-tenant-isolation` skill (`.agents/skills/`) contains the wiring rules, the steps
to add a table, and the troubleshooting guide. Do not write them again here.

### CI gates

Two scripts check tenant isolation. With `--strict`, each script exits with code 1 when it finds
a violation:

| Script | Rejects |
| ------ | ------- |
| `scripts/check-tenant-scoping.mjs` | a query on a tenant table with no `tenantId` reachable in scope |
| `scripts/check-prisma-admin-usage.mjs` | `prismaAdmin` used from a file outside the whitelist |

Run them without `--strict` to get a report instead of a failure.

> **No CI workflow runs these checks now.** `.github/workflows/ci.yml` ran both scripts with
> `--strict`. It also ran the RLS integration test `apps/api/tests/feature/rls-isolation.test.ts`.
> Commit `4b384b7` deleted `ci.yml`. Commit `323deeb` restored only `deploy.yml`, which runs none
> of these checks. Until `ci.yml` is restored, run both scripts with `--strict` before you open a
> pull request.

## Architecture: Socket Event Routing (Critical)

There are two paths. Select the correct path.

**Path A — Direct emit** (API process, inline):

```ts
fastify.io.to(room).emit(event, data);
```

Use path A when all of these conditions are true:

- The event is the direct result of the current HTTP request.
- The data is already in the database.
- You know the room.
- You need no more queries.

**Path B — Async queue** (eventBus → BullMQ → workers → Redis pub/sub):

```ts
eventBus.publish({ name: "case.assigned", tenantId, timestamp: new Date(), payload }); // API process
// → notificationQueue.add(job)  // BullMQ
// → apps/workers consume → publishSocketEvent(redis, room, event, data)
```

Use path B when one of these conditions is true:

- You must query the database to find the recipients.
- The work is a side effect that must not delay the response.
- The event starts in a background job.

**Workers are a separate process.** They CANNOT access `fastify.io`. Send events through Redis
pub/sub:

```ts
await redisPublisher.publish(
  "socket:emit",
  JSON.stringify({ room, event, data }),
);
```

`eventBus` (`apps/api/src/events/event-bus.ts`) is an in-process EventEmitter only. It has no
Redis connection.

## Prisma Rules

- Schema: `packages/database/prisma/schema.prisma`
- In application code, get the client from Fastify (`fastify.prisma`, `request.tenantPrisma`,
  `fastify.prismaAdmin`). See the table above. Do **not** construct your own `PrismaClient`. A
  client that you construct goes around the RLS wiring.

  These application files construct a client on purpose: `packages/database/src/client.ts`,
  `apps/api/src/plugins/prisma.plugin.ts` and `apps/workers/src/index.ts`. Scripts that run
  outside the application also construct their own client: `packages/database/prisma/seed.ts`,
  `packages/kb-ingest` and `apps/api/verify-quota.mts`. Feature tests do the same.
- `@open333crm/database` re-exports everything from `@prisma/client` (`export * from '@prisma/client'`).
  Thus, import types and enums from `@open333crm/database`, so that the code has one import source.
- For `where` filters, use string literals, not enum imports. Most of the codebase uses string
  literals:

  ```ts
  role: { in: ['ADMIN', 'SUPERVISOR'] }
  ```

  An import of the generated enum is *not* an error. Older versions of this file said that it was.
  `packages/database/prisma/seed.ts` and `apps/api/src/modules/platform/platform.routes.ts` both
  import enums, and both pass the type check.

## Conventions

- **CHANGELOG Maintenance (MANDATORY)**: when you implement a feature (`feat`), a bug fix (`fix`)
  or an architecture change, you **MUST update `CHANGELOG.md`**. The same applies when you
  complete an OpenSpec change or a PR. Write the entry under the latest release section, in a
  category such as `Added`, `Changed` or `Fixed`. Do not submit a code change without an entry
  in `CHANGELOG.md`.
- **CHANGELOG Date Format (CRITICAL / MANDATORY)**: each new or updated release section **MUST**
  use the date-only heading format `## [YYYY-MM-DD]`. **Never create or restore `## [Unreleased]`**.
  Do not change existing version headings, unless the user explicitly asks for a history rewrite.
- **Validation**: use Zod in API route handlers.
- **Errors**: `throw new AppError(message, code, statusCode, details?)`
  (`apps/api/src/shared/utils/response.ts`). **The message comes first.** `code` has the default
  `INTERNAL_ERROR`, and `statusCode` has the default 500. Thus, give both values. Do not return
  raw errors.
- **Multi-tenancy**: see the two-layer section above. Both layers are mandatory.
- **Soft-delete**: set `isActive: false`. Do not use a hard DELETE (agents, channels and similar).
- **Commits**: use Conventional Commits (`feat:`, `fix:`, `chore:` and similar).
- **Authorization**: guard a route with `requirePermission('<code>')` from
  `apps/api/src/guards/rbac.guard.ts`. `packages/core/src/rbac/permissions.ts` registers the
  codes. `docs/ref/modules/PERMISSIONS.md` explains how the system calculates effective
  permissions.

  The role enum (`ADMIN`, `SUPERVISOR`, `AGENT`) no longer guards routes. Some business rules
  still read it, for example case auto-assignment and notification recipients. `requireRole()`
  stays only as a legacy shim. Do not use it in new routes.
- **ESM**: give each new package `"type": "module"`. Some existing packages have no `type` field.

  A package without the field compiles to CJS **and shows no error**. The CJS→ESM interop of
  Node then loses forwarded re-exports (`export { x } from './y.js'`). At runtime, they are
  `undefined`. This caused CM-175: the system dropped the first message of each new contact
  and showed no error.

  `node scripts/check-workspace-esm.mjs --strict` does not require the field. It fails only on
  the dangerous combination: a CJS package that imports a symbol that an ESM package forwards
  in this way.
- **Prisma in shared packages**: do not use the module-level `prisma` singleton from
  `@open333crm/database` inside `packages/*`. It is not bound to a tenant (RLS, see
  CM-171/CM-172). It is also the symbol that the interop problem above loses. Shared functions
  receive a Prisma executor from the caller (`packages/core/src/identity/identity-stitcher.ts`).
  For existing exceptions, see structure rule 2.

## Environment Gotchas

- **Docker Compose reads `.env.api`, `.env.web` and `.env.workers`** from the repo root. Copy
  each file from the matching `.env.*.example`. `docker-compose.dev.yml` and `docker-compose.yml`
  load these three files.
- **The API that runs directly on the host** (`pnpm --filter @open333crm/api dev`, no Docker)
  loads the root `.env` instead. `apps/api/src/index.ts` finds that path 3 levels up. The API
  does **not** read `apps/api/.env`. That file is only a template.
- **Docker ports are not the defaults**: PostgreSQL uses **5433** (not 5432). Redis uses
  **6380** (not 6379).
- **RLS is not enforced in local development.** The local API connects as `crm`. `crm` is a
  superuser, and a superuser bypasses RLS. A query without its tenant binding works locally, but
  returns no rows in production. The feature tests connect as `app_tenant`.
  `rls-isolation.test.ts` is the test that checks RLS.
- **Next.js compiles `NEXT_PUBLIC_*` values into the browser bundle.** Do not set such a value to
  a Compose service name such as `api:3001`. The browser cannot resolve a Compose service name.
  Use `http://localhost:3001/api` locally.
- **`PLATFORM_JWT_SECRET` enables the platform control plane (`/admin/*`).** If this variable is
  not set, `/api/v1/platform/auth/login` returns 503 `PLATFORM_DISABLED`.
- **Web dev needs a sync first**: the `dev` script of `pnpm --filter @open333crm/web dev` runs
  `sync:widget` and `sync:playcaptcha` automatically.
- **Docker on macOS**: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`

## Monorepo Layout

```text
apps/
  api/          # Fastify backend, entry: src/index.ts
  web/          # Next.js frontend, entry: src/app/page.tsx
  workers/      # BullMQ consumers, entry: src/index.ts
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
  brain/      # AI/LLM helpers, not imported by any app
  channel-plugins/ # LINE, Facebook, Instagram DM (`threads`), WebChat plugins
  kb-ingest/  # Knowledge base ingestion
```

## Database Docs

| You want | Read |
| -------- | ---- |
| Field definitions, types, constraints (source of truth) | `packages/database/prisma/schema.prisma` |
| Table relations and what each table stores | `docs/ref/DATABASE-ERD.md` |
| Why the schema has this shape, index strategy, known drift | `docs/16_DB_SCHEMA.md` |

## Tool-Specific Files

These paths contain tool-specific instructions and skills. Project-wide rules belong in this file.

| Path | Contents |
| ---- | -------- |
| `.agent/instructions.md` | Generic agent runners: `.agent/workflows/`, `.agent/skills/` |
| `.agents/skills/`, `.agents/workflows/` | OpenSpec skills and workflows, and the `postgres-rls-tenant-isolation` skill |
| `.codex/skills/` | Codex: OpenSpec skills and the `open333crm-cli` skill |
| `openspec/config.yaml` | OpenSpec context and per-artifact rules |
| `.claude/agents/` | Claude Code subagent definitions |

The repository has no `CLAUDE.md`. Thus, by default, Claude Code reads neither `AGENTS.md` nor
`.agents/skills/`. To use them, create a `CLAUDE.md` that imports `@AGENTS.md`. Then symlink each
skill directory into `.claude/skills/`.
