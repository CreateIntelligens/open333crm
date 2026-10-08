# Proposal

## Why

Open333CRM already makes customer-service decisions through substring keyword rules, configurable LLM classification and sentiment analysis, KB confidence thresholds, and round-robin case assignment. These paths miss paraphrases and make it difficult to apply one bounded decision contract across routing, handoff, urgency, and classification. Clef-Flash exposes typed `choice`, `noul`, and `score` decisions with probability distributions, so the CRM can evaluate these decisions through one integration and expose the results to existing workflows.

## What Changes

- Add a tenant-safe Clef client for `POST /v1/systemone`, with typed request and response validation, bounded timeouts, failure handling, and inference usage/latency recording. Clef outages, timeouts, and invalid results SHALL fall back to the existing path where one exists; otherwise the decision is marked unavailable without surfacing an error to the customer or executing a guessed action.
- Use Clef decisions for these explicit business questions: what the inbound message is about; whether it asks for a human; whether its intent should trigger a tenant automation or use the existing KB/Agent route; whether sentiment is positive, neutral, or negative; which existing case category applies; whether a new case priority is LOW, MEDIUM, HIGH, or URGENT; and which eligible tenant team should receive a new case.
- Route decision outcomes through existing automation contracts and case/handoff services; keep tenant-authored exact keyword rules and explicit identity-binding commands available as deterministic paths.
- Add configurable confidence thresholds and safe fallback behavior so an unavailable or uncertain decision does not silently execute a consequential action.
- Add a decision-provider health check and operational configuration for the Clef base URL, model, timeout, and feature enablement.

## Capabilities

### New Capabilities

- `decision-intelligence`: Shared Clef inference client, typed decision tasks, confidence handling, operational health, usage and latency records.

### Modified Capabilities

- `automation-engine`: Make semantic intent results available to automation rules while preserving keyword triggers and worker-owned execution.
- `bot-handoff-config`: Add semantic customer request detection as a handoff path alongside explicit postbacks and configured keywords.
- `case-management`: Add decision-assisted case classification, urgency scoring, and team recommendation with existing tenant and permission constraints.
- `ai-usage-recording`: Record Clef inference usage and latency through the existing AI observability surface or an explicitly typed compatible record.

## Impact

- API and worker: `apps/api/src/modules/automation/automation.worker.ts`, `apps/api/src/modules/ai/classify.service.ts`, `apps/api/src/modules/ai/sentiment.service.ts`, `apps/api/src/modules/ai/kb-autoreply.service.ts`, case assignment services, and new Clef client/service modules.
- Shared contracts and authoring: `packages/automation`, automation API validation, and the web automation editor.
- Configuration and observability: environment/config validation, `AiUsage` or a compatible usage record, logs, health checks, and admin settings where tenant-level thresholds are required.
- External service: `https://clef.aiurl.tw/v1/systemone`; customer text sent for enabled decisions requires bounded payloads, timeout handling, and documented data handling.
- No decision may bypass tenant scoping, authorization, existing idempotency, or explicit confirmation for identity-binding actions.

## Decision Scope

| Decision area | Clef question and choices | Effect in Open333CRM |
|---|---|---|
| Inbound intent | `choice`: `product_inquiry`, `order_issue`, `return_exchange`, `payment_issue`, `shipping_delivery`, `account_issue`, `technical_support`, `complaint_feedback`, `faq`, `general_assistance`, or `other` | Publish a semantic intent for matching automation rules. FAQ and general-assistance intents use the existing KB and Agent eligibility rules. |
| Human handoff | `noul`: did the customer request a human agent? | At the handoff threshold, use the existing idempotent handoff flow. Explicit postbacks and configured handoff keywords remain immediate paths. |
| Sentiment | `choice`: positive, neutral, or negative | Store the existing sentiment fact and publish the existing negative-sentiment event at its threshold. |
| Case category | `choice`: `產品諮詢`, `訂單問題`, `退換貨`, `帳號問題`, `技術支援`, `投訴建議`, `付款問題`, `物流配送`, or `其他` | Fill category only when unset; otherwise use the current classifier/fallback. |
| Case urgency | `score`: LOW → MEDIUM → HIGH → URGENT | Map the result to Case priority only when creation did not supply a priority. |
| Team recommendation | `choice`: active teams eligible for this tenant and channel | Select only from validated candidates when creation did not supply a team; keep existing round-robin agent selection inside that team. |

Clef supplies decisions and confidence distributions. Existing CRM services validate thresholds, tenant candidates, and workflow eligibility before applying them. Identity binding, account merging, and confirmation-sensitive commands remain outside this decision scope.
