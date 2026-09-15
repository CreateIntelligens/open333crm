## Why

Open333CRM currently provides provider-based single-turn LLM generation, KB retrieval, conversation history, classification, sentiment analysis, and automatic handoff. It cannot let the model decide when to retrieve live web facts, read pages, fetch weather, or publish a long-form answer, so these capabilities cannot be composed into the Agent flow described by the product direction.

## What Changes

- Add a tenant-scoped Agent runner that supports model-selected tool calls and returns tool results to the model for another reasoning turn.
- Support a hard maximum of 100 Agent turns, plus independent timeout, tool-call, token, and repeated-call guards.
- Add `search_web` and `read_web_page` tools using `https://2md.aiurl.tw/` as the primary service, then `https://2md.glsoft.ai/`, then `https://create360.ai` as fallbacks.
- Add `get_live_weather` using a server-side weather provider with validated location and bounded response data.
- Add a guarded `publish_wiki_report` tool using the David888 Wiki REST API and return only its public `shareUrl`.
- Persist Agent runs, tool calls, status, expiry, and public report links with a three-day TTL for temporary execution data and unpublished drafts.
- Connect inbound BOT_HANDLED text messages to the Agent flow behind a safe tenant/global feature flag while preserving the existing KB auto-reply fallback.
- Add tests, API contracts, security controls, operational cleanup, and `CHANGELOG.md` documentation.

## Capabilities

### New Capabilities

- `agentic-llm-orchestration`: Tenant-scoped Agent runs, tool calling, 100-turn bounded loop, safeguards, and final response delivery.
- `web-research-tools`: Live web search and URL reading through the specified 2md/create360 fallback chain.
- `wiki-report-publishing`: Long-form report generation and publication to David888 Wiki with public share URL handling.
- `agent-execution-retention`: Three-day expiry and cleanup of temporary Agent execution data and unpublished drafts.

### Modified Capabilities

- None.

## Impact

- API: new Agent service, tool registry, provider contract extensions, routes, inbound integration, and weather client.
- Database: new Prisma models and migration for Agent runs/tool calls/report drafts, with tenant indexes and expiry indexes.
- Workers: scheduled cleanup job for expired Agent data.
- Configuration: feature flag, service URLs, limits, weather configuration, and Wiki credentials.
- Security: SSRF-safe URL validation, external response validation, tenant isolation, RBAC for manual runs and publishing, redaction of secrets, and rate/cost limits.
- Documentation: OpenSpec artifacts, environment example, API contract documentation, and latest `CHANGELOG.md` section.
