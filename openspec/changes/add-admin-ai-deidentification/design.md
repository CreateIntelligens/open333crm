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
7. Add a `privacy` namespace to `Message.metadata`, containing only the masked copy and a bounded mode marker. `content` stays the operational representation: inbound channels retain original content; an agent's default outbound text becomes masked and an explicit opt-out keeps original content. This avoids a database migration, preserves existing Message APIs and lets downstream model readers select the masked copy without exposing it as a normal channel payload.
8. Centralize message-content processing in the privacy service. Every Message writer calls it before persistence, while delivery uses the chosen operational content. Reads that assemble summaries, histories and cross-channel context use `metadata.privacy.maskedContent` whenever present. The existing provider wrapper remains the final guard for any text path that has no stored Message.

## Risks / Trade-offs

- Raw text is sent to 2md before masking → keep feature off until a platform administrator explicitly enables it and explain this on the control.
- Rule detection may miss free-form identities or over-mask product names/numbers → label this as PII masking and use synthetic Taiwan-format examples in tests.
- Added network latency and upstream outages → bound requests and concurrency; stop model dispatch on failure rather than forwarding original text.
- Full category labels reduce distinctions between people and may change search relevance → preserve source records; new embedding calls follow the policy, existing indexes are not automatically regenerated.
- An external de-identification request can delay inbound webhooks → bound the request and return a privacy-processing failure before any model path reads the raw event; upstream channel retry semantics retain delivery responsibility.

## Migration Plan

Deploy code with all policy rows absent, preserving default off. Platform administrators can enable selected tenants after review. Disabling the selected tenant's policy restores unmasked model input for subsequent operations; no database migration or record rewriting is needed.
