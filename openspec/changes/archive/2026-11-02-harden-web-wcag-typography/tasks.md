## 1. Accessibility contract tests

- [x] 1.1 Add a failing unit test for AA-safe theme tokens, 18px Chinese typography floor, focus ring, reduced-motion, and 44px shared-control contracts in `apps/web/tests/unit/accessibility/design-system.test.ts`.
- [x] 1.2 Add a failing component test for tablist/tab/tabpanel roles and selection relationships in `apps/web/tests/unit/components/ui/tabs.test.tsx`.

## 2. Implement the design-system foundation

- [x] 2.1 Update `apps/web/src/app/globals.css` with AA-safe light/dark tokens, 18px Chinese-first base typography, small-text floor overrides, focus/selection/reduced-motion rules, and layout-safe defaults.
- [x] 2.2 Update shared Button, Input, Textarea, Checkbox, Badge, and Tabs components for 44px targets, readable text, focus states, and native semantics.

## 3. Update the authenticated shell

- [x] 3.1 Add skip navigation and a focusable main landmark to the dashboard layout.
- [x] 3.2 Update Sidebar and Topbar controls for 44px targets, readable status text, accessible labels, and responsive overflow.

## 4. Verify and ship

- [x] 4.1 Run focused Web tests, then `pnpm test` and `pnpm build`.
- [x] 4.2 Run `node scripts/feature-impact.mjs --files ...` and review affected-area regressions.
- [x] 4.3 Run `node scripts/check-tenant-scoping.mjs --strict`, `node scripts/check-prisma-admin-usage.mjs --strict`, and `node scripts/check-tenant-ctx.mjs --strict`; record unrelated baseline findings separately.
- [x] 4.4 Run Impeccable detector and perform desktop/narrow viewport UI verification; fix all release-blocking findings.
- [x] 4.5 Add a `CHANGELOG.md` entry and complete the OpenSpec archive/release review checklist.
