## ADDED Requirements

### Requirement: 命中規則的新留言建立處理中紀錄
系統收到 FB `feed` 或 IG `comments` 的新留言事件，留言命中渠道的啟用規則時，SHALL 在同一個租戶交易內建立一筆 `PENDING` 觸發紀錄並排入 `comment-reply` 背景工作，webhook 回應 SHALL 不等私訊送出。`/webhooks/meta`、`/webhooks/fb/:channelId`、`/webhooks/threads/:channelId` 三個入口行為相同。

#### Scenario: FB 留言命中規則
- **WHEN** 以正確簽章送 FB `object=page`、`field=feed`、`item=comment`、`verb=add`、文字命中啟用規則的請求到 `/webhooks/meta`
- **THEN** 回應 200；該渠道恰好 1 筆紀錄，狀態 `PENDING`；有 1 個待處理的 `comment-reply` job

#### Scenario: 舊模式渠道網址
- **WHEN** 同一個請求改送到 `/webhooks/fb/:channelId`
- **THEN** 結果與送到 `/webhooks/meta` 相同

#### Scenario: IG 留言命中規則
- **WHEN** 送 IG `object=instagram`、`field=comments` 命中啟用規則的請求到 `/webhooks/threads/:channelId`
- **THEN** 回應 200；IG 渠道 1 筆 `PENDING` 紀錄

### Requirement: 不處理的留言不留紀錄
下列留言 SHALL NOT 產生紀錄，也 SHALL NOT 呼叫 Meta：沒命中任何啟用規則；粉專或 IG 帳號自己的留言；簽章錯誤；`entry.id` 對不到啟用中的渠道；租戶停用；租戶方案不含 `comment_reply`；平台緊急停止或關閉該平台的私訊能力；渠道設定下游轉發 `immediate` 模式。租戶沒有方案時視為含 `comment_reply`。

#### Scenario: 沒命中規則
- **WHEN** 留言文字不含任何啟用規則的關鍵字
- **THEN** 不產生紀錄

#### Scenario: 粉專自己的留言
- **WHEN** FB 留言的 `from.id` 等於 `entry.id`（含本功能自己的公開回覆被 Meta 送回）
- **THEN** 不產生紀錄，不呼叫 Graph API

#### Scenario: 方案不含留言自動私訊
- **WHEN** 租戶方案的 features 不含 `comment_reply`，留言命中規則
- **THEN** 不產生紀錄，不呼叫 Graph API

#### Scenario: 租戶沒有方案
- **WHEN** 租戶 `planId` 為 null，留言命中規則
- **THEN** 產生 1 筆 `PENDING` 紀錄

#### Scenario: 簽章錯誤
- **WHEN** 請求以別的 App Secret 簽章
- **THEN** 回應與既有私訊的驗簽失敗相同，不產生紀錄

### Requirement: 留言事件依帳號分派到所屬租戶
留言事件 SHALL 依 `entry.id` 與私訊相同的帳號分派規則找到渠道與租戶，紀錄 SHALL 寫在該渠道所屬租戶。一個請求含多個租戶的帳號時，各租戶各自建立紀錄。

#### Scenario: 一個請求帶兩個租戶的留言
- **WHEN** 租戶 A、B 的粉專共用同一個 Meta App，一個請求帶兩個 `entry`，各自命中規則
- **THEN** A、B 各 1 筆紀錄；以 B 綁定的 `app_tenant` 連線查不到 A 的紀錄

#### Scenario: 回呼網址與粉專屬於不同租戶
- **WHEN** 請求送到租戶 A 渠道的回呼網址，`entry.id` 是租戶 B 的粉專
- **THEN** 紀錄寫在 B 的渠道，A 沒有紀錄

### Requirement: 留言處理失敗不影響私訊
同一個 webhook 請求同時有私訊與留言時，私訊 SHALL 照常進收件匣。留言收件丟錯時，系統 SHALL 在該渠道記 `comment_intake_failed` 警示並寫 error log，webhook 仍回 200。

#### Scenario: 同一請求有私訊與留言
- **WHEN** 一個請求同時帶 `messaging[]` 私訊與命中規則的 `changes[]` 留言
- **THEN** 私訊進收件匣，留言產生 1 筆紀錄

#### Scenario: 留言收件丟錯
- **WHEN** 留言收件時讀規則失敗
- **THEN** 同一請求的私訊仍落地；該渠道有 `comment_intake_failed` 警示；webhook 回 200

### Requirement: 同一則留言只建立一筆紀錄
`(channelId, commentId)` SHALL 唯一。Meta 重投、IG 廣告貼文的重複通知、兩個入口同時收到同一則留言時，SHALL 只有一筆紀錄、一個有效的送出工作。

#### Scenario: 同一個請求重送三次
- **WHEN** 同一個 webhook 請求依序送 3 次，之後處理完所有工作
- **THEN** 只有 1 筆紀錄，Meta 只收到 1 次私訊呼叫

#### Scenario: 兩個入口並行
- **WHEN** 同一則留言同時從 `/webhooks/meta` 與 `/webhooks/fb/:channelId` 進來
- **THEN** 只有 1 筆紀錄，Meta 只收到 1 次私訊呼叫

### Requirement: 背景送出私訊
`comment-reply` 工作在 API 行程以綁定租戶的連線執行，SHALL 以 Send API 的 `recipient: { comment_id }` 私訊留言者。成功時紀錄 SHALL 改為 `SENT`，記錄 Meta 回傳的 `recipient_id`、`message_id`、送出時間與送出內容快照。呼叫 Meta 的期間 SHALL 不持有資料庫交易。

#### Scenario: FB 文字規則送出成功
- **WHEN** FB 文字規則命中、Graph API 回成功
- **THEN** Meta 收到 1 次 `POST /me/messages`，body 的 `recipient.comment_id` 是留言 ID、沒有 `recipient.id`、`message.text` 是規則文字；紀錄是 `SENT`，`recipientUid` 是回應的 `recipient_id`

#### Scenario: IG 文字規則送出成功
- **WHEN** IG 文字規則命中、Graph API 回成功
- **THEN** Meta 收到 1 次 `POST graph.instagram.com/.../me/messages`，`recipient.comment_id` 正確；紀錄是 `SENT`

#### Scenario: Meta 呼叫不在交易內
- **WHEN** 假 Graph API 在回應前，以另一條連線查該紀錄
- **THEN** 查得到已提交的 `SENDING` 狀態與 `sendAttemptedAt`

### Requirement: 私訊內容的渲染
送出內容 SHALL 由規則的文字或素材渲染而成：`{commenter.name}` 代入留言者名稱，素材變數代入預設值，沒有預設值的變數留空；送出內容 SHALL NOT 含未解析的佔位字串。FB 素材中的站內路徑 SHALL 換成公開網址。

#### Scenario: 素材含留言者名稱與變數
- **WHEN** 素材文字是「{commenter.name} 你好，{{coupon_name}}」，`coupon_name` 有預設值「春季券」，另一個變數沒有預設值
- **THEN** 送出的文字代入留言者名稱與「春季券」，不含 `{{` 或 `}}`

### Requirement: 送出前重新檢查
工作執行時 SHALL 重新檢查，任一不成立就不呼叫 Meta，紀錄改為 `SKIPPED` 並記原因：租戶停用（`TENANT_DISABLED`）、緊急停止（`EMERGENCY_STOPPED`）、能力關閉（`CAPABILITY_DISABLED`）、方案不含功能（`PLAN_FEATURE_DISABLED`）、渠道停用（`CHANNEL_INACTIVE`）、規則停用或刪除（`RULE_INACTIVE`）、素材停用或刪除（`MATERIAL_UNAVAILABLE`）、素材類型不支援（`MATERIAL_UNSUPPORTED`）。

#### Scenario: 排隊期間規則被停用
- **WHEN** 紀錄排隊期間規則被停用，之後工作執行
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `RULE_INACTIVE`，`GET /logs` 看得到

#### Scenario: 排隊期間方案移除功能
- **WHEN** 紀錄排隊期間租戶方案移除 `comment_reply`，之後工作執行
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `PLAN_FEATURE_DISABLED`

#### Scenario: 排隊期間素材被停用
- **WHEN** 素材規則的素材在排隊期間被停用
- **THEN** 不呼叫 Meta，紀錄是 `SKIPPED`、原因 `MATERIAL_UNAVAILABLE`

### Requirement: 超過 7 天的留言不送出
留言時間距今達 7 天減 10 分鐘時，系統 SHALL 不呼叫 Meta，紀錄改為 `EXPIRED`、原因 `WINDOW_EXPIRED`。FB 以留言的 `created_time` 判斷；IG 事件沒有留言時間，以通知時間判斷並記錄時間來源。Meta 回超過期限時，紀錄 SHALL 為 `EXPIRED`、原因 `EXPIRED_BY_META`。

#### Scenario: 7 天前的留言
- **WHEN** 留言時間是 7 天又 1 分鐘前，工作執行
- **THEN** 不呼叫 Meta，紀錄是 `EXPIRED`

#### Scenario: 安全邊際內
- **WHEN** 留言時間是 6 天 23 小時 55 分前
- **THEN** 紀錄是 `EXPIRED`

#### Scenario: 6 天前的留言
- **WHEN** 留言時間是 6 天前
- **THEN** 送出私訊

#### Scenario: Unix 秒的留言時間
- **WHEN** FB 留言 `created_time` 是 `1731470000`
- **THEN** 紀錄的留言時間是 2024-11-13，不是 1970 年

#### Scenario: 排隊到過期
- **WHEN** 留言收件時未滿 7 天，因限流排隊到工作執行時已滿 7 天減 10 分鐘
- **THEN** 不呼叫 Meta，紀錄是 `EXPIRED`

### Requirement: 重複執行的工作不重複私訊
同一筆紀錄的工作被執行多次時，SHALL 只有一次能把紀錄從 `PENDING` 改為 `SENDING` 並呼叫 Meta。紀錄停在 `SENDING` 超過 2 分鐘時，系統 SHALL 再送一次；Meta 回「已私訊過」時紀錄 SHALL 為 `SENT`、原因 `SENT_UNCONFIRMED`，不記為失敗。

#### Scenario: 同一筆紀錄的工作執行兩次
- **WHEN** 同一筆 `PENDING` 紀錄的工作被執行兩次
- **THEN** Meta 收到 1 次私訊呼叫，第二次執行不改紀錄

#### Scenario: 送出後寫結果前中斷
- **WHEN** Meta 已回成功、寫結果前行程中斷；2 分鐘後重新處理，假 Graph API 回「已私訊過」
- **THEN** 紀錄是 `SENT`、原因 `SENT_UNCONFIRMED`；Meta 成功送達的私訊只有 1 則

### Requirement: 同一位留言者在同一規則只私訊一次
規則開啟「每人一次」（預設開）時，同一位留言者在同一條規則 SHALL 最多有一筆 `SENT`。之後的留言 SHALL 記為 `SKIPPED_DUPLICATE` 並在詳情指出先前送出的紀錄。前一筆 `FAILED` 或 `EXPIRED` SHALL NOT 佔名額。規則關閉「每人一次」時每則留言各自送出。

#### Scenario: 同一人留五則
- **WHEN** 規則開啟每人一次，同一人依序留 5 則都命中
- **THEN** 1 筆 `SENT`、4 筆 `SKIPPED_DUPLICATE`，Meta 只收到 1 次私訊

#### Scenario: 關閉每人一次
- **WHEN** 規則關閉每人一次，同一人依序留 5 則都命中
- **THEN** 5 筆 `SENT`，Meta 收到 5 次私訊

#### Scenario: 第一則失敗後的留言仍會嘗試
- **WHEN** 規則開啟每人一次，第一則私訊 Meta 回 551（使用者無法接收），之後同一人再留一則
- **THEN** 第二則會呼叫 Meta 嘗試送出

#### Scenario: 同一人兩則留言並行
- **WHEN** 規則開啟每人一次，同一人兩則留言的工作同時執行
- **THEN** Meta 只收到 1 次私訊，另一筆最後是 `SKIPPED_DUPLICATE`

#### Scenario: 不同規則各送一次
- **WHEN** 同一人的兩則留言分別命中規則 X 與規則 Y
- **THEN** 兩筆都是 `SENT`

### Requirement: 私訊失敗的原因與可否重試
Meta 拒絕時紀錄 SHALL 改為 `FAILED`，`reasonCode` 是封閉清單之一（`TOKEN_EXPIRED`、`PERMISSION_MISSING`、`APP_NOT_APPROVED`、`USER_UNAVAILABLE`、`COMMENT_NOT_FOUND`、`ALREADY_REPLIED`、`RECIPIENT_IS_PAGE`、`RATE_LIMITED`、`NETWORK`、`UNKNOWN`），並記 Meta 原始錯誤碼與訊息前 200 字。這類業務失敗 SHALL 讓工作正常完成，不進 failed set、不發佇列失敗告警。

#### Scenario: 權杖失效
- **WHEN** Graph API 回 code 190
- **THEN** 紀錄是 `FAILED`、原因 `TOKEN_EXPIRED`、可重試，詳情有原始 code；工作正常完成

#### Scenario: 使用者無法接收
- **WHEN** Graph API 回 code 551
- **THEN** 紀錄是 `FAILED`、原因 `USER_UNAVAILABLE`、不可重試；沒有發出 `queue-failed` 告警

#### Scenario: 測試階段的權限錯誤
- **WHEN** 平台設定 `commentReply.testPhase.fb` 為 true，平台模式 FB 渠道的私訊回 code 10
- **THEN** 紀錄是 `FAILED`、原因 `APP_NOT_APPROVED`、不可重試

#### Scenario: 未對照的錯誤
- **WHEN** Graph API 回未對照的錯誤碼
- **THEN** 紀錄是 `FAILED`、原因 `UNKNOWN`，詳情帶原始訊息

### Requirement: 網路錯誤自動重試
送出時網路錯誤或 HTTP 5xx SHALL 退避重試，最多 5 次；重試期間紀錄 SHALL 維持 `PENDING`。重試用盡時紀錄 SHALL 為 `FAILED`、原因 `NETWORK`、可重試，後台看得到。資料庫或程式例外 SHALL 讓工作失敗，重試用盡後進 failed set 並發出告警。

#### Scenario: 第一次網路錯誤第二次成功
- **WHEN** 第 1 次呼叫 Meta 丟網路錯誤、第 2 次成功
- **THEN** 紀錄最後是 `SENT`，只有 1 筆紀錄

#### Scenario: 一直回 500
- **WHEN** Graph API 每次都回 HTTP 500，直到重試用盡
- **THEN** 紀錄是 `FAILED`、原因 `NETWORK`，`GET /logs` 看得到

#### Scenario: 資料庫錯誤重試用盡
- **WHEN** 工作執行時資料庫一直連不上，直到重試用盡
- **THEN** job 進 failed set，平台佇列監控看得到，並發出 `queue-failed` 告警

### Requirement: Meta 限流時排隊而不是失敗
每個渠道的私訊 SHALL 受每小時上限限制（數字來自平台設定）。額度不足時 SHALL 不呼叫 Meta，紀錄維持 `PENDING`、原因 `RATE_LIMIT_QUEUED`，工作延到有額度時再執行，SHALL NOT 消耗重試次數。Meta 回限流錯誤時同樣延後；同一筆紀錄累計 10 次 Meta 限流回應時記 `FAILED`、原因 `RATE_LIMITED`、可重試。

#### Scenario: 本小時額度用完
- **WHEN** 渠道本小時額度已用完，又有一筆待送
- **THEN** 不呼叫 Meta；紀錄是 `PENDING`、原因 `RATE_LIMIT_QUEUED`；job 延後且重試次數沒有增加

#### Scenario: 另一個渠道不受影響
- **WHEN** 渠道 A 額度用完，渠道 B 有一筆待送
- **THEN** 渠道 B 照常送出

#### Scenario: Meta 回限流一次
- **WHEN** Graph API 回 code 613 一次、之後成功
- **THEN** 紀錄最後是 `SENT`，job 沒有進 failed set

### Requirement: 公開回覆留言
規則開啟公開回覆時，系統 SHALL 只在私訊 `SENT` 之後公開回覆一次（FB `POST /{comment-id}/comments`、IG `POST /{comment-id}/replies`），文字依留言 ID 從設定中固定選一則。私訊沒送出時 `publicReplyStatus` SHALL 為 `SKIPPED`。公開回覆失敗 SHALL NOT 改變私訊狀態；公開回覆送出中斷時 SHALL NOT 重送，記 `FAILED`、原因 `UNKNOWN_AFTER_CRASH`。

#### Scenario: 私訊成功後公開回覆
- **WHEN** FB 規則開啟公開回覆、私訊成功
- **THEN** Meta 收到 1 次 `POST /{comment-id}/comments`，文字是設定中的一則；`publicReplyStatus` 是 `SENT`

#### Scenario: 私訊失敗不公開回覆
- **WHEN** 私訊 `FAILED`
- **THEN** 沒有公開回覆呼叫，`publicReplyStatus` 是 `SKIPPED`

#### Scenario: 公開回覆缺權限
- **WHEN** 私訊成功、公開回覆回權限錯誤
- **THEN** 紀錄仍是 `SENT`，`publicReplyStatus` 是 `FAILED`、原因 `PERMISSION_MISSING`

#### Scenario: 同一則留言重算選到同一則文字
- **WHEN** 規則設定 3 則公開回覆文字，30 則不同留言觸發
- **THEN** 同一個留言 ID 每次選到相同文字，30 則中至少用到 2 則不同文字

#### Scenario: 公開回覆額度用完
- **WHEN** 私訊成功，渠道公開回覆本小時額度用完
- **THEN** 私訊照常 `SENT`，`publicReplyStatus` 是 `SKIPPED`、原因 `RATE_LIMITED`

### Requirement: 觸發紀錄的查詢
有 `comment_reply.view` 的成員 SHALL 能以 `GET /api/v1/comment-replies/logs` 依狀態、渠道、規則、期間與留言者名稱或內容查詢紀錄（cursor 分頁），以 `GET /logs/summary` 取得各狀態筆數，以 `GET /logs/:id` 讀詳情。結果 SHALL 只含檢視者看得到的渠道；看不到或其他租戶的紀錄回 404 `LOG_NOT_FOUND`。

#### Scenario: 分店帳號只看到自己渠道的紀錄
- **WHEN** 成員只看得到渠道 A，呼叫 `GET /logs` 與 `GET /logs/summary`
- **THEN** 只含渠道 A 的紀錄與筆數

#### Scenario: 讀看不到的渠道的紀錄
- **WHEN** 只看得到渠道 A 的成員讀渠道 B 的紀錄詳情
- **THEN** 回應 404，`error.code` 是 `LOG_NOT_FOUND`

#### Scenario: 沒有檢視權限
- **WHEN** 沒有 `comment_reply.view` 的成員呼叫 `GET /logs`
- **THEN** 回應 403，`error.details.requiredPermission` 是 `comment_reply.view`

#### Scenario: 已私訊過的詳情指出先前的紀錄
- **WHEN** 讀一筆 `SKIPPED_DUPLICATE` 紀錄的詳情
- **THEN** 回應帶先前 `SENT` 紀錄的 ID

### Requirement: 紀錄詳情的對話連結依權限顯示
紀錄詳情 SHALL 只在檢視者有 `inbox.view` 且看得到該渠道時回傳 `conversationId`；否則只回顧客是否已回覆。

#### Scenario: 沒有收件匣權限
- **WHEN** 顧客已回覆私訊，沒有 `inbox.view` 的成員讀這筆紀錄詳情
- **THEN** 回應沒有 `conversationId`，`customerReplied` 是 true

### Requirement: 手動重試
有 `comment_reply.manage` 的成員 SHALL 能以 `POST /api/v1/comment-replies/logs/:id/retry` 重試可重試的 `FAILED` 紀錄，或原因 `PLAN_QUOTA_EXCEEDED` 的 `SKIPPED` 紀錄，條件是留言未滿 7 天減 10 分鐘。成功回 202，紀錄改為 `PENDING` 並排入新的工作。不符合時回 409 `RETRY_NOT_ALLOWED`，`details.reason` 是 `NOT_FAILED`、`NOT_RETRYABLE` 或 `EXPIRED`。

#### Scenario: 重試可重試的失敗
- **WHEN** 紀錄是 `FAILED`、原因 `TOKEN_EXPIRED`、留言 2 天前，有 manage 的成員重試
- **THEN** 回應 202 `{ status: 'PENDING' }`；工作執行成功後紀錄是 `SENT`

#### Scenario: 重試不可重試的失敗
- **WHEN** 紀錄是 `FAILED`、原因 `USER_UNAVAILABLE`
- **THEN** 回應 409，`details.reason` 是 `NOT_RETRYABLE`

#### Scenario: 重試已送出的紀錄
- **WHEN** 紀錄是 `SENT`
- **THEN** 回應 409，`details.reason` 是 `NOT_FAILED`

#### Scenario: 重試已過期的留言
- **WHEN** 紀錄是 `FAILED`、可重試，但留言已是 7 天前
- **THEN** 回應 409，`details.reason` 是 `EXPIRED`

### Requirement: 遺失或卡住的工作自動補回
系統 SHALL 每 5 分鐘找出 `PENDING` 超過 10 分鐘沒有進展、或 `SENDING` 超過 2 分鐘的紀錄並重新排入工作；留言時間已超過 7 天的 `PENDING` 或 `SENDING` 紀錄 SHALL 改為 `EXPIRED`。

#### Scenario: Redis 裡的工作不見了
- **WHEN** 紀錄是 `PENDING`，對應的 job 已從 Redis 消失超過 10 分鐘
- **THEN** 下一次補回後紀錄最後是 `SENT`，Meta 只收到 1 次私訊

#### Scenario: 卡住超過 7 天
- **WHEN** 紀錄是 `PENDING`，留言時間已超過 7 天
- **THEN** 補回時紀錄改為 `EXPIRED`，不呼叫 Meta

### Requirement: 留言被刪除時清除內容
收到 FB 留言刪除事件（`verb=remove`）且該留言已有紀錄時，系統 SHALL 清空紀錄的留言內容並記錄刪除時間，不產生新紀錄、不呼叫 Meta。

#### Scenario: 顧客刪除留言
- **WHEN** 已有紀錄的留言收到 `verb=remove` 事件
- **THEN** 紀錄數不變，該紀錄的 `commentText` 是 null、`commentDeletedAt` 有值

### Requirement: 留言處理不把個資寫進工作與日誌
`comment-reply` 工作的資料 SHALL 只有 `tenantId` 與 `logId`。處理留言時的日誌 SHALL NOT 含留言內容、留言者名稱、私訊內容、權杖或 `appsecret_proof`。

#### Scenario: 工作資料只有識別欄位
- **WHEN** 一則命中的留言排入工作
- **THEN** job data 的鍵只有 `tenantId` 與 `logId`

#### Scenario: 日誌不含留言內容
- **WHEN** 處理一則內容為「0912345678 我要領券」的留言時擷取日誌
- **THEN** 日誌不含「0912345678」、留言者名稱與私訊文字
