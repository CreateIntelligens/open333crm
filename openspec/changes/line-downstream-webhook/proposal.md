## Why

目前 channel 收到 webhook 後，只有本系統自己的 inbound 處理管線（建立聯絡人／對話／訊息、觸發 canvas、自動回覆等）。有些情境需要把原始 webhook 轉發到**下游系統**（例如既有的 bot、外部客服系統、資料分析服務），且需求分兩種：

- 讓下游系統**接手**處理（本系統不再往下動作）；
- 讓下游系統**旁聽**一份（本系統仍照常處理）。

現況沒有任何「把原始 webhook 轉發到自訂 URL」的機制，因此新增此能力。適用於**所有 channel**（不限 LINE）。

## What Changes

- 在 channel 的 `settings` JSON 新增 `downstreamWebhook` 設定：`enabled`、`url`（單一 https）、`mode`（`immediate` | `after`），可選 `timeoutMs`。適用所有 channel 類型。
- 前端於渠道列表為**所有渠道**提供**獨立入口**（🪝 按鈕 → 專屬 dialog），設定／編輯／清除單一下游網址（不放在「Bot 設定」內）。
- 於 `processWebhookEvent`（`apps/api/src/modules/webhook/webhook.service.ts`）在**簽章驗證通過後**，依設定將**原封的原始 header 與 body**（不新增自訂標頭、不加簽、不改寫 content-type；僅移除 `host`/`content-length` 由傳輸層重設）以**背景（fire-and-forget）+ 逾時（不重試、不理會結果）**轉發到下游 URL。
- 兩種模式行為：
  - **`immediate`（立即發送）**：先觸發背景轉發，然後**短路**——不再執行 `parseWebhook` / `processInboundMessage`（後續不動作）。
  - **`after`（最後發送）**：照常執行 inbound 處理，處理完後再觸發背景轉發（後續繼續動作）。
- 對來源平台仍維持既有**即時回應**（`webhook.routes.ts` 於處理前即回應），下游轉發不阻塞回應。
- 轉發僅在簽章驗證通過後進行；下游 URL 為 admin 設定，加入 SSRF 防護（限 `https`、封鎖內網／保留位址）。
- **迴圈防護**：因為轉發的是**原封 raw body + 有效簽章標頭**，若下游回送至本端點會再次通過驗證並無限轉發（流量放大）。以冪等識別碼記錄於 Redis（TTL 一天）：LINE 以每事件 `webhookEventId`（退回 `replyToken`），其他 channel 退回 **body 雜湊**；偵測到回送即不再轉發。
- Channel 設定更新路徑（`PATCH /api/v1/channels/:id` 的 `settings`）新增對 `downstreamWebhook` 形狀的 Zod 驗證。

## Capabilities

### New Capabilities
- `line-downstream-webhook`: channel 的下游 webhook 轉發能力（適用所有 channel）—— 涵蓋每 channel 設定、原封 header/body 轉發、`immediate`（短路）與 `after`（續行）兩種模式、背景 best-effort 送出、簽章驗證前置條件、迴圈防護、SSRF 防護。（能力名稱沿用 `line-` 前綴，但功能不限 LINE。）

### Modified Capabilities
<!-- 無。既有 webhook 事件處理的簽章驗證與解析需求不變；immediate 模式的短路屬本能力新增的條件行為，不改動既有需求語意。 -->

## Impact

- **API**：`apps/api/src/modules/webhook/webhook.service.ts`（轉發與模式短路的插入點）；新增 `downstream-forwarder.ts`（fetch + 逾時、原封 header 轉發、SSRF）與 `downstream-loop-guard.ts`（Redis 去重）；`apps/api/src/modules/channel/`（`settings.downstreamWebhook` 的 Zod 驗證）。
- **資料庫**：無 schema 變更；設定存於既有 `Channel.settings` JSON。
- **Redis**：迴圈防護使用既有 `REDIS_URL` 記錄冪等鍵（TTL 一天、自動過期，不新增資料表）。
- **前端**：`ChannelManagement.tsx` 於每個渠道列加 🪝 按鈕開啟 `DownstreamWebhookDialog.tsx`（enabled/url/mode）。
- **可觀測性**：轉發輸出輕量結構化日誌（channelId、mode、url、封鎖/失敗）；**不記錄 body 內容**、不新增資料表。
- **安全**：伺服器端對外請求，需 SSRF 防護與 admin-only 設定。
