## Context

See `proposal.md` for motivation. Currently `apps/api/src/modules/ai/agent/web-client.ts` defines:
```ts
export const TWO_MD_BASE_URLS = [
  'https://2md.aiurl.tw',
  'https://2md.glsoft.ai',
  'https://create360.ai',
] as const;
```
It implements sequential iteration across these URLs for `search_web` and `read_web_page`. However, every concurrent request initiates separate network calls without coordination. If the primary endpoint degrades, all concurrent requests stall for up to 15 seconds simultaneously and then dump their load in unison onto the second endpoint. Furthermore, Agent runs lack multimodal tools to interpret screenshots and document attachments sent by customers, while `packages/brain/src/services/MarkitdownService.ts` hardcodes a Python virtualenv path for file conversions.

## Goals / Non-Goals

**Goals:**
- Implement an in-memory `SingleFlightManager` to coalesce identical in-flight requests (same URL, search query, or document/image hash) so only one upstream request is dispatched.
- Implement a node health and circuit breaker state tracker across `TWO_MD_BASE_URLS` with failure counts, cooldown periods, and randomized jitter on failovers to prevent cascading thundering herd collapse.
- Add `ocr_image` and `parse_document` tool definitions and executors in `apps/api/src/modules/ai/agent/tool-registry.ts`.
- Update `packages/brain/src/services/MarkitdownService.ts` to use 2md AnyDoc HTTP API as the primary conversion engine with resilient fallback.
- Enforce strict SSRF validation, file size limits (10MB for images, 20MB for documents), and bounded text outputs (30,000 characters).

**Non-Goals:**
- Replacing LLM inference providers (Gemini / Ollama) with 2md.
- Adding distributed cross-pod Redis locks for simple HTTP reads (in-memory single-flight handles process-level traffic bursts with zero Redis latency overhead).
- Implementing deep recursive asynchronous web crawling in the fast agent path.

## Decisions

### Decision 1: In-Memory Single-Flight Coalescing
- **Rationale**: When multiple agents or webhook handlers receive the same URL or identical search query in parallel, they should share a single promise (`Map<string, Promise<T>>`). Once settled, the in-flight entry is cleared and the result is retained in a short-lived cache (60s TTL for searches and pages, 10m TTL for hashed files).
- **Alternatives Considered**:
  - Redis-based distributed single-flight: Adds network roundtrip, serialization overhead, and Redis dependency to every fast tool execution. In-memory single-flight resolves 99% of thundering herds within each Fastify/Worker process with sub-millisecond execution.

### Decision 2: Circuit Breaker & Health State per `TWO_MD_BASE_URLS`
- **Rationale**:
  - Node States: `CLOSED` (healthy), `OPEN` (cooldown, requests skip immediately to next node), `HALF_OPEN` (single probe request allowed).
  - After 3 consecutive network/timeout errors, a node enters `OPEN` state with a 30-second cooldown.
  - Failovers introduce randomized jitter (20–100ms) between subsequent node attempts to break synchronized concurrency waves.
- **Alternatives Considered**:
  - Static round-robin: Distributes load but fails to prioritize the fastest/primary server when all nodes are healthy.
  - Blind retry loop (current state): Causes 15s timeout multiplication and cascading stampedes when primary node goes down.

### Decision 3: Multimodal Agent Tools Integration
- **Rationale**:
  - `ocr_image`: Invokes 2md's PaddleOCR PP-OCRv4 endpoint (`POST /api/ocr` or `/v1/ocr`) with image URL or base64/form data, extracting text lines and layout.
  - `parse_document`: Invokes 2md's AnyDoc endpoint (`POST /`) with document file or URL, returning parsed Markdown.
  - Both tools integrate seamlessly into `tool-registry.ts` and `runner.ts` alongside `search_web` and `read_web_page`.
- **Alternatives Considered**:
  - Running client-side Tesseract.js / Python in process: Heavy CPU consumption, bloated image size, and inferior recognition accuracy on complex Chinese/English receipts.

### Decision 4: `MarkitdownService` Modernization
- **Rationale**: Modernize `MarkitdownService.convertToMarkdown(inputPath)` to submit documents to 2md AnyDoc via multipart HTTP request. If all 2md endpoints fail and a local Python environment is present, it falls back to local execution.
- **Alternatives Considered**:
  - Removing `MarkitdownService` entirely: Would break existing KM vectorization references. Keeping the class interface intact ensures 100% backward compatibility for KM ingestion pipelines.

## Risks / Trade-offs

- **[Risk] Unbounded In-Memory Cache Growth**
  → *Mitigation*: Cap cache entries to 1,000 items and prune expired entries eagerly or upon reaching capacity.
- **[Risk] SSRF and Malicious URL Payloads**
  → *Mitigation*: Reuse and strictly enforce `assertSafePublicHttpUrl` on all image and document URLs before dispatching requests.
- **[Risk] Upstream Outage of All 2md Nodes**
  → *Mitigation*: Fail gracefully with structured tool errors (`All multimodal parsing services currently unavailable`); Agent runner handles tool errors as standard observations without crashing the conversation loop.
