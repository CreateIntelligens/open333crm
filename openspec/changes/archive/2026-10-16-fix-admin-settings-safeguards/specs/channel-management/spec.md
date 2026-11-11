## ADDED Requirements

### Requirement: Webhook 公開網址的格式

`POST /api/v1/channels/webhook-base-url` SHALL 只接受 `https` 網址，網址不得含帳號密碼、查詢字串（`?`）或片段（`#`）。不合格時系統 SHALL 回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不修改任何渠道。

#### Scenario: https 網址可以套用
- **WHEN** 有 `channel.update` 的成員送出 `baseUrl` 為 `https://crm.example.com/`
- **THEN** 系統回 HTTP 200，每個渠道的 webhook 網址以 `https://crm.example.com/api/v1/webhooks/` 開頭

#### Scenario: http 網址被拒
- **WHEN** 成員送出 `baseUrl` 為 `http://crm.example.com`
- **THEN** 系統回 HTTP 400，渠道的 webhook 網址不變

#### Scenario: 帶查詢字串的網址被拒
- **WHEN** 成員送出 `baseUrl` 為 `https://crm.example.com?x=1`
- **THEN** 系統回 HTTP 400，渠道的 webhook 網址不變

### Requirement: 套用 Webhook 公開網址前確認

渠道管理頁按「套用」時，前端 SHALL 先顯示確認，說明會改寫幾個渠道的 webhook 網址、填錯會讓這些渠道收不到訊息。成員取消時，前端 SHALL 不送出請求。說明文字 SHALL NOT 要求填寫 ngrok 等臨時隧道網址。

#### Scenario: 取消確認時不送出
- **WHEN** 成員填好網址按「套用」，在確認中按取消
- **THEN** 前端不呼叫 `POST /api/v1/channels/webhook-base-url`

#### Scenario: 確認後送出
- **WHEN** 成員填好網址按「套用」，在確認中按確定
- **THEN** 前端以填寫的網址呼叫 `POST /api/v1/channels/webhook-base-url`

### Requirement: 渠道狀態查詢不寫入資料

`GET /api/v1/channels/:id/status` SHALL 只讀取。查詢 FB 權杖狀態時，系統 SHALL NOT 更新渠道的 `lastVerifiedAt` 或 `settings`。「最後驗證」時間只由 `POST /api/v1/channels/:id/verify`（測試連線）更新。渠道管理頁 SHALL 只對啟用中的 FB 渠道查詢權杖狀態。

#### Scenario: 查詢 FB 權杖狀態不更新最後驗證
- **WHEN** 成員開啟渠道管理頁，前端對 FB 渠道呼叫 `GET /api/v1/channels/:id/status`
- **THEN** 該渠道的 `lastVerifiedAt` 與 `settings` 不變

#### Scenario: 停用的 FB 渠道不查詢
- **WHEN** 租戶有一個停用的 FB 渠道，成員開啟渠道管理頁
- **THEN** 前端不對這個渠道呼叫 `GET /api/v1/channels/:id/status`

### Requirement: Bot 最大回覆次數的範圍

建立或更新渠道時，若 `settings.botConfig.maxBotReplies` 有值，系統 SHALL 只接受 1～50 的整數，否則回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不修改渠道。

#### Scenario: 範圍內的值可以儲存
- **WHEN** 有 `channel.update` 的成員以 `settings.botConfig.maxBotReplies` 為 10 更新渠道
- **THEN** 系統回 HTTP 200

#### Scenario: 超出範圍的值被拒
- **WHEN** 成員以 `settings.botConfig.maxBotReplies` 為 9999 或 0 更新渠道
- **THEN** 系統回 HTTP 400，渠道的設定不變

### Requirement: 有資料的渠道改用停用

渠道管理頁 SHALL 為每個渠道提供停用與重新啟用的按鈕，以 `PATCH /api/v1/channels/:id` 的 `isActive` 切換。`DELETE /api/v1/channels/:id` 遇到渠道仍被對話或其他資料參照、資料庫拒絕刪除時，系統 SHALL 回 HTTP 409，`error.code` 是 `CHANNEL_IN_USE`，訊息建議改用停用，渠道維持原狀。

#### Scenario: 收過對話的渠道刪除被拒
- **WHEN** 渠道有對話，有 `channel.delete` 的成員刪除這個渠道
- **THEN** 系統回 HTTP 409，`error.code` 是 `CHANNEL_IN_USE`，渠道仍然存在

#### Scenario: 從卡片停用渠道
- **WHEN** 有 `channel.update` 的成員在啟用中渠道的卡片按「停用」並確認
- **THEN** 前端以 `{ isActive: false }` 呼叫 `PATCH /api/v1/channels/:id`
