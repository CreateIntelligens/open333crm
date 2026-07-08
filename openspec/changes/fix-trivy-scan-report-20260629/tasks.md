## 1. Vulnerability Inventory

- [x] 1.1 Read `docs/TRIVY_SCAN_REPORT_20260629.md`, `trivy-fs.json`, and `pnpm-lock.yaml` to confirm the HIGH/CRITICAL package list, vulnerable versions, fixed-version guidance, and dependency paths.
- [x] 1.2 Run `pnpm why` for `fast-jwt`, `jsonpath-plus`, `@xmldom/xmldom`, `lodash`, `ws`, and `socket.io-parser` to identify direct owners before editing manifests.
- [x] 1.3 Split findings into direct manifest upgrades, owner-package upgrades, transitive overrides, and blocked/unavailable fixes.

## 2. Critical Remediation

- [x] 2.1 Upgrade the Fastify JWT dependency path so `fast-jwt` resolves to a non-vulnerable version, preferring an `@fastify/jwt` owner upgrade over a direct override.
- [x] 2.2 Upgrade or safely override the automation rule dependency path so `jsonpath-plus` resolves to a non-vulnerable version.
- [x] 2.3 Validate JWT/auth behavior and automation rule condition evaluation after the CRITICAL remediations.

## 3. High Remediation

- [x] 3.1 Upgrade `next` and related Next packages for `apps/web`, then confirm the web build still succeeds.
- [x] 3.2 Upgrade all direct `axios` consumers across workspace manifests and confirm API client imports still compile.
- [x] 3.3 Upgrade Fastify-related runtime packages, including `fastify` and plugin owners where required.
- [x] 3.4 Upgrade XML/document parsing dependencies through `mammoth` or a scoped `@xmldom/xmldom` override, then validate document parsing behavior.
- [x] 3.5 Upgrade Socket.IO/WebSocket dependency owners so `ws` and `socket.io-parser` resolve to fixed versions, then validate API/web/widget socket compatibility.
- [x] 3.6 Upgrade or replace the spreadsheet import dependency for `xlsx`; if no compatible fixed package version is available, document the residual risk and follow-up migration path.
- [x] 3.7 Upgrade or override remaining HIGH findings from the report, including `lodash`, `form-data`, `fast-uri`, `defu`, and `effect` when present in the refreshed dependency graph.

## 4. Lockfile and Validation

- [x] 4.1 Regenerate `pnpm-lock.yaml` with pnpm from the updated manifests and any approved root overrides.
- [x] 4.2 Run `pnpm --filter @open333crm/api build`.
- [x] 4.3 Run `pnpm --filter @open333crm/web build`.
- [x] 4.4 Run targeted smoke or test coverage for auth/JWT, automation rule evaluation, sockets, document parsing, and spreadsheet import.
- [x] 4.5 Run a refreshed Trivy filesystem scan against the updated workspace and compare it with `docs/TRIVY_SCAN_REPORT_20260629.md`.

## 5. Documentation and Residual Risk

- [x] 5.1 Update or add remediation notes documenting fixed packages, remaining findings, unavailable fixed versions, and accepted residual risks.
- [x] 5.2 Ensure any remaining HIGH/CRITICAL finding has a clear owner, reason, risk, and follow-up task before marking the change complete.
- [x] 5.3 Run `openspec validate fix-trivy-scan-report-20260629 --strict` and confirm the change remains valid.
