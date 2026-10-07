# Tasks

## 1. Clef decision client and resilience

- [ ] 1.1 Add failing unit tests in `apps/api/tests/unit/modules/ai/clef-decision.client.test.ts` for the `Typed Clef decision requests` scenarios: batched keyed `choice`/`noul`/`score` questions and invalid question definitions; verify invalid definitions do not call the HTTP client.
- [ ] 1.2 Implement the typed Clef request builder and response decoder; verify task 1.1 passes.
- [ ] 1.3 Add failing unit tests in `apps/api/tests/unit/modules/ai/clef-decision.client.test.ts` for the `Validate Clef decision responses` scenarios: valid choice, malformed response, missing answer, unknown choice, invalid probability, and question/answer type mismatch.
- [ ] 1.4 Implement response validation and typed available/unavailable outcomes; verify task 1.3 passes.
- [ ] 1.5 Add failing unit tests in `apps/api/tests/unit/modules/ai/clef-decision.resilience.test.ts` for the `Clef failures produce bounded unavailable results` scenarios: unreachable provider, non-2xx response, timeout, customer flow continuation, and no guessed action when no fallback exists.
- [ ] 1.6 Implement `CLEF_BASE_URL`, `CLEF_MODEL`, `CLEF_TIMEOUT_MS`, and `CLEF_DECISIONS_ENABLED` configuration and bounded failure conversion; verify task 1.5 passes.
- [ ] 1.7 Add failing unit tests in `apps/api/tests/unit/modules/ai/clef-decision.tenant-scope.test.ts` for the `Bound decision inputs and preserve tenant context` scenarios: reject a foreign team id and do not submit context without verified tenant ownership.
- [ ] 1.8 Implement minimal decision-state construction and candidate-ID validation; verify task 1.7 passes.

## 2. Decision usage and provider health

- [ ] 2.1 Add failing unit tests in `apps/api/tests/unit/modules/ai/clef-decision-usage.test.ts` for the `Record decision usage and latency` scenarios: successful usage metadata, bounded failure record, and no raw message/state in usage data.
- [ ] 2.2 Add nullable Clef latency storage and usage recording; map input tokens to prompt tokens, generated tokens to zero, and leave Clef cost unpriced without a pricing entry; verify task 2.1 passes.
- [ ] 2.3 Add a failing route test in `apps/api/tests/unit/modules/ai/clef-health-route.test.ts` for the `Clef provider health is inspectable` scenarios: authorized healthy and unavailable results while general CRM health stays operational.
- [ ] 2.4 Implement the authenticated provider health check and verify task 2.3 passes.

## 3. Inbound semantic decisions and automation

- [ ] 3.1 Add failing tests in `apps/api/tests/unit/modules/automation/clef-intent-automation.test.ts` for the `Semantic intent is available to automation rules` scenarios: confident active rule, below-threshold intent, and Clef unavailable fallback to keyword/Agent/KB processing.
- [ ] 3.2 Add failing tests in `apps/api/tests/unit/modules/automation/clef-intent-automation.test.ts` for the `Semantic automation does not duplicate a reply` scenarios: handled rule, no matching rule, FAQ-to-KB route, and general-assistance-to-Agent route, each sending at most one reply.
- [ ] 3.3 Add failing contract tests in `apps/api/tests/unit/modules/automation/clef-intent-contract.test.ts` for the `Automation editor authors semantic intent rules` scenarios: valid intent authoring and rejection of an unknown intent.
- [ ] 3.4 Implement the shared `intent.detected` event/fact contract, API validation, worker dispatch, and web authoring metadata; verify tasks 3.1–3.3 pass.
- [ ] 3.5 Add failing tests in `apps/api/tests/unit/modules/automation/clef-sentiment.test.ts` for the `Clef sentiment results feed existing sentiment automation` scenarios: confident negative result publishes the existing event and unavailable/invalid/uncertain results fall back to existing sentiment analysis.
- [ ] 3.6 Implement batched inbound intent, route, handoff, and sentiment decisions without changing webhook response timing; verify task 3.5 passes.

## 4. Semantic handoff

- [ ] 4.1 Add failing tests in `apps/api/tests/unit/modules/automation/clef-semantic-handoff.test.ts` for the `Detect semantic requests for a human agent` scenarios: confident paraphrase handoff, negative/below-threshold result, and no status change for `AGENT_HANDLED` conversations.
- [ ] 4.2 Add failing regression tests in `apps/api/tests/unit/modules/automation/clef-semantic-handoff.test.ts` for explicit keyword and handoff-postback behavior when Clef is disabled or unavailable.
- [ ] 4.3 Implement confidence-gated semantic handoff through the existing idempotent transition and verify tasks 4.1–4.2 pass.

## 5. Decision-assisted case management

- [ ] 5.1 Add failing tests in `apps/api/tests/unit/modules/ai/clef-case-decisions.test.ts` for the `Decision-assisted case classification` scenarios: save a confident allowed category, preserve an existing category, and use the existing classifier on unavailable/invalid/low-confidence outcomes.
- [ ] 5.2 Add failing tests in `apps/api/tests/unit/modules/case/clef-case-urgency.test.ts` for the `Decision-assisted case urgency` scenarios: map a confident score when priority was omitted, preserve explicit priority, and retain current priority on unavailable/invalid/low-confidence outcomes.
- [ ] 5.3 Add failing tests in `apps/api/tests/unit/modules/case/clef-team-recommendation.test.ts` for the `Tenant-scoped team recommendation for case assignment` scenarios: valid eligible team, out-of-set or low-confidence result, explicit team, and no eligible candidates.
- [ ] 5.4 Implement one batched case decision request and apply only allowed values to unset fields; retain current round-robin assignment on fallback and verify tasks 5.1–5.3 pass.

## 6. Integration and completion

- [ ] 6.1 Add a feature test in `apps/api/tests/feature/modules/ai/clef-decision-tenant-scope.test.ts` for tenant-scoped usage and candidate-team writes; verify a decision cannot read or update another tenant's data.
- [ ] 6.2 Update AI configuration/API documentation with Clef environment variables, decision features, confidence defaults, failure fallbacks, provider health behavior, and external text handling; verify all documented names match runtime configuration.
- [ ] 6.3 Add a `CHANGELOG.md` entry under the latest date-only release heading for this feature.
- [ ] 6.4 Run `pnpm test` and `pnpm test:feature`; verify both suites pass.
- [ ] 6.5 Run `node scripts/check-tenant-scoping.mjs --strict` and `node scripts/check-prisma-admin-usage.mjs --strict`; verify this change adds no violations.
- [ ] 6.6 Run `node scripts/validate-openspec.mjs integrate-clef-decision-model` and `node scripts/validate-openspec.mjs --specs`; verify both pass.
- [ ] 6.7 Verify every implementation task is complete and the change is ready to archive through `pnpm exec openspec archive`.
