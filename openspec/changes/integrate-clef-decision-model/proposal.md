# Proposal

## Why

Open333CRM already makes customer-service decisions through substring keyword rules, configurable LLM classification and sentiment analysis, KB confidence thresholds, and round-robin case assignment. These paths miss paraphrases and make it difficult to apply one bounded decision contract across routing, handoff, urgency, and classification. Clef-Flash exposes typed `choice`, `noul`, and `score` decisions with probability distributions, so the CRM can evaluate these decisions through one integration and expose the results to existing workflows.

## What Changes

- Add a tenant-safe Clef client for `POST /v1/systemone`, with typed request and response validation, bounded timeouts, failure handling, and inference usage/latency recording. Clef outages, timeouts, and invalid results SHALL fall back to the existing path where one exists; otherwise the decision is marked unavailable without surfacing an error to the customer or executing a guessed action.
- Use Clef decisions for inbound intent, semantic automation matching, human-handoff intent, case category, urgency, sentiment/escalation signals, and team-assignment recommendations.
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
