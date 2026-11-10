## 1. 有效上限含當月加購量（plan-limits-core）

- [x] 1.1 測試 `apps/api/tests/unit/modules/platform/plan-limits.test.ts`：「同月多筆加購加總」「下個月回到方案額度」「台灣月初凌晨核准的加購算在新月份」「待審、駁回與其他租戶的加購不計入」「升級方案後加購加在新方案的額度上」「基礎上限無上限時仍無上限」，在現有程式上斷言失敗
- [x] 1.2 `plan-limits.service.ts`：`sumMonthlyTopupTokens()`、`resolveEffectiveLimit()` 加第三個參數、`getEffectiveLimit()` 的 `monthlyTokens` 加上當月加購量（design D1、D2）

## 2. 核准加購只計入當月（plan-change-request）

- [x] 2.1 測試 `apps/api/tests/unit/modules/platform/plan-change.test.ts`：「沒有覆寫時加在方案的額度上」「已有覆寫時加在覆寫值上」改為斷言有效上限與 `limitOverrides` 不變；新增「同月第二筆加購累加」「同一筆申請同時核准兩次」；在現有程式上斷言失敗
- [x] 2.2 「有效額度是無上限時不能加購」「核准加購後立即恢復 AI」「核准加購後再次跨越門檻」：行為不變，改寫後仍通過；突變驗證：拿掉 `getEffectiveLimit()` 的加購量時「立即恢復 AI」與「再次跨越門檻」失敗
- [x] 2.3 `approveRequest()` 的 `token_topup` 分支：用 `resolveEffectiveLimit()` 判斷 `TOPUP_UNLIMITED`、以 `updateMany` 條件更新申請、不寫 `limitOverrides`，保留清計數器與告警旗標（design D2、D3、D5）
- [x] 2.4 測試同檔「待審的申請附本月加購量與本月上限」，在現有程式上斷言失敗
- [x] 2.5 `listPendingRequests()` 回傳 `monthlyTopupTokens`、`monthlyTokenLimit`

## 3. 月額度提高後可以再次告警（usage-quota-alerts）

- [x] 3.1 測試 `apps/api/tests/unit/modules/platform/quota-alert-recalibration.test.ts`：「升級方案後再次跨越門檻」「平台變更租戶方案或試用轉付費後再次告警」「平台調高方案額度後再次告警」，在現有程式上斷言失敗
- [x] 3.2 同檔「降級不刪除告警紀錄」：現有程式本來就不刪，寫好就通過；突變驗證：`isLimitRaised()` 一律回 true 時失敗
- [x] 3.3 `plan-limits.service.ts` 新增 `isLimitRaised()`、`monthlyTokensRaisedByPlanChange()`；`approveRequest()`（升級）、`updateTenant()`、`convertToPaid()`、`updatePlan()` 提高時呼叫 `clearQuotaAlertFlags()`（design D4）

## 4. 既有加購覆寫值的 migration

- [x] 4.1 測試 `apps/api/tests/feature/modules/platform/token-topup-monthly-migration.test.ts`：執行 migration 的 SQL 後，`monthlyTokens` key 被移除、其他 key 不變、沒有這個 key 的租戶不變，再執行一次結果相同。在 migration 檔建立前斷言失敗（讀不到檔案時以斷言失敗呈現）
- [x] 4.2 新增 `packages/database/prisma/migrations/20261110120000_remove_topup_monthly_tokens_override/migration.sql`（design D6）。只在測試資料庫執行，不套進開發庫或 UAT

## 5. 畫面

- [x] 5.1 測試 `apps/web/tests/unit/app/dashboard/plan-page.test.tsx`：「租戶選擇加購時看到當月限制」「已核准的加購顯示有效月份」，在現有程式上斷言失敗
- [x] 5.2 `apps/web/src/app/dashboard/plan/page.tsx`：加購說明與已核准加購的有效月份（台灣月份）
- [x] 5.3 測試 `apps/web/tests/unit/app/admin/plan-changes-page.test.tsx`：「平台審核時看到本月加購量與上限」，在現有程式上斷言失敗
- [x] 5.4 `apps/web/src/app/admin/plan-changes/page.tsx`：頁首說明、加購申請顯示本月已加購與本月上限（平台層，見 proposal 的 Platform layer）

## 6. 文件

- [x] 6.1 `docs/ref/system/AUDIT.md`：PLAN-02、PLAN-05、PLAN-13 改為已修正，PLAN-03 的第二點更新；`AUDIT-REVIEWS.md` 加紀錄
- [x] 6.2 `docs/ref/features/platform/PLANS.md`、`PLAN-CHANGES.md`、`USAGE.md`、`docs/ref/features/feature-map.json`、`.claude/skills/feature-platform-plan-changes/SKILL.md` 更新加購與有效上限的描述

## 7. 完成定義

- [x] 7.1 `pnpm test`
- [x] 7.2 `pnpm test:feature`（獨立測試庫 `TEST_DATABASE_NAME`）
- [x] 7.3 `pnpm build`
- [x] 7.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx`、`check-workspace-esm` 加 `--strict`；`feature-impact.mjs --check`
- [x] 7.5 `node scripts/validate-openspec.mjs --specs` 與 `node scripts/validate-openspec.mjs make-token-topup-monthly`
- [x] 7.6 `CHANGELOG.md` 的 `## [2026-11-10]` 加條目
- [ ] 7.7 歸檔：UAT 驗證後、`fix-platform-usage-trial-display` 歸檔之後，執行 `pnpm exec openspec archive make-token-topup-monthly`
