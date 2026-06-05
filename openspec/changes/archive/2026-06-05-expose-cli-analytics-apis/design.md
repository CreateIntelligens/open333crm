## Context

The current CLI migration adds `open333 login`, `open333 status`, and `open333 apis` with server-side CLI sessions, hashed `cli_` tokens, narrow default scopes, and a curated endpoint registry. That gives the CLI identity and discovery, but no business value beyond proving the connection.

The API already has dashboard analytics routes under `/api/v1/analytics/*`. Those routes are browser/admin-oriented and protected by the existing web authentication plus supervisor RBAC. CLI tokens should not be accepted broadly on those routes until each exposed surface has explicit scopes, field limits, and discovery metadata.

## Goals / Non-Goals

**Goals:**
- Add read-only CLI access to aggregate CRM statistics.
- Keep CLI token access explicit through `cli:analytics:read`.
- Expose a curated CLI-facing route surface that can be listed by `open333 apis`.
- Reuse existing analytics service functions so calculations match the dashboard.
- Add a CLI command for operators and future agent workflows to fetch statistics from the configured profile.

**Non-Goals:**
- Do not expose raw conversation messages, contact details, timelines, exports, automation, settings, marketing, or write operations.
- Do not make all existing `/api/v1/analytics/*` routes accept CLI tokens.
- Do not add new database tables or analytics calculation models.
- Do not introduce Socket.IO, workers, queues, or realtime behavior.

## Decisions

1. Add dedicated CLI-facing analytics routes.
   - Use routes under `/api/v1/cli/analytics/*`, for example `/api/v1/cli/analytics/overview`, `/message-trend`, `/cases`, `/channels`, and `/my`.
   - These route handlers authenticate with `authenticateCliSession` and check `cli:analytics:read`.
   - Rationale: a separate CLI/public facade is a common API boundary when auth model, scopes, output shape, and stability promises differ from the browser/admin API. It avoids granting CLI tokens access to every dashboard analytics route while still sharing business logic.
   - Alternative considered: allow CLI tokens on `/api/v1/analytics/*`. That is less code, but it couples browser RBAC and CLI scopes too tightly and makes future field restrictions harder to review.

2. Reuse analytics service logic instead of duplicating calculations.
   - CLI route handlers should call existing helpers such as `getOverviewStats`, `getMessageTrend`, `getCaseStats`, `getChannelAnalytics`, and `getMyPerformance`.
   - If a service response contains fields that are too detailed for CLI exposure, introduce a small response mapper in the CLI route module rather than changing the dashboard service contract.
   - Rationale: route duplication is acceptable for product boundaries; business logic duplication is not.
   - Alternative considered: create separate CLI analytics queries. That would increase drift risk and make dashboard/CLI numbers disagree.

3. Keep analytics scope separate from status and discovery.
   - New scope: `cli:analytics:read`.
   - Existing CLI tokens with only `cli:status` and `cli:apis` must not see or call analytics endpoints.
   - Login/session creation may continue issuing narrow default scopes unless the implementation intentionally grants analytics to a role or test path.
   - Rationale: users should be able to inspect identity/discovery without automatically receiving business data access.

4. Extend curated discovery metadata.
   - Add a `statistics` or `analytics` capability group to the CLI endpoint registry.
   - Each endpoint should include method, path, scope, description, date-range params, grouping params where applicable, and example values.
   - Discovery must hide analytics capabilities from tokens that lack `cli:analytics:read`.
   - Rationale: `open333 apis` remains the source of truth for what the current token can call.

5. Add a CLI statistics command.
   - Add a command such as `open333 stats` with flags for `--profile`, `--from`, `--to`, `--group-by`, and `--json`.
   - Default behavior should print a compact overview and current-agent performance. JSON mode can include the full curated response.
   - Rationale: a human operator needs a useful command, while JSON mode gives scripts and LLM-operated flows stable structured output.

## Risks / Trade-offs

- [Risk] CLI-facing routes can drift from dashboard routes. → Reuse analytics service helpers and cover representative parity in tests.
- [Risk] Existing tokens unexpectedly gain data access. → Keep `cli:analytics:read` out of the base status/discovery scope unless deliberately granted.
- [Risk] Aggregates can still reveal sensitive business volume. → Keep the scope explicit, tenant-scoped, and read-only; avoid raw record lists and CSV export.
- [Risk] Role expectations differ between browser supervisor analytics and CLI users. → Decide access through CLI scopes, and only grant the analytics scope to users/sessions intended to view aggregate statistics.
- [Risk] CLI output becomes unstable as dashboard analytics evolve. → Treat CLI response mappers and discovery metadata as the stable contract.

## Migration Plan

1. Add backend CLI analytics routes under the existing `/api/v1/cli` module.
2. Add `cli:analytics:read` scope checks and 403 responses for insufficient scope.
3. Extend the CLI capability registry with analytics endpoints and params.
4. Add `open333 stats` to the CLI package using existing profile/token lookup and API client helpers.
5. Add API and CLI tests for discovery visibility, scope denial, successful aggregate reads, and JSON/text output.
6. Verify with CLI TypeScript build and sandbox install.

Rollback: remove the CLI analytics routes, remove the analytics capability metadata, and remove the CLI stats command. Existing CLI login/status/apis behavior should remain unchanged.

## Open Questions

- Should analytics scope be granted automatically to ADMIN/SUPERVISOR CLI sessions, or should the login endpoint continue issuing only status/discovery until a token-management UI exists?
- Should `open333 stats` fetch all supported datasets by default, or start with overview plus `my` and require flags for heavier trend queries?
