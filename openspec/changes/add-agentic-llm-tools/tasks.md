## 1. Contracts and configuration

- [x] 1.1 Extend the provider-neutral chat contract with tool declarations, tool calls, tool results, and tool-aware turns while keeping existing single-turn callers compatible; verify API typecheck passes.
- [x] 1.2 Add validated Agent, web, weather, Wiki, guard, and three-day retention configuration with safe defaults and an environment example; verify invalid configuration is rejected by config tests.
- [x] 1.3 Add OpenSpec/API contract documentation for Agent run input/output, errors, and trace redaction; verify `openspec validate --change add-agentic-llm-tools` accepts the planning artifacts.

## 2. Persistence and retention

- [x] 2.1 Add Prisma models and migration for tenant-scoped Agent runs, tool calls, and report drafts with status, counters, expiry, and publication metadata; verify `pnpm db:generate` succeeds.
- [x] 2.2 Implement idempotent three-day cleanup for expired temporary payloads and traces without touching CRM messages or published URLs; verify unit tests cover reruns and expiry boundaries.
- [x] 2.3 Register a standalone BullMQ repeating cleanup job and verify the worker starts without duplicate schedules.

## 3. External tools

- [x] 3.1 Implement SSRF-safe URL validation, bounded HTTP fetching, response parsing, and the 2md primary/fallback chain for `read_web_page`; verify unsafe URLs, timeout, fallback, and truncation tests.
- [x] 3.2 Implement `search_web` using the same primary/fallback chain and normalize JSON/Markdown responses to bounded title/URL/snippet results; verify primary success, fallback, malformed response, and query validation tests.
- [x] 3.3 Implement `get_live_weather` with validated Open-Meteo geocoding and forecast response parsing; verify location validation, upstream failure, and normalized weather output tests.
- [x] 3.4 Implement authorized `publish_wiki_report` with path/Markdown limits, optional Bearer credential, idempotency, response validation, and public `shareUrl`-only output; verify unauthorized, duplicate retry, malformed response, and success tests.

## 4. Agent runner and providers

- [x] 4.1 Implement the tenant-scoped tool registry with typed schemas, allowlists, argument validation, output redaction, and per-tool authorization; verify unknown tools and invalid arguments never execute.
- [x] 4.2 Implement Ollama tool-call serialization and tool-result messages based on its chat API contract; verify single, parallel, sequential, malformed, and final-text responses.
- [x] 4.3 Implement Gemini function declaration, function-call, and function-response serialization without changing existing Gemini text generation; verify tool-call and final-answer fixtures.
- [x] 4.4 Implement the Agent loop with a hard immutable 100-turn maximum, timeout/token/tool/repeated-call guards, trace persistence, and safe final fallback; verify every guard and normal multi-tool completion.

## 5. CRM integration and API

- [x] 5.1 Add authenticated tenant-scoped Agent run/status endpoints with Zod validation and permission guards; verify response shape, 404 isolation, and authorization tests.
- [x] 5.2 Run Agent mode before KB auto-reply for eligible BOT_HANDLED text messages, deliver at most one reply, and preserve KB fallback on disabled/failed Agent runs; verify inbound integration tests.
- [x] 5.3 Include published Wiki `shareUrl` in the final Bot response and persist it in the run trace; verify channel delivery and no internal edit URL leakage.
- [x] 5.4 Add `CHANGELOG.md` under `[Unreleased]`, update task checkboxes, run full typecheck/lint/tests, and verify the OpenSpec change is ready to archive.

## 6. Verification checkpoint

- [x] 6.1 Run `pnpm --filter @open333crm/api build`, `pnpm --filter @open333crm/api lint`, relevant `tsx` tests, and `openspec validate --change add-agentic-llm-tools --strict`; API build is blocked only by the pre-existing missing `nodemailer` dependency, while relevant tests, workers build, Prisma validation, lint, and OpenSpec validation pass.
