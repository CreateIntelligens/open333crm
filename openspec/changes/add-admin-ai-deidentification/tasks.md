# Tasks

## 1. Platform policy

- [x] 1.1 Add failing `apps/api/tests/unit/modules/platform/ai-privacy.test.ts` tests for Default off and isolated tenants, Authorized enable and disable, and Rejected administrative requests; verify failures are assertions. Existing platform-auth guard scenarios use mutations if already passing.
- [x] 1.2 Implement tenant policy read/write and guarded GET/PATCH routes with atomic audit; pass policy tests and document endpoints in `docs/ref/features/platform/TENANTS.md`.

## 2. Model input processing

- [x] 2.1 Add failing `apps/api/tests/unit/modules/ai/deidentification.test.ts` tests for Disabled AI call, Enabled Chat and Embedding calls, Agent tool result and arguments, Privacy service unavailable, Policy unavailable, and Mapping remains outside model input. Assert final provider requests through real service entry points; use mutation for existing off-path behavior.
- [x] 2.2 Implement bounded 2md client and ChatProvider wrapper, wire Chat/Agent/Embedding, and pass all model input tests. Document covered inputs, service failure behavior and retention scope in `docs/ref/features/tenant/KNOWLEDGE.md`.

## 3. Platform control

- [x] 3.1 Add failing `apps/web/tests/unit/components/admin/ai-privacy-control.test.tsx` tests for Display and update privacy setting and Failed privacy setting request; verify assertion failures through the existing tenant page.
- [x] 3.2 Add the accessible platform tenant control with loading, saving and retry behavior, preserve admin visual style, and pass UI tests; document the control alongside policy API documentation.

## 4. Definition of done

- [x] 4.1 Add the feature entry under the latest dated release in `CHANGELOG.md` and check the final diff for unintended changes.
- [x] 4.2 Run `pnpm test`, both strict tenant checks, relevant TypeScript checks, and the Impeccable detector; resolve any new violations and record pre-existing failures separately. Run feature tests if database schema, Redis, RLS or feature tests change.
- [x] 4.3 Validate the change with `node scripts/validate-openspec.mjs add-admin-ai-deidentification` and main specs with `node scripts/validate-openspec.mjs --specs`; ensure every scenario is mapped to a test and all tracked tasks are complete.

## 5. Protected message storage and agent choice

- [x] 5.1 Add failing API unit tests in `apps/api/tests/unit/modules/privacy/message-content.test.ts` for Inbound channel message keeps an operational original, System-created message is protected, Masking storage failure preserves no unclassified model path, Default masked agent reply, Agent preserves original reply, and Disabled policy does not add a forced mask.
- [x] 5.2 Implement a shared message-content privacy helper and wire every API message writer, inbound webhook writer, automation and Agent persistence path; make model history, summaries and cross-channel context read the stored masked representation. Pass the message content tests.
- [x] 5.3 Add failing component tests in `apps/web/tests/unit/components/inbox/message-privacy-control.test.tsx` for default masked agent reply, explicit original selection, and the policy-off state.
- [x] 5.4 Add the MessageInput privacy control and request contract; pass component tests and document agent choice, inbound retention and model-read behavior in `docs/ref/features/tenant/KNOWLEDGE.md`.

## 6. Updated definition of done

- [x] 6.1 Update the latest dated `CHANGELOG.md` entry and re-run the focused unit tests, `pnpm test`, strict tenant checks, relevant TypeScript checks, OpenSpec validation and the Impeccable detector.

## 7. Protected marketing material storage

- [x] 7.1 Add failing API unit tests for enabled material creation defaulting to masked body, explicit original mode retaining both representations, masked version snapshots on create/update, masking failure preventing writes, and disabled-policy behavior.
- [x] 7.2 Extend the shared privacy helper for structured material bodies; add nullable `maskedBody` and `privacyMode` to Material and MaterialVersion; wire create/update/version services and route validation so the tenant policy is enforced server-side.
- [x] 7.3 Add a failing MaterialEditor test for tenant-enabled default mask and explicit original choice; add the per-save control to create/edit UI and send its mode with material writes.
- [ ] 7.4 Document material storage and retained history, update CHANGELOG, validate the Prisma schema and deployment migration, run API/Web tests, type checks, strict tenant checks and OpenSpec validation; run feature tests when local PostgreSQL and Redis are available.

## 8. Agent trace failure state

- [x] 8.1 Add a failing Agent service test for tool trace de-identification failure: no raw trace write and the AgentRun reaches a terminal failed state.
- [x] 8.2 Catch post-creation Agent failures, mark the run failed with a bounded reason and timestamp, then preserve the original error without persisting unmasked text.

## Workflow follow-up

- Archive using the OpenSpec CLI after all tracked tasks are complete and validate resulting main specs.

## Verification evidence

- Initial failing assertions: policy API returned 404; enabled Chat/Agent forwarded original phone values; unavailable-service cases did not reject; the tenant page had no privacy switch.
- `Disabled AI call` was verified with two mutations: bypass the disabled ChatProvider branch, and bypass the disabled Embedding branch. Each mutation failed its assertion; both branches were restored.
- Six related API files passed 53 tests after adding explicit default-off policy mocks to existing usage/quota, binding-guard and cross-channel-context fixtures. Existing assertions were preserved.
- Full `pnpm test` passed all 15 Turbo tasks; API: 173 files / 1092 tests. The web privacy control adds 4 passing interaction tests.
- API and web TypeScript checks passed. Both strict tenant checks passed. Impeccable detector returned no deterministic issues.
- Browser verification used synthetic platform responses in headless Chrome: desktop and mobile screenshots captured, enable/disable interactions succeeded. The control keeps a 280px minimum width within the existing admin horizontal-scroll layout on narrow screens.

## 9. System template wording keeps its authored text

- [x] 9.1 Add failing API unit tests (`tests/unit/modules/privacy/system-template-message.test.ts`, `tests/unit/modules/csat/csat.service.test.ts`) for the email registration link, return-to-bot note, default handoff notice and CSAT follow-up keeping their authored text while storing a masked copy; keep an agent-typed handoff notice masked. Mutation for the agent-typed case: always passing `system_template` for the handoff notice makes that test fail.
- [x] 9.2 Add the `system_template` message source and use it for fixed system wording: identity-binding messages (email/phone registration links, binding codes and notices), CSAT survey and follow-up, the default handoff notice, the return-to-bot note, the user-requested handoff note and the binding-failure note.
- [x] 9.3 Add failing API unit tests (`tests/unit/modules/privacy/tenant-template-message.test.ts`) for the outside-hours reply, the first-contact greeting with rendered customer name, phone and email (model reads stay masked) and a Canvas message node keeping their authored text with a masked copy; the masking-failure case passes as written and was verified by the mutation of falling back to the original content when 2md fails, which makes it fail.
- [x] 9.4 Add the `tenant_template` message source and use it for the outside-hours reply, the first-contact greeting and Canvas message nodes; knowledge-base replies, Agent replies, LLM summaries and saved materials keep their masking.
