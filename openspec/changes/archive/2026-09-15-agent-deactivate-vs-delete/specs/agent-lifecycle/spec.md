## ADDED Requirements

### Requirement: 停用人員（可逆、保留 email）

系統 SHALL 提供停用人員的動作，將 Agent 的 `isActive` 設為 false，保留 Agent 記錄。停用 MUST NOT 釋放該 email（記錄仍存在、email 仍被 `@@unique([email])` 佔用）。停用的人員 SHALL 可被重新啟用。此動作要求權限 `agent.deactivate`，且僅作用於當前租戶的人員。

#### Scenario: 停用保留記錄與 email
- **WHEN** 具 `agent.deactivate` 權限者停用某人員
- **THEN** 該人員 isActive=false、記錄仍存在，其 email 仍無法在其他租戶新增人員時使用

#### Scenario: 停用需權限
- **WHEN** 不具 `agent.deactivate` 權限者呼叫停用
- **THEN** 回傳 403，狀態不變

### Requirement: 刪除人員（不可逆、釋放 email）

系統 SHALL 提供刪除人員的動作，真正移除 Agent 記錄並釋放其 email，使該 email 可在其他租戶重新加入。刪除 SHALL 在單一交易內先清理對 `agents` 為 RESTRICT 的關聯（`notifications`、`cli_sessions`、`passkey_credentials`）再刪除 Agent；CASCADE 與 SET NULL 關聯由資料庫處理。此動作要求權限 `agent.purge`，僅作用於當前租戶的人員，且為不可復原操作。

#### Scenario: 刪除釋放 email
- **WHEN** 具 `agent.purge` 權限者刪除某人員
- **THEN** 該 Agent 記錄移除，其 email 可在其他租戶新增人員時使用

#### Scenario: 刪除清理 RESTRICT 關聯不被擋
- **WHEN** 被刪人員有 notifications 等 RESTRICT 關聯資料
- **THEN** 系統於交易內先清這些關聯再刪 Agent，刪除成功不因外鍵被擋

#### Scenario: 刪除保留歷史（SET NULL）
- **WHEN** 被刪人員曾被指派對話/案件、送出過訊息
- **THEN** 這些歷史資料保留，僅將指派人/送出者欄位設為 NULL

#### Scenario: 刪除需權限且限本租戶
- **WHEN** 不具 `agent.purge` 權限、或目標人員不屬當前租戶
- **THEN** 回傳 403 / 404，不執行刪除

### Requirement: 端點語義

`DELETE /agents/:id` SHALL 對應「刪除（purge）」語義（真刪除、釋放 email），而非停用。停用 SHALL 使用獨立端點 `POST /agents/:id/deactivate`。

#### Scenario: DELETE 為真刪除
- **WHEN** 呼叫 `DELETE /agents/:id`（具 agent.purge）
- **THEN** 執行真刪除並釋放 email，而非僅停用
