## Why

目前 LINE channel 收到 webhook 後，只有本 CRM 自己的 inbound 處理管線（建立聯絡人／對話／訊息、觸發 canvas、自動回覆等）。有些情境需要把 LINE 的原始 webhook 轉發到**下游系統**（例如既有的 bot、外部客服系統、資料分析服務），且需求分兩種：

- 讓下游系統**接手**處理（CRM 不再往下動作）；
- 讓下游系統**旁聽**一份（CRM 仍照常處理）。

現況沒有任何「把原始 LINE webhook 轉發到自訂 URL」的機制，因此新增此能力。

## What Changes

- 在 LINE channel 的 `settings` JSON 新增 `downstreamWebhook` 設定：`enabled`、`url`（單一 https）、`mode`（`immediate` | `after`）、可選 `secret`。
- 前端於渠道列表為 LINE 渠道提供**獨立入口**（🪝 按鈕 → 專屬 dialog），設定／編輯／清除單一下游網址（不放在「Bot 設定」內）。
- 於 `processWebhookEvent`（`apps/api/src/modules/webhook/webhook.service.ts`）在**簽章驗證通過後**，依設定將**原始 raw body 與 LINE 標頭**（含 `x-line-signature`）以**背景（fire-and-forget）+ 重試/逾時**轉發到下游 URL。
- 兩種模式行為：
  - **`immediate`（立即發送）**：先觸發背景轉發，然後**短路**——不再執行 CRM 的 `parseWebhook` / `processInboundMessage`（後續不動作）。
  - **`after`（最後發送）**：照常執行 CRM inbound 處理，處理完後再觸發背景轉發（後續繼續動作）。
- 對外回應仍**立即回 200**（現況即如此，`webhook.routes.ts` 在呼叫處理前已回 200），下游轉發不阻塞回應。
- 轉發僅在 LINE 簽章驗證通過後進行；下游 URL 為 admin 設定，加入 SSRF 防護（限 `https`、封鎖內網／保留位址）。
- **迴圈防護**：因為轉發的是**原封 raw body + 有效 `x-line-signature`**，若下游回送至本端點會再次通過驗證並無限轉發（流量放大）。以每事件冪等識別碼（`webhookEventId`，退回 `replyToken`）記錄於 Redis（TTL），偵測到回送即不再轉發。
- Channel 設定更新路徑（`PATCH /api/v1/channels/:id` 的 `settings`）新增對 `downstreamWebhook` 形狀的 Zod 驗證。

## Capabilities

### New Capabilities
- `line-downstream-webhook`: LINE channel 的下游 webhook 轉發能力 —— 涵蓋每 channel 設定、原始 payload/標頭轉發、`immediate`（短路）與 `after`（續行）兩種模式、背景送出與重試/逾時、簽章驗證前置條件、SSRF 防護與可觀測性。

### Modified Capabilities
<!-- 無。line-webhook-events 的簽章驗證與事件解析需求不變；immediate 模式的短路屬本能力新增的條件行為，不改動既有需求語意。 -->

## Impact

- **API**：`apps/api/src/modules/webhook/webhook.service.ts`（轉發與模式短路的插入點）；新增下游轉發模組（沿用 `webhook-subscriptions/webhook-dispatcher.ts` 的 fetch + 重試 + 逾時模式）；`apps/api/src/modules/channel/`（`settings.downstreamWebhook` 的 Zod 驗證）。
- **資料庫**：無 schema 變更；設定存於既有 `Channel.settings` JSON。
- **Redis**：迴圈防護使用既有 `REDIS_URL` 記錄事件冪等鍵（TTL 自動過期，不新增資料表）。
- **設定**：可能新增 SSRF allow/deny 相關環境變數（可選）。
- **前端**：LINE channel 設定畫面可新增下游 webhook 表單欄位（本次以後端契約為主，前端為可選 impact）。
- **可觀測性**：每次轉發輸出結構化日誌（url、mode、status、延遲、重試次數）；不新增資料表。
- **安全**：伺服器端對外請求，需 SSRF 防護與 admin-only 設定。
