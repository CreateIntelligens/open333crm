## ADDED Requirements

### Requirement: CLI Execution Environment
建立基於 Node.js 的可執行工具，供終端使用者安裝與運行。

#### Scenario: Basic Interaction
- **WHEN** 執行 `333 whoami`
- **THEN** CLI 呼叫 API 並顯示目前登入的 Agent 名稱、Email 與所屬 Tenant。

### Requirement: Shared Request Logic
Web 與 CLI 必須共用底層的 API 請求代碼，避免邏輯發散。

#### Scenario: Code Sharing
- **WHEN** `packages/api-client` 中的 `getContacts` 方法發生變更
- **THEN** Web 專案與 CLI 專案在重新編譯後都會自動獲得最新的請求邏輯。
