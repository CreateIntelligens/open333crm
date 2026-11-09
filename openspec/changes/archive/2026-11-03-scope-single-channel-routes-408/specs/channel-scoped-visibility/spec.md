## ADDED Requirements

### Requirement: 單筆渠道路由的可見範圍

成員以渠道 ID 讀取或管理渠道，而成員看不到該渠道（含不存在與已停用）時，系統 SHALL 回 HTTP 404，MUST NOT 回傳渠道內容，也 MUST NOT 執行操作。讀取渠道、狀態、嵌入碼與導流識別 SHALL 要求 `read_only`；修改、刪除、測試連線、LIFF 測試、設定 webhook、WebChat 連結與外觀、修改導流識別 SHALL 要求 `full`，不足時回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`。持有 `channel.view_all` 的成員不受限制。

#### Scenario: 讀取看不到的渠道被拒
- **WHEN** 成員沒有 `channel.view_all`，只綁定 CH-A，以 ID 讀取 CH-B，或讀取 CH-B 的嵌入碼或導流識別
- **THEN** 系統回 HTTP 404，不回傳渠道設定、憑證與驗證權杖

#### Scenario: 修改看不到的渠道被拒
- **WHEN** 成員有 `channel.update` 與 `channel.delete`，沒有 `channel.view_all`，只綁定 CH-A，對 CH-B 改名、停用、換權杖、刪除、測試連線、產生 LIFF 測試、設定 webhook、產生 WebChat 連結、改外觀或改導流識別
- **THEN** 系統回 HTTP 404，CH-B 的名稱、狀態、憑證、設定與 webhook 網址不變，渠道沒有被刪除

#### Scenario: 唯讀層級可以讀取渠道
- **WHEN** 成員對 CH-A 的層級是 `read_only`，以 ID 讀取 CH-A
- **THEN** 系統回 HTTP 200 與 CH-A 的資料

#### Scenario: 唯讀層級不能管理渠道
- **WHEN** 成員有 `channel.update` 與 `channel.delete`，對 CH-A 的層級是 `read_only`，修改、刪除 CH-A 或改它的 WebChat 外觀
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，CH-A 不變

#### Scenario: 完整層級可以管理渠道
- **WHEN** 成員有 `channel.update`，對 CH-A 的層級是 `full`，修改 CH-A 的名稱
- **THEN** 系統回 HTTP 200，CH-A 的名稱已更新

#### Scenario: 總店不受可見範圍限制
- **WHEN** 成員有 `channel.view` 與 `channel.view_all`，沒有綁定 CH-B，以 ID 讀取 CH-B
- **THEN** 系統回 HTTP 200 與 CH-B 的資料

### Requirement: 嵌入碼需要檢視渠道權限

`GET /api/v1/channels/:id/embed-code` SHALL 要求 `channel.view`。成員沒有這個權限時，系統 SHALL 回 HTTP 403，`error.details.requiredPermission` 為 `channel.view`。

#### Scenario: 嵌入碼需要 channel.view
- **WHEN** 成員沒有 `channel.view`，綁定 WebChat 渠道 CH-A，讀取 CH-A 的嵌入碼
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `channel.view`

### Requirement: 團隊指派由指派權限控管

渠道與團隊的指派路由（列出、指派、撤銷）SHALL 只要求 `channel.assign_team`，不檢查操作者自己的渠道可見範圍：`channel.assign_team` 是全租戶的渠道指派權，與指派用渠道清單、建立成員時的指派範圍一致。

#### Scenario: 團隊指派由 channel.assign_team 控管
- **WHEN** 成員有 `channel.assign_team`，沒有 `channel.view_all`，沒有綁定 CH-B，把 CH-B 指派給團隊、列出 CH-B 的團隊、再撤銷
- **THEN** 指派回 HTTP 201，列出含該團隊，撤銷回 HTTP 204
