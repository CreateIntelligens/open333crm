# channel-management Specification

## Purpose
規定渠道管理的防呆：Webhook 公開網址的格式與套用前確認、查詢渠道狀態不寫入資料也不呼叫外部 API、Bot 最大回覆次數的上下限，以及已有對話資料的渠道改用停用而非刪除。

## Requirements

### Requirement: Webhook 公開網址的格式

`POST /api/v1/channels/webhook-base-url` SHALL 只接受 `https` 網址，網址不得含帳號密碼、查詢字串（`?`）或片段（`#`）。不合格時系統 SHALL 回 HTTP 400，`error.code` 是 `VALIDATION_ERROR`，不修改任何渠道。

#### Scenario: https 網址可以套用
- **WHEN** 有 `channel.update` 與 `channel.view_all` 的成員送出 `baseUrl` 為 `https://crm.example.com/`
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

### Requirement: 產生 LIFF 設定的測試連結

`POST /api/v1/channels/:id/liff-test` SHALL 需要 `channel.update` 權限。渠道是本租戶的 LINE 渠道，且已存檔 LIFF App ID 與 LINE Login Channel ID 時，系統 SHALL 回傳 `testId`、測試網址 `https://liff.line.me/{liffId}?lt={testId}&lid={liffId}`、該網址的 QR code（data URL）與到期時間。測試連結 SHALL 在 10 分鐘後失效，測試的是產生當下存檔的設定值。

#### Scenario: 已設定的 LINE 渠道產生測試連結

- **GIVEN** LINE 渠道存檔了 LIFF App ID `1660000000-abcdefgh` 與 Login Channel ID `1660000001`
- **WHEN** 有 `channel.update` 權限的管理者呼叫 `POST /api/v1/channels/:id/liff-test`
- **THEN** 回應的 `testUrl` 是 `https://liff.line.me/1660000000-abcdefgh?lt={testId}&lid=1660000000-abcdefgh`，並附 `qrCode` 與 10 分鐘後的 `expiresAt`

#### Scenario: 沒有設定完整時不產生

- **GIVEN** LINE 渠道只存檔了 LIFF App ID，沒有 Login Channel ID
- **WHEN** 管理者呼叫 `POST /api/v1/channels/:id/liff-test`
- **THEN** 回 HTTP 409，`error.code` 是 `LIFF_NOT_CONFIGURED`，不產生測試連結

#### Scenario: 不是 LINE 渠道

- **WHEN** 管理者對 FB 渠道呼叫 `POST /api/v1/channels/:id/liff-test`
- **THEN** 回 HTTP 409，`error.code` 是 `LIFF_NOT_CONFIGURED`

#### Scenario: 其他租戶的渠道

- **WHEN** 管理者以其他租戶的渠道 id 呼叫 `POST /api/v1/channels/:id/liff-test`
- **THEN** 回 HTTP 404，不產生測試連結

#### Scenario: 沒有權限

- **WHEN** 沒有 `channel.update` 權限的成員呼叫 `POST /api/v1/channels/:id/liff-test`
- **THEN** 回 HTTP 403，`error.details.requiredPermission` 是 `channel.update`

### Requirement: 手機回報 LIFF 測試結果

公開端點 `POST /api/v1/fan/liff-test` SHALL 只憑 `testId` 找到要測試的租戶、渠道與設定值。請求帶 `idToken` 時，系統 SHALL 以產生測試時的 Login Channel ID 向 LINE 驗證；請求帶 `failure`（`init_failed` 或 `no_id_token`）時，系統 SHALL 直接記錄該失敗。系統 SHALL 記錄結果並回傳結果代碼與給人看的說明。只有結果是 `verified` 時，系統 SHALL 在渠道 `settings.liffTest` 記錄測試時間與測試的設定值。

#### Scenario: 設定正確且是官方帳號的聯絡人

- **GIVEN** 一條有效的測試連結
- **WHEN** 手機送出 LINE 驗證通過的 ID token，ID token 的使用者是這個渠道已有的 LINE 身分
- **THEN** 結果是 `verified`，渠道 `settings.liffTest` 記錄 `verifiedAt` 與測試的 LIFF App ID、Login Channel ID

#### Scenario: LINE 帳號不在這個官方帳號的聯絡人裡

- **GIVEN** 一條有效的測試連結
- **WHEN** 手機送出 LINE 驗證通過的 ID token，ID token 的使用者不是這個渠道的任何 LINE 身分
- **THEN** 結果是 `not_a_friend`，說明提到要先加好友，以及 Login channel 與官方帳號可能不在同一個 Provider；`settings.liffTest` 不變

#### Scenario: ID token 跟 Login Channel ID 不符

- **WHEN** 手機送出的 ID token 被 LINE 拒絕
- **THEN** 結果是 `id_token_rejected`，`settings.liffTest` 不變

#### Scenario: 連不上 LINE

- **WHEN** 向 LINE 驗證 ID token 時連線失敗、逾時，或 LINE 回 5xx、408、429
- **THEN** 結果是 `line_unreachable`，`settings.liffTest` 不變

#### Scenario: 手機回報 LIFF 端的失敗

- **WHEN** 手機送出 `failure: 'no_id_token'`
- **THEN** 結果是 `no_id_token`，說明提到在 LIFF App 的 Scope 勾選 openid；系統不呼叫 LINE

#### Scenario: 測試連結過期或不存在

- **WHEN** 手機以不存在或已過期的 `testId` 回報
- **THEN** 回 HTTP 410，`error.code` 是 `LIFF_TEST_EXPIRED`，不記錄任何結果

### Requirement: 查詢 LIFF 測試結果

`GET /api/v1/channels/:id/liff-test/:testId` SHALL 需要 `channel.update` 權限，回傳 `pending`（還沒收到回報）、`expired`（連結已過期）或最近一次回報的結果代碼與說明。`testId` 不屬於這個租戶的這個渠道時，系統 SHALL 回 HTTP 404。

#### Scenario: 還沒收到回報

- **GIVEN** 剛產生的測試連結
- **WHEN** 管理者查詢結果
- **THEN** `status` 是 `pending`

#### Scenario: 收到回報後

- **GIVEN** 手機已回報，結果是 `not_a_friend`
- **WHEN** 管理者查詢結果
- **THEN** `status` 是 `not_a_friend`，附同樣的說明

#### Scenario: 其他渠道的測試

- **WHEN** 管理者以 A 渠道的路徑查詢 B 渠道產生的 `testId`
- **THEN** 回 HTTP 404

### Requirement: LIFF 測試紀錄由系統維護

`settings.liffTest` SHALL 只由測試結果寫入。以 `PATCH /api/v1/channels/:id` 更新渠道設定時，請求沒帶 `liffTest` 的話系統 SHALL 保留原值；請求帶了 `liffTest` 的話，系統 SHALL 忽略它。

#### Scenario: Bot 設定整包存檔不會洗掉測試紀錄

- **GIVEN** 渠道 `settings.liffTest` 有測試成功的紀錄
- **WHEN** 管理者以不含 `liffTest` 的 `settings` 呼叫 `PATCH /api/v1/channels/:id`
- **THEN** `settings.liffTest` 不變

#### Scenario: 不能從 API 偽造測試紀錄

- **WHEN** 管理者以含 `liffTest` 的 `settings` 呼叫 `PATCH /api/v1/channels/:id`
- **THEN** `settings.liffTest` 不變

### Requirement: LIFF 入口頁的測試流程

LIFF 入口頁 `/liff/redirect` 的網址帶 `lt` 時，系統 SHALL 跑測試流程，不跑短連結或票券流程：啟動 LIFF、未登入時先登入、取得 ID token 後送到 `POST /api/v1/fan/liff-test`，並在手機上顯示結果說明。LIFF 啟動失敗或沒有 ID token 時，入口頁 SHALL 回報對應的失敗並顯示說明。

#### Scenario: 取得 ID token 後回報

- **GIVEN** 已登入 LINE 的 LIFF
- **WHEN** 入口頁以 `lt` 開啟
- **THEN** 入口頁送出 `testId` 與 ID token，並顯示回傳的說明

#### Scenario: 沒有 ID token

- **WHEN** LIFF 已登入但 `getIDToken()` 回 null
- **THEN** 入口頁送出 `failure: 'no_id_token'`，並顯示回傳的說明

#### Scenario: LIFF 啟動失敗

- **WHEN** `liff.init` 失敗或逾時，或啟動後呼叫 `isLoggedIn`、`login`、`getIDToken` 拋錯
- **THEN** 入口頁送出 `failure: 'init_failed'`，並顯示回傳的說明

#### Scenario: 測試連結過期

- **WHEN** 回報收到 HTTP 410
- **THEN** 入口頁顯示「測試連結已過期，請回後台重新產生」

### Requirement: 後台顯示 LIFF 測試狀態

Bot 設定的 LIFF 區塊 SHALL 提供「測試 LIFF 設定」。LIFF App ID 或 Login Channel ID 沒填，或跟已存檔的值不同時，按鈕 SHALL 停用並提示先儲存。產生測試後，後台 SHALL 顯示 QR code 與連結，並定期查詢結果直到收到回報或連結過期。連結過期仍未收到回報時，後台 SHALL 列出常見原因：LIFF App ID 錯誤、Endpoint URL 錯誤。`settings.liffTest` 的設定值等於目前存檔的值時，後台 SHALL 顯示「上次測試成功」與時間；不相等時 SHALL NOT 顯示。

#### Scenario: 設定改過但還沒存檔

- **WHEN** 管理者改了 LIFF App ID 但還沒儲存
- **THEN** 「測試 LIFF 設定」停用，並提示先儲存

#### Scenario: 收到結果

- **WHEN** 查詢結果從 `pending` 變成 `id_token_rejected`
- **THEN** 後台顯示該結果的說明，並停止查詢

#### Scenario: 過期仍未收到回報

- **WHEN** 查詢結果是 `expired`
- **THEN** 後台說明沒有收到手機的結果，並列出 LIFF App ID 錯誤、Endpoint URL 錯誤兩個常見原因

#### Scenario: 上次測試成功的紀錄

- **GIVEN** `settings.liffTest` 記錄的 LIFF App ID、Login Channel ID 等於目前存檔的值
- **WHEN** 管理者打開 Bot 設定
- **THEN** 顯示「上次測試成功」與時間

#### Scenario: 設定改過後不顯示舊紀錄

- **GIVEN** `settings.liffTest` 記錄的 Login Channel ID 跟目前存檔的值不同
- **WHEN** 管理者打開 Bot 設定
- **THEN** 不顯示「上次測試成功」

### Requirement: Webhook 公開網址只限總店

`POST /api/v1/channels/webhook-base-url` 改寫全租戶每個渠道的 webhook 網址，系統 SHALL 要求 `channel.update` 與 `channel.view_all`。缺少 `channel.view_all` 時系統 SHALL 回 HTTP 403，`error.details.requiredPermission` 為 `channel.view_all`，不修改任何渠道。渠道管理頁 SHALL 只對同時有這兩個權限的成員顯示套用欄位。

#### Scenario: 分店成員不能套用 Webhook 公開網址
- **WHEN** 成員有 `channel.update`，沒有 `channel.view_all`，送出 `baseUrl` 為 `https://evil.example.test`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `channel.view_all`，所有渠道的 webhook 網址不變

#### Scenario: 分店成員看不到套用欄位
- **WHEN** 沒有 `channel.view_all` 的成員開啟渠道管理頁
- **THEN** 頁面不顯示 Webhook 公開網址的輸入框與「套用」按鈕

### Requirement: 渠道列表讀取失敗時不顯示成沒有渠道
渠道管理頁讀取 `GET /api/v1/channels` 失敗時 SHALL 顯示錯誤，MUST NOT 顯示「沒有渠道」的空狀態與新增按鈕。回 403 時 SHALL 顯示「沒有權限」並說明需要「檢視渠道」權限與含渠道功能的方案，不顯示「重新載入」。其他錯誤 SHALL 顯示錯誤原因與「重新載入」按鈕。

#### Scenario: 沒有檢視權限時顯示無權限訊息
- **WHEN** 渠道列表回 403，`error.details.requiredPermission` 為 `channel.view`
- **THEN** 頁面顯示含「沒有權限」與「檢視渠道」的提示，不顯示「沒有渠道」與「新增您的第一個渠道」

#### Scenario: 列表讀取失敗時顯示錯誤與重新載入
- **WHEN** 渠道列表回 500，訊息為「系統發生錯誤，請稍後重試」
- **THEN** 頁面顯示這個訊息與「重新載入」按鈕，不顯示「沒有渠道」
- **AND** 按「重新載入」重新讀取列表

### Requirement: 沒有新增權限時不顯示新增渠道的操作
渠道管理頁 SHALL 只對有 `channel.create` 的成員顯示「新增渠道」「設定精靈」與 Facebook 連結按鈕。有效權限依方案天花板計算，方案不含 `channels` 時這些按鈕也不顯示。

#### Scenario: 沒有新增權限時不顯示新增按鈕
- **WHEN** 成員沒有 `channel.create`，租戶沒有渠道
- **THEN** 頁面顯示「沒有渠道」，但不顯示「新增渠道」與「設定精靈」按鈕
