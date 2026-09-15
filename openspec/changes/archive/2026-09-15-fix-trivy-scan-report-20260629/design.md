## Context

`docs/TRIVY_SCAN_REPORT_20260629.md` reports 42 deduplicated HIGH/CRITICAL findings from `pnpm-lock.yaml`. The affected packages are a mix of direct dependencies (`next`, `axios`, `fastify`, `xlsx`) and transitive dependencies:

- `fast-jwt` comes through `@fastify/jwt`.
- `jsonpath-plus` comes through `json-rules-engine`.
- `@xmldom/xmldom` comes through `mammoth`.
- `lodash` comes through `minio`.
- `ws` and `socket.io-parser` come through `socket.io`, `socket.io-client`, `engine.io`, and `@fastify/websocket`.

The remediation must update package manifests and regenerate `pnpm-lock.yaml` through pnpm resolution. Manual lockfile-only edits are not acceptable because they can produce an install state that does not match package manifests or deployed dependency graphs.

## Goals / Non-Goals

**Goals:**

- Remove or reduce all HIGH/CRITICAL findings listed in the 2026-06-29 Trivy report.
- Prefer direct dependency upgrades when an owning package has a compatible fixed release.
- Use root-level `pnpm.overrides` only when the owning package cannot yet express a safe fixed transitive version and compatibility can be validated.
- Preserve API auth behavior, automation rule evaluation, web build/runtime behavior, webchat/widget sockets, XML/doc parsing, and spreadsheet import behavior.
- Produce a refreshed Trivy scan result and a short remediation note for any remaining findings.

**Non-Goals:**

- No database schema changes.
- No API contract changes.
- No broad framework rewrite or package-manager migration.
- No suppression of vulnerabilities without either a fixed-version explanation or a residual-risk entry.

## Decisions

### Decision: Upgrade owners before forcing transitive overrides

The first pass will update direct owners such as `@fastify/jwt`, `fastify`, `next`, `axios`, `socket.io`, `socket.io-client`, `@fastify/websocket`, `mammoth`, and `minio` where compatible versions resolve the vulnerable transitive packages.

Alternative considered: add `pnpm.overrides` for every vulnerable transitive package immediately. That is faster but riskier because packages such as `json-rules-engine` may depend on behavior of a specific `jsonpath-plus` major version. Owner upgrades keep dependency contracts closer to upstream tested combinations.

### Decision: Use overrides only with compatibility checks

If a transitive package remains vulnerable after owner upgrades, use root `pnpm.overrides` for the smallest package/version override that clears the finding. Each override must be paired with a compatibility check covering the code path that uses it.

Examples:

- `jsonpath-plus`: validate automation condition evaluation through existing automation tests or a focused rule-evaluation smoke test.
- `@xmldom/xmldom`: validate document parsing paths that use `mammoth`.
- `lodash`: prefer a `minio` upgrade; override only if no compatible `minio` release resolves it.
- `ws` / `socket.io-parser`: prefer Socket.IO family upgrades; override only if compatible.

### Decision: Treat unavailable fixed versions as residual risk, not silent success

Some report recommendations may point at versions that are not available in the current registry, not compatible with the current package, or not reachable in this environment. When that happens, the implementation must document the blocker, keep the package pinned to the safest compatible version, and leave a residual-risk note instead of claiming remediation.

### Decision: Validate the runtime surface, not only installation

Dependency upgrades can break behavior without TypeScript errors. Validation must include package installation, lockfile regeneration, builds, targeted tests/smoke checks, and a refreshed Trivy scan. The minimum acceptance gate is:

- `pnpm install --lockfile-only` or equivalent lockfile refresh from manifests
- `pnpm --filter @open333crm/api build`
- `pnpm --filter @open333crm/web build`
- targeted tests or smoke checks for auth/JWT, automation rules, webchat/widget sockets, document parsing, and spreadsheet import where affected
- refreshed Trivy filesystem scan showing no unhandled HIGH/CRITICAL findings from the report

## Risks / Trade-offs

- [Risk] Major transitive upgrades can break hidden package assumptions. -> Mitigation: prefer owner upgrades; use overrides only after focused compatibility tests.
- [Risk] A report-recommended version may not exist or may be unavailable. -> Mitigation: document the exact blocker and residual risk; do not mark the finding fixed.
- [Risk] Web/framework upgrades may introduce build or runtime changes. -> Mitigation: build web and API separately, then run the broadest practical monorepo build.
- [Risk] Security fixes can be spread across many packages and lockfile changes. -> Mitigation: keep remediation grouped by package family and verify each family against Trivy output.
- [Risk] Network-restricted environments may prevent dependency downloads or Trivy DB refresh. -> Mitigation: run local lockfile/build checks first; request network approval only for package resolution or scan DB refresh when needed during apply.

## Migration Plan

1. Update package manifests by owner package family, starting with CRITICAL findings.
2. Regenerate `pnpm-lock.yaml` through pnpm.
3. Build and test affected packages after each major family where practical.
4. Run a final Trivy filesystem scan and compare against `docs/TRIVY_SCAN_REPORT_20260629.md`.
5. Update or add a remediation note documenting fixed packages and any residual findings.

Rollback is a git revert of package manifest and lockfile changes. No data migration is involved.

## Open Questions

- Which Trivy DB version produced the 2026-06-29 report, and should apply re-scan with the same DB snapshot or the latest available DB?
- Are report-recommended versions such as `xlsx@0.20.2` available in the configured registry? If not, should spreadsheet import move to an alternative maintained package in a later change?
