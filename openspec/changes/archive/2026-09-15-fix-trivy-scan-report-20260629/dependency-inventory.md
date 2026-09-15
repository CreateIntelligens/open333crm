# Dependency Vulnerability Inventory

Source files:

- `docs/TRIVY_SCAN_REPORT_20260629.md`
- `trivy-fs.json`
- `pnpm-lock.yaml`

## Summary

- HIGH/CRITICAL vulnerability rows in `trivy-fs.json`: 42
- Source target: `pnpm-lock.yaml`
- CRITICAL packages: `fast-jwt`, `jsonpath-plus`

## Direct manifest upgrades

- `apps/web/package.json`: `next`, `axios`, `socket.io-client`
- `apps/api/package.json`: `fastify`, `@fastify/jwt`, `@fastify/websocket`, `socket.io`, `mammoth`, `xlsx`
- `apps/widget/package.json`: `socket.io-client`
- `packages/core/package.json`: `axios`, `json-rules-engine`, `minio`
- `packages/brain/package.json`: `axios`
- `packages/automation/package.json`: `json-rules-engine`

## Owner-package upgrades

- `fast-jwt@5.0.6`: owned by `@fastify/jwt@9.1.0`
- `jsonpath-plus@7.2.0`: owned by `json-rules-engine@6.6.0`
- `@xmldom/xmldom@0.8.11`: owned by `mammoth@1.12.0`
- `lodash@4.17.23`: owned by `minio@8.0.7`
- `ws@8.18.3`: owned by `@fastify/websocket`, `socket.io`, `socket.io-client`, `engine.io`, and `engine.io-client`
- `socket.io-parser@4.2.5`: owned by `socket.io` and `socket.io-client`

## Candidate overrides if owner upgrades are insufficient

- `fast-jwt`: `>=6.2.4`
- `jsonpath-plus`: `>=10.3.0`
- `@xmldom/xmldom`: `>=0.8.13`
- `lodash`: `>=4.18.0`
- `ws`: `>=8.21.0`
- `socket.io-parser`: `>=4.2.6`
- `fast-uri`: `>=3.1.2`
- `form-data`: `>=4.0.6`
- `defu`: `>=6.1.5`
- `effect`: `>=3.20.0`
- `fast-xml-builder`: `>=1.1.7`

## Known potentially blocked item

- `xlsx`: report recommends `0.20.2`, but the current manifest uses `^0.18.5`. Verify registry availability during apply. If unavailable or incompatible, document residual risk and migration path.
