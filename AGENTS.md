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
| A change to docs or OpenSpec files only | No. Exception: to remove a whole main spec, open a change (see Step 4) | No. Run each command that the change adds or changes. Make sure that each path and link in the change exists |
| Specs and tests for behavior that the code already has | Yes | No. The tests pass when you write them. Verify each test with a mutation instead (see "When a test passes as soon as you write it") |

### Step 1 — Spec the behavior (SDD)

Plan changes in `openspec/`. Use the OpenSpec skills in `.agents/skills/`:
`openspec-propose`, `openspec-apply-change` and `openspec-archive-change`.

The root `package.json` pins the version of the OpenSpec CLI (`@fission-ai/openspec`). Run the
CLI as `pnpm exec openspec`. Do not use a global install or `npx openspec`. Other versions
validate the same spec differently: for example, a spec that passes on one version fails on
another.

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

**Unit tests in `apps/api` do not connect to Redis.** `apps/api/tests/setup/unit.setup.ts`
replaces `ioredis` for all unit tests. Each Redis command fails at once, as when Redis is down.
The mock also replaces the `redis` client of `@open333crm/core`. A test can replace this mock
with its own `vi.mock('ioredis')`. Give the mock class an `on()` method that returns `this`.
`@open333crm/core` calls `redis.on()` when it loads.

The mock reaches `@open333crm/core` only because the repo installs one version of `ioredis`.
`apps/api`, `apps/workers` and `packages/core` pin the version that `bullmq` pins. When you
update `bullmq`, change all three. `pnpm why ioredis -r` must show one version.
`apps/api/tests/unit/no-redis-connection.test.ts` fails when a second version appears.

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

**A mock does only what the real code can do.** Before you make a mock throw an error, read the
real function. If the real function catches the error and returns a fallback, a mock that throws
tests a path that does not exist. To test a failure, make the lowest boundary fail (for example,
the LLM call or the HTTP request), and keep the real code between that boundary and the code
under test. Example: `analyzeSentiment()` catches an LLM error and returns a keyword result, so
`apps/api/tests/unit/modules/automation/sentiment-llm-fallback.test.ts` mocks the LLM, not
`analyzeSentiment()`.

**When a test passes as soon as you write it.** A test for behavior that the code already has
cannot fail first. Verify the test with a mutation:

1. Change the code that the scenario covers so that the behavior breaks. For example, remove a
   permission check or invert a condition.
2. Run the test. It must fail.
3. Restore the code.

If the test still passes, it does not check the behavior. Fix the test, not the code. List the
mutations in `tasks.md` of the change. A common cause is a second check that gives the same
result. For example, two guards can both return 403. Assert the field that names the check, such
as `error.details.requiredPermission`.

If the code breaks a scenario, write the scenario as the behavior should be. Then do one of
these:

- Fix the code in the same change. Write a test that fails first, as for a bug fix.
- Record the problem in `docs/ref/system/AUDIT.md`. The scenario has no test until the fix.

**When an existing test fails, do not change the assertion before you know which side is correct.**

1. Find the commit that changed the behavior (`git log -S '<string>'`).
2. If the commit changed the behavior on purpose, update the test. Name that commit in your
   commit message.
3. If the change was not on purpose, the test found a bug. Fix the code.

### Step 3 — Follow the structure rules (SOLID)

A module is in `apps/api/src/modules/<name>/`. It uses these file suffixes:

| Suffix | Role |
| ------ | ---- |
| `<name>.routes.ts` | HTTP boundary: Zod validation, guards, call a flow, wrap the response |
| `<name>.flow.ts` | Use case: opens the tenant transaction, calls services, writes the audit row, sends Socket events, events and jobs (structure rule 2) |
| `<name>.service.ts` | Business logic and data access |
| `<name>.worker.ts`, `<name>.scheduler.ts` | Background work. The Socket Event Routing section tells which process runs them |

Each rule below is the pattern that most of this repo uses. Each rule tells why it exists and how
to find code that breaks it.

The rules apply to new and changed code. Existing code that breaks a rule is not a template.
Do not copy it. Do not refactor it only to obey the rule. Fix it when you change that file for
a different reason.

#### 1. A route handler does not query the database

A route handler validates input, checks permissions, calls a flow, and returns. Put the query in
`<name>.service.ts`. Routes of modules that #337 has not moved yet still call services with the old
clients.

- **Why**: a test can reach a query in a route only through the HTTP layer, with the plugins
  and guards of the route registered. A unit test can call a query in a service directly, with
  a mock executor.
- **Check**: `grep -nE '(prisma|tenantPrisma|prismaAdmin|\btx)\.[a-zA-Z]+\.(find|create|update|delete|upsert|count|aggregate|groupBy)' apps/api/src/modules/*/*.routes.ts`
- **Existing exceptions**: `docs/ref/system/AUDIT.md`, ARCH-01.

#### 2. A service that reads or writes tenant data receives a `TenantCtx` and never opens a transaction

The entry point opens one transaction that is bound to the tenant. The entry point is a flow
(`<name>.flow.ts`) or a background job. It calls `inTenant(prisma, tenantId, (scope) => ...)` from
`apps/api/src/lib/tenant-ctx.ts`.

The layers have these jobs:

| Layer | Does | Receives |
| ----- | ---- | -------- |
| route | parses input, checks permissions, builds the actor with `actorOf(request)`, turns the result into an HTTP response | `request`, `reply` |
| flow | work outside the transaction (bcrypt, external calls), `inTenant()`, calls services, writes the audit row, sends Socket events, events and jobs, clears caches | `TenantScope`, injected dependencies |
| service | the business rules and the queries of one aggregate | `TenantCtx` |

Each route that reads or writes tenant data calls a flow. This is also true for a query: when a
query needs a cache later, the cache goes in the flow, because a service cannot use Redis and a
cache hit must not open a transaction. A route that reads no tenant data (for example a static
permission matrix) answers directly. `actorOf(request)` returns 401 when the request has no tenant.

A flow that only calls one service function can use `flowOf(fn)` from `lib/tenant-ctx.ts`, for
example `export const listStoresFlow = flowOf(listStores)`. When the operation gets a side effect
or work outside the transaction, write a normal flow function instead. A route does not call
`inTenant()` itself.

Each exported service function that reads or writes tenant data takes the `TenantCtx` as its first
parameter. A `TenantCtx` has only `tx` and `tenantId`. A service returns the facts that the flow
needs, and the flow decides the side effects:

```ts
// case.service.ts
export async function resolveCase(ctx: TenantCtx, caseId: string) {
  const updated = await ctx.tx.case.updateMany({ where: { id: caseId, tenantId: ctx.tenantId }, ... });
  return updated;
}

// case.flow.ts
export function resolveCaseFlow(deps: { prisma: PrismaClient; io: Server; events: EventPublisher }, actor: RequestActor, caseId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const updated = await resolveCase(scope, caseId);
    await recordTenantAudit(scope, { actorId: actor.agentId, action: 'case.resolve', ... });
    notifyTenant(scope, deps.io, 'case.updated', payload);              // sent to tenant:<tenantId> after commit
    await publishEvent(scope, deps.events, 'case.resolved', payload);  // written to the outbox, sent after commit
    return updated;
  });
}
```

A `TenantScope` is a `TenantCtx` with one method more: `afterCommit(label, fn)`. Only `inTenant()`
knows when the transaction commits, so this method is the only one on the object. Each other side
effect is a separate function that takes the scope. The caller gives the dependencies (`io`, an
`EventPublisher`) as parameters, so the parameters show what the code depends on. Do not add a
method to `TenantCtx` or `TenantScope` for a new side effect. Write a function that takes the scope.

A service obeys these rules:

- Use `ctx.tx` for each query. Do not import a client, and do not open a transaction
  (`withTenant`, `inTenant`, `$transaction`).
- Do not call an external service (LINE, an LLM, S3) inside the transaction. The transaction has a
  timeout of 5 seconds, and it holds a database connection. The flow splits the work into three
  steps: transaction, external call, transaction. Before you split it, write in the spec whether the
  external call happens at most once or at least once. If the flow goes through a queue, write
  this for each step of the flow: where the step can fail, where the data stays after the
  failure, which code does the step again, and the guarantee. Change `outbox-event-delivery`,
  `design.md` section 14, shows such a table.

A flow and a background job obey these rules:

- Send Socket events with `notifyTenant(scope, io, name, data)` (to all agents of the tenant) or
  `notifyAgent(scope, io, agentId, name, data)` (to one agent), from `apps/api/src/events/socket-push.ts`.
  Send events with `await publishEvent(scope, publisher, name, payload)`. Send BullMQ jobs with
  `await enqueueJob(scope, publisher, queueName, name, data)`. `publisher` is an `EventPublisher`,
  for example `createOutboxPublisher(prisma)`. Both are in
  `apps/api/src/events/outbox-publisher.ts`. Do not call `io.emit`, `eventBus.publish` or
  `queue.add()` directly. The caller does not give a room name: `socket-push.ts` selects the room
  for each Socket event.
- Socket events go out after the commit and are dropped after a rollback. A Socket event is
  sent at most once. `publishEvent` and `enqueueJob` write a row to the outbox inside the
  transaction. The row commits with the data, and the system sends it after the commit, at least
  once. Thus the receiver can get an event or a job two times. Before a side effect that must not
  repeat (for example, a message to a customer), claim it with `claimSideEffect()` from
  `@open333crm/core`, or with a conditional update. `docs/ref/modules/EVENTS.md` explains the
  outbox and the claims.
- To clear a cache after a write, call `scope.afterCommit(label, fn)`. Do not clear it inside the
  transaction: another request can read the old data before the commit and write it back to the
  cache. `inTenant()` runs `fn` after the commit and waits for `fn` to finish. Thus the flow
  returns, and the response goes out, after `fn` finishes. `fn` runs at most once. If `fn` fails,
  the system writes a log and the result stays successful. After a rollback, `fn` does not run.
- Write a tenant audit row with `recordTenantAudit(scope, input)` from
  `apps/api/src/modules/tenant-audit/tenant-audit.service.ts`. The audit row needs the actor and the
  IP of the request, so the flow writes it, not the service. The row commits with the data. If
  the write fails, the function throws and the transaction rolls back. Do not call
  `writeTenantAudit()` inside a transaction: it catches the database error, and after that error
  PostgreSQL rejects each query of the transaction. The commit then becomes a rollback, but the
  request can still return success. `writeTenantAudit()` stays only for callers that are not moved
  yet.
- When several entry points send the same Socket event, write the content of the event once in a
  module function, for example `apps/api/src/modules/coupon/coupon-effects.ts`. Each entry point
  calls that function.
- In a job handler (a BullMQ processor or an event subscriber), do not catch an error only to
  write a log. The job then completes, and the work is lost: the queue does not try again.
  Let these errors go out of the handler, so that the queue tries the job again:
  - an error before the claim commits, or in the claim transaction;
  - an error when the handler adds the next job to a queue.

  Catch an error and write a log only after the claim commits (the side effect is at most once),
  or when the code uses a fallback on purpose (for example, a knowledge-base reply when the LLM
  fails). `docs/ref/modules/EVENTS.md` lists the cases.
- Do not catch a unique-constraint error (`P2002`) and then continue inside the transaction. After
  the first error, PostgreSQL rejects each subsequent query in the transaction. To write a row or
  use the row that exists, use `createOrFindExisting()` from `@open333crm/core`
  (`packages/core/src/db/db-invariants.ts`). To claim one row with a conditional update, use
  `claimOne()` from the same file.

This rule does not cover two kinds of functions. They do not take a `TenantCtx`:

- A service for platform-layer tables (see the list in the Multi-Tenancy section), for example
  `platform-audit.service.ts`. These tables belong to no tenant, so the service uses `prismaAdmin`.
- A function that does not read the database, for example `sendOpsAlert()` in
  `apps/api/src/modules/ops-alert/ops-alert.service.ts`. It writes Redis and a queue only, so do
  not call it inside a tenant transaction (see the rule about external calls below).

`scripts/check-tenant-ctx.mjs` does not know about these two kinds. It counts only the old forms,
so these functions do not change its result.

- **Why**: the service then knows its guarantees from its parameter type. Its queries have RLS,
  and its writes succeed or fail together. The service cannot start a side effect, so the timing of
  each side effect is visible in the flow. With the old parameter type `TenantDb`, the caller
  decides these guarantees: `prismaAdmin` has no RLS, and `request.tenantPrisma` runs each query
  in a separate transaction. A unit test also cannot run a service without a database if the
  service gets a client by itself. `tests/support/mock-tenant-ctx.ts` gives a `TenantCtx` for
  service tests and a `TenantScope` for flow tests. The "Prisma in shared packages" convention below
  is this rule for `packages/*`.
- **Check**: `node scripts/check-tenant-ctx.mjs --strict` fails when one of these increases in a file:
  - the old forms `TenantDb`, `request.tenantPrisma` and a transaction opened in a service file;
  - a reference from a service file to a Redis client (`redis` or the whole module from
    `@open333crm/core`, or `ioredis`) or to an LLM module (`ai/llm.service.js`, a file in
    `ai/providers/` other than `types.js`). The type checker cannot stop a service that uses these
    module-level clients inside the transaction, so a flow receives them as dependencies instead.

  The script parses the TypeScript syntax for the last kind: a re-export, a dynamic
  `import()`, `require()`, a renamed import and a namespace call count. A type-only import and a
  comment do not count. Also
  `grep -rnE "new PrismaClient|import \{[^}]*\bprisma\b[^}]*\} from '@open333crm/database'" apps/api/src/modules packages/*/src`
- **Existing exceptions**: most services still take `TenantDb`. Issue #337 moves them module by
  module. `scripts/check-tenant-ctx.baseline.json` records how many remain. When you change one of
  these services for a different reason, you do not have to move it. The Canvas engine and unused
  services in `packages/core` also import a client: `docs/ref/system/AUDIT.md`, RLS-01 and RLS-08.

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
- **Existing exceptions**: none. The check above has no output.

#### 5. Channel differences go through the plugin registry

Get the behavior for each channel from `getChannelPlugin()`. Do not branch on `channelType`.
To add a channel, register a plugin. Do not add a branch.

Register the plugin in both processes:

- `registerChannelPlugin()` in `apps/api/src/index.ts`.
- `createWorkerPluginRegistry()` in `apps/workers/src/lib/plugin-registry.ts`.

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
| 2 | Dependency inversion, Liskov substitution |
| 4 | Dependency inversion, interface segregation |
| 5 | Open-closed |

Rule 2 is Liskov substitution because a `TenantCtx` gives the same guarantees from each entry point.
The old type `TenantDb` broke this principle: its three members have the same methods but different
guarantees. The contract that each channel plugin implements is also Liskov substitution. Rule 5
covers that contract.

### Step 4 — Check the definition of done

No CI workflow runs these checks (see CI gates below). Run them yourself before you open a pull
request:

- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes, if you changed a file in `packages/*`, a dependency, or a file that
      `apps/web` imports. Tests and `tsc` do not find a module that the browser bundle cannot
      load. Only the Next.js build finds it.
- [ ] `pnpm test:feature` passes, if you changed the database, Redis, RLS or a feature test.
- [ ] `node scripts/check-tenant-scoping.mjs --strict` and
      `node scripts/check-prisma-admin-usage.mjs --strict` show no violation that your change
      added. `docs/ref/system/AUDIT.md` records the violations that already exist on `main`.
- [ ] `node scripts/check-tenant-ctx.mjs --strict` passes. If your change removes old forms, run
      `node scripts/check-tenant-ctx.mjs --update-baseline` and commit the baseline file.
- [ ] `CHANGELOG.md` has an entry for each `feat`, `fix` or architecture change (see Conventions).
- [ ] All OpenSpec tasks of the change have a check mark. Archive the change when all tasks are done.
- [ ] Each delta spec uses `MODIFIED` for a requirement that already exists in `openspec/specs/`.
      Use `ADDED` only for a new requirement. An `ADDED` requirement that changes an existing one
      makes the main spec contradict itself after the archive.
- [ ] You archive with `pnpm exec openspec archive` or the `openspec-archive-change` skill. Do not move a
      change into `archive/` or copy its specs into `openspec/specs/` by hand. A hand copy can
      leave a main spec in a format that the CLI cannot read.

      When the archive creates a new main spec, the CLI writes its `## Purpose` as
      "TBD - created by archiving change …". Replace it with the purpose of the spec. The
      validation in the next items rejects this text.
- [ ] To remove a whole main spec (`openspec/specs/<name>/`), first check whether its capability
      is still planned:
      1. If the capability is still planned, copy the requirements of the main spec into a change
         for that capability. Write them as an `ADDED` delta spec.
      2. If the capability is not planned, remove the main spec only in one of these cases:
         - The product does not have the capability that the main spec describes.
         - Another spec or document now covers that capability.
         - The main spec records a one-time task, not behavior that the system keeps.

      Do not delete the directory of the main spec by hand. Remove the main spec with a change
      that has these two items:
      - A delta spec that lists each requirement of the main spec under
        `## REMOVED Requirements`.
      - `retire_capabilities: true` in the `.openspec.yaml` of the change. Without this line,
        `pnpm exec openspec archive` fails when it removes the last requirement of a main spec.

      When you archive the change, the CLI deletes the directory of the main spec. In the
      `proposal.md` of the change, give the reason for each removed main spec. If a spec or
      document replaces the removed main spec, name that spec or document.
- [ ] `node scripts/validate-openspec.mjs --specs` passes, if your change touches `openspec/`.
      Before you archive a change, `node scripts/validate-openspec.mjs <change-name>` also
      passes. All main specs pass on `main`.

      The script runs `pnpm exec openspec validate --strict`. With `--strict`, a warning also
      fails the command. A common warning is a `## Purpose` section shorter than 50 characters.
      The script ignores one warning, only in main specs: a requirement text longer than 500
      characters. Many main specs have such requirements, and until they are split, `--strict`
      always fails on them. In a change, the script does not ignore this warning. Split a new
      requirement that is too long.
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
| `inTenant(prisma, tenantId, (scope) => ...)` | one transaction on `app_tenant`, bound to `tenantId` | flows and new and moved background jobs. A scheduler finds its rows with `prismaAdmin`, then calls `inTenant()` for each row |
| `fastify.prisma` | `app_tenant`, RLS enforced | the base client for `inTenant()` and `withTenant()`. Without one of them, RLS returns no rows |
| `request.tenantPrisma` | `app_tenant`, bound to `request.agent.tenantId` | old form, being moved (#337). Each query runs in a separate transaction. Throws an error when the request is not authenticated |
| `withTenant(prisma, tenantId, fn)` | runs `fn` in a transaction with `app.current_tenant` set | old form, being moved (#337). `inTenant()` uses it internally |
| `fastify.prismaAdmin` | `app_admin`, **BYPASSRLS** | whitelist only: platform console, auth, schedulers, OAuth callbacks, public webhooks |

`withTenant` sets the session variable with `SET LOCAL` inside the transaction. Thus the variable
cannot go to the next request on a pooled connection.

Queries inside `fn` **must** use the `tx` that `withTenant` gives. An outer client uses a
different connection. On that connection the variable is not set, so RLS returns no rows
(fail-closed).

The `postgres-rls-tenant-isolation` skill (`.agents/skills/`) contains the wiring rules, the steps
to add a table, and the troubleshooting guide. Do not write them again here.

### CI gates

Three scripts check tenant isolation. With `--strict`, each script exits with code 1 when it finds
a violation:

| Script | Rejects |
| ------ | ------- |
| `scripts/check-tenant-scoping.mjs` | a query on a tenant table with no `tenantId` reachable in scope |
| `scripts/check-prisma-admin-usage.mjs` | `prismaAdmin` used from a file outside the whitelist |
| `scripts/check-tenant-ctx.mjs` | more old forms in a file than `scripts/check-tenant-ctx.baseline.json` records (rule 2) |

Run them without `--strict` to get a report instead of a failure.

> **No CI workflow runs these checks now.** `.github/workflows/ci.yml` ran both scripts with
> `--strict`. It also ran the RLS integration test `apps/api/tests/feature/rls-isolation.test.ts`.
> Commit `4b384b7` deleted `ci.yml`. Commit `323deeb` restored only `deploy.yml`, which runs none
> of these checks. Until `ci.yml` is restored, run the scripts with `--strict` before you open a
> pull request.

## Architecture: Socket Event Routing (Critical)

There are two paths. Select the correct path.

**Path A — Direct emit** (API process, inline):

```ts
notifyTenant(scope, io, name, data); // in a flow, inside inTenant(): sent to tenant:<tenantId> after the commit
```

Old code calls `fastify.io.to(room).emit(event, data)` directly. Inside a transaction, that call
sends the event before the commit. Do not copy it (structure rule 2).

Use path A when all of these conditions are true:

- The event is the direct result of the current HTTP request.
- The data is already in the database.
- The Socket event goes to all agents of the tenant (`notifyTenant`) or to one agent (`notifyAgent`).
- You need no more queries.

**Path B — Async queue** (outbox → subscriber queue → BullMQ → workers → Redis pub/sub):

```ts
await publishEvent(scope, publisher, "case.assigned", payload); // written to the outbox in the transaction
// → after the commit: job on the event-notification queue (API process)
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

Workers send a business event with `writeOutbox()` from `@open333crm/core`, in the transaction
that writes the data. Give the `tenantId`: the workers connection has no RLS. After the commit,
call `dispatchOutboxRows()`.

When you create a BullMQ `Worker`, set `concurrency`. The default is 1: the worker processes one
job at a time, and a slow job (for example, an LLM call) makes the jobs of all tenants wait.
`apps/api/src/events/subscriber-workers.ts` sets the value for each subscriber queue.

`eventBus.publish()` (`apps/api/src/events/event-bus.ts`) is the old form. It sends the event
directly to the subscriber queues and does not write the outbox. Thus the event is lost if the
process stops before it sends the event. New code uses `publishEvent`.

## Architecture: Scheduled Jobs in the API Process

Do not use `setInterval` or `setTimeout` for a periodic job.

Put a periodic job in the API process only if the job needs the API process, for example
`fastify.io`. Put all other periodic jobs in `apps/workers`.

To add a periodic job to the API process:

1. Register the job with `registerSchedule()` from `apps/api/src/lib/job-scheduler.ts`:

   ```ts
   export function setupXxxScheduler(scheduler: JobScheduler, prisma: PrismaClient) {
     scheduler.registerSchedule({ id: 'xxx', every: 60_000, run: () => runXxx(prisma) });
   }
   ```

2. Call `setupXxxScheduler(jobScheduler, ...)` in `apps/api/src/index.ts`. Call it before
   `jobScheduler.start()`.

### Frequency

- Give `every` (milliseconds) or `pattern` (cron). Do not give both.
- A cron uses the time zone of the API process. The containers do not set `TZ`, so the time
  zone is UTC.
- An API restart does not run the job. The job runs at its next scheduled time.

### One job for each period

BullMQ Job Scheduler stores the schedule in Redis. Each period creates **one job only**. This is
also true when more than one API process runs. Do not add a lock for this.

### A job can run more than one time

If the process stops while the job runs, BullMQ runs the job again. For example, Docker can
stop the API during a deploy. A test with the default BullMQ settings showed the second run
after approximately 60 seconds. The default settings are `lockDuration` 30 seconds and
`stalledInterval` 30 seconds.

Write `run` so that a second run does not do a side effect again. Before `run` sends a message
or changes the state of a row, `run` must claim the row with a conditional update.

### Two periods can overlap

BullMQ creates the next job when a worker takes the current job. Thus the next period can
start before the current period ends.

If a job can run longer than its period, set `withoutOverlapping: { expiresInMs }`:

- Set `expiresInMs` to the longest time that the job can run. Do not set it to the period.
- The job releases the lock when the job ends.
- If the process stops, the job does not release the lock. The lock then expires after
  `expiresInMs`.
- If the job runs longer than `expiresInMs`, the lock also expires. The next period can then
  start while the job runs.

The lock prevents overlap only while the lock is valid. The lock does not prevent a second run
of the same job. Thus `run` needs conditional updates also when you set the lock.

### Schedule ids

The schedule id is also the job name and the lock key. `start()` removes each schedule in Redis
that no code registers. Thus a renamed or removed id does not stay in Redis.

## Prisma Rules

- Schema: `packages/database/prisma/schema.prisma`
- A migration name starts with a timestamp, and Prisma applies migrations in name order. After you
  rebase on `main`, compare your migration with the migrations on `main`
  (`ls packages/database/prisma/migrations | tail`). If `main` has a migration with the same or a
  later timestamp, rename your migration directory to a later timestamp. Do this before the
  merge, while no environment has applied your migration.
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
  or an architecture change, you **MUST update `CHANGELOG.md`**. A pull request that changes only
  docs, OpenSpec files or tests does not need an entry. Write the entry under the latest release
  section, in a category such as `Added`, `Changed` or `Fixed`. Do not submit a code change
  without an entry in `CHANGELOG.md`.
- **CHANGELOG Date Format (CRITICAL / MANDATORY)**: each new or updated release section **MUST**
  use the date-only heading format `## [YYYY-MM-DD]`. **Never create or restore `## [Unreleased]`**.
  Do not change existing version headings, unless the user explicitly asks for a history rewrite.
- **Validation**: the API validates each input field with Zod. Do not rely on the validation
  of the frontend: a client can send any request, and other clients (the CLI, MCP, webhooks,
  scripts) do not use the frontend.
  - Parse `request.params`, `request.query` and `request.body` with a Zod schema before you use
    them. Do not cast them with `as`. A cast only tells the compiler the type. It does not check
    the value at runtime.
  - Give each field its type and its limits: the format (for example `.uuid()`), the length, the
    range and the allowed values (`z.enum`). A field that the database stores in an `Int` column
    must fit in int4: use `int4Schema` from `apps/api/src/shared/utils/numeric-bounds.ts`. For
    `page` and `limit`, use `paginationSchema` from `apps/api/src/shared/utils/pagination.ts`.
  - A JSON field (for example `settings` or `config`) gets a schema for each key that the code
    reads. Do not accept it as `z.record(z.unknown())`. Put the schema in a module file, so that
    the route and the service use the same definition.
  - When the code reads a JSON column from the database, check the value with the same schema.
    Do not cast it with `as`: rows that were written before the schema existed can hold any
    value. If the value is invalid, use a safe default.
  - Use `z.record(z.unknown())` only for a value that the code stores or forwards and never
    reads, for example `clientExtensionResults` from WebAuthn. Write a comment that tells why.
  - Frontend validation (for example `<input min={0}>`) only helps the user. The API rejects
    the same invalid values with HTTP 400.

  `apps/api/src/modules/portal/` shows the pattern: `portal.routes.ts` and
  `portal-public.routes.ts` parse each input, and `portal-settings.ts` defines the activity
  settings for the routes and the service. Many existing routes still cast their input with
  `as`, and issue #405 lists the `z.record(z.unknown())` fields. Fix them when you change the
  route for a different reason.
- **Errors**: `throw new AppError(message, code, statusCode, details?)`
  (`apps/api/src/shared/utils/response.ts`). **The message comes first.** `code` has the default
  `INTERNAL_ERROR`, and `statusCode` has the default 500. Thus, give both values. Do not return
  raw errors.
- **Multi-tenancy**: see the two-layer section above. Both layers are mandatory.
- **Soft-delete**: set `isActive: false`. Do not use a hard DELETE (agents, channels and similar).
- **Commits**: use Conventional Commits (`feat:`, `fix:`, `chore:` and similar).
- **Authorization**: guard a route with `requirePermission('<code>')` from
  `apps/api/src/guards/rbac.guard.ts`. `packages/shared/src/rbac/permissions.ts` registers the
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
- **Packages that `apps/web` bundles**: `apps/web` imports `@open333crm/automation` and
  `@open333crm/shared`. Thus these packages run in the browser. Do not import
  `@open333crm/core`, `@open333crm/channel-plugins` or `@open333crm/database` from them. The
  `core` index loads BullMQ, and BullMQ needs Node modules (`child_process`, `net`). The web build
  then fails, but tests and `tsc` pass. Put a function that reads the database in an
  `apps/api` module, for example `apps/api/src/modules/automation/keyword-yield.ts`.
  `packages/automation/tests/unit/browser-safe.test.ts` checks the `automation` package.
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
- **The feature tests need the passwords of `app_tenant` and `app_admin`.** These roles belong to
  the whole PostgreSQL server, so the development database shares them. The global setup sets
  their passwords (`app_tenant_local`, `app_admin_local`) only when a role has no password yet. If
  a role already has a different password, the setup stops before any test runs and tells you how
  to fix it: give the current passwords in `TEST_APP_TENANT_PASSWORD` and
  `TEST_APP_ADMIN_PASSWORD`, or change the role passwords. Before this check, every test that
  used these roles failed with `500 INTERNAL_ERROR` and showed no cause.
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
