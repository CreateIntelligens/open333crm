## 1. 渠道訊息視窗

- [x] 1.1 測試：FB 與 THREADS 的 plugin 宣告 24 小時視窗，LINE 沒有（`packages/channel-plugins/tests/unit/messaging-window.test.ts`）
- [x] 1.2 實作：`ChannelPlugin.messagingWindowHours`，FB 與 THREADS 設 24

## 2. 群發略過視窗外的人

- [x] 2.1 migration：`broadcasts.skippedCount`
- [x] 2.2 測試：FB 群發略過視窗外的人、全部在視窗外時失敗、LINE 不略過（`apps/api/tests/unit/modules/marketing/broadcast-messaging-window.test.ts`）
- [x] 2.3 實作：`executeBroadcast` 依 plugin 視窗過濾受眾，寫 `skippedCount`

## 3. 可送達人數

- [x] 3.1 測試：audience-preview 的 FB、LINE 與受眾不完整案例
- [x] 3.2 實作：`previewBroadcastAudience` 與 `POST /marketing/broadcasts/audience-preview`
- [x] 3.3 測試：建立群發表單顯示可送達人數、列表顯示略過人數（`apps/web/tests/unit/app/dashboard/marketing/`）
- [x] 3.4 實作：前端表單與列表

## 4. 收尾

- [x] 4.1 CHANGELOG、`docs/ref/features/tenant/MARKETING.md`
- [x] 4.2 `pnpm test`、typecheck、tenant scoping 檢查、`node scripts/validate-openspec.mjs broadcast-messaging-window`
