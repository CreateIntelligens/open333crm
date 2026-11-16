## ADDED Requirements

### Requirement: 前置條件查詢
`GET /api/v1/comment-replies/readiness` SHALL 回傳平台的測試階段、能力開關、緊急停止、本月用量與上限，以及檢視者看得到的每個 FB／IG 渠道的連結模式、是否開啟留言接收、訂閱狀態、缺少的權限、能否私訊與公開回覆、權杖狀態與最後收到留言的時間。查 Meta 的結果 SHALL 快取 5 分鐘，每個渠道最多等 3 秒，逾時回 `subscribed: null`。

#### Scenario: 用量與上限
- **WHEN** 租戶本月已私訊 12 則、`monthlyCommentReplies` 是 100、啟用規則 3 條、`maxCommentReplyRules` 是 5，呼叫 readiness
- **THEN** `quota` 是 `{ monthlyUsed: 12, monthlyLimit: 100, activeRules: 3, maxRules: 5 }`

#### Scenario: Meta 回應很慢
- **WHEN** 假 Graph API 延遲 5 秒
- **THEN** readiness 在 3 秒內回應，該渠道 `subscribed` 是 null

#### Scenario: 自備 App 的渠道
- **WHEN** 渠道以自備 App 手動填權杖連結
- **THEN** 該渠道 `appMode` 是 `own_app`，前端不顯示平台的測試階段卡

#### Scenario: 只列看得到的渠道
- **WHEN** 只看得到渠道 A 的成員呼叫 readiness
- **THEN** `channels` 只含渠道 A

### Requirement: 開啟留言接收時送出完整的訂閱欄位
`POST /api/v1/comment-replies/channels/:channelId/subscribe-comments` SHALL 需要 `channel.update` 與 `comment_reply.view`。FB 渠道 SHALL 以 `POST /{page-id}/subscribed_apps` 送出 4 個 messaging 欄位加 `feed` 的完整清單並帶 `appsecret_proof`；IG 渠道 SHALL 以 `POST graph.instagram.com/.../me/subscribed_apps` 送 `messages` 與 `comments`。成功後渠道標記為開啟接收、清除前置條件快取、寫租戶稽核。

#### Scenario: FB 開啟留言接收
- **WHEN** 有權限的成員對 FB 渠道開啟留言接收
- **THEN** 假 Graph API 收到的 `subscribed_fields` 恰好是 `messages`、`messaging_postbacks`、`messaging_referrals`、`message_echoes`、`feed`；下一次 readiness 顯示已開啟

#### Scenario: IG 開啟留言接收
- **WHEN** 對 IG 渠道開啟留言接收
- **THEN** 假 Graph API 收到 `POST graph.instagram.com/.../me/subscribed_apps`，欄位含 `messages` 與 `comments`

#### Scenario: 自備 App 的渠道用自己的密鑰
- **WHEN** 對自備 App 的 FB 渠道開啟留言接收
- **THEN** `appsecret_proof` 以渠道自己的粉專權杖與 App Secret 計算

#### Scenario: 缺渠道修改權限
- **WHEN** 成員只有 `comment_reply.view`、沒有 `channel.update`
- **THEN** 回應 403，`error.details.requiredPermission` 是 `channel.update`

#### Scenario: Meta 回權限錯誤
- **WHEN** Graph API 回權限錯誤
- **THEN** 回應 409，`error.code` 是 `REAUTH_REQUIRED`，渠道仍是未開啟

#### Scenario: Meta 回其他錯誤
- **WHEN** Graph API 回 HTTP 500
- **THEN** 回應 502，`error.code` 是 `SUBSCRIBE_FAILED`，渠道仍是未開啟

### Requirement: 關閉留言接收
`DELETE /api/v1/comment-replies/channels/:channelId/subscribe-comments` SHALL 以同樣的權限，把 FB 渠道的訂閱欄位改回只有 4 個 messaging 欄位（IG 只剩 `messages` 與既有欄位），成功後渠道標記為未開啟並寫租戶稽核。

#### Scenario: 關閉後只剩私訊欄位
- **WHEN** 對已開啟接收的 FB 渠道關閉留言接收
- **THEN** 假 Graph API 收到的 `subscribed_fields` 恰好是 4 個 messaging 欄位

### Requirement: 重新連結粉專時保留留言欄位
Meta 連結流程重新連結粉專時，SHALL 依渠道是否已開啟留言接收決定訂閱欄位：已開啟時送 4 個 messaging 欄位加 `feed`，未開啟時恰好送 4 個 messaging 欄位。新連結的粉專在租戶方案含 `comment_reply` 且平台開放 FB 私訊能力時 SHALL 預設開啟接收並訂 `feed`，否則不訂。

#### Scenario: 已開啟接收的粉專重新連結
- **WHEN** 已開啟留言接收的粉專重新連結
- **THEN** `subscribed_fields` 含 `feed` 與 4 個 messaging 欄位

#### Scenario: 未開啟接收的粉專重新連結
- **WHEN** 未開啟留言接收的粉專重新連結
- **THEN** `subscribed_fields` 恰好是 4 個 messaging 欄位

#### Scenario: 方案不含功能時新連結
- **WHEN** 方案不含 `comment_reply` 的租戶新連結粉專
- **THEN** `subscribed_fields` 恰好是 4 個 messaging 欄位，渠道未開啟接收

### Requirement: 連結流程可以回到留言自動私訊頁
`POST /api/v1/meta-connect/start` SHALL 接受選填的 `returnTo`，只接受 `/dashboard/` 開頭的站內相對路徑；連結完成後導回該路徑。其他值 SHALL 回 400，不導向外部網址。

#### Scenario: 站內路徑
- **WHEN** `returnTo` 是 `/dashboard/comment-replies`
- **THEN** 連結完成後導回 `/dashboard/comment-replies`

#### Scenario: 外部網址
- **WHEN** `returnTo` 是 `https://evil.example` 或 `//evil.example`
- **THEN** 回應 400

### Requirement: 最近貼文清單
`GET /api/v1/comment-replies/channels/:channelId/posts` SHALL 需要 `comment_reply.manage`，代理 Graph API 回傳最近貼文（貼文 ID、連結、縮圖、摘要、類型、發布時間）與下一頁 cursor，結果快取 60 秒，不寫資料庫。平台關閉該平台的貼文挑選能力時 SHALL 回 403 `CAPABILITY_DISABLED`；Meta 回錯誤時 SHALL 回 502 `POSTS_UNAVAILABLE`，`details.reason` 指出原因。

#### Scenario: 權杖失效
- **WHEN** Graph API 回 code 190
- **THEN** 回應 502，`error.code` 是 `POSTS_UNAVAILABLE`，`details.reason` 是 `TOKEN_EXPIRED`

#### Scenario: 平台未開放貼文挑選
- **WHEN** 平台設定 `commentReply.capabilities.fbPostPicker` 為 false，查 FB 渠道的最近貼文
- **THEN** 回應 403，`error.code` 是 `CAPABILITY_DISABLED`，沒有呼叫 Graph API

### Requirement: 以網址找貼文只呼叫 Graph API
`POST /api/v1/comment-replies/channels/:channelId/posts/resolve` SHALL 把 FB 貼文網址或 IG 貼文、Reels 網址解析成貼文，只呼叫 `graph.facebook.com` 或 `graph.instagram.com`，SHALL NOT 對使用者給的網址發出請求。找不到時回 404 `POST_NOT_FOUND`。能力開關與錯誤處理與最近貼文清單相同。

#### Scenario: 解析 FB 貼文網址
- **WHEN** 送 `https://www.facebook.com/<page>/posts/123`
- **THEN** 回傳 `postId` 為 `{pageId}_123` 的貼文

#### Scenario: 任意外部網址
- **WHEN** 送 `https://evil.example/a`
- **THEN** 回應 404 `POST_NOT_FOUND`；系統呼叫過的主機只有 Graph API 網域

### Requirement: 定期檢查留言訂閱
系統 SHALL 每 6 小時對開啟留言接收的渠道查詢 Meta 的訂閱欄位，記錄結果為 `ok`、`missing` 或 `unknown`。網路錯誤或限流記 `unknown`，不改先前狀態、不通知。開啟接收且有啟用規則的渠道訂閱缺少 `feed` 或 `comments` 時，SHALL 發出維運告警並通知租戶管理員。

#### Scenario: Meta 取消了 feed 訂閱
- **WHEN** 開啟接收且有啟用規則的 FB 渠道，`GET subscribed_apps` 回傳的欄位沒有 `feed`
- **THEN** 渠道的訂閱狀態是 `missing`；發出 `comment-reply-subscription:<channelId>` 告警；租戶管理員收到通知

#### Scenario: 查詢時網路錯誤
- **WHEN** 查詢訂閱時網路錯誤
- **THEN** 訂閱狀態是 `unknown`，沒有告警與通知
