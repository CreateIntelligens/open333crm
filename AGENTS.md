# AGENTS.md — Open333CRM

Omnichannel CRM monorepo. TypeScript end-to-end.

> **This file is the single source of truth for AI coding agents.**
> The files under [Tool-Specific Files](#tool-specific-files) are small, tool-specific supplements.
> Each one refers to this file. Do **not** copy project facts into them.
> Two copies of one fact diverge, and then the two files contradict each other.
> Put project-wide rules in this file only.
>
> This file gives each rule and the command that checks it. When a rule needs more detail, the
> rule names the document under `docs/ref/` that has it. Read that document before you do the
> task that the rule covers.

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
| A dependency update | No | No. Run `pnpm test`. Also run `pnpm test:feature` if the database code or the Redis code uses the dependency |
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

Before you write the proposal, find the existing features that the change touches. One change
often breaks a feature in a different module, and nobody notices until a user reports it.

- `docs/ref/features/feature-map.json` lists each feature area: its files, pages, tables, events,
  specs and the other areas that depend on it.
- `node scripts/feature-impact.mjs --files <files you plan to change>` lists the affected areas.
  On a branch with commits, run it without arguments. It compares with `origin/main`.
- Each area has a Claude Code skill `.claude/skills/feature-<id>/`. The skill describes the
  frontend flows, the rules that must not break and a regression list.
  The `feature-impact-reviewer` subagent runs these steps and writes a report.

#### Plan the platform layer in the same change

The platform layer is the control plane at `/admin` (`docs/ref/features/platform/README.md`).
It decides what each plan can use, counts AI usage, and lets the platform team see and control
tenants. A tenant feature that needs the platform layer is not finished when the tenant side
works. Plan and build its platform part in the same change.

Before you write the proposal, check each item in this table. In `proposal.md`, write a section
`## Platform layer` that lists each item that applies and what the change does for it. If no item
applies, write one sentence that says why.

| If the change | Then also |
| ------------- | --------- |
| adds a permission code | Give it a `feature` in `packages/shared/src/rbac/permissions.ts`. Guard its routes with `requirePermission()`. A route without the guard ignores the plan ceiling (AUDIT PLAN-04). |
| adds a feature area that a plan can switch on or off | Add it to `packages/core/src/rbac/features.ts`. Decide which plans include it. Add it to existing plans with a one-time migration that only changes that field and can run again. The seed only creates missing plans, so a seed change does not reach existing plans. |
| adds a resource that a plan should limit (a count or a quota) | Add the limit key to `plan-limits.service.ts`, an input to `LIMIT_KEYS` in `apps/web/src/app/admin/plans/page.tsx`, and a check in the code that creates the resource. Do not add a limit that nothing checks: `maxTags` shows on the plan page and limits nothing (AUDIT PLAN-04). |
| calls an AI model | Record the call with `recordLlmUsage()` in `apps/api/src/modules/ai/llm.flow.ts`, with an `AiFeature` value from `apps/api/src/modules/ai/llm.service.ts`. Check the monthly quota (`token-quota.service.ts`) and the tenant AI privacy policy (`ai-privacy.service.ts`). A new model needs a price in `model_pricings`. Without a price, the system records its cost as 0 (AUDIT USAGE-02). |
| adds a channel type | Make sure the plan page can allow or block it (`allowedChannelTypes`). |
| adds a tenant setting or state that the platform team must see or control | Add it to the platform API and pages. An example is the AI privacy switch on the tenant page. |
| writes a new platform audit action | Add its label to the platform audit label table (`PLATFORM_AUDIT_ACTION_LABELS` in `apps/web/src/app/admin/lib/audit-log.ts`). The tenant detail page and the platform user detail page both read it. Otherwise they show the raw code. |
| adds a BullMQ queue | Add it to `apps/api/src/modules/queue-monitoring/monitored-queues.ts`, so that the queue monitor shows its failed jobs. |
| sends a request from a tenant to the platform team, or the other way | Notify the other side. A request that nobody sees waits forever (AUDIT PLAN-17). |

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

**How to write a test.** Before you write a test, read `docs/ref/system/TESTING.md`. It tells how
to do these tasks:

- inject a mock executor into a service (`tests/support/mock-tenant-ctx.ts`)
- replace Redis in `apps/api` unit tests, and keep one `ioredis` version in the repo
- write a React component test in jsdom (`apps/web` only)
- keep the data of a feature test separate from other tests

These rules apply to each test:

- Use `node:assert/strict`. Do not copy tests that import `node:assert`: its `assert.equal`
  compares with `==`.
- Test behavior, not source text. A test that asserts a string in a source file fails after a
  rename. Write it only for a guarantee that a behavior test cannot reach.
- A mock does only what the real code can do. Before you make a mock throw an error, read the
  real function. To test a failure, make the lowest boundary fail, for example the LLM call or
  the HTTP request. Keep the real code between that boundary and the code under test.

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
| `<name>.worker.ts`, `<name>.scheduler.ts` | Background work. `docs/ref/modules/EVENTS.md` tells which process runs them |

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

Before you write or change a route, flow, service or job handler in `apps/api`, read
`docs/ref/modules/API-MODULE.md`. It has an example flow and the details of each item below.

The entry point opens one transaction that is bound to the tenant. The entry point is a flow
(`<name>.flow.ts`) or a background job. It calls `inTenant(prisma, tenantId, (scope) => ...)` from
`apps/api/src/lib/tenant-ctx.ts`.

| Layer | Does | Receives |
| ----- | ---- | -------- |
| route | parses input, checks permissions, builds the actor with `actorOf(request)`, turns the result into an HTTP response | `request`, `reply` |
| flow | work outside the transaction (bcrypt, external calls), `inTenant()`, calls services, writes the audit row, sends Socket events, events and jobs, clears caches | `TenantScope`, injected dependencies |
| service | the business rules and the queries of one aggregate | `TenantCtx` |

Each route that reads or writes tenant data calls a flow, also for a query. A route does not
call `inTenant()` itself. A flow that only calls one service function can use `flowOf(fn)`.

Each exported service function that reads or writes tenant data takes the `TenantCtx` as its first
parameter. A `TenantCtx` has only `tx` and `tenantId`. A `TenantScope` adds one method,
`afterCommit(label, fn)`. Do not add a method to either type for a new side effect. Write a
function that takes the scope.

A service obeys these rules:

- Use `ctx.tx` for each query. Do not import a client, and do not open a transaction
  (`withTenant`, `inTenant`, `$transaction`).
- Do not call an external service (LINE, an LLM, S3) inside the transaction. The transaction has a
  timeout of 5 seconds. The flow splits the work into three steps: transaction, external call,
  transaction. Before you split it, write in the spec whether the external call happens at most
  once or at least once.
- Do not use Redis. In the API process, the entry point gets `fastify.redis` and gives it to the
  flow. In other places, create a connection with `createRedisClient(url, purpose)` from
  `@open333crm/core`. Do not use `new IORedis`.

A flow and a background job obey these rules:

- Send Socket events with `notifyTenant`, `notifyChannel` or `notifyAgent` from
  `apps/api/src/events/socket-push.ts`. An event that carries messages or conversation data of a
  channel (`message.new`, `conversation.*`) uses `notifyChannel`.
- Send events with `publishEvent` and BullMQ jobs with `enqueueJob`, from
  `apps/api/src/events/outbox-publisher.ts`. Do not call `io.emit`, `eventBus.publish` or
  `queue.add()` directly. `publishEvent` and `enqueueJob` send events and jobs at least once. Before a side effect that must
  not repeat, claim it with `claimSideEffect()` from `@open333crm/core` or with a conditional update.
- Clear a cache with `scope.afterCommit(label, fn)`, not inside the transaction.
- Write a tenant audit row with `recordTenantAudit(scope, input)`. Do not call
  `writeTenantAudit()` inside a transaction.
- In a job handler, do not catch an error only to write a log. Do not catch these two errors:
  - an error that occurs before the claim commits
  - an error that occurs when you add the next job to a queue

  Let the handler throw them. The queue then tries the job again.
- Do not catch a unique-constraint error (`P2002`) and then continue inside the transaction. Use
  `createOrFindExisting()` or `claimOne()` from `packages/core/src/db/db-invariants.ts`.

Two kinds of functions do not take a `TenantCtx`:

- a service for platform-layer tables. It uses `prismaAdmin`.
- a function that does not read the database, for example `sendOpsAlert()`.

- **Why**: the service then knows its guarantees from its parameter type. Its queries have RLS,
  and its writes succeed or fail together. The service cannot start a side effect, so the timing of
  each side effect is visible in the flow. With the old parameter type `TenantDb`, the caller
  decides these guarantees: `prismaAdmin` has no RLS, and `request.tenantPrisma` runs each query
  in a separate transaction. The "Prisma in shared packages" convention below is this rule for
  `packages/*`.
- **Check**: `node scripts/check-tenant-ctx.mjs --strict` fails when a file gets more of these:
  - old forms: `TenantDb`, `request.tenantPrisma` or a transaction in a service
  - references from a service file to a Redis client or an LLM module

  Also run
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
  shape. Before you split `platform.routes.ts`, read SEC-03 in `docs/ref/system/AUDIT.md`. That
  file registers its rate limit inside its route function.

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

- **Why**: each branch on `channelType` is one more location where a developer must add a new
  channel by hand. If the developer forgets one location, the new channel fails at that location
  and shows no error.
- **Check**: `grep -rnE "channelType (===|!==)|case '(LINE|FB|THREADS|WEBCHAT)'" apps/api/src apps/workers/src`
- **Existing exceptions**: many modules still branch on `channelType` or call the API of a
  channel directly. This file does not list them, because a move into plugins costs much work.
  Do not copy them. `docs/ref/modules/CHANNEL-PLUGINS.md` tells where they are and how to add a
  channel.

#### When to consider a new structure

A structure is a new layer, a new file type, a shared object, a registry or a shared function.
The signals below tell you when to stop and evaluate a structure. A signal does not decide
the result. The evaluation decides it.

| Signal | What it can show | Structure to evaluate |
| ------ | ---------------- | --------------------- |
| The same rule or query is in two or more modules | The rule has no owner. A fix reaches one copy only | One shared function. Examples: `createOrFindExisting()` and `claimOne()` in `packages/core/src/db/db-invariants.ts` |
| Two or more review comments on one pull request are about the same part of the code | Nobody defined the guarantee of that code | First write the guarantee in the spec, for example "at most once" or "at least once". Then evaluate the code again |
| One change needs edits in many locations, and a missed location shows no error | The behavior has no single point of control | A registry or a shared function. Example: the channel plugin registry (structure rule 5) |

To evaluate a structure, answer these questions in the proposal or the pull request:

1. Which file paths have the problem now? A problem that can occur only in the future is not
   a reason.
2. How many callers use the structure now? With only one caller, the structure can be more
   design than the problem needs. An open change or an issue can name the second caller.
3. What is the smallest form that solves the problem? Compare a rule in this file, a function
   and a check script with a new object or a new layer.
4. How difficult is it to remove the structure? If the structure changes many files, try it in
   one or two modules first. Review the result. Then apply the structure to the other modules.
   Example: #337 stage 2 tried `TenantCtx` in `role` and `agent`. The review of that stage
   added the flow layer.

Earlier evaluations rejected these structures. Evaluate one again when its reason is no longer
true:

| Structure | Reason |
| --------- | ------ |
| A generic repository layer | A generic repository loses the result type of each Prisma query. The other jobs of a repository have a different owner in this repo. Tenant isolation is the job of the two enforcement layers in the Multi-Tenancy section. The transaction boundary is the job of `TenantCtx` |
| Event listeners that a service registers | A person who reads the service cannot see its side effects |
| A method on `TenantCtx` or `TenantScope` for each side effect | See structure rule 2 |
| One transaction for each aggregate, with events between aggregates | Many operations must write several tables together, for example a contact merge. With one transaction for each aggregate, a failure can leave only part of the operation written |

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
- [ ] `node scripts/feature-impact.mjs` lists the areas that your change affects. You checked
      each item of the regression list in the skill of each directly affected area. If you changed a
      path, table, event or dependency of an area, update `docs/ref/features/feature-map.json`,
      and `node scripts/feature-impact.mjs --check` passes.
- [ ] `pnpm build` passes, if you changed a file in `packages/*`, a dependency, or a file that
      `apps/web` imports. Tests and `tsc` do not find a module that the browser bundle cannot
      load. Only the Next.js build finds it.
- [ ] This change does each item of "Plan the platform layer in the same change" (Step 1) that
      applies. `proposal.md` has its `## Platform layer` section. Do not leave the
      platform part for a later change.
- [ ] `pnpm test:feature` passes, if you changed the database, Redis, RLS or a feature test.
- [ ] `node scripts/check-tenant-scoping.mjs --strict` and
      `node scripts/check-prisma-admin-usage.mjs --strict` show no violation that your change
      added. `docs/ref/system/AUDIT.md` records the violations that already exist on `main`.
- [ ] `node scripts/check-tenant-ctx.mjs --strict` passes. If your change removes old forms, run
      `node scripts/check-tenant-ctx.mjs --update-baseline` and commit the baseline file.
- [ ] If you changed `apps/api/src`, `apps/workers/src` or `packages/*/src`, the structure review
      found no new problem, or the pull request tells why a finding does not apply. In Claude
      Code, run the `structure-reviewer` subagent. It runs the scripts above. Then it checks the
      rules that no script can check, for example Socket events with channel data and errors in
      job handlers. In other tools, check the diff against structure rules 1–5 and
      `docs/ref/modules/API-MODULE.md` yourself.
- [ ] `CHANGELOG.md` has an entry for each `feat`, `fix` or architecture change (see Conventions).
- [ ] All OpenSpec tasks of the change have a check mark. Archive the change when all tasks are done.
- [ ] Each delta spec uses `MODIFIED` for a requirement that already exists in `openspec/specs/`.
      Use `ADDED` only for a new requirement. An `ADDED` requirement that changes an existing one
      makes the main spec contradict itself after the archive.
- [ ] You archive with `pnpm exec openspec archive` or the `openspec-archive-change` skill, not by
      hand. If the archive creates a new main spec, replace its "TBD" `## Purpose`.
- [ ] To remove a whole main spec, you use a change with a `## REMOVED Requirements` delta and
      `retire_capabilities: true`. Do not delete the directory by hand.
- [ ] `node scripts/validate-openspec.mjs --specs` passes, if your change touches `openspec/`.
      Before you archive a change, `node scripts/validate-openspec.mjs <change-name>` also passes.

      The three items above have details in `docs/ref/system/DELIVERY.md` (OpenSpec section):
      the archive, when you can remove a main spec, and which warnings the validation ignores.
- [ ] `node scripts/check-doc-history.mjs --strict` passes, if you changed `AGENTS.md`,
      `docs/ref/features/`, `docs/ref/modules/` or a feature skill. These files describe only the
      current code. The script rejects closed issue numbers, change names, commit hashes and
      sentences about old behavior. Put the history in `docs/ref/system/AUDIT-REVIEWS.md` and the
      commit message. An open issue can stay: list it in `scripts/check-doc-history.allow.json`.
- [ ] If your change fixes an item in `docs/ref/system/AUDIT.md` completely or in part, add an
      entry to `docs/ref/system/AUDIT-REVIEWS.md` that names the fix (change or commit). Then do
      one of these:
      - The change fixes the item completely: remove its row and its section from `AUDIT.md`. Do not keep
        it with the status "已修正". In the entry, write "已修正，從 `AUDIT.md` 移除". Remove or
        update each link to the item in other files (`grep -rn "<ID>"`), for example
        `docs/ref/features/feature-map.json` and the limit tables in `docs/ref/`.
      - The change fixes the item in part: keep the item and set its status to "部分修正". In
        the item, write which part the change fixes and which part stays open.

      Also update each feature or module document under `docs/ref/` that describes the changed
      behavior.
- [ ] If your change fixes a health-check item (`HC-<DOMAIN>-NN` in `docs/ref/features/health/`)
      that has no AUDIT item, add an entry to `docs/ref/system/AUDIT-REVIEWS.md`. In the health
      report, add the item to the `已修正` line at the top. Do not change the rest of the report:
      it describes the code at the commit that the check ran on.
- [ ] If your change fixes an AUDIT item or a health-check item, remove the bug from each
      `.claude/skills/feature-<id>/SKILL.md` and from each document under `docs/ref/features/` and
      `docs/ref/modules/` that describes it (`grep -rn "<ID>" .claude/skills docs/ref`). Do not
      remove it from the health reports or `AUDIT-REVIEWS.md`. A skill describes only the current
      behavior. Do not write the old behavior, the fix date or the fixing commit in a skill:
      `docs/ref/system/AUDIT-REVIEWS.md` and the health report keep that history. An agent that
      reads a stale skill copies the bug or reports it again.

## Multi-Tenancy: Two Enforcement Layers (Critical)

**Two layers enforce tenant isolation. Your code must satisfy both.**

**Layer 1, application**: each query on a tenant table must include `tenantId` in `where`.

**Layer 2, Postgres RLS**: all tables have `ENABLE` and `FORCE ROW LEVEL SECURITY`, except the
platform-layer tables. These tables are `tenants`, `plans`, `platform_users`, `platform_audit_logs`,
`platform_settings`, `model_pricings` and `trial_signups`. The `tenant_isolation` policy reads the
session variable `app.current_tenant`. A new tenant table needs its own migration that enables
RLS and grants `SELECT, INSERT, UPDATE, DELETE` on the table to `app_tenant`. New tables get no
privileges for `app_tenant` by default. `app_tenant` can only read `tenants`, `plans`,
`platform_settings` and `model_pricings`, and cannot use the other platform-layer tables. Write
platform-layer tables through `prismaAdmin`. The skill named below gives the steps.

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

> **No CI workflow runs these checks now.** `.github/workflows/` has only `deploy.yml`, which runs
> none of these checks. Run the scripts with `--strict` before you open a pull request.
> `docs/ref/system/DELIVERY.md` tells which checks the deleted `ci.yml` ran.

## Architecture: Socket Event Routing (Critical)

There are two paths. Select the correct path.

**Path A — Direct emit** (API process, inline): in a flow, call `notifyTenant`, `notifyChannel`
or `notifyAgent` inside `inTenant()`. These functions send the event after the commit. Use path A when all of
these conditions are true:

- The event is the direct result of the current HTTP request.
- The data is already in the database.
- You need no more queries to find the recipients.

Old code calls `fastify.io.to(room).emit(event, data)` directly. Inside a transaction, that call
sends the event before the commit. Do not copy it.

**Path B — Async queue** (outbox → subscriber queue → BullMQ → workers → Redis pub/sub): call
`await publishEvent(scope, publisher, name, payload)` in the transaction. Use path B when one of
these conditions is true:

- You must query the database to find the recipients.
- The work is a side effect that must not delay the response.
- The event starts in a background job.

**Workers are a separate process.** They CANNOT access `fastify.io`. They send Socket events
through Redis with `publishSocketEvent()`, or with `publishChannelSocketEvent()` for messages or
conversation data of a channel (`apps/workers/src/lib/socket-bridge.ts`). Workers send a business
event with `writeOutbox()` from `@open333crm/core` in the transaction that writes the data, with
the `tenantId`, and call `dispatchOutboxRows()` after the commit.

When you create a BullMQ `Worker`, set `concurrency`. The default is 1, and one slow job makes
the jobs of all tenants wait.

`eventBus.publish()` is the old form. It does not write the outbox, so the event is lost if the
process stops. New code uses `publishEvent`.

Before you add an event, a queue or a Socket event, read "新增事件或背景工作時" in
`docs/ref/modules/EVENTS.md`. It tells which channel to use and what each channel guarantees.

## Architecture: Scheduled Jobs in the API Process

Do not use `setInterval` or `setTimeout` for a periodic job. Put a periodic job in the API
process only if the job needs the API process, for example `fastify.io`. Put all other periodic
jobs in `apps/workers`.

To add a periodic job to the API process, register it with `registerSchedule()` from
`apps/api/src/lib/job-scheduler.ts`, and call its setup function in `apps/api/src/index.ts`
before `jobScheduler.start()`. Read "新增 API 行程內的排程" in `docs/ref/modules/EVENTS.md` for
the code and the options.

BullMQ creates one job for each period, also when more than one API process runs. Do not add a
lock for this. But the job can run more than one time, and two periods can overlap:

- If the process stops while the job runs (for example, during a deploy), BullMQ runs the job
  again. Before `run` sends a message or changes the state of a row, `run` must claim the row
  with a conditional update.
- If a job can run longer than its period, set `withoutOverlapping: { expiresInMs }` to the
  longest time that the job can run. The lock does not prevent a second run of the same job, so
  `run` needs conditional updates also when you set the lock.

## Prisma Rules

- Schema: `packages/database/prisma/schema.prisma`
- A migration name starts with a timestamp, and Prisma applies migrations in name order. After you
  rebase on `main`, compare your migration with the migrations on `main`
  (`ls packages/database/prisma/migrations | tail`). If `main` has a migration with the same or a
  later timestamp, rename your migration directory to a later timestamp. Do this before the
  merge, while no environment has applied your migration.
- In application code, get the client from Fastify (`fastify.prisma`, `request.tenantPrisma`,
  `fastify.prismaAdmin`). See the table above. Do **not** construct your own `PrismaClient`. A
  client that you construct does not use the RLS wiring.

  These application files construct a client on purpose: `packages/database/src/client.ts`,
  `apps/api/src/plugins/prisma.plugin.ts` and `apps/workers/src/index.ts`. Scripts that run
  outside the application also construct their own client: `packages/database/prisma/seed.ts`,
  `packages/kb-ingest` and `apps/api/verify-quota.mts`. Feature tests do the same.

  The one-time scripts in `apps/api/src/scripts/` also run outside the application. They scan
  data of all tenants. They use the module-level `prisma` from `@open333crm/database`, and
  `DATABASE_URL` must point to `crm` or `app_admin` (BYPASSRLS). Do not import these scripts from
  application code. Do not copy this pattern into `apps/api/src/modules`.
- `@open333crm/database` re-exports everything from `@prisma/client` (`export * from '@prisma/client'`).
  Thus, import types and enums from `@open333crm/database`, so that the code has one import source.
- For `where` filters, use string literals, not enum imports. Most of the codebase uses string
  literals:

  ```ts
  role: { in: ['ADMIN', 'SUPERVISOR'] }
  ```

  An import of the generated enum is *not* an error. `packages/database/prisma/seed.ts` and
  `apps/api/src/modules/platform/platform.routes.ts` both import enums, and both pass the type
  check.

## Conventions

- **Do not reinvent existing code (MANDATORY)**: before you write a helper, a schema, a guard, a
  flow or a component, search the repo for code that already does the job. Use that code. Extend the
  existing code if it does almost the job. Do not write a second version next to it.
  - **Why**: two versions of one rule diverge. A later fix reaches one version only, and the other
    version keeps the bug. Reviews in this repo have found new SSRF checks written next to
    `isBlockedUrl()`, and new handoff code written next to `handOffConversation()`.
  - **How to search**:
    1. `grep -rn` for the function name, the error code and the Chinese message text.
    2. Read the skill of the feature area (`.claude/skills/feature-<id>/`).
    3. Run `node scripts/feature-impact.mjs --files <file>` to find the area that owns the code.
  - **Common helpers**: `isBlockedUrl()` (SSRF check, `apps/api/src/modules/webhook/downstream-forwarder.ts`),
    `handOffConversation()` (hand a conversation to an agent, `apps/api/src/modules/automation/handoff.flow.ts`),
    `claimSideEffect()` (`packages/core/src/outbox/claims.ts`), `createOrFindExisting()` and
    `claimOne()` (`packages/core/src/db/db-invariants.ts`), `paginationSchema`
    (`apps/api/src/shared/utils/pagination.ts`), `int4Schema`
    (`apps/api/src/shared/utils/numeric-bounds.ts`), `AppError` (`apps/api/src/shared/utils/response.ts`).
  - Sometimes you cannot use the existing code, for example because it breaks a structure rule.
    Then write the reason in the pull request. Move the callers to the new code in the same change.
- **CHANGELOG Maintenance (MANDATORY)**: when you implement a feature (`feat`), a bug fix (`fix`)
  or an architecture change, you **MUST update `CHANGELOG.md`**. A pull request that changes only
  docs, OpenSpec files or tests does not need an entry. Write the entry in the section for the
  current date. If `CHANGELOG.md` has no section for the current date yet, add it above the
  latest section. Put the entry in a category such as `Added`, `Changed` or `Fixed`. Do not submit a code change
  without an entry in `CHANGELOG.md`.
- **CHANGELOG Date Format (CRITICAL / MANDATORY)**: each new or updated release section **MUST**
  use the date-only heading format `## [YYYY-MM-DD]`. **Never create or restore `## [Unreleased]`**.
  Do not change existing version headings, unless the user explicitly asks for a history rewrite.
- **Validation**: the API parses each input field with a Zod schema. Do not rely on the
  validation of the frontend. Other clients (the CLI, MCP, webhooks, scripts) do not use it.
  - Parse `request.params`, `request.query` and `request.body` with a Zod schema. Do not cast them
    with `as`.
  - Give each field its type and its limits: format, length, range and allowed values.
  - An `Int` column value uses `int4Schema`. `page` and `limit` use `paginationSchema`.
  - A JSON field gets a schema for each key that the code reads, not `z.record(z.unknown())`.
    Parse a JSON column that the code reads from the database with the same schema.

  `docs/ref/modules/API-MODULE.md` ("驗證輸入") gives the details and the example module.
  Many existing routes still cast their input with `as`. Issue #405 lists the
  `z.record(z.unknown())` fields. Fix them when you change the route for a different reason.
- **Errors**: `throw new AppError(message, code, statusCode, details?)`
  (`apps/api/src/shared/utils/response.ts`). **The message comes first.** `code` has the default
  `INTERNAL_ERROR`, and `statusCode` has the default 500. Thus, give both values. Do not return
  raw errors.
- **Multi-tenancy**: see the two-layer section above. Both layers are mandatory.
- **Soft-delete**: set `isActive: false`. Do not use a hard DELETE (agents, channels and similar).
- **Commits**: use Conventional Commits (`feat:`, `fix:`, `chore:` and similar).
- **Writing rules for documents (MANDATORY)**: when you write or change text in this repo, apply
  the writing skill for its language before you finish. Apply it also when you change only some
  sentences of a document.

  | Language | Skill to read and apply |
  | -------- | ----------------------- |
  | Traditional Chinese | `.agents/skills/simplified-technical-chinese/SKILL.md` |
  | English | `.agents/skills/asd-ste100/SKILL.md` |

  - These rules apply to documents under `docs/`, `AGENTS.md`, `CLAUDE.md`, OpenSpec files,
    `.claude/skills/` and `.claude/agents/`, `CHANGELOG.md` entries, code comments, commit
    messages, pull request descriptions and code review comments.
  - These rules do not apply to text that users of the product see, for example UI strings.
  - **Why**: agents and developers read these documents and act on each sentence. A sentence
    with no subject, or with two meanings, causes wrong work that nobody can ask about later.
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
  `undefined`, and the code that uses them fails without an error message.

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
  `@open333crm/database` inside `packages/*`. It is not bound to a tenant, so its queries have
  no RLS. It is also the symbol that the interop problem above loses. Shared functions receive a
  Prisma executor from the caller (`packages/core/src/identity/identity-stitcher.ts`). For
  existing exceptions, see structure rule 2.

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
  a role already has a different password, the setup stops before any test runs. Its message tells
  you how to fix the problem. Do one of these:
  - Give the current passwords in `TEST_APP_TENANT_PASSWORD` and `TEST_APP_ADMIN_PASSWORD`.
  - Change the role passwords.
- **Next.js compiles `NEXT_PUBLIC_*` values into the browser bundle.** Do not set such a value to
  a Compose service name such as `api:3001`. The browser cannot resolve a Compose service name.
  Use `http://localhost:3001/api` locally.
- **`PLATFORM_JWT_SECRET` enables the platform control plane (`/admin/*`).** If this variable is
  not set, `/api/v1/platform/auth/login` returns 503 `PLATFORM_DISABLED`.
- **Web dev needs a sync first**: the `dev` script of `pnpm --filter @open333crm/web dev` runs
  `sync:widget` and `sync:playcaptcha` automatically.
- **A new git worktree has no `node_modules`, no built packages and no Prisma client.** Run
  `pnpm install`, `pnpm db:generate`, `pnpm --filter @open333crm/shared build` and
  `pnpm --filter @open333crm/automation build`. Without these steps, tests fail at import, not
  at an assertion.
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
| `.agents/skills/`, `.agents/workflows/` | OpenSpec skills and workflows, the `postgres-rls-tenant-isolation` skill, and two writing skills: `simplified-technical-chinese` (Traditional Chinese technical documents) and `asd-ste100` (English text that an agent reads, MIT license) |
| `.codex/skills/` | Codex: OpenSpec skills and the `open333crm-cli` skill |
| `openspec/config.yaml` | OpenSpec context and per-artifact rules |
| `.claude/agents/` | Claude Code subagent definitions, for example `feature-impact-reviewer` (affected feature areas) and `structure-reviewer` (structure rules) |
| `.claude/skills/` | Claude Code skills: one `feature-<id>` skill for each feature area, and symlinks to `.agents/skills/` |
| `docs/ref/features/health/` | Health check of each feature area: gaps between spec, code and UI, test results, and manual test results |

`CLAUDE.md` imports this file (`@AGENTS.md`), so that Claude Code reads it. Each directory in
`.agents/skills/` has a symlink in `.claude/skills/`. When you add a skill to `.agents/skills/`,
add its symlink too.
