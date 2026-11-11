## MODIFIED Requirements

### Requirement: Webhook Verification
系統 SHALL 為每個 Instagram 渠道提供 `GET /api/v1/webhooks/threads/:channelId` 與 `POST /api/v1/webhooks/threads/:channelId`。

GET 處理 Meta 的訂閱驗證。`hub.mode` 是 `subscribe`，而且 `hub.verify_token` 等於渠道憑證的 `verifyToken` 時，系統 SHALL 回 200 與 `hub.challenge` 的原值。缺少參數或 token 不符時回 403，渠道不存在時回 404。

POST SHALL 立即回 200，再非同步處理事件；處理失敗不改變回應。系統 SHALL 以渠道憑證的 `appSecret` 驗證 `X-Hub-Signature-256` 簽章。

#### Scenario: Valid Verification Request
- **WHEN** Meta 對一個 Instagram 渠道送出 GET，`hub.mode` 是 `subscribe`，`hub.verify_token` 等於該渠道的 `verifyToken`，`hub.challenge` 是 `challenge-123`
- **THEN** 系統回 200，回應內容是 `challenge-123`

#### Scenario: 驗證權杖不符
- **WHEN** Meta 送出的 `hub.verify_token` 不等於渠道的 `verifyToken`
- **THEN** 系統回 403，回應內容不含 `hub.challenge`

#### Scenario: 驗證的渠道不存在
- **WHEN** 網址的 `channelId` 不是任何 Instagram 渠道
- **THEN** 系統回 404

#### Scenario: Webhook Message
- **WHEN** 渠道憑證的 `appSecret` 與 `channelSecret` 是不同的值，Meta 以 `appSecret` 簽章送出 POST
- **THEN** 簽章驗證通過，事件交給 ThreadsPlugin 解析

#### Scenario: 處理事件失敗仍回 200
- **WHEN** Meta 送出 POST，系統處理事件時拋出錯誤
- **THEN** 系統仍回 200，Meta 不會重送這個事件

### Requirement: Message Parsing
系統 SHALL 把 Instagram 私訊的 webhook 事件解析成 `ParsedWebhookMessage`。每則訊息的 `channelMsgId` 是 Meta 的 `message.mid`，供進站流程去重。

下列事件 SHALL NOT 產生訊息：
- `object` 不是 `instagram` 的事件。
- 沒有 `message.mid` 的事件，例如已讀回條與 reaction。
- 商業帳號自己送出、被 Meta 回送的 echo：`message.is_echo` 為真，或 `sender.id` 等於 `entry.id`。

referral 事件的解析見 `inbound-message-processing`。

#### Scenario: Text Message
- **WHEN** 客人傳一則文字私訊，`message.mid` 是 `m-1`
- **THEN** `parseWebhook` 回傳一則 `contentType` 為 `text` 的訊息，`content.text` 是訊息文字，`channelMsgId` 是 `m-1`

#### Scenario: Image Message
- **WHEN** 客人傳一張圖片，附件的 `payload.url` 是 `https://cdn.example.com/a.jpg`
- **THEN** `parseWebhook` 回傳一則 `contentType` 為 `image` 的訊息，`content.mediaUrl` 與 `content.url` 都是 `https://cdn.example.com/a.jpg`，沒有 `content.text`

#### Scenario: Story Reply
- **WHEN** 客人回覆限時動態，文字是「好看」
- **THEN** `parseWebhook` 回傳一則 `contentType` 為 `text` 的訊息，`content.text` 是「[Story reply] 好看」

#### Scenario: Like (Heart) Reaction
- **WHEN** 客人送出一個愛心，附件的 `type` 是 `like_heart`
- **THEN** `parseWebhook` 回傳一則 `contentType` 為 `sticker` 的訊息，`content.text` 是「❤️」

#### Scenario: 沒有 mid 的事件
- **WHEN** Meta 送來一則有 `sender` 但沒有 `message.mid` 的事件，例如已讀回條
- **THEN** `parseWebhook` 不回傳任何訊息

#### Scenario: 商業帳號自己送出的 echo
- **WHEN** Meta 回送商業帳號自己送出的訊息，`message.is_echo` 為真；或 `sender.id` 等於 `entry.id`
- **THEN** `parseWebhook` 不回傳任何訊息

### Requirement: Profile Retrieval
系統 SHALL 以 `graph.instagram.com` 取得 Instagram 使用者的 `name` 與 `profile_pic`，回傳 `uid`、`displayName`（`name`）與 `avatarUrl`（`profile_pic`）。Graph API 沒有回傳 `name`，或呼叫失敗時，`displayName` SHALL 是「Instagram User <uid>」，SHALL NOT 拋出錯誤，讓進站訊息照常建立聯絡人。

#### Scenario: Get Profile
- **WHEN** 以使用者 ID `9990001` 呼叫 `getProfile`，Graph API 回傳 `name`「小美」與 `profile_pic`「https://cdn.example.com/p.jpg」
- **THEN** 回傳 `{ uid: '9990001', displayName: '小美', avatarUrl: 'https://cdn.example.com/p.jpg' }`

#### Scenario: 取得個人資料失敗
- **WHEN** 以使用者 ID `9990001` 呼叫 `getProfile`，Graph API 呼叫失敗
- **THEN** 回傳 `{ uid: '9990001', displayName: 'Instagram User 9990001' }`，不拋出錯誤

### Requirement: Message Sending
系統 SHALL 以 `graph.instagram.com` 的 `/me/messages` 送出 Instagram 私訊：
- 圖片訊息帶 `message.attachment`，`type` 是 `image`，`payload.url` 是圖片 URL。
- 帶 quick replies 的訊息把每個選項轉成 `content_type` 為 `text` 的 `quick_replies`。
- 其他訊息只帶文字。

Graph API 回傳 `error` 時，`sendMessage` SHALL 回傳 `success: false` 與錯誤訊息。

#### Scenario: Send Text Reply
- **WHEN** 以文字「您好」呼叫 `sendMessage`，Graph API 回傳 `message_id` `mid-9`
- **THEN** 送出的內容是 `{ text: '您好' }`，`sendMessage` 回傳 `success: true` 與 `channelMsgId` `mid-9`

#### Scenario: Send Image Reply
- **WHEN** 以 `contentType` `image`、`mediaUrl` `https://cdn.example.com/a.jpg` 呼叫 `sendMessage`
- **THEN** 送出的內容是 `{ attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } } }`

#### Scenario: Send Quick Reply Button
- **WHEN** 以文字「請選擇」與選項「查訂單」（`postbackData` 是 `order`）呼叫 `sendMessage`
- **THEN** 送出的 `quick_replies` 有一個選項，`content_type` 是 `text`，`title` 是「查訂單」，`payload` 是 `order`

#### Scenario: Graph API 回傳錯誤
- **WHEN** Graph API 回傳 `{ error: { message: 'Invalid token' } }`
- **THEN** `sendMessage` 回傳 `success: false`，`error` 是「Invalid token」

## ADDED Requirements

### Requirement: 驗證 Instagram 渠道的權杖
對 Instagram 渠道執行驗證時，系統 SHALL 以渠道的 `pageAccessToken` 呼叫 `graph.instagram.com` 的 `/me`。Graph API 回傳錯誤時，系統 SHALL 回 400 `CHANNEL_VERIFY_FAILED`，`details.upstream` 帶 Graph API 的錯誤訊息，讓管理員知道 Meta 拒絕的原因；SHALL NOT 回 `UNSUPPORTED_CHANNEL`。

#### Scenario: 權杖有效
- **WHEN** 對一個權杖有效的 Instagram 渠道執行驗證
- **THEN** 驗證成功

#### Scenario: 權杖無效
- **WHEN** 對一個 Instagram 渠道執行驗證，Graph API 回傳錯誤「Invalid OAuth access token」
- **THEN** 系統回 400 `CHANNEL_VERIFY_FAILED`，`details.upstream` 是「Invalid OAuth access token」

### Requirement: 後台建立 Instagram 渠道
管理員 SHALL 能在後台建立 `channelType` 為 `THREADS` 的渠道。建立時 `appSecret` 與 `pageAccessToken` 必填。系統 SHALL 加密儲存憑證，並把渠道的 `webhookUrl` 設成 `<base>/api/v1/webhooks/threads/<channelId>`，讓管理員貼到 Meta 後台。

#### Scenario: 建立 Instagram 渠道
- **WHEN** 管理員以 `appSecret`、`pageAccessToken`、`verifyToken` 建立 Instagram 渠道，`webhookBaseUrl` 是 `https://api.example.com`
- **THEN** 系統建立 `channelType` 為 `THREADS` 的渠道，`webhookUrl` 是 `https://api.example.com/api/v1/webhooks/threads/<新渠道的 id>`

#### Scenario: 缺少 appSecret
- **WHEN** 管理員建立 Instagram 渠道，憑證沒有 `appSecret`
- **THEN** 系統回 400，不建立渠道

### Requirement: 後台顯示 Instagram 渠道的驗證權杖
讀取 Instagram 渠道時，系統 SHALL 完整回傳 `verifyToken`、`appId`、`pageId`，讓管理員貼到 Meta 後台；其他憑證欄位 SHALL 遮罩。更新憑證時，系統 SHALL 合併既有的憑證，本次沒有提供的欄位保留原值。

#### Scenario: 讀取 Instagram 渠道的憑證
- **WHEN** 管理員讀取一個 Instagram 渠道，憑證的 `verifyToken` 是 `verify-abc`，`appSecret` 是 `secret-1234567890`
- **THEN** 回應的 `verifyToken` 是 `verify-abc`，`appSecret` 是 `secr...7890`

#### Scenario: 只更新部分憑證
- **WHEN** 管理員只送出新的 `appSecret` 更新 Instagram 渠道
- **THEN** 渠道的 `appSecret` 改成新值，`pageAccessToken` 與 `verifyToken` 保留原值

### Requirement: 收件匣以 Instagram 顯示 IG 對話
收件匣的渠道篩選 SHALL 把 `THREADS` 顯示為「Instagram」。渠道標示 SHALL 把 `THREADS` 顯示為「Instagram」，不顯示原始值 `THREADS`。Instagram 對話的訊息輸入框 SHALL 能傳送圖片。

#### Scenario: 以 Instagram 篩選收件匣
- **WHEN** 客服看得到一個 Instagram 渠道，開啟收件匣的篩選
- **THEN** 渠道選項有「Instagram」

#### Scenario: 渠道標示顯示 Instagram
- **WHEN** 畫面以渠道標示顯示 `THREADS`
- **THEN** 標示的文字是「Instagram」

#### Scenario: Instagram 對話傳送圖片
- **WHEN** 客服在 Instagram 對話選擇一張圖片
- **THEN** 前端把圖片送到該對話的 `/send-image`
