## Why

Automation rule authoring currently mixes event lists, condition fields, and action choices across web, API, worker, and shared SLA code. This makes it easy to expose invalid combinations such as message-only facts on case events, case-only actions without case context, or stale frontend choices that the API later rejects.

This change introduces a contract composer so events, facts, and actions remain independently defined, while authoring and validation are assembled from explicit context capabilities.

## What Changes

- Add a package-level automation contract model for event definitions, fact definitions, action definitions, operators, scopes, and optional resolver metadata.
- Add a composer API that derives available conditions and actions from a selected event by comparing event-provided scopes with fact/action requirements.
- Move non-SLA automation event/fact/action metadata out of scattered web constants and into shared package-level definitions.
- Update frontend automation rule authoring so the trigger event determines the available condition fields and action choices.
- Update API automation rule create/update/test validation so event, conditions, and actions must be compatible with the composed contract.
- Update worker/API fact-building boundaries to use the same fact keys and event context model when evaluating queued automation rules.
- Preserve existing persisted rule shape (`trigger`, `conditions`, `actions`) and avoid a database migration for this change.

## Capabilities

### New Capabilities
- `automation-contract-composer`: Defines the shared event/fact/action contract and the composition rules that determine valid authoring options for each automation event.

### Modified Capabilities
- `automation-engine`: Automation rule authoring, validation, and worker evaluation must use the composed contract so event-specific facts and actions are constrained consistently across web, API, and worker.

## Impact

- Affected packages:
  - `packages/automation`: contract definitions, composer, validation helpers, fact/action metadata.
  - `packages/shared`: existing SLA contract may move into or re-export through the automation contract surface.
- Affected apps:
  - `apps/web`: automation rule page, condition builder, action editor/list.
  - `apps/api`: automation rule CRUD/test validation and event enqueue contract.
  - `apps/workers`: automation fact building and action execution compatibility checks.
- No Prisma schema migration is expected.
- No runtime socket routing change is expected; worker-originated side effects continue to use BullMQ and Redis socket bridge where applicable.
