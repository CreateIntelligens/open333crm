## 1. 每日用量以台灣日期分日並補齊沒有用量的日子

- [x] 1.1 測試 `apps/api/tests/feature/modules/platform/platform-usage.test.ts`：「每日用量補齊沒有用量的日子」「台灣凌晨的呼叫算在台灣當天」，在現有程式上斷言失敗（只回有用量的 2 天；UTC 01-09 20:00 算到 01-09，01-10 只有 7）
- [x] 1.2 同檔「單一租戶的每日用量與來源分布」「預設查詢最近 30 天」改為只比對有用量的日子（主規格 scenario 文字同步修改）
- [x] 1.3 `packages/core/src/coupon/taipei-time.ts` 新增 `taipeiDatesBetween()`（unit 測試 `packages/core/tests/unit/coupon/taipei-time.test.ts`）；券統計的 `fillDays()` 改用它，行為不變
- [x] 1.4 `getTenantUsageDetail()` 以 `to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD')` 分組，`fillTrendDays()` 補齊期間內每一天
- [x] 1.5 「期間超過 400 天只列有用量的日子」：原本只列有用量的日子，寫好就通過；突變驗證：`MAX_TREND_DAYS` 改成 4000 時失敗

## 2. 用量統計頁

- [x] 2.1 測試 `apps/web/tests/unit/app/admin/usage-page.test.tsx`：「近 30 天從台灣 29 天前的 00:00 起算，三個查詢用同一個區間」「沒有用量的日子不畫長條，仍佔一格」，在現有程式上斷言失敗（`from` 是現在減 30×24 小時；零用量長條高 2px）
- [x] 2.2 新增 `apps/web/src/app/admin/lib/usage-range.ts`（`usageRange()`），`/admin/usage` 三個查詢共用同一個區間；`TrendChart` 零用量高度 0

## 3. 申請記錄的狀態顯示中文

- [x] 3.1 測試 `apps/web/tests/unit/app/admin/trial-page.test.tsx`：「三種狀態顯示中文」在現有程式上斷言失敗
- [x] 3.2 `apps/web/src/app/admin/trial/page.tsx` 新增 `SIGNUP_STATUS_META`
- [x] 3.3 「未知的狀態顯示原值」：原本就顯示原值，寫好就通過；突變驗證：退回值改成空字串時失敗

## 4. 完成定義

- [x] 4.1 `pnpm --filter @open333crm/core test`、`@open333crm/api test`、`@open333crm/web test`
- [x] 4.2 `pnpm test:feature`（獨立測試庫 `TEST_DATABASE_NAME=open333crm_test_p497`）
- [x] 4.3 api、web 的 `tsc --noEmit`
- [x] 4.4 `check-tenant-scoping`、`check-prisma-admin-usage` 加 `--strict`
- [x] 4.5 `node scripts/validate-openspec.mjs fix-platform-usage-trial-display`
- [x] 4.6 `CHANGELOG.md` 的 `## [2026-11-10]` Fixed 加條目；`docs/ref/features/platform/USAGE.md`、`TRIALS.md` 更新
- [ ] 4.7 歸檔（合併後執行 `pnpm exec openspec archive fix-platform-usage-trial-display`）
