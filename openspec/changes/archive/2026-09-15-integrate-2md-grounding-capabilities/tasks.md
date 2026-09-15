## 1. Anti-Thundering-Herd & Resilient 2md Client Infrastructure

- [x] 1.1 Implement `SingleFlightManager` and bounded in-memory response cache in `apps/api/src/modules/ai/agent/web-client.ts`, verifying that concurrent identical URLs/queries trigger only one upstream fetch.
- [x] 1.2 Implement per-host Circuit Breaker and node health state tracking across `TWO_MD_BASE_URLS` with cooldown and randomized jitter, verifying that failing nodes are bypassed without timeout stalls.
- [x] 1.3 Add automated unit tests covering single-flight coalescing, cache TTL expiry, and circuit-breaker failover transitions in `apps/api/src/__tests__/two-md-client-resilience.test.ts`.

## 2. Multimodal Tools for Agent Runner

- [x] 2.1 Implement `ocrThrough2md` in `web-client.ts` targeting 2md PP-OCRv4 endpoint with SSRF checks, 10MB payload limit, and Markdown normalization.
- [x] 2.2 Implement `parseDocumentThrough2md` in `web-client.ts` targeting 2md AnyDoc endpoint with file format validation and character truncation limits.
- [x] 2.3 Register `ocr_image` and `parse_document` in `apps/api/src/modules/ai/agent/tool-registry.ts` with Zod parameter schemas and permission contexts.
- [x] 2.4 Add tests for `ocr_image` and `parse_document` tool execution and error handling in `apps/api/src/__tests__/agent-multimodal-tools.test.ts`.

## 3. Knowledge Base Ingestion Modernization

- [x] 3.1 Refactor `packages/brain/src/services/MarkitdownService.ts` to call 2md AnyDoc HTTP API as the primary document converter with multi-node failover.
- [x] 3.2 Verify `MarkitdownService` successfully parses document buffers without requiring a host Python virtualenv.

## 4. Documentation & Monorepo Verification

- [x] 4.1 Update `CHANGELOG.md` under the date-only heading `## [YYYY-MM-DD]` documenting the new multimodal tools and anti-thundering-herd resilience layer.
- [x] 4.2 Run `pnpm --filter @open333crm/api build` and `scripts/check-tenant-scoping.mjs` to verify zero regressions across the codebase.
