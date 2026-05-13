## 1. Contract Model

- [x] 1.1 Add automation scope, event, fact, operator, action, and parameter metadata types in `packages/automation`
- [x] 1.2 Define shared operator metadata, including labels and valueless operators such as `exists` and `notExists`
- [x] 1.3 Define message, conversation, contact, case, and SLA event definitions with native provided scopes
- [x] 1.4 Define fact definitions for message, conversation, contact, case, and SLA facts with required scopes and allowed operators
- [x] 1.5 Define action definitions for messaging, case, contact, assignment, and notification actions with required and mutated scopes
- [x] 1.6 Add compatibility exports or re-exports so existing SLA contract callers can migrate without breaking imports

## 2. Composer and Validation

- [x] 2.1 Implement a composer function that returns event-specific facts and actions based on scope compatibility
- [x] 2.2 Implement explicit resolver metadata support without enabling cross-entity scopes by default
- [x] 2.3 Implement validation for unknown events, unknown facts, unsupported operators, and missing values
- [x] 2.4 Implement validation for action type compatibility and action parameter metadata requirements
- [x] 2.5 Add contract helpers for frontend-friendly condition fields and action options

## 3. Frontend Authoring

- [x] 3.1 Replace hard-coded trigger event labels on the automation rule page with package contract metadata
- [x] 3.2 Replace `automationFields` usage with composer-derived condition fields for all supported event types
- [x] 3.3 Update the condition builder to respect event-specific operators and valueless operators
- [x] 3.4 Update the action list/editor to show only actions compatible with the selected event
- [x] 3.5 Reset or reconcile existing condition/action selections when the trigger event changes to an incompatible event
- [x] 3.6 Render action parameter editors from contract metadata where feasible, keeping JSON fallback for unknown payloads

## 4. API and Worker Integration

- [x] 4.1 Update API automation create/update validation to use the composed contract for conditions and actions
- [x] 4.2 Update API automation test validation to reject event-incompatible facts and actions before dry-run evaluation
- [x] 4.3 Align API and worker automation fact builders with package-defined fact keys
- [x] 4.4 Ensure worker queued automation evaluation ignores or logs rules that fail contract compatibility checks
- [x] 4.5 Keep persisted `trigger`, `conditions`, and `actions` shapes unchanged

## 5. Tests and Verification

- [x] 5.1 Add package tests for composer output for `message.received`, `case.created`, and representative SLA events
- [x] 5.2 Add package tests for explicit resolver behavior and default resolver exclusion
- [x] 5.3 Add API tests for rejecting message-only facts on case events and case-only facts on message events
- [x] 5.4 Add API tests for rejecting event-incompatible actions
- [x] 5.5 Add focused frontend tests or component-level checks for event-specific condition/action options where existing test setup allows
- [x] 5.6 Run `pnpm --filter @open333crm/automation build`
- [x] 5.7 Run `pnpm --filter @open333crm/shared build` if SLA compatibility exports are touched
- [x] 5.8 Run `pnpm --filter @open333crm/api build`
- [x] 5.9 Run `pnpm --filter @open333crm/workers build`
- [x] 5.10 Run `pnpm --filter @open333crm/web build`
- [x] 5.11 Run focused automation contract validation tests
