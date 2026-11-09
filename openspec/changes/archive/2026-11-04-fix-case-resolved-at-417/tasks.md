## 1. 測試先行

- [x] 1.1 `packages/shared/tests/unit/case-transitions.test.ts`：五項規則（先以回傳 `{}` 的空殼函式跑，4 項以 assertion 失敗）
- [x] 1.2 `apps/api/tests/unit/modules/case/case-resolved-at.test.ts`：「RESOLVED → IN_PROGRESS 清除 resolvedAt」「CLOSED → OPEN 清除 resolvedAt」在現有程式上以 assertion 失敗；「直接 CLOSED 不寫」「RESOLVED → CLOSED 保留」「轉成 RESOLVED 寫入」「升級不寫」「指派不寫」現有程式本來就通過，以 mutation 驗證（見 3.1）
- [x] 1.3 `apps/workers/tests/unit/lib/automation-update-case-status.test.ts`：六項在現有程式上全部以 assertion 失敗
- [x] 1.4 `apps/api/tests/feature/modules/case/case-resolved-at.test.ts`：走 `transitionCaseFlow` 與 `getOverviewStats`，在現有程式上以 assertion 失敗（重開後 `resolvedAt` 不為 null）
- [x] 1.5 `apps/api/tests/unit/modules/csat/csat.service.test.ts`：評分後結案兩項（從 RESOLVED 保留、沒有經過 RESOLVED 不算已解決）

## 2. 實作

- [x] 2.1 `packages/shared/src/constants/case-transitions.ts`：`caseTransitionTimestamps()`
- [x] 2.2 `case.service.ts`：`transitionCase()`、`escalateCase()`、`assignCase()` 用共用規則
- [x] 2.3 `csat.service.ts` 的 `recordCsatScore()` 與 `csat.scheduler.ts` 的逾時結案用共用規則
- [x] 2.4 workers `update_case_status`：讀目前狀態、以 `tenantId` 與讀到的狀態條件更新、套共用規則

## 3. Mutation 驗證

- [x] 3.1 mutation 與失敗的測試（每次都已還原）：
  - M1：規則的 RESOLVED → CLOSED 也清除 `resolvedAt` → shared、API、workers、CSAT 的「保留 resolvedAt」4 項失敗
  - M2：規則的直接關閉寫入 `resolvedAt: now` → shared、API、workers、CSAT 的「直接關閉不算已解決」4 項失敗
  - M3：拿掉規則的「狀態沒有改變」判斷 → shared「狀態沒有改變」失敗
  - M4：規則的其他狀態改成寫入 `now` → 重開清除 5 項、「升級不寫」「指派不寫」失敗
  - M5：拿掉 `recordCsatScore()` 的共用規則 → 「評分後結案：沒有經過 RESOLVED 的工單不算已解決」失敗

## 4. 完成定義

- [x] 4.1 `pnpm --filter @open333crm/api --filter @open333crm/workers --filter @open333crm/shared test`、受影響的 feature 測試、`pnpm build`；`check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 4.2 `node scripts/validate-openspec.mjs fix-case-resolved-at-417` 與 `--specs`
- [x] 4.3 CHANGELOG、AUDIT.md（CASE-04、AUTO-10）、AUDIT-REVIEWS.md、功能文件、健檢、skill 回歸清單
