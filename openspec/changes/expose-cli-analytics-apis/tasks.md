## 1. Backend CLI Analytics Surface

- [x] 1.1 Add a `cli:analytics:read` scope constant or shared helper usage where CLI session scopes are checked.
- [x] 1.2 Add CLI analytics routes under the existing `/api/v1/cli` boundary for overview, message trend, cases, channels, and current-agent performance.
- [x] 1.3 Protect every CLI analytics route with `authenticateCliSession` and an explicit `cli:analytics:read` insufficient-scope response.
- [x] 1.4 Reuse existing analytics service functions for calculations and add CLI response mapping only where fields need to be omitted or summarized.
- [x] 1.5 Keep default CLI login/session scopes limited to status and discovery unless a deliberate analytics-scoped session path or test helper is added.

## 2. Discovery Metadata

- [x] 2.1 Extend the CLI endpoint registry with an analytics/statistics capability group.
- [x] 2.2 Add endpoint metadata for each CLI analytics route, including method, path, required scopes, date-range params, grouping params, and example values.
- [x] 2.3 Verify discovery omits analytics capabilities for tokens without `cli:analytics:read`.
- [x] 2.4 Verify discovery includes analytics capabilities for tokens with `cli:analytics:read`.

## 3. CLI Command

- [x] 3.1 Add an `open333 stats` command to the oclif command registry.
- [x] 3.2 Support `--profile`, `--from`, `--to`, `--group-by`, and `--json` flags.
- [x] 3.3 Use existing profile config, keychain credential loading, and API client helpers instead of adding a separate credential path.
- [x] 3.4 Print compact human-readable statistics in text mode.
- [x] 3.5 Print structured JSON output in JSON mode.
- [x] 3.6 Report insufficient scope clearly when the API returns HTTP 403.

## 4. Tests

- [x] 4.1 Add API tests for invalid CLI token rejection on CLI analytics routes.
- [x] 4.2 Add API tests for valid CLI token without `cli:analytics:read` returning HTTP 403.
- [x] 4.3 Add API tests for analytics-scoped CLI token returning tenant-scoped aggregate data.
- [x] 4.4 Add API tests proving analytics discovery metadata is scope-filtered.
- [x] 4.5 Add CLI tests or focused command-level coverage for text output, JSON output, missing profile/token behavior, and insufficient scope handling.

## 5. Verification

- [x] 5.1 Run API TypeScript/test validation covering CLI session auth and analytics routes.
- [x] 5.2 Run CLI TypeScript validation.
- [x] 5.3 Run the CLI sandbox build/install check and verify `open333 stats --help` resolves from the installed binary.
- [x] 5.4 Run `openspec status --change expose-cli-analytics-apis` and confirm implementation tasks can be tracked.
