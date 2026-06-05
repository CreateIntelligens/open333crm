## Why

Open333 CLI tokens currently support login, status, and API discovery, but they do not expose any useful business data. Read-only statistics are the safest next surface because they help operators and future CLI/LLM workflows inspect CRM health without immediately exposing raw conversations, contacts, or write operations.

## What Changes

- Add CLI-visible analytics capabilities guarded by a new read-only scope such as `cli:analytics:read`.
- Expose curated statistics endpoints for overview, message trends, case statistics, channel analytics, and current-agent performance.
- Keep the CLI surface behind dedicated CLI-facing routes and discovery metadata instead of broadly accepting CLI tokens on every existing web/admin route.
- Reuse existing analytics service logic for calculations so CLI output and dashboard analytics stay consistent.
- Return aggregate and summary data only; do not expose raw conversation messages, contact records, exports, settings, automation, marketing, or write operations in this change.
- Update `open333 apis` discovery metadata so tokens with analytics scope can see the new statistics endpoints and parameter examples.
- Extend the CLI with a statistics command that reads the stored CLI token and calls only the analytics endpoints available to that token.

## Capabilities

### New Capabilities
- `cli-analytics`: Read-only CLI access to curated CRM statistics and analytics discovery metadata.

### Modified Capabilities
- None.

## Impact

- Backend API: add CLI-facing analytics route handlers under the CLI boundary and scope checks for `cli:analytics:read`.
- Analytics services: reuse existing aggregate calculation functions without duplicating business logic.
- CLI discovery: extend the curated endpoint registry with analytics capability metadata, routes, scopes, and parameter examples.
- CLI package: add a command for viewing statistics from the configured host/profile.
- Security: keep CLI token access narrow, read-only, tenant-scoped, and explicit; avoid direct exposure of raw PII-heavy CRM routes.
- Tests: add API coverage for scope enforcement, tenant scoping, discovery visibility, and CLI command output.
