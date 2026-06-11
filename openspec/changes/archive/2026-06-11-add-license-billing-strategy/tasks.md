## 1. License Strategy Foundation

- [x] 1.1 Define license snapshot, provider, decision, credit, limit, and channel policy types near the API license service.
- [x] 1.2 Implement `AllowAllLicenseProvider` with enabled-by-default features, unlimited limits, unlimited credits, and enabled channels.
- [x] 1.3 Implement `EnvLicenseProvider` with validated JSON parsing for features, limits, credits, and channel settings.
- [x] 1.4 Implement `CachedLicenseProvider` using the existing cache abstraction and a fallback source provider.
- [x] 1.5 Add provider selection from `LICENSE_PROVIDER` with startup validation for unsupported provider names.

## 2. License Service API

- [x] 2.1 Replace the hard-coded mock config in `apps/api/src/services/license.ts` with provider-backed snapshot loading.
- [x] 2.2 Implement async public methods for feature checks, limits, channel checks, credit checks, deduction, and sanitized summary.
- [x] 2.3 Preserve tenant-aware method arguments for compatibility while allowing local providers to ignore tenant scope.
- [x] 2.4 Add env schema entries for provider selection, fail behavior, cache TTL, and JSON override variables.

## 3. Guards and Business Integration

- [x] 3.1 Update `requireFeature` and `requireCredits` guards to await provider-backed LicenseService decisions.
- [x] 3.2 Standardize error payloads for `FEATURE_NOT_ENABLED`, `LIMIT_EXCEEDED`, `INSUFFICIENT_CREDITS`, and provider unavailable failures.
- [x] 3.3 Wire channel creation validation through LicenseService channel enabled and max-count methods.
- [x] 3.4 Wire outbound channel fee checks through LicenseService message fee and credit methods where channel billing already exists.
- [x] 3.5 Avoid adding license logic inside unrelated business services; route guards or narrow helper calls should own gating.

## 4. Tests and Verification

- [x] 4.1 Add unit coverage for allow-all default behavior and unknown feature allow behavior.
- [x] 4.2 Add unit coverage for env provider disabled features, channel limits, message fees, and insufficient credits.
- [x] 4.3 Add unit coverage for cache provider cache-hit and cache-miss fallback behavior.
- [x] 4.4 Add route/service coverage for a disabled feature returning `FEATURE_NOT_ENABLED`.
- [x] 4.5 Add route/service coverage for channel limit exceeded returning `CHANNEL_LIMIT_EXCEEDED`.
- [x] 4.6 Run the focused API test suite and OpenSpec validation for `license-service` and `channel-billing`.

## 5. Documentation and Cleanup

- [x] 5.1 Document the supported `LICENSE_PROVIDER` values and JSON override examples in the relevant env/docs location.
- [x] 5.2 Remove stale comments that describe the license data as a mock remote fetch.
- [x] 5.3 Confirm no database migration is introduced for this change.
