## Context

The current API uses `apps/api/src/modules/ai/llm.service.ts` for one provider generation call. `kb-autoreply.service.ts` performs deterministic embedding search and passes recent history plus KB text to that call. Ollama and Gemini are the active providers. Canvas already has configured `API_FETCH` and `AI_GEN` nodes, but neither is an LLM-selected tool. The repository has no web research adapter or Wiki publishing adapter.

The requested architecture needs a provider-neutral tool contract, provider-specific serialization, an execution trace, and safe outbound HTTP boundaries. The existing inbound flow must remain usable when the new Agent mode is disabled or an external dependency fails.

## Goals / Non-Goals

**Goals:**

- Add a reusable Agent runner with a hard 100-turn ceiling and independent operational guards.
- Support Ollama and Gemini tool-call formats without breaking existing single-turn generation callers.
- Implement web search and page reading with the requested primary/fallback chain.
- Implement live weather lookup and controlled Wiki publication.
- Preserve tenant isolation, RBAC, existing delivery semantics, usage accounting, and KB fallback.
- Expire temporary Agent state after three days.

**Non-Goals:**

- Replacing the existing KB retrieval implementation.
- Letting the model execute arbitrary HTTP requests, shell commands, database queries, or channel sends.
- Deleting CRM conversation history or already-published Wiki pages.
- Adding a new frontend dashboard in the first slice; the API trace is sufficient for the initial capability.

## Decisions

### 1. Provider-neutral tool contract with provider adapters

Extend the existing provider abstraction with tool declarations and a tool-aware turn response while keeping `generate()` unchanged for current callers. Ollama messages will use its documented `assistant.tool_calls` and `tool` message format. Gemini requests will use function declarations and function-call/function-response parts. The runner owns execution; the provider never executes application code.

Alternative rejected: implementing only an OpenAI-compatible provider, because the project currently supports Ollama and Gemini and neither should silently lose capability.

### 2. One runner, explicit allowlist

Create an Agent runner and registry under `apps/api/src/modules/ai/agent`. The registry contains only `search_web`, `read_web_page`, `get_live_weather`, and `publish_wiki_report`. Each tool owns input validation, output normalization, timeout, and audit redaction. The runner passes only safe tool definitions to the model and limits tools by run context.

### 3. Web adapter fallback chain

Use `https://2md.aiurl.tw/` first, then `https://2md.glsoft.ai/`, then `https://create360.ai`. Reader calls use the documented JSON POST shape where possible; search calls use the documented `/search?q=` shape. Responses are requested as JSON, validated, normalized, and capped. A failed provider is logged without exposing response bodies to the user.

### 4. Weather via Open-Meteo

Use Open-Meteo geocoding followed by its forecast endpoint for current weather. This avoids embedding a tenant API key and provides structured latitude/longitude, timezone, temperature, humidity, wind, and weather code data. Both responses are schema-checked and bounded.

### 5. Wiki side effects are policy-gated

Wiki publication requires an explicit runtime capability and a configured Wiki API token when the deployment requires authentication. Paths are generated or validated as safe slugs; Markdown is size-limited. The response parser requires a public `shareUrl` and never returns the internal edit URL. The run ID supplies idempotency metadata and the URL is persisted.

### 6. Safety budgets

The runner uses `MAX_TURNS = 100` as an immutable upper bound. Defaults also limit wall-clock duration, tool calls, repeated identical calls, output characters, and token usage. Configuration can make limits stricter but cannot raise the 100-turn ceiling. A stopped run returns a clear handoff/fallback message and records the reason.

### 7. Retention model

Add `AgentRun`, `AgentToolCall`, and `AgentReportDraft` records with `expiresAt`. Temporary Markdown and tool result payloads are cleared during cleanup; status, counts, errors, timestamps, and public share URL metadata remain as a small audit record. Cleanup runs in the standalone workers process using a repeatable BullMQ job.

### 8. Inbound integration and rollback

On `message.received`, Agent mode is attempted before KB auto-reply only for eligible text messages and BOT_HANDLED conversations. A successful Agent run owns the reply. A disabled flag, missing provider tool support, expired run, or failure before final text falls back to `attemptKbAutoReply`. The feature is disabled by default until deployment configuration enables it, making rollback an environment change.

## Risks / Trade-offs

- **100 turns can be expensive** → enforce timeout, tool-call, token, repeated-call, and monthly quota guards.
- **Web content can contain prompt injection** → label it as untrusted context, keep system instructions separate, and never allow content to authorize publishing or arbitrary tools.
- **SSRF through page reading** → validate schemes, credentials, DNS/IP targets, redirects, ports, and response size.
- **External service shape changes** → validate every response, use fallback providers, and keep the existing KB reply path.
- **Wiki retry can duplicate pages** → derive a stable run idempotency key, persist publication state, and verify the returned public URL.
- **Existing API process owns EventBus subscribers** → emit inbound delivery in API as today; use worker scheduling only for retention cleanup and other background work.

## Migration Plan

1. Add Prisma models and a non-destructive migration; run `pnpm db:generate` and migrate deployment databases.
2. Deploy provider/tool contracts and unit tests with Agent mode disabled.
3. Configure the 2md endpoints, Open-Meteo endpoint, Wiki API credentials, and conservative limits.
4. Enable Agent mode for a test tenant, verify trace, fallback, expiry, and LINE delivery.
5. Gradually enable other tenants. Roll back by disabling the feature flag; existing KB auto-reply remains active.
