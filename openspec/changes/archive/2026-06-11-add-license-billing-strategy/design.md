## Context

The current code has two license-service paths:

- `apps/api/src/services/license.ts` builds a hard-coded mock license in memory.
- `packages/core/src/license/license-service.ts` sketches remote fetch + Redis cache, but it is not wired as the main API license authority.

The product does not have a license server today. For MVP, all features must remain usable by default, while giving us one central place to turn features, limits, and credits on or off. The current tenant model remains in the database, but this change must not require tenant-specific licensing tables because the expected commercial model is not yet tenant-driven.

## Goals / Non-Goals

**Goals:**

- Make license and billing decisions come from a single strategy-based service.
- Default to allow-all behavior when no strategy is configured.
- Support environment-driven feature, limit, and credit overrides now.
- Define a cache-backed provider seam so Redis/API strategies can be added without changing route guards or business services.
- Keep feature gates at API/module boundaries through guards and shared helper methods.
- Keep method signatures compatible with existing tenant-aware code while allowing strategies to ignore tenant scope.

**Non-Goals:**

- Build a license server.
- Build a platform admin or billing UI.
- Add tenant feature mapping tables.
- Add payment, invoice, subscription, or recharge flows.
- Enforce every possible feature gate in this change; only wire the first meaningful gates and leave a clear pattern.
- Move LLM API key ownership into a license server.

## Decisions

### Decision 1: Strategy interface, not license server contract

Introduce a `LicenseProvider` interface behind `LicenseService`.

```ts
interface LicenseProvider {
  readonly name: string;
  load(context: LicenseContext): Promise<LicenseSnapshot>;
  refresh?(context: LicenseContext): Promise<LicenseSnapshot>;
  deductCredits?(input: CreditDeductionInput): Promise<CreditDecision>;
}
```

`LicenseService` owns normalization and public methods:

- `isFeatureEnabled(featurePath, context?)`
- `getLimit(limitPath, context?)`
- `isChannelEnabled(channelType, context?)`
- `getChannelMaxCount(channelType, context?)`
- `getMessageFee(channelType, context?)`
- `hasCredits(creditType, amount, context?)`
- `deductCredits(creditType, amount, context?)`
- `getSummary(context?)`

Alternative considered: wire Redis/API fetch directly into route guards. That would make the first implementation faster but would spread license decisions across handlers and make future provider changes expensive.

### Decision 2: Default provider is allow-all

When `LICENSE_PROVIDER` is unset or set to `allow-all`, the service returns a normalized snapshot where:

- all known feature paths are enabled by default;
- missing feature paths are treated as enabled unless env explicitly disables unknown features;
- limits are unlimited unless configured;
- credits are unlimited unless configured.

Alternative considered: default deny for unknown features. That is safer for a mature SaaS license system, but it would break the current product while no license server exists.

### Decision 3: Env provider uses compact JSON overrides

The env provider reads optional JSON from environment variables:

- `LICENSE_PROVIDER=env`
- `LICENSE_FEATURES_JSON`
- `LICENSE_LIMITS_JSON`
- `LICENSE_CREDITS_JSON`
- `LICENSE_CHANNELS_JSON`

Example:

```json
{
  "features": {
    "analytics.dashboard": true,
    "portal.activities": false
  },
  "limits": {
    "contacts.maxContacts": 10000,
    "automation.maxRules": 50
  },
  "credits": {
    "llmTokens": { "remaining": 1000000, "total": 1000000, "unit": "tokens" }
  },
  "channels": {
    "LINE": { "enabled": true, "maxCount": 1 },
    "FB": { "enabled": false }
  }
}
```

Alternative considered: one env var per feature. That is easy to grep but becomes hard to manage when the feature catalog grows.

### Decision 4: Cache provider is read-through but refresh source is pluggable

The cache provider reads a normalized `LicenseSnapshot` from cache first. If absent, it can call an injected source provider. In this change the default source can be `allow-all` or `env`; a future `api` source can be added without changing callers.

Flow:

```text
LicenseService
  -> selected provider
      allow-all
      env
      cache -> cacheStore.get(key)
              -> fallback source provider
              -> cacheStore.set(key, ttl)
```

This should use the existing cache abstraction in `apps/api/src/lib/cacheStore.ts` rather than hard-coding Redis into license logic.

Alternative considered: use Redis directly. The repo already has cache configuration (`CACHE_DRIVER`, `CACHE_SEGMENT`, `CACHE_EXPIRES_IN`), so using the cache abstraction keeps memory/dev and Redis/prod behavior aligned.

### Decision 5: Tenant compatibility without tenant dependency

Public service calls may accept `tenantId` because routes and models already carry tenant scope. Providers must not require tenant records. The cache key may include tenant ID for compatibility, but the default env/allow-all providers return the same snapshot for all tenants.

Alternative considered: remove tenant from licensing APIs. That would simplify the new service but cause unnecessary churn across current route handlers and tests.

### Decision 6: Guards return explicit decisions

`requireFeature` and `requireCredits` should call async service methods and use normalized denial reasons. Business services should not know how feature state is stored.

Expected denial codes:

- `FEATURE_NOT_ENABLED`
- `LIMIT_EXCEEDED`
- `INSUFFICIENT_CREDITS`
- `LICENSE_PROVIDER_UNAVAILABLE`

For provider errors, allow-all behavior should be preferred unless `LICENSE_FAIL_CLOSED=true`.

Alternative considered: throw raw provider errors. That would leak implementation details and make route behavior inconsistent.

## Risks / Trade-offs

- **Risk: default allow-all can hide missing gates** -> Mitigation: expose `getSummary()` and tests showing the active provider and resolved snapshot.
- **Risk: env JSON can be malformed** -> Mitigation: validate at startup and fail fast only when `LICENSE_PROVIDER=env`; otherwise keep allow-all default.
- **Risk: cache data can become stale** -> Mitigation: store provider name, version, `loadedAt`, and TTL metadata in the snapshot; allow manual refresh through service method later.
- **Risk: tenantId becomes misleading** -> Mitigation: document that tenant scope is compatibility-only in this phase.
- **Risk: credits are not truly atomic** -> Mitigation: require providers that support real deduction to implement `deductCredits`; env/allow-all providers may return non-destructive success.

## Migration Plan

1. Add license snapshot and provider types.
2. Replace hard-coded mock config with provider selection.
3. Add env schema entries for provider and JSON overrides.
4. Update guards to await service decisions.
5. Wire channel creation/send checks through the service methods that already exist conceptually.
6. Add unit tests for allow-all, env deny, env limits, cache fallback, and provider error behavior.
7. Keep current behavior as rollback by setting `LICENSE_PROVIDER=allow-all`.

## Open Questions

- Which feature paths should be the first commercial catalog? Suggested starter set: `analytics.dashboard`, `automation.rules`, `marketing.broadcast`, `portal.activities`, `shortlinks.tracking`, `ai.suggestReply`, `channels.LINE`, `channels.FB`, `channels.WEBCHAT`.
- Should provider errors fail open in production too, or should `LICENSE_FAIL_CLOSED=true` be required for paid deployments?
- Should credit deduction be enforced in this change for AI calls, or only for channel billing paths that already have fee concepts?
