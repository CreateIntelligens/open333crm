# Design

## Context

See proposal.md for motivation and the delta specs for observable behavior. The CRM currently runs inbound reply routing, keyword triggers, handoff, sentiment, and case classification in API/worker flows. Clef's OpenAPI contract accepts one `state` and a keyed `questions` object, and returns typed answers with confidence/probabilities, usage, and latency. A synthetic request returned successfully in 10.192 seconds on the current CPU deployment.

## Goals / Non-Goals

**Goals:**

- Use one bounded inference request for the independent decisions needed at each workflow point.
- Keep Clef transport and response parsing separate from business policy and fallback behavior.
- Allow a deployment to disable Clef and return all workflows to their established behavior.
- Keep candidate entities, case writes, and usage records tenant scoped.

**Non-Goals:**

- Sending identity-binding, account-merge, or other confirmation-sensitive actions to Clef for execution.
- Letting Clef compose or send customer-facing replies; existing Agent, KB, and automation paths own replies.
- Sending full conversation histories or unrestricted CRM records to Clef.

## Decisions

### One API-side typed client, domain fallbacks at call sites

Add a small API module that uses the runtime's `fetch` and the documented `/v1/systemone` JSON contract. Keep transport outcomes as a discriminated available/unavailable result. It validates question types and answer criteria, maps `usage.input_tokens` and `latency_seconds`, and records bounded error codes. Domain services choose the fallback because the correct fallback differs by workflow: configured handoff keywords, existing classifier, sentiment provider, current assignment, or no semantic action.

This keeps the integration independent of any chat provider and avoids duplicating Clef HTTP parsing across the worker, case service, and AI service. A provider adapter inside `llm.service.ts` was considered; that couples decision inference to text generation and the per-tenant chat-provider settings, which Clef does not use.

### Batch decisions at each workflow boundary

For an eligible inbound text message, request intent, handoff, and sentiment answers together. For an eligible new case, request category, urgency, and team recommendation together. The keyed question format performs these in one inference call and keeps context consistent across answers. Skip decisions that are irrelevant to that workflow or already resolved by an explicit deterministic path.

The current worker checks handoff and reply routing on `message.received`; it can perform Clef inference there without adding work to the webhook HTTP request. Exact configured handoff/automation keywords and explicit handoff postbacks retain their immediate existing paths. Clef does not select a reply body.

### Minimize state and validate candidates before use

Send the current inbound text plus only the small structured fields needed for the decision. Do not send conversation history by default. For team routing, build candidate IDs from active teams already eligible for the tenant and channel, include only those candidates in Clef criteria, and verify the returned ID against that same set before writing `Case.teamId`. Keep all database reads and writes within the caller's tenant context.

Persist decision metadata and usage measurements, not raw Clef request state. Record input tokens and latency from Clef. Add nullable latency storage to `AiUsage`; map Clef to provider `clef`, model `clef-flash`, input tokens to prompt tokens, and generated tokens to zero. Do not infer monetary cost for Clef without an explicit pricing entry.

### Bounded latency and explicit fallback

Add deployment configuration for `CLEF_BASE_URL`, `CLEF_MODEL`, `CLEF_TIMEOUT_MS`, `CLEF_DECISIONS_ENABLED`, and per-feature confidence thresholds. Default the integration to disabled until the deployment opts in. Use a configurable timeout; start with 12 seconds to cover the observed 10.192-second CPU inference while allowing operators to lower it. Existing exact keyword paths run before or independently of the decision call. On timeout, transport failure, non-2xx, invalid schema, or below-threshold confidence, use the established workflow fallback; where none exists, skip that decision and continue processing.

The initial confidence defaults are conservative: 0.90 for handoff and semantic automation actions, 0.70 for classification, urgency, and team recommendation, and 0.60 for sentiment escalation. Keep each threshold configurable so production evidence can tune it without changing the API contract.

### Health is provider-specific

Expose a provider health check on the authenticated AI/settings surface, following the existing chat-provider health-check pattern. Report Clef availability and measured latency. The CRM's general `/health` remains healthy when Clef is down, because fallback behavior keeps the application operational.

## Risks / Trade-offs

- [Clef currently responds in about ten seconds on CPU] → Keep the call off the webhook request, skip it when explicit rules already decide the route, enforce a configurable timeout, and fall back to current behavior.
- [Customer text leaves the CRM for an external inference service] → Enable the feature explicitly per deployment, minimize the submitted state, avoid sending history, and keep raw request data out of usage records.
- [A confident but incorrect decision can change routing or priority] → Require feature-specific confidence thresholds, validate all IDs against tenant-scoped candidates, preserve user-supplied fields, and keep deterministic keyword/postback controls.
- [Clef schema or availability can change] → Validate every response, record bounded failures, and use existing classifier, sentiment, keyword, and assignment behavior on failure.
- [Inference usage does not include a price] → Record tokens and latency separately from cost; cost remains unpriced until an explicit model-pricing entry exists.

## Migration Plan

1. Add optional `AiUsage.latencyMs` storage with an additive Prisma migration and deploy code that can read/write it.
2. Deploy the client, decision policies, fallbacks, provider health check, and feature configuration with `CLEF_DECISIONS_ENABLED=0`.
3. Enable Clef for a controlled environment, review latency, confidence, fallback, and routing outcomes, then enable production features through deployment configuration.
4. Roll back by setting `CLEF_DECISIONS_ENABLED=0`; existing keyword, LLM classification/sentiment, and round-robin paths remain available. The nullable usage column can remain without affecting older code.
