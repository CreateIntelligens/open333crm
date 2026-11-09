## Why

issue #411（AUDIT PLAN-14）：`trial`（免費試用）與 `light`（輕量版）方案的 `features` 不含 `channels`。`channel.view`、
`channel.create` 屬於 `channels` feature，被方案天花板擋下，這兩個方案的租戶連管理員都看不到、也建不了任何渠道，
從開通第一天起就接不了 LINE、FB、IG、網站聊天室。UAT（正式環境）的方案內容與 seed 相同。2026-11-03 使用者確認
這不是刻意設計，兩個方案都要能使用渠道。

渠道頁又把 `GET /channels` 的 403 顯示成「沒有渠道／新增您的第一個渠道」（AUDIT RBAC-11 的渠道管理部分）。
租戶實際有啟用中的渠道時，畫面也說沒有渠道，按「新增渠道」才 403。

## What Changes

- seed 的 `trial`、`light` 方案 `features` 加入 `channels`；方案定義抽到 `packages/database/prisma/seed-data/plans.ts`，
  讓測試讀同一份內容。
- 新增資料 migration `20261103120000_enable_channels_on_trial_light`：只在 slug 是 `trial`／`light`、`features` 還不含
  `channels` 時加入，不動其他欄位與其他方案，可重複執行。部署時不依賴 seed（entrypoint 的 seed 失敗不中止啟動）。
- 渠道管理頁：列表讀取回 403 時顯示「沒有權限」與需要的權限，不顯示「沒有渠道」；其他讀取錯誤顯示原因與「重新載入」。
  沒有 `channel.create` 時不顯示「新增渠道」「設定精靈」與 Facebook 連結按鈕。
- 方案上限沒有改：seed 方案沒有 `maxChannels`（無上限），`allowedChannelTypes` 是 `[]`（不限制），
  看得到渠道頁就建得了渠道（PLAN-07 的分級缺口維持原狀）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-plan`：修改「Plan 全域資料模型」，規定每個 seed 方案都含 `channels`，既有 `trial`、`light` 方案由 migration 補上。
- `channel-management`：新增「渠道列表讀取失敗時不顯示成沒有渠道」與「沒有新增權限時不顯示新增渠道的操作」。

## Impact

- `packages/database/prisma/seed.ts`、`packages/database/prisma/seed-data/plans.ts`、新 migration。
- `apps/web/src/components/settings/ChannelManagement.tsx`。
- 部署：既有租戶的有效權限在 Redis `perms:tenant:*` 快取最多 10 分鐘；`getTenantPlanId` 的程序內快取在重啟時清空。
- 文件：`docs/ref/features/health/PLATFORM-PLANS.md`、`docs/ref/features/feature-map.json`、
  `.claude/skills/feature-platform-plans`、`.claude/skills/feature-channels`。
