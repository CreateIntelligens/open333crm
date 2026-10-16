## Why

PR #283 讓廣播在受眾無法解析或解析後為零人時停止發送並標為「失敗」，不再退化成發給整個渠道。立即發送時原因會隨 400 回應顯示在畫面上；但排程發送由背景排程器執行，`executeBroadcast()` 的外層 catch 只把狀態改成 `failed`，原因只寫進 log。`Broadcast` 沒有存放失敗原因的欄位，行銷人員在後台只看得到「失敗」，不知道為什麼、也不知道怎麼修（issue #287）。

同樣的情況也發生在「每一位收件人都送失敗」時（例如渠道權杖失效）：狀態是「失敗」，但看不到渠道回的錯誤。另外，失敗的廣播在後端可以重送（`failed` 在可發送狀態內），畫面上卻沒有重送按鈕。

## What Changes

- `Broadcast` 新增可為 null 的 `failureReason` 文字欄位，附正式 migration。
- `executeBroadcast()` 失敗時寫入原因：
  - 發送前就失敗（受眾無法解析、零人、素材或渠道找不到、憑證無法解密等）：寫入 `AppError` 的中文訊息；非預期的錯誤寫入通用說明，不外露內部錯誤內容。
  - 每一位收件人都送失敗：寫入失敗人數與第一個渠道錯誤。
  - 部分成功：狀態維持「已完成」，`failureReason` 為 null（失敗人數已在列表顯示）。
- 開始發送（搶占 `sending`）時清空 `failureReason`，重送成功後不留舊原因。
- 渠道沒有對應 plugin 的錯誤訊息改成中文（原為英文 `No plugin for channel type`）。
- 前端：廣播列表與活動詳情的廣播表格，在「失敗」徽章下方顯示原因；失敗的廣播顯示「重新發送」按鈕。

## Capabilities

### New Capabilities

- `broadcast-failure-reason`：廣播發送失敗時記錄並顯示原因，失敗的廣播可以重送。

### Modified Capabilities

（無）

## Impact

- `packages/database/prisma/schema.prisma`、新 migration（`broadcasts.failureReason`）
- `apps/api/src/modules/marketing/marketing.service.ts`
- `apps/web/src/app/dashboard/marketing/page.tsx`、`apps/web/src/app/dashboard/marketing/campaigns/[campaignId]/page.tsx`
- 部署：migration 只加可為 null 的欄位，不需回填；既有的失敗廣播 `failureReason` 為 null，畫面顯示「沒有記錄原因」。
