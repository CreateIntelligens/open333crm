# Remediation Notes

## Dependency Changes

Direct manifest upgrades:

- `apps/api`: `@fastify/jwt` to `^10.1.0`, `@fastify/websocket` to `^11.2.0`, `fastify` to `^5.8.5`, `json-rules-engine` to `^7.3.1`, `socket.io` to `^4.8.3`
- `apps/web`: `axios` to `^1.16.0`, `next` to `^15.5.18`, `socket.io-client` to `^4.8.3`
- `apps/widget`: `socket.io-client` to `^4.8.3`
- `packages/core`: `axios` to `^1.16.0`, `json-rules-engine` to `^7.3.1`
- `packages/brain`: `axios` to `^1.16.0`
- `packages/automation`: `json-rules-engine` to `^7.3.1`

Root `pnpm.overrides` are used only for transitive packages whose owners do not yet publish a fixed owner release or whose owner range still permits vulnerable resolution:

- `@xmldom/xmldom@0.8.13`
- `defu@6.1.7`
- `effect@3.21.4`
- `fast-uri@3.1.3`
- `fast-xml-builder@1.1.9`
- `form-data@4.0.6`
- `lodash@4.18.1`
- `socket.io-parser@4.2.6`
- `ws@8.21.0`

## Refreshed Trivy Result

Docker command:

```bash
docker run --rm -v /Users/louis/Desktop/open333crm:/work aquasec/trivy:latest fs --scanners vuln --pkg-types library --severity HIGH,CRITICAL --format json --output /work/openspec/changes/fix-trivy-scan-report-20260629/trivy-refresh.json /work
```

Local Trivy command:

```bash
env DOCKER_CONFIG=/tmp/trivy-empty-docker-config trivy fs --db-repository ghcr.io/aquasecurity/trivy-db:2 --scanners vuln --pkg-types library --severity HIGH,CRITICAL --format json --output openspec/changes/fix-trivy-scan-report-20260629/trivy-refresh-local.json .
```

Result:

- Original report: 42 HIGH/CRITICAL rows from `pnpm-lock.yaml`
- Refreshed report: 2 HIGH rows from `pnpm-lock.yaml`
- Docker refreshed report file: `openspec/changes/fix-trivy-scan-report-20260629/trivy-refresh.json`
- Local Trivy refreshed report file: `openspec/changes/fix-trivy-scan-report-20260629/trivy-refresh-local.json`

Remaining findings:

| Package | Installed | Severity | CVE | Trivy fixed version |
| --- | --- | --- | --- | --- |
| `xlsx` | `0.18.5` | HIGH | `CVE-2023-30533` | `0.19.3` |
| `xlsx` | `0.18.5` | HIGH | `CVE-2024-22363` | `0.20.2` |

## Residual Risk

`xlsx` remains because the npm registry does not publish the fixed versions reported by Trivy:

- `pnpm view xlsx@0.19.3 version --json` returns `E404`
- `pnpm view xlsx@0.20.2 version --json` returns `E404`
- `pnpm view xlsx version versions --json` reports latest `0.18.5`

Current owner: API knowledge import, `apps/api/src/modules/knowledge/file-parser.service.ts`.

Risk path: user-uploaded `.xlsx` and `.csv` files are parsed during knowledge import. The package is not used in browser runtime and does not execute macros, but it still parses untrusted workbook input in the API process.

Follow-up migration options:

- Replace workbook parsing with a maintained package such as `exceljs` after compatibility testing.
- Split CSV handling to a CSV-specific parser so the `xlsx` package is only used for workbook files.
- If SheetJS publishes a fixed npm version or approved tarball, upgrade and remove this residual item.

## Validation

Passed:

- `pnpm install`
- `pnpm why fast-jwt jsonpath-plus @xmldom/xmldom lodash ws socket.io-parser fast-uri form-data defu effect fast-xml-builder axios next fastify xlsx --recursive`
- `pnpm --filter @open333crm/api build`
- `pnpm --filter @open333crm/web build`
- `pnpm --filter @open333crm/automation build`
- `pnpm --filter @open333crm/core build`
- `pnpm --filter @open333crm/api exec tsx src/__tests__/cli-session-auth.test.ts`
- Automation rule evaluation smoke using built `packages/automation/dist/rules/evaluator.js`
- XLSX parser smoke through `parseFileToMarkdown` and `parseSpreadsheetToQaRows`
- Socket.IO server/client websocket handshake smoke
- Refreshed Trivy scan
- Local Trivy 0.72.0 refreshed scan

Notes:

- `pnpm --filter @open333crm/web build` exits successfully but still prints the existing ESLint configuration warning: `Cannot find package 'eslint-config-next' imported from apps/web/eslint.config.mjs`.
- Initial `pnpm install` printed existing `apache-arrow` bin symlink warnings for `arrow2csv`; install completed successfully.
