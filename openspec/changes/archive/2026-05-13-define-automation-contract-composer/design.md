## Context

Automation authoring has grown from simple message rules into message, conversation, case, contact, and SLA-driven rules. SLA now has shared event/fact metadata, but the rest of automation still has duplicated frontend constants, API-side validation gaps, and worker/API fact builders that are not described by one shared contract.

The core problem is not only missing metadata. It is missing composition semantics: events, facts, and actions are separate concepts, but the product must only allow combinations that make sense for the context produced by the selected event.

Current examples:
- `message.received` naturally provides tenant, contact, conversation, and message context.
- `case.created` naturally provides tenant, contact, and case context.
- SLA events provide tenant, case, SLA, and sometimes contact context.
- `send_message` requires a conversation/contact delivery context.
- `update_case_status` requires a case context.

Without a composer, each layer must remember these relationships independently.

## Goals / Non-Goals

**Goals:**
- Define a shared contract model for automation events, facts, actions, scopes, operators, labels, and parameter metadata.
- Add a composer that derives available condition fields and actions from the selected event.
- Make frontend authoring, API validation, and worker evaluation consume the same contract.
- Keep event definitions, fact definitions, and action definitions independently maintained.
- Preserve the existing persisted rule shape: `trigger`, `conditions`, and `actions`.
- Support SLA events through the same contract surface instead of a separate one-off SLA-only path.

**Non-Goals:**
- No Prisma schema migration.
- No rewrite of every action executor into a new runtime abstraction.
- No automatic cross-entity resolver expansion in the first implementation unless an event explicitly declares it.
- No change to socket routing. Worker-originated side effects continue through BullMQ and Redis socket bridge.
- No broad redesign of automation logs or historical rule execution records.

## Decisions

### Decision 1: Use scope-based composition

Each event declares the context scopes it provides. Each fact and action declares the scopes it requires. A fact or action is available when its required scopes are a subset of the event's provided scopes.

```txt
event.provides = ['tenant', 'contact', 'conversation', 'message']
fact.requires = ['message']
action.requires = ['conversation']

requires subset of provides => available
```

Rationale: this keeps events, facts, and actions independent while still giving deterministic composition. It avoids hard-coded `if event === ...` matrices.

Alternative considered: maintain explicit per-event allowlists for facts and actions. This is easy to read at first, but it duplicates relationships and becomes expensive when adding new events or actions.

### Decision 2: Put the contract in `packages/automation`

`packages/automation` should own automation-domain concepts: event catalog, fact catalog, action catalog, operators, validation, and composer helpers. `packages/shared/src/sla` can either re-export from this surface or be folded into it during implementation, but web/API/worker should consume one contract surface for authoring and validation.

Rationale: `packages/shared` is a broad utility surface, while `packages/automation` is the narrower domain package.

Alternative considered: keep SLA in `packages/shared` and create another automation contract beside it. That preserves current files but keeps two metadata systems alive.

### Decision 3: Treat resolver expansion as explicit

An event may optionally declare resolvable scopes, such as resolving a case from `conversation.caseId`. These scopes must not be treated like native `provides` scopes unless the event definition explicitly opts in.

```txt
message.received
  provides: ['tenant', 'contact', 'conversation', 'message']
  resolvable: []

case-linked-message.received
  provides: ['tenant', 'contact', 'conversation', 'message']
  resolvable: ['case']
```

Rationale: automatic expansion hides null cases. If a message has no linked case, case facts become null and rules become hard to reason about.

Alternative considered: always include all DB-reachable facts. That is flexible, but it makes the UI promise facts that may not exist at runtime.

### Decision 4: API validation is the authority

The frontend should hide invalid fields/actions, but API create/update/test validation must still reject incompatible condition facts, operators, and action types for the selected event.

Rationale: UI constraints improve UX, but persisted automation rules are security-sensitive tenant data and can be created through API clients.

Alternative considered: frontend-only constraints. This would leave invalid rules possible through direct API calls or stale clients.

### Decision 5: Composer output is UI-ready and validation-ready

The composer should return labels, field types, value options, operators, action parameter metadata, and compatibility decisions. Web should not maintain a second mapping of labels or action choices.

Rationale: a single source avoids drift. The same definition can drive dropdowns, API errors, and focused tests.

Alternative considered: composer returns only IDs and each app maps labels locally. This keeps package metadata smaller, but recreates the drift problem.

## Risks / Trade-offs

- [Risk] Some existing rules may contain condition facts or actions that become invalid under the new contract. → Mitigation: add a compatibility audit or soft warning path before enforcing active rule updates; do not mutate existing rows automatically.
- [Risk] Scope-based composition may be too coarse for a few actions. → Mitigation: allow action definitions to include optional event allowlists or deny-lists only when scope checks are insufficient.
- [Risk] Moving SLA metadata can create import churn. → Mitigation: keep compatibility re-exports from the old SLA path until callers are migrated.
- [Risk] `exists` and `notExists` operators need UI behavior different from value-based operators. → Mitigation: include operator metadata and update the condition builder to hide values for valueless operators.
- [Risk] Resolver behavior can surprise users if enabled broadly. → Mitigation: first implementation only uses native `provides` scopes; resolvers are metadata-only or explicitly enabled per event.

## Migration Plan

1. Add contract types and catalogs in `packages/automation`.
2. Add composer and validation helpers with unit coverage.
3. Re-export or adapt existing SLA event/fact metadata through the automation contract surface.
4. Update web automation authoring to consume composer output for trigger events, condition fields, operators, value editors, and action choices.
5. Update API automation rule create/update/test validation to use the composer.
6. Update worker/API fact builders to align emitted fact keys with the contract.
7. Add focused tests for representative message, case, and SLA events.

Rollback strategy: keep the persisted rule schema unchanged so rollback can restore previous UI/API validation code without a database migration.

## Open Questions

- Should case-linked message events opt into a `case` resolver in the first implementation, or should case facts remain unavailable for all message events until a later change?
- Should existing inactive rules be validated immediately, or only when a user edits/tests/activates them?
- Should action parameter schemas be a lightweight internal metadata format or a JSON Schema-compatible shape?
