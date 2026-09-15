## Why

The 2026-06-29 Trivy filesystem scan reports 42 deduplicated HIGH/CRITICAL vulnerabilities from `pnpm-lock.yaml`, including CRITICAL findings in `fast-jwt` and `jsonpath-plus`. These dependencies sit in runtime paths for API auth, web rendering, HTTP clients, XML parsing, WebSocket handling, and spreadsheet import, so the remediation needs to be planned as a controlled dependency upgrade rather than an ad hoc lockfile edit.

## What Changes

- Upgrade vulnerable direct dependencies and transitive dependency owners to versions that clear the HIGH/CRITICAL findings listed in `docs/TRIVY_SCAN_REPORT_20260629.md`.
- Prioritize CRITICAL packages first: `fast-jwt` via the owning Fastify JWT dependency chain, and `jsonpath-plus` via the package that pulls it into the lockfile.
- Upgrade broad-impact runtime packages, including `next`, `axios`, `@xmldom/xmldom`, `fastify`, `lodash`, `socket.io-parser`, `ws`, and `xlsx`, while preserving application behavior.
- Refresh `pnpm-lock.yaml` through pnpm resolution, not by manual lockfile-only edits.
- Re-run package builds and the Trivy filesystem scan to confirm remediation, and document any remaining findings that cannot be upgraded because no compatible fixed version is available.
- No breaking API or database changes are intended.

## Capabilities

### New Capabilities

- `dependency-vulnerability-remediation`: Defines how security scan findings from Trivy/SBOM reports are translated into safe dependency upgrades, validation, and residual-risk documentation.

### Modified Capabilities

- None.

## Impact

- Affected files: root/package workspace manifests as needed, `apps/api/package.json`, `apps/web/package.json`, package manifests for any transitive owners, and `pnpm-lock.yaml`.
- Affected systems: API auth/JWT handling, Fastify HTTP server, Next.js web build/runtime, Axios clients, Socket.IO/WebSocket stack, XML parsing, and spreadsheet import.
- Validation impact: requires targeted package builds, full monorepo build where practical, focused smoke tests for auth/API/web routes, and a refreshed Trivy scan against the updated lockfile.
