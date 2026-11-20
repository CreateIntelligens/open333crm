## ADDED Requirements

### Requirement: Agent 預設關閉

環境變數 `AGENTIC_LLM_ENABLED` 沒有設定時，系統 SHALL 視為 `false`：客人的文字訊息 SHALL NOT 交給 Agent，SHALL 走知識庫回覆。只有 `AGENTIC_LLM_ENABLED` 的值是 `true` 時，系統才先交給 Agent。

#### Scenario: 沒有設定 AGENTIC_LLM_ENABLED 時 Agent 關閉
- **WHEN** API 啟動時沒有設定 `AGENTIC_LLM_ENABLED`
- **THEN** 設定值 `AGENTIC_LLM_ENABLED` 是 `false`

#### Scenario: AGENTIC_LLM_ENABLED=true 時 Agent 開啟
- **WHEN** API 啟動時 `AGENTIC_LLM_ENABLED` 的值是 `true`
- **THEN** 設定值 `AGENTIC_LLM_ENABLED` 是 `true`
