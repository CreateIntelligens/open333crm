## Why

issue #441（AUDIT PLAN-20）：API 容器每次啟動都跑 seed（`apps/api/docker-entrypoint.sh`）。`seedPlans()` 以
`plan.upsert` 寫入五個預設方案，`update` 分支把 `name`、`features`、`limits`、`priceMonthly` 寫回原始碼的值。
平台在 `/admin/plans` 對這五個方案的修改，下次合併 main、自動部署時就被蓋掉，沒有任何提示。
主規格 `tenant-plan` 寫明平台改方案即時生效、無需改碼或重新部署，部署後被還原與這條需求衝突。
UAT 就是正式環境，有真實客戶的方案設定。

主規格的「seed MUST 以 idempotent upsert 建立」沒有規定既有方案要不要更新，這次寫明：seed 只建立不存在的方案，
程式要改既有方案時用資料 migration。

## What Changes

- `seedPlans()` 的 `plan.upsert` 把 `update` 改為空物件（與 `seedModelPricing()` 相同寫法）：
  方案不存在時建立，已存在時完全不寫入，`updatedAt` 也不變。函式移到 `seed-data/plans.ts`，接收 Prisma client，
  讓單元測試可以注入假的 plan model。
- 規則寫進 `seedPlans()` 註解、`docs/ref/features/platform/PLANS.md` 與 skill `feature-platform-plans`：
  程式要改既有方案內容時，寫一次性、只改目標欄位、可重複執行的資料 migration
  （範例 `20261103120000_enable_channels_on_trial_light`），同時更新 `SEED_PLANS`。
- 不改其他 seed 區段（Demo 租戶、Demo 角色、Demo 成員、平台帳號、系統模板、模型價目），盤點結果記在 AUDIT-REVIEWS。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-plan`：修改「Plan 全域資料模型」，規定 seed 只建立不存在的方案、不更新既有方案，既有方案的內容變更用 migration。

## Impact

- `packages/database/prisma/seed.ts`、`packages/database/prisma/seed-data/plans.ts`、
  `packages/database/tests/unit/seed/plans.test.ts`。
- 部署：沒有 migration。部署後 seed 不再改動 `plans` 的既有列；資料庫沒有的方案仍會建立。
- 文件：`docs/ref/features/platform/PLANS.md`、`docs/ref/features/health/PLATFORM-PLANS.md`、
  `docs/ref/system/AUDIT.md`（PLAN-20）、`docs/ref/system/AUDIT-REVIEWS.md`、`.claude/skills/feature-platform-plans`、`CHANGELOG.md`。
