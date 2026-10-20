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

## Workflow follow-up

- Archive using the OpenSpec CLI after all tracked tasks are complete and validate resulting main specs.

## Verification evidence

- Initial failing assertions: policy API returned 404; enabled Chat/Agent forwarded original phone values; unavailable-service cases did not reject; the tenant page had no privacy switch.
- `Disabled AI call` was verified with two mutations: bypass the disabled ChatProvider branch, and bypass the disabled Embedding branch. Each mutation failed its assertion; both branches were restored.
- Six related API files passed 53 tests after adding explicit default-off policy mocks to existing usage/quota, binding-guard and cross-channel-context fixtures. Existing assertions were preserved.
- Full `pnpm test` passed all 15 Turbo tasks; API: 173 files / 1092 tests. The web privacy control adds 4 passing interaction tests.
- API and web TypeScript checks passed. Both strict tenant checks passed. Impeccable detector returned no deterministic issues.
- Browser verification used synthetic platform responses in headless Chrome: desktop and mobile screenshots captured, enable/disable interactions succeeded. The control keeps a 280px minimum width within the existing admin horizontal-scroll layout on narrow screens.
