## Why

Open333CRM currently uses `2md.aiurl.tw` (along with fallbacks `2md.glsoft.ai` and `create360.ai`) for basic web search (`search_web`) and page extraction (`read_web_page`). However:
1. **Thundering Herd & Cascading Failover**: Concurrent agent runs and inbound requests query upstream endpoints without request coalescing (single-flight). If the primary node degrades, concurrent requests repeatedly hammer the failing node, time out together, and simultaneously cascade onto fallback nodes (thundering herd), risking cascading outages across all `TWO_MD_BASE_URLS`.
2. **Missing Multimodal Grounding Capabilities**: Customers in omnichannel inboxes (LINE, FB Messenger, WebChat) frequently share screenshots, error dialogs, invoices, receipts, and document attachments (PDF/DOCX/XLSX). Agents currently lack image OCR and document parsing tools to comprehend these inputs.
3. **Fragile Python Dependencies in Ingestion**: `packages/brain` relies on a local Python virtualenv (`.venv/bin/markitdown`) via `execAsync`, which is heavy and error-prone in Docker, CI, and worker runtimes. 2md's AnyDoc engine provides sub-5ms cloud parsing for these documents without host Python dependencies.

## What Changes

- **Anti-Thundering-Herd & Single-Flight Client**:
  - Implement single-flight request coalescing so identical in-flight read, search, OCR, or document parsing requests share a single execution promise.
  - Implement short-lived memory caching for normalized queries and URLs to eliminate duplicate upstream bursts.
  - Implement circuit breaker and node health state tracking across `TWO_MD_BASE_URLS` with cooldown and jittered backoff, preventing cascading failover storms.
- **Multimodal Agent Tools (`ocr_image` & `parse_document`)**:
  - Add `ocr_image` tool to `tool-registry.ts` connecting to 2md's PP-OCRv4 engine (`POST /api/ocr` or `/v1/ocr`) to extract text and structured key-value lines from customer screenshots and images.
  - Add `parse_document` tool to `tool-registry.ts` connecting to 2md's AnyDoc engine to parse PDF, DOCX, XLSX, and CSV attachments into clean Markdown.
- **Knowledge Base Ingestion Modernization**:
  - Refactor `MarkitdownService` in `packages/brain` to prioritize 2md's AnyDoc HTTP parsing API with resilient failover, keeping local fallback optional or deprecated.
- **Safety and Quotas**:
  - Enforce strict SSRF protection, size caps (image & document upload bounds), timeout controls, and tenant isolation on all new multimodal grounding paths.

## Capabilities

### New Capabilities
- `two-md-client-resilience`: Anti-thundering-herd single-flight coalescing, short-lived caching, node health tracking, and circuit-breaker failover across `TWO_MD_BASE_URLS`.
- `agentic-multimodal-tools`: Agent tool registry extensions for `ocr_image` and `parse_document` leveraging 2md OCR and AnyDoc engines.

### Modified Capabilities
- `km-ingestion`: Update KM document conversion specification to require remote AnyDoc API parsing with resilient fallback in place of hard dependencies on local Python venvs.

## Impact

- **API (`apps/api`)**:
  - Enhanced `apps/api/src/modules/ai/agent/web-client.ts` with single-flight manager, node health tracker, and resilient request dispatcher.
  - Extended `apps/api/src/modules/ai/agent/tool-registry.ts` with `ocr_image` and `parse_document` definitions and executors.
  - Added schema validation and bounded size checks for binary uploads and remote URLs.
- **Packages (`packages/brain`)**:
  - Updated `packages/brain/src/services/MarkitdownService.ts` to use HTTP AnyDoc endpoints with resilient failover instead of requiring local python `.venv`.
- **Infrastructure / Operational**:
  - Zero external Python runtime dependency in standard Docker containers for document conversion.
  - Significantly reduced upstream latency and bandwidth consumption on 2md services during traffic spikes.
- **Documentation**:
  - OpenSpec artifacts and updated `CHANGELOG.md`.
