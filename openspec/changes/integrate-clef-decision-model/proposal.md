# Proposal

## Why

Open333CRM already makes customer-service decisions through substring keyword rules, configurable LLM classification and sentiment analysis, KB confidence thresholds, and round-robin case assignment. These paths miss paraphrases and make it difficult to apply one bounded decision contract across routing, handoff, urgency, and classification. Clef-Flash exposes typed `choice`, `noul`, and `score` decisions with probability distributions, so the CRM can evaluate these decisions through one integration and expose the results to existing workflows.

## What Changes

- Add a provider-neutral decision engine with adapters for two or more local Clef endpoints, OpenAI, and JEV. Each provider SHALL map its native request/response to the shared typed decision catalog.
- Add an ordered provider fallback chain. For each requested decision, continue to the next configured provider after an outage, timeout, malformed/unsupported answer, or confidence below threshold; stop when the answer is accepted or the total time budget expires. If the chain is exhausted, use the existing CRM fallback for that decision or mark it unavailable without surfacing an error or guessed action.
- Add tenant-admin settings to configure each provider instance's display name, base URL, model, API key, enabled state, timeout, and chain order. This includes separate settings for both local Clef models and Base URL/API key settings for OpenAI and JEV.
- Encrypt provider API keys at rest, return only masked key status, allow administrators to replace or clear a key, and keep secrets out of logs and audit payloads.
- Record inference usage and latency across every attempted provider, and expose provider-level connectivity checks.
- Use the provider decision chain for these explicit business questions: what the inbound message is about; whether it asks for a human; whether its intent should trigger a tenant automation or use the existing KB/Agent route; whether sentiment is positive, neutral, or negative; which existing case category applies; whether a new case priority is LOW, MEDIUM, HIGH, or URGENT; and which eligible tenant team should receive a new case.
- Route decision outcomes through existing automation contracts and case/handoff services; keep tenant-authored exact keyword rules and explicit identity-binding commands available as deterministic paths.
- Add configurable per-decision confidence thresholds, per-provider timeouts, an overall chain time budget, and a global kill switch so provider failures never interrupt customer-facing processing.

## Capabilities

### New Capabilities

- `decision-intelligence`: Shared decision catalog, provider adapters, ordered fallback execution, confidence handling, and normalized decision results.
- `decision-provider-management`: Tenant-admin provider configuration, encrypted credentials, health checks, and editable fallback ordering for local Clef, OpenAI, and JEV instances.

### Modified Capabilities

- `automation-engine`: Make semantic intent results available to automation rules while preserving keyword triggers and worker-owned execution.
- `bot-handoff-config`: Add semantic customer request detection as a handoff path alongside explicit postbacks and configured keywords.
- `case-management`: Add decision-assisted case classification, urgency scoring, and team recommendation with existing tenant and permission constraints.
- `ai-usage-recording`: Record each provider attempt, fallback result, token usage, latency, and bounded failure code.

## Impact

- API and worker: `apps/api/src/modules/automation/automation.worker.ts`, `apps/api/src/modules/ai/classify.service.ts`, `apps/api/src/modules/ai/sentiment.service.ts`, `apps/api/src/modules/ai/kb-autoreply.service.ts`, case assignment services, and new decision provider registry/adapter modules.
- Shared contracts and authoring: `packages/automation`, automation API validation, and the web automation editor.
- Configuration and observability: tenant-scoped provider records, RLS, encrypted credentials, `AiUsage` latency, logs, health checks, and settings UI/API.
- External services: local Clef endpoints plus configured OpenAI and JEV decision endpoints. Customer text sent for enabled decisions requires bounded payloads, timeout handling, and documented data handling.
- No decision may bypass tenant scoping, authorization, existing idempotency, or explicit confirmation for identity-binding actions.

## Decision Scope

| Decision area | Shared decision question and choices | Effect in Open333CRM |
|---|---|---|
| Inbound intent | `choice`: `product_inquiry`, `order_issue`, `return_exchange`, `payment_issue`, `shipping_delivery`, `account_issue`, `technical_support`, `complaint_feedback`, `faq`, `general_assistance`, or `other` | Publish a semantic intent for matching automation rules. FAQ and general-assistance intents use the existing KB and Agent eligibility rules. |
| Human handoff | `noul`: did the customer request a human agent? | At the handoff threshold, use the existing idempotent handoff flow. Explicit postbacks and configured handoff keywords remain immediate paths. |
| Sentiment | `choice`: positive, neutral, or negative | Store the existing sentiment fact and publish the existing negative-sentiment event at its threshold. |
| Case category | `choice`: `產品諮詢`, `訂單問題`, `退換貨`, `帳號問題`, `技術支援`, `投訴建議`, `付款問題`, `物流配送`, or `其他` | Fill category only when unset; otherwise use the current classifier/fallback. |
| Case urgency | `score`: LOW → MEDIUM → HIGH → URGENT | Map the result to Case priority only when creation did not supply a priority. |
| Team recommendation | `choice`: active teams eligible for this tenant and channel | Select only from validated candidates when creation did not supply a team; keep existing round-robin agent selection inside that team. |

The first healthy, valid, above-threshold provider in the configured order supplies each decision. Existing CRM services validate thresholds, tenant candidates, and workflow eligibility before applying results. Identity binding, account merging, and confirmation-sensitive commands remain outside this decision scope.
