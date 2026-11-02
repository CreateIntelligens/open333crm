## ADDED Requirements

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

- **WHEN** `liff.init` 失敗或逾時
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
