## 1. seed 不覆寫既有方案

- [x] 1.1 重構（不改行為）：`seedPlans()` 從 `seed.ts` 移到 `packages/database/prisma/seed-data/plans.ts`，改為接收 Prisma client；既有 `plans.test.ts`、`demo-accounts.test.ts` 前後都通過
- [x] 1.2 測試 `packages/database/tests/unit/seed/plans.test.ts`：「部署後保留平台修改」兩個測試（執行一次、執行兩次）與「只補缺少的方案」，在現有程式上斷言失敗（`maxAgents` 8 被改回 5、`name`、`priceMonthly`、`features` 被改回 seed 值）
- [x] 1.3 測試「方案不存在時 seed 建立」：現有程式已有此行為，測試寫好即通過；突變驗證：把 `create` 的 `name` 改成別的值時「方案不存在時 seed 建立」與「只補缺少的方案」失敗
- [x] 1.4 `seedPlans()` 的 `upsert` 把 `update` 改為 `{}`（沿用 `seedModelPricing()` 的寫法），註解寫明改既有方案要用資料 migration；突變驗證：`update` 放回 `name` 時「部署後保留平台修改」兩項與「只補缺少的方案」失敗
- [x] 1.5 拋棄式資料庫 `open333crm_test_p3_441_seed` 實跑：migrate deploy → seed → 改 light、刪 enterprise → 再跑 seed；light 的欄位與 `updatedAt`（先設為 2020-01-01）不變、enterprise 被補回；跑完刪除資料庫

## 2. 文件

- [x] 2.1 `docs/ref/features/platform/PLANS.md`、`docs/ref/features/health/PLATFORM-PLANS.md`、skill `feature-platform-plans` 寫明 seed 不更新既有方案與 migration 規則
- [x] 2.2 AUDIT PLAN-20 移除、AUDIT-REVIEWS 新增條目（含 seed 其他區段盤點）、CHANGELOG

## 3. 完成定義

- [x] 3.1 `pnpm test`
- [x] 3.2 feature：`channel-trial-light-plans.test.ts`（使用 `SEED_PLANS`）
- [x] 3.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 3.4 `node scripts/validate-openspec.mjs preserve-plan-edits-on-seed-441` 與 `--specs`
