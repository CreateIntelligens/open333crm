## Why

The current license plan assumes a central license server, but the product needs feature gating before that server exists. We need a local-first License/Billing layer that defaults to allowing all features, supports environment overrides now, and can later swap to cache/API-backed strategies without touching business routes.

## What Changes

- Replace the current mock license configuration with a strategy-based `LicenseProvider` abstraction.
- Add an allow-all default strategy so existing deployments keep working with no license server and no feature flags configured.
- Add an environment strategy for explicit feature, limit, and credit overrides in development or single-tenant deployments.
- Add a cache-backed strategy interface that can read cached entitlements and optionally refresh from another source later.
- Keep tenant identifiers in method signatures for compatibility, but do not make tenant-specific storage or tenant billing models part of this implementation.
- Standardize feature gate checks so route-level `preHandler` guards can call one service instead of embedding licensing decisions in business logic.
- Standardize credit/usage checks as policy decisions, initially non-destructive unless a strategy explicitly supports deduction.
- Remove the assumption that API access requires a license server during MVP.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `license-service`: Change from central-server-only license fetching to strategy-based entitlement resolution with allow-all, env, and cache-backed providers.
- `channel-billing`: Change channel limits and message-fee checks to consume normalized license decisions from the strategy service instead of assuming a remote License JSON source.

## Impact

- Affected backend code:
  - `apps/api/src/services/license.ts`
  - `apps/api/src/guards/license.guard.ts`
  - `apps/api/src/config/env.ts`
  - channel creation and outbound send paths that already consult license/channel billing logic
- Affected specs:
  - `openspec/specs/license-service/spec.md`
  - `openspec/specs/channel-billing/spec.md`
- No database migration is expected for this change.
- No license server, platform admin portal, tenant feature table, or Redis schema is required in this phase.
