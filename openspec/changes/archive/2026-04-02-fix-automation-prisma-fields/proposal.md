## Why

The `automation.service.ts` and `automations.ts` route handler were referencing `conditionsJson` and `actionsJson` as Prisma fields when writing to the database, but the Prisma schema only defines `conditions` and `actions`. This caused TypeScript build errors (TS2561, TS2551, TS2339) that prevented the API from compiling.

## What Changes

- Remove `conditionsJson` assignments from `prisma.automationRule.create()` in `apps/api/src/modules/automation/automation.service.ts`
- Remove `actionsJson` assignments from `prisma.automationRule.create()` in `apps/api/src/modules/automation/automation.service.ts`
- Remove `conditionsJson` and `actionsJson` from the `AutomationRuleUpdateInput` object in `updateRule()` in `automation.service.ts`
- Remove `conditionsJson`/`actionsJson` keys from Prisma create/update calls in `apps/api/src/routes/automations.ts`

## Capabilities

### New Capabilities
<!-- None introduced -->

### Modified Capabilities
- `automation-engine`: Prisma persistence fields corrected — `conditions` and `actions` used exclusively (removing stale `conditionsJson`/`actionsJson` aliases)

## Impact

- **Files changed**: `apps/api/src/modules/automation/automation.service.ts`, `apps/api/src/routes/automations.ts`
- **Build**: Fixes TypeScript compilation errors; no runtime behavior change
- **Note**: `packages/automation` retains `conditionsJson`/`actionsJson` in its own in-memory types — those are intentional and unaffected
