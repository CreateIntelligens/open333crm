## 1. Fix Prisma Field References in automation.service.ts

- [x] 1.1 Remove `conditionsJson` from `prisma.automationRule.create()` call
- [x] 1.2 Remove `actionsJson` from `prisma.automationRule.create()` call
- [x] 1.3 Remove `conditionsJson` assignment from `updateRule()` update object
- [x] 1.4 Remove `actionsJson` assignment from `updateRule()` update object

## 2. Fix Prisma Field References in automations.ts Route Handler

- [x] 2.1 Remove `conditionsJson`/`actionsJson` keys from `prisma.automationRule.create()` call in POST handler
- [x] 2.2 Remove `conditionsJson`/`actionsJson` keys from `prisma.automationRule.update()` call in PUT handler

## 3. Verify

- [x] 3.1 Run `tsc --noEmit` in `apps/api` — confirm zero TypeScript errors
