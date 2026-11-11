## 1. 試用與輕量版方案含渠道

- [x] 1.1 重構（不改行為）：方案定義從 `seed.ts` 抽到 `packages/database/prisma/seed-data/plans.ts`
- [x] 1.2 測試 `packages/database/tests/unit/seed/plans.test.ts`：「試用與輕量版方案可以使用渠道」，在現有程式上斷言失敗（`trial 缺 channels`）
- [x] 1.3 測試 `apps/api/tests/feature/modules/channel/channel-trial-light-plans.test.ts`：「試用與輕量版方案可以使用渠道」，以 seed 同內容的方案建租戶，在現有程式上 4 個測試都斷言失敗（`403 !== 200`、`403 !== 201`）
- [x] 1.4 `plans.ts` 的 trial、light 加入 `channels`
- [x] 1.5 測試 `apps/api/tests/feature/migrations/enable-channels-on-trial-light.test.ts`：「既有方案補上 channels」；突變驗證：拿掉 `AND NOT (features ? 'channels')` 時兩個測試都失敗（`2 !== 0`、`1 !== 0`）
- [x] 1.6 新增 migration `20261103120000_enable_channels_on_trial_light`

## 2. 渠道頁的讀取錯誤與新增權限

- [x] 2.1 測試 `apps/web/tests/unit/components/settings/channel-management.test.tsx`：「沒有檢視權限時顯示無權限訊息」「列表讀取失敗時顯示錯誤與重新載入」「沒有新增權限時不顯示新增按鈕」，在現有程式上斷言失敗
- [x] 2.2 `ChannelManagement.tsx`：讀取錯誤改用 `SettingsLoadError`（`describeChannelListError()`），新增相關按鈕依 `channel.create` 顯示

## 3. 完成定義

- [x] 3.1 `pnpm test`：database、api、web unit（`--maxWorkers=3`）
- [x] 3.2 feature：本 change 的兩個測試檔，加上 `permission-check.test.ts`（獨立測試庫 `open333crm_test_p411`）
- [x] 3.3 api、web、database tsc；`pnpm --filter @open333crm/web build`
- [x] 3.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 3.5 `node scripts/validate-openspec.mjs enable-channels-on-trial-light-411` 與 `--specs`
- [x] 3.6 CHANGELOG、AUDIT（PLAN-14、RBAC-11）、AUDIT-REVIEWS 的條目交給主控寫入；`docs/ref/features/health/PLATFORM-PLANS.md`、`feature-map.json`、`feature-platform-plans`、`feature-channels` skill 已更新
