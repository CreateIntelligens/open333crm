## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Webhook 公開網址只限總店

`POST /api/v1/channels/webhook-base-url` 改寫全租戶每個渠道的 webhook 網址，系統 SHALL 要求 `channel.update` 與 `channel.view_all`。缺少 `channel.view_all` 時系統 SHALL 回 HTTP 403，`error.details.requiredPermission` 為 `channel.view_all`，不修改任何渠道。渠道管理頁 SHALL 只對同時有這兩個權限的成員顯示套用欄位。

#### Scenario: 分店成員不能套用 Webhook 公開網址
- **WHEN** 成員有 `channel.update`，沒有 `channel.view_all`，送出 `baseUrl` 為 `https://evil.example.test`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `channel.view_all`，所有渠道的 webhook 網址不變

#### Scenario: 分店成員看不到套用欄位
- **WHEN** 沒有 `channel.view_all` 的成員開啟渠道管理頁
- **THEN** 頁面不顯示 Webhook 公開網址的輸入框與「套用」按鈕
