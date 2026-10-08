# Tasks

## 1. Tenant provider configuration and RLS

- [ ] 1.1 Add failing unit tests in `apps/api/tests/unit/modules/settings/decision-provider-settings.test.ts` for `Tenant administrators manage provider instances` and `Provider credentials are encrypted and write-only`: configure duplicate Clef instances plus OpenAI/JEV, reject incomplete enabled configurations, require `settings.manage`, mask keys, replace/clear keys, and omit secrets from audit data.
- [ ] 1.2 Add a failing feature test in `apps/api/tests/feature/modules/settings/decision-provider-rls.test.ts` for `Provider configuration is tenant-isolated`: tenant A cannot read/update tenant B provider rows and RLS rejects cross-tenant insert/update.
- [ ] 1.3 Implement the tenant-scoped provider table, encrypted credentials, additive migration with ENABLE/FORCE RLS and tenant policy, settings CRUD routes/services, audit events, and strict tenantId filters; verify tasks 1.1–1.2 pass.

## 2. Provider settings and editable order

- [ ] 2.1 Add failing component tests in `apps/web/tests/unit/components/settings/decision-provider-settings.test.tsx` for `Administrators control fallback order`: add/edit/disable instances, reorder Clef A → Clef B → OpenAI → JEV, display masked key state, and reject invalid provider IDs/order.
- [ ] 2.2 Add failing route tests in `apps/api/tests/unit/modules/settings/decision-provider-health.test.ts` for `Provider connectivity can be tested safely`: successful and failed checks use saved configuration and return no credential or raw provider response body.
- [ ] 2.3 Implement the AI settings editor, reorder API, provider test action, and sanitized health results; verify tasks 2.1–2.2 pass.

## 3. Provider adapters and shared decision catalog

- [ ] 3.1 Add failing unit tests in `apps/api/tests/unit/modules/ai/decision-catalog.test.ts` for `CRM decision catalog defines business choices`: exact intent keys, handoff/sentiment types, nine case categories, ordered priorities, score-to-legend mapping, and tenant-filtered team candidates.
- [ ] 3.2 Implement and export the shared decision catalog and result mappings; verify task 3.1 passes.
- [ ] 3.3 Add failing adapter tests in `apps/api/tests/unit/modules/ai/decision-provider-adapters.test.ts` for `Provider adapters normalize decision answers`: Clef SystemOne mapping, OpenAI mapping, JEV mapping from its confirmed API contract, and unsupported question-type outcomes.
- [ ] 3.4 Implement typed Clef, OpenAI, and JEV adapters using configured Base URL, model, credential, and timeout; verify task 3.3 passes.
- [ ] 3.5 Add failing tests in `apps/api/tests/unit/modules/ai/decision-provider-adapters.test.ts` for `Validate provider decision responses`: valid choice/score/noul, malformed data, missing answers, unknown options, invalid probabilities, and answer-type mismatch across adapters.
- [ ] 3.6 Implement common response validation and normalized available/unavailable results; verify task 3.5 passes.

## 4. Ordered fallback execution and usage

- [ ] 4.1 Add failing unit tests in `apps/api/tests/unit/modules/ai/decision-chain.test.ts` for `Ordered provider fallback resolves each question`: accept the first valid answer, fall through on outage/timeout/invalid/unsupported/low-confidence answers, resolve different questions at different providers, use existing fallbacks when exhausted, and stop at the total time budget.
- [ ] 4.2 Implement per-question sequential fallback using the tenant's enabled provider order, per-provider timeouts, `DECISION_ENGINE_ENABLED`, and a total chain budget; verify task 4.1 passes and customer-facing flows receive unavailable results rather than thrown provider errors.
- [ ] 4.3 Add failing tests in `apps/api/tests/unit/modules/ai/decision-provider-usage.test.ts` for `Decision provider attempts are recorded in AI usage history`: record each Clef/OpenAI/JEV success and failed fallback attempt, input tokens and latency, and no raw state.
- [ ] 4.4 Add nullable `AiUsage.latencyMs` storage and write one tenant-scoped usage record per attempt with provider instance, bounded error code, and no inferred cost; verify task 4.3 passes.

## 5. Inbound intent, automation, handoff, and sentiment

- [ ] 5.1 Add failing tests in `apps/api/tests/unit/modules/automation/decision-intent-automation.test.ts` for `Semantic intent is available to automation rules`, `Semantic automation does not duplicate a reply`, and `Automation editor authors semantic intent rules`: all allowed intent keys, confidence gate, provider-chain exhaustion, rule match, FAQ-to-KB, general-assistance-to-Agent, and unknown intent rejection.
- [ ] 5.2 Add failing tests in `apps/api/tests/unit/modules/automation/semantic-handoff.test.ts` for `Detect semantic requests for a human agent`: `noul` probability threshold, provider fallback, agent-handled no-op, and explicit keyword/postback precedence.
- [ ] 5.3 Add failing tests in `apps/api/tests/unit/modules/automation/provider-sentiment.test.ts` for `Provider sentiment results feed existing sentiment automation`: confident negative event and fallback to current sentiment provider/keyword behavior.
- [ ] 5.4 Implement shared `intent.detected` contracts, authoring/API validation, worker routing, semantic handoff, and sentiment decisions through the ordered chain; verify tasks 5.1–5.3 pass with at most one customer reply.

## 6. Case classification, urgency, and team recommendation

- [ ] 6.1 Add failing tests in `apps/api/tests/unit/modules/ai/decision-case-classification.test.ts` for `Decision-assisted case classification`: all nine category values, preserve existing category, and current classifier fallback after chain exhaustion.
- [ ] 6.2 Add failing tests in `apps/api/tests/unit/modules/case/decision-case-urgency.test.ts` for `Decision-assisted case urgency`: map the highest-probability `LOW`/`MEDIUM`/`HIGH`/`URGENT` legend entry only when priority is omitted, and preserve explicit priority or current priority on fallback.
- [ ] 6.3 Add failing tests in `apps/api/tests/unit/modules/case/decision-team-recommendation.test.ts` for `Tenant-scoped team recommendation for case assignment`: valid candidate, out-of-set result, low confidence, explicit team, no eligible teams, and round-robin fallback.
- [ ] 6.4 Implement one batched case decision bundle through the ordered chain, validate candidate IDs against the tenant/channel candidate set, and apply answers only to unset fields; verify tasks 6.1–6.3 pass.

## 7. Integration and completion

- [ ] 7.1 Add a feature test in `apps/api/tests/feature/modules/ai/decision-provider-tenant-scope.test.ts` for provider configuration, encrypted-key metadata, usage, and candidate-team writes; verify tenant A cannot read or change tenant B data under real RLS.
- [ ] 7.2 Update AI settings/API documentation with provider configuration, Base URL/key handling, ordering, JEV protocol, timeouts, confidence defaults, fallback behavior, health tests, and notice that enabled providers may receive the decision state; verify documented names match implementation.
- [ ] 7.3 Add a `CHANGELOG.md` entry under the latest date-only release heading.
- [ ] 7.4 Run `pnpm test` and `pnpm test:feature`; verify both suites pass.
- [ ] 7.5 Run `node scripts/check-tenant-scoping.mjs --strict` and `node scripts/check-prisma-admin-usage.mjs --strict`; verify this change adds no violations.
- [ ] 7.6 Run `node scripts/validate-openspec.mjs integrate-clef-decision-model` and `node scripts/validate-openspec.mjs --specs`; verify both pass.
- [ ] 7.7 Verify every implementation task is complete and the change is ready to archive through `pnpm exec openspec archive`.
