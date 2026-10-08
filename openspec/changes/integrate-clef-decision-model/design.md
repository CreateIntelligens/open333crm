# Design

## Context

See proposal.md for motivation and the delta specs for observable behavior. The CRM currently runs inbound reply routing, keyword triggers, handoff, sentiment, and case classification in API/worker flows. Clef's OpenAPI contract accepts one `state` and a keyed `questions` object, and returns typed answers with confidence/probabilities, usage, and latency. A synthetic request returned successfully in 10.192 seconds on the current CPU deployment. Existing AI settings are tenant-scoped, use `settings.manage`, and already provide an encrypted BYOK-key pattern.

## Goals / Non-Goals

**Goals:**

- Use one bounded inference request for the independent decisions needed at each workflow point.
- Keep provider transport and response parsing separate from business policy and fallback behavior.
- Let each tenant configure multiple provider instances and a clear fallback order.
- Allow a deployment to disable the decision chain and return all workflows to their established behavior.
- Keep candidate entities, case writes, and usage records tenant scoped.

**Non-Goals:**

- Sending identity-binding, account-merge, or other confirmation-sensitive actions to Clef for execution.
- Letting Clef compose or send customer-facing replies; existing Agent, KB, and automation paths own replies.
- Sending full conversation histories or unrestricted CRM records to Clef.
- Treating every provider as if it uses the Clef SystemOne HTTP schema.

## Decisions

### Decision matrix

| Workflow | Shared decision question | Criteria / input | CRM behavior after confidence validation | Fallback |
|---|---|---|---|---|
| Inbound intent | `intent` / `choice` | Current text; `product_inquiry`, `order_issue`, `return_exchange`, `payment_issue`, `shipping_delivery`, `account_issue`, `technical_support`, `complaint_feedback`, `faq`, `general_assistance`, `other` | Publish `intent.detected` for matching tenant automation. `faq` follows existing KB eligibility and grounding; `general_assistance` follows existing Agent/bot-mode eligibility. At most one reply is sent. | Existing exact keyword rules, then existing Agent/KB routing. |
| Handoff request | `handoff_request` / `noul` | Current text; `noul` is the probability that the customer asks for a human agent | At `noul` ≥ 0.90, transition an eligible `BOT_HANDLED` conversation using the existing idempotent handoff flow. | Explicit `handoff_request` postback and configured handoff keywords remain immediate; exhausted provider chain leaves other messages in the existing Agent/KB path. |
| Sentiment | `sentiment` / `choice` | Current text; `positive`, `neutral`, `negative` | Persist the existing sentiment fact; publish `sentiment.negative` at confidence ≥ 0.60. | Existing sentiment LLM and keyword fallback. |
| Case category | `case_category` / `choice` | Latest inbound case text; `產品諮詢`, `訂單問題`, `退換貨`, `帳號問題`, `技術支援`, `投訴建議`, `付款問題`, `物流配送`, `其他` | At confidence ≥ 0.70, fill category only when unset. | Existing classifier and its keyword fallback. |
| Case urgency | `case_urgency` / `score` | Case text; ordered `LOW`, `MEDIUM`, `HIGH`, `URGENT` criteria mapped to Case priority | At confidence ≥ 0.70, map the legend entry with the highest probability only when creation omitted priority. | Keep current Case priority. |
| Team recommendation | `team_recommendation` / `choice` | Case text; IDs and labels of active teams eligible for the tenant and channel | At confidence ≥ 0.70 and only when creation omitted team, validate the returned ID and use that team; existing round-robin chooses an eligible agent. | Existing team selection and round-robin assignment. |

The model classifies and recommends. It does not execute automation actions, send replies, change identity bindings, or bypass tenant and channel checks. Shared question keys and criteria live in one catalog so the request builder, worker, editor, and tests use the same values.

### Tenant provider registry and editable order

Store one row per provider instance in a tenant-scoped `DecisionProvider` table. Each row holds a stable ID, display name, provider family (`clef`, `openai`, or `jev`), base URL, model ID, encrypted optional API key, enabled state, order, and provider timeout. Two local Clef models are two separate Clef rows, so they can use different endpoints and model IDs. The per-tenant ordered IDs form the fallback chain for all decision features.

Expose this registry in the existing AI settings surface. Require `settings.manage` for list, create, update, disable, reorder, and connection-test operations. Return key-configured and masked-key state only. Credential writes are write-only; audit records include instance ID and operation but omit the key, request body, and URL query values. Apply the existing credential AES-GCM helper with `CREDENTIAL_ENCRYPTION_KEY`.

The provider table is a tenant table: every query includes `tenantId`, the migration enables and forces RLS, and the policy uses the established tenant isolation policy. Local/private base URLs remain valid for local Clef and JEV deployments; access is restricted to authorized settings managers, and connection-test responses expose only reachability, model, latency, and sanitized error codes.

### Provider-specific adapters and per-question fallback

Implement a common adapter contract for building requests and normalizing answers. The Clef adapter uses `/v1/systemone`; OpenAI and JEV adapters use their own documented decision protocols. Do not route all three through the chat-generation provider abstraction. For a decision bundle, try enabled instances in order and accept each question as soon as its schema and confidence threshold pass. Carry only unresolved questions to the next provider. This avoids repeating accepted decisions and supports providers with different question-type capabilities.

When all providers fail or remain below threshold, invoke the existing workflow fallback for each unresolved decision. If no fallback exists, leave that decision unavailable and do not execute a guessed action. Record each attempt separately so operators can see which instance handled a question and where the chain failed.

### Shared transport, provider adapters, domain fallbacks at call sites

Add a small API-side HTTP transport that uses the runtime's `fetch`, per-instance base URL/credential, abort timeout, and a provider-specific adapter. Keep transport outcomes as a discriminated available/unavailable result. The Clef adapter uses `/v1/systemone`; other adapters map to each provider's native request and response contract. The common layer validates answers against the shared catalog and records normalized usage, latency, and bounded errors. Domain services choose the final CRM fallback because it differs by workflow: configured handoff keywords, existing classifier, sentiment provider, current assignment, or no semantic action.

This keeps decision inference independent of the existing chat-generation provider interface and avoids coupling classifications to tenant reply prompts. Reusing `llm.service.ts` or the chat provider registry was considered; those interfaces generate text and require chat generation settings, while this feature requires typed decisions, confidence distributions, provider ordering, and per-decision fallback.

### Batch decisions at each workflow boundary

For an eligible inbound text message, request intent, handoff, and sentiment answers together. For an eligible new case, request category, urgency, and team recommendation together. Each provider receives one keyed question bundle for currently unresolved questions. If it only answers some questions above threshold, later providers receive only the remaining questions. Skip decisions that are irrelevant to that workflow or already resolved by an explicit deterministic path.

The current worker checks handoff and reply routing on `message.received`; it can perform decision inference there without adding work to the webhook HTTP request. Exact configured handoff/automation keywords and explicit handoff postbacks retain their immediate existing paths. Providers do not select a reply body.

### Minimize state and validate candidates before use

Send the current inbound text plus only the small structured fields needed for the decision. Do not send conversation history by default. For team routing, build candidate IDs from active teams already eligible for the tenant and channel, include only those candidates in Clef criteria, and verify the returned ID against that same set before writing `Case.teamId`. Keep all database reads and writes within the caller's tenant context.

Persist decision metadata and usage measurements, not raw Clef request state. Record input tokens and latency from Clef. Add nullable latency storage to `AiUsage`; map Clef to provider `clef`, model `clef-flash`, input tokens to prompt tokens, and generated tokens to zero. Do not infer monetary cost for Clef without an explicit pricing entry.

### Bounded latency and explicit fallback

Use a global `DECISION_ENGINE_ENABLED` kill switch, per-feature confidence thresholds, per-instance timeouts, and a total chain time budget. The first release defaults the kill switch off until a tenant has at least one enabled provider and an operator opts in. Bound the whole fallback sequence so a slow first provider cannot make a multi-provider chain wait without limit. Existing exact keyword paths run before or independently of decision inference. On provider timeout, transport failure, non-2xx, invalid schema, unsupported question, or below-threshold answer, continue to the next enabled instance while the total budget remains.

The initial confidence defaults are conservative: 0.90 for handoff and semantic automation actions, 0.70 for classification, urgency, and team recommendation, and 0.60 for sentiment escalation. For `noul`, compare its true-probability value to the handoff threshold. For `score`, use the highest-probability legend entry and its confidence. Keep each threshold configurable so production evidence can tune it without changing the API contract.

### Health is provider-specific

Expose a provider-instance health check on the authenticated AI/settings surface, following the existing chat-provider health-check pattern. Report reachability, model, and measured latency without returning response bodies. The CRM's general `/health` remains healthy when any decision provider is down, because fallback behavior keeps the application operational.

## Risks / Trade-offs

- [Clef currently responds in about ten seconds on CPU] → Keep the call off the webhook request, skip it when explicit rules already decide the route, enforce a configurable timeout, and fall back to current behavior.
- [Customer text leaves the CRM for an external inference service] → Enable the feature explicitly per deployment, minimize the submitted state, avoid sending history, and keep raw request data out of usage records.
- [Fallback may send the same customer text to several providers] → Show the configured order in settings, explain that enabled fallback providers may receive the decision state, allow each instance to be disabled, and record every attempt without logging raw state.
- [A provider Base URL can point to an internal endpoint] → Restrict management to `settings.manage`, validate HTTP(S) syntax, return sanitized health results, and keep endpoint fetches behind explicit provider test or decision calls.
- [A confident but incorrect decision can change routing or priority] → Require feature-specific confidence thresholds, validate all IDs against tenant-scoped candidates, preserve user-supplied fields, and keep deterministic keyword/postback controls.
- [Clef schema or availability can change] → Validate every response, record bounded failures, and use existing classifier, sentiment, keyword, and assignment behavior on failure.
- [Inference usage does not include a price] → Record tokens and latency separately from cost; cost remains unpriced until an explicit model-pricing entry exists.

## Migration Plan

1. Add the `DecisionProvider` table with tenant indexes, encrypted key field, RLS enable/force/policy, and optional `AiUsage.latencyMs`; deploy the additive migration using the owner connection.
2. Deploy provider CRUD, settings UI, adapters, and decision-chain logic with `DECISION_ENGINE_ENABLED=0`.
3. Configure the two local Clef instances and optional OpenAI/JEV instances in the tenant settings UI, test each endpoint, and set their order.
4. Enable decisions for a controlled tenant; review per-instance latency, confidence, and fallback outcomes before enabling additional tenants.
5. Roll back by setting `DECISION_ENGINE_ENABLED=0`; existing keyword, LLM classification/sentiment, and round-robin paths remain available. Provider rows and nullable usage fields can remain without affecting older code.

## Open Questions

- Confirm the JEV decision API contract (endpoint path, authentication header, request format, response schema, and supported question types) before implementing its adapter. The provider registry and fallback contract do not depend on this protocol; task 3.3 uses the confirmed JEV contract to create adapter fixtures.
