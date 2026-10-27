# Design

## Context

See proposal.md for scope. `generateReply` assembles Chat context; `runAgentReply` supplies a provider to the multi-turn runner. `generateEmbedding` sends input to the configured Ollama host. Platform tenant details are already managed at `/admin/tenants/[id]`.

## Goals / Non-Goals

**Goals:** Add a single policy reader and reusable text-processing boundary while preserving existing provider contracts and tenant executor injection.

**Non-Goals:** Anonymizing image pixels, restoring masked responses, retroactively transforming existing records, or claiming complete anonymity. This is rule-based PII masking. Existing vector data and Agent traces keep their existing retention rules.

## Decisions

1. Store `{ enabled: boolean }` at `ai.privacy.<tenantId>` in existing PlatformSetting. Missing rows mean off; corrupt values and lookup errors stop processing. This avoids a schema migration and tenant-editable settings. Read at operation start without process caching, so later operations see platform changes across API replicas.
2. Add a dedicated platform route resource registered with the existing superuser/password-change guards. Service validates tenant existence and uses one transaction for setting and audit. Runtime reads use the caller's TenantDb; platform writes use the injected platform executor. All keys include the explicit tenant ID.
3. Wrap each operation's ChatProvider rather than duplicating logic in Gemini and Ollama. Only `.generate` and `.generateToolTurn` process content. Process the final assembled system prompt, each history/message content, and nested string values in assistant tool arguments. Preserve protocol identifiers, roles, names, transport settings and credentials. Embedding applies the same text processor before its existing retry loop.
4. POST only to `https://2md.aiurl.tw/api/deid`, with `mode=label`, `retentionMode=none`, `score=false`. No fallback to reader nodes: their de-identification support and data-processing scope are unverified. Reject redirects, enforce a 10-second request timeout, 100,000-character input and 1 MiB output limits. Validate the documented envelope and return only `data.text`.
5. Bound concurrency while masking multiple messages. Deduplicate identical strings only inside one processing batch; retain no cross-call/tenant text cache. Masking failure yields `AI_DEIDENTIFICATION_UNAVAILABLE` with a fixed message; existing Agent fallback may continue only through paths that independently re-apply the policy before model dispatch.
6. Extend the existing platform tenant page with a small independent control. Keep its confirmed boolean unchanged until PATCH succeeds. Load failure shows retry; save failure leaves its confirmed state intact. Use the existing admin visual style (Operate mode).
7. Add a `privacy` namespace to `Message.metadata`, containing only the masked copy and a bounded mode marker. `content` stays the operational representation: inbound channels retain original content; an agent's default outbound text becomes masked and an explicit opt-out keeps original content. Fixed system wording composed in code (registration links, binding notices, CSAT texts, default handoff and return-to-bot notes) keeps its authored text as `content` with mode `system_template`, because rule-based masking misreads ordinary words as names (UAT 2026-10-27: 「下方連結」 became 「下[姓名]」). Model, summary or agent-supplied system text stays masked. This avoids a database migration, preserves existing Message APIs and lets downstream model readers select the masked copy without exposing it as a normal channel payload.
8. Centralize message-content processing in the privacy service. Every Message writer calls it before persistence, while delivery uses the chosen operational content. Reads that assemble summaries, histories and cross-channel context use `metadata.privacy.maskedContent` whenever present. The existing provider wrapper remains the final guard for any text path that has no stored Message.
9. For Material writes, persist the operational body in `Material.body`, its sanitized copy in `Material.maskedBody`, and a bounded `privacyMode`. The default mode makes the sanitized copy the operational body. Explicit original mode keeps the authored body for delivery while retaining the sanitized copy. `MaterialVersion` stores both the operational snapshot and sanitized snapshot so history does not lose the protected representation. Existing records are not rewritten; an enabled body save creates a protected representation. The tenant policy is read on the server and the client mode is only an explicit per-save choice.
10. If processing an Agent trace or final output fails after an `AgentRun` row exists, mark the run failed with a fixed stop reason and completion time, then rethrow the bounded privacy error. The failure update stores no customer text and prevents a run from remaining in `RUNNING`.

## Risks / Trade-offs

- Raw text is sent to 2md before masking → keep feature off until a platform administrator explicitly enables it and explain this on the control.
- Rule detection may miss free-form identities or over-mask product names/numbers → label this as PII masking and use synthetic Taiwan-format examples in tests.
- Added network latency and upstream outages → bound requests and concurrency; stop model dispatch on failure rather than forwarding original text.
- Full category labels reduce distinctions between people and may change search relevance → preserve source records; new embedding calls follow the policy, existing indexes are not automatically regenerated.
- An external de-identification request can delay inbound webhooks → bound the request and return a privacy-processing failure before any model path reads the raw event; upstream channel retry semantics retain delivery responsibility.

## Migration Plan

Deploy code with all policy rows absent, preserving default off. Platform administrators can enable selected tenants after review. The Material sidecar migration is additive and nullable; the deployment entrypoint runs it through `MIGRATE_DATABASE_URL`. Disabling the selected tenant's policy restores unmasked model input for subsequent operations; existing records are not rewritten.
