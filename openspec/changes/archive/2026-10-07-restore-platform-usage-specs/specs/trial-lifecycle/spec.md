## MODIFIED Requirements

### Requirement: 試用 token 額度硬擋（簡化版）
試用租戶的 AI 月額度 SHALL 與其他租戶相同，由 `token-quota` 的「呼叫 LLM 之前檢查月額度」執行。本月用量達到試用方案的有效 `monthlyTokens` 時，系統 MUST NOT 呼叫 LLM，MUST 拋出 `PLAN_LIMIT_EXCEEDED`。

#### Scenario: 試用租戶用盡 token
- **GIVEN** trial 方案 monthlyTokens=200000，某試用租戶本月的用量已達 200000
- **WHEN** 新的 inbound 訊息觸發 AI 自動回覆
- **THEN** LLM MUST NOT 被呼叫，錯誤 MUST 為 PLAN_LIMIT_EXCEEDED
