## MODIFIED Requirements

### Requirement: 呼叫來源標記與租戶隔離
各呼叫端 MUST 傳入 feature 標記（`kb-autoreply`、`suggestion`、`summary`、`classify`、`sentiment`、`automation`、`embedding`），未傳時記為 `unknown`。`embedding` 表示 Gemini 向量化（見 `embedding-settings`）。`AiUsage` 查詢 MUST 以 tenantId 過濾（依租戶隔離鐵律）。

#### Scenario: 自動化規則觸發的 AI 動作
- **WHEN** 自動化動作經 `generateReply()` 呼叫 LLM（自動化規則目前沒有呼叫 LLM 的動作：`llm_reply`、`kb_auto_reply` 已於 2026-10-05 從契約移除。之後新增時適用本情境）
- **THEN** 該筆 AiUsage 的 `feature` MUST 為 `'automation'`

#### Scenario: Gemini 向量化的用量標記
- **WHEN** 租戶的向量化服務是 Gemini，系統向量化一篇文章成功
- **THEN** 該筆 AiUsage 的 `feature` 是 `'embedding'`
