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

---

### Requirement: Inbound webhook event filtering
系統 SHALL 只把「真正的訊息事件」送進 inbound 管線。Meta 的 `read`（已讀回條）/`reaction`/`seen` 等非訊息事件雖帶 `sender`，但無 `message.mid`；`echo`（商業帳號自己發出、被 Meta 回送）則帶 `is_echo` 或 `sender.id` 等於 entry id。`ThreadsPlugin.parseWebhook` MUST 跳過這兩類事件，不建立訊息。

#### Scenario: Read/seen/reaction events are skipped
- **WHEN** Meta 送來一則無 `message.mid` 的事件（已讀回條、reaction、seen 等）
- **THEN** `parseWebhook` 跳過該事件、不建立任何訊息，webhook 處理不因缺 sender/message 欄位而崩潰

#### Scenario: Echo messages do not loop the bot
- **WHEN** 商業帳號自己發出的訊息被 Meta 以 webhook 回送（`message.is_echo` 為真，或 `sender.id` 等於 entry id）
- **THEN** `parseWebhook` 跳過該 echo，Bot 不會把自己的回覆當成客戶訊息再次回覆（不形成自問自答迴圈）

---

### Requirement: Non-text inbound messages do not trigger KB auto-reply
系統 SHALL 只對純文字 inbound 訊息執行 KB 語意檢索自動回覆。圖片/貼圖/檔案等非文字訊息（即使帶「[圖片]」等佔位文字）MUST NOT 被拿去做 KB 檢索。`message.received` 事件 MUST 帶 `contentType`，automation worker MUST 據此守門（僅 `contentType` 為 text 或未帶時才呼叫 KB 自動回覆）。

#### Scenario: Image message does not get a KB reply
- **WHEN** 客戶對已接 Bot 的 IG 對話傳送一張圖片
- **THEN** 系統不對該圖片做 KB 檢索、不回不相關的 KB 內容；圖片改由 auto-handoff 轉真人處理

#### Scenario: Text message still gets a KB reply
- **WHEN** 客戶對已接 Bot 的 IG 對話傳送純文字問題
- **THEN** 系統正常做 KB 檢索並自動回覆

---

### Requirement: Inbound message deduplication by platform message id
系統 SHALL 以平台訊息 id（`channelMsgId`）對 inbound 訊息去重，防止 Meta 重複投遞同一 webhook 事件造成重複訊息與 Bot 重複回覆。`messages` 表 MUST 有 `(conversationId, channelMsgId)` unique 約束；建立 inbound 訊息時 MUST 先以應用層查重（擋先後到達的重複），並以 P2002 處理 unique 衝突（擋幾乎同時的併發）。撞重複時 MUST NOT 觸發 Bot / socket。

#### Scenario: Duplicate webhook redelivery is ignored
- **WHEN** Meta 對同一則訊息（相同 `channelMsgId`）重複投遞 webhook
- **THEN** 第二筆被辨識為重複、不建立第二則訊息、不觸發第二次 Bot 回覆

#### Scenario: Concurrent redelivery hits the unique constraint
- **WHEN** 兩個相同 `channelMsgId` 的請求幾乎同時進入、皆通過應用層查重
- **THEN** 後建立者撞 `(conversationId, channelMsgId)` unique 約束（P2002），被視為重複、提早結束，不建立重複訊息

---

### Requirement: Inbound image renders in the inbox
IG（`THREADS`）inbound 圖片 SHALL 在收件匣正確顯示。plugin inbound 圖片以 `mediaUrl`（並相容 `url`）儲存，前端 `extractMediaUrl` MUST 同時辨識 `mediaUrl` 與 `url`。無法解析內容的 unknown 訊息 MUST NOT 顯示為 `[object Object]`。

#### Scenario: IG inbound image displays as an image
- **WHEN** 收件匣顯示一則 `contentType: image` 的 IG inbound 訊息（content 帶 `mediaUrl`）
- **THEN** 前端解析出圖片 URL 並以 `<img>` 顯示，而非顯示不出來或退化為文字

#### Scenario: Unknown content type shows a friendly placeholder
- **WHEN** 收件匣顯示一則無可解析文字的 unknown 訊息
- **THEN** 顯示「[不支援的訊息類型]」而非 `[object Object]`

---

### Requirement: Verify token and callback URL are visible in the admin UI
系統 SHALL 讓管理者在後台看到 IG/FB 渠道的 Callback URL 與驗證權杖（verifyToken），以便貼到 Meta 後台設定 webhook。`getChannel` 回傳憑證時 MUST 對非機密欄位（`verifyToken` / `appId` / `pageId`）回傳完整值（不遮罩）；渠道建立完成頁與編輯視窗 MUST 顯示實際的 Callback URL 與 verifyToken。更新憑證時，未提交的既有欄位（含 verifyToken）MUST 被保留（合併而非覆蓋）。

#### Scenario: Admin reads the verify token to configure Meta webhook
- **WHEN** 管理者建立或編輯一個 IG/FB 渠道
- **THEN** UI 顯示可複製的 Callback URL 與實際 verifyToken，供貼到 Meta 後台完成 webhook 驗證

#### Scenario: Partial credential edit preserves other fields
- **WHEN** 管理者只更新部分憑證欄位（例如只改 appSecret）並儲存
- **THEN** 未提交的既有欄位（appId / pageId / verifyToken 等）不被洗掉，仍保留原值
