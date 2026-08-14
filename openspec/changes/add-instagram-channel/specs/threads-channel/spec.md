## MODIFIED Requirements

### Requirement: Threads Plugin Registration
系統 SHALL 在應用啟動時將 ThreadsPlugin **實例**註冊進 Plugin Registry，使 `getChannelPlugin('THREADS')` 能取得可用的 plugin。`channel-plugins` 套件 MUST export 一個 `threadsPlugin` 實例（非僅 export class），`apps/api` 啟動時 MUST 呼叫 `registerChannelPlugin(threadsPlugin)`。

#### Scenario: Plugin instance is registered on startup
- **WHEN** API 應用啟動
- **THEN** ThreadsPlugin 實例以 channelType `THREADS` 註冊完成，`getChannelPlugin('THREADS')` 回傳該實例（而非 undefined）

#### Scenario: Message parsing includes dedup id
- **WHEN** IG 送來一則 DM webhook
- **THEN** `parseWebhook` 回傳的 `ParsedWebhookMessage` MUST 帶 `channelMsgId`（IG `message.mid`），供 inbound 管線去重

---

### Requirement: Threads Inbound Webhook Route
系統 SHALL 提供 IG 專屬的 inbound webhook 端點 `GET /api/v1/webhooks/threads/:channelId` 與 `POST /api/v1/webhooks/threads/:channelId`。GET 用於 Meta 的訂閱驗證握手；POST 用於接收訊息事件。POST handler MUST 先回 HTTP 200，再以 fire-and-forget 呼叫 `processWebhookEvent(...)`（不阻塞回應、不因處理失敗而回非 200，避免觸發 Meta 重試或 webhook 自動停用）。

#### Scenario: Webhook verification handshake
- **WHEN** Meta 對 `GET /api/v1/webhooks/threads/:channelId` 送出帶 `hub.mode` / `hub.verify_token` / `hub.challenge` 的驗證請求
- **THEN** 系統比對 `hub.verify_token` 等於該 channel credentials 的 `verifyToken`，相符則回 `hub.challenge` 原值（HTTP 200），不符則回 403

#### Scenario: Inbound message event
- **WHEN** Meta 對 `POST /api/v1/webhooks/threads/:channelId` 送出訊息事件
- **THEN** 系統立即回 HTTP 200，並非同步以 channelType `THREADS` 呼叫 `processWebhookEvent`（驗簽 → parse → 進 inbound 管線）

---

### Requirement: Threads Signature Secret Resolution
系統 SHALL 對 THREADS 渠道使用 **App Secret** 進行 webhook 簽章驗證（`X-Hub-Signature-256` 的 HMAC-SHA256），與 FB 相同機制。`webhook.service.ts` 的 secret 對應 MUST 將 THREADS 併入「使用 `credentials.appSecret`」的分支，而非誤用 `channelSecret`。

#### Scenario: Threads webhook uses appSecret for verification
- **WHEN** 系統驗證一個 THREADS channel 的 inbound 簽章
- **THEN** 使用 `credentials.appSecret` 計算 HMAC 並比對 `x-hub-signature-256`（若誤用 channelSecret 將永遠驗簽失敗）

---

### Requirement: Threads Channel Verification
系統 SHALL 支援對 THREADS channel 執行 `verifyChannel`，透過 Instagram Graph API 確認其憑證有效。`channel.service.ts` MUST 為 THREADS 提供驗證分支（呼叫 `graph.instagram.com` 的 `/me`），而非落入 `UNSUPPORTED_CHANNEL` 錯誤。

#### Scenario: Verify a valid Threads channel
- **WHEN** 對一個憑證有效的 THREADS channel 呼叫 `verifyChannel`
- **THEN** 系統以 `pageAccessToken` 呼叫 `graph.instagram.com/v21.0/me` 成功，回傳驗證通過

#### Scenario: Verify with invalid token
- **WHEN** THREADS channel 的 `pageAccessToken` 無效或過期
- **THEN** Graph 呼叫失敗，`verifyChannel` 回報驗證未通過（不 throw UNSUPPORTED_CHANNEL）

---

### Requirement: Create Instagram Channel from Admin UI
系統 SHALL 允許管理者從後台建立 IG（THREADS）渠道。前端 channel wizard MUST 提供 IG 選項與對應憑證欄位（`appId` / `appSecret` / `pageAccessToken` / `verifyToken`），憑證以既有 `Channel.credentialsEncrypted`（AES-256）加密儲存，`webhookUrl` 依既有規則動態產生為 `.../api/v1/webhooks/threads/{channelId}`。

#### Scenario: Admin creates an Instagram channel
- **WHEN** 管理者在 channel wizard 選擇 IG 並填入 appId / appSecret / pageAccessToken / verifyToken 後儲存
- **THEN** 系統建立一個 channelType `THREADS` 的 channel，憑證加密儲存，並產生 `webhookUrl = <base>/api/v1/webhooks/threads/{channelId}` 供管理者貼到 Meta 後台

#### Scenario: Inbound IG message triggers AI reply
- **WHEN** 已建立並接好 webhook 的 IG channel 收到使用者 DM，且該 channel 的 botMode 啟用
- **THEN** 訊息進入既有 inbound 管線、觸發 KB/AI 自動回覆，回覆經 `deliverToChannel` → ThreadsPlugin.sendMessage 送回 IG（與 LINE/FB 相同流程，渠道無關部分零改動）

---

### Requirement: Instagram displays correctly in the inbox
IG（`THREADS`）對話 SHALL 在收件匣及相關頁面正確顯示為 Instagram，並可被渠道篩選器選取。前端各處寫死的 channelType→顯示對應（badge、渠道篩選選項、渠道名稱/顏色 map）MUST 涵蓋 `THREADS`；既有將 IG key 誤寫為 `INSTAGRAM` 之處（與正式值 `THREADS` 不符）MUST 修正。

#### Scenario: IG conversation shows an Instagram badge
- **WHEN** 收件匣列表/對話詳情/聯絡資訊面板顯示一個 `THREADS` 渠道的對話
- **THEN** 顯示 Instagram 專屬的 badge（圖示 + 品牌色），而非灰底的原始碼字串 `THREADS`

#### Scenario: User filters the inbox by Instagram
- **WHEN** 使用者在收件匣篩選器選擇「Instagram」渠道
- **THEN** 篩選器提供 THREADS 選項，且只列出 IG 對話（`channelType.in` 帶入 THREADS）

#### Scenario: IG source channel name renders in timeline and case detail
- **WHEN** 聯絡人時間軸或案件詳情顯示某筆資料的來源渠道為 `THREADS`
- **THEN** 顯示「Instagram」中文/品牌名稱，而非原始碼字串 `THREADS`（修正既有 `INSTAGRAM` key 錯誤）

---

### Requirement: Send images to Instagram
系統 SHALL 支援對 IG（`THREADS`）對話傳送圖片。`ThreadsPlugin.sendMessage` MUST 在收到圖片內容時，以 `graph.instagram.com/v21.0/me/messages` 送出 `message.attachment`（`type: 'image'`、`payload.url` 指向圖片），格式同 FB 的 image attachment。前端收件匣的傳圖白名單 MUST 包含 `THREADS`，使 IG 對話顯示傳圖按鈕。

#### Scenario: Agent sends an image to an IG conversation
- **WHEN** 客服在一個 IG（THREADS）對話點傳圖並上傳一張圖片
- **THEN** 前端顯示傳圖按鈕（THREADS 在白名單內），後端經 `/send-image` → `deliverToChannel` → `ThreadsPlugin.sendMessage` 組出 `{ attachment: { type: 'image', payload: { url } } }` 送至 IG，IG 使用者收到該圖

#### Scenario: Text and quick replies still work after adding image support
- **WHEN** 對 IG 對話送出純文字或帶 quick replies 的訊息
- **THEN** 既有文字/quick_replies 行為不受影響（image 分支不覆蓋 text 分支）
