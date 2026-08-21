# ai-usage-recording

## ADDED Requirements

### Requirement: Provider 回傳 token 用量
`ChatProvider.generate()` MUST 回傳 `{ text, usage? }`；`usage` 含 `promptTokens`、`cachedTokens`、`candidatesTokens`、`thoughtsTokens`（缺項以 0 補齊）。Gemini provider MUST 從回應 `usageMetadata` 取值；Ollama provider MUST 從 `prompt_eval_count` / `eval_count` 取值。provider 無法取得用量時 MUST 回傳 `usage: undefined` 而 MUST NOT 使呼叫失敗。

#### Scenario: Gemini 回應帶 usageMetadata
- **WHEN** Gemini 回應 `usageMetadata` 為 `{ promptTokenCount: 3000, cachedContentTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 500 }`
- **THEN** `generate()` 回傳的 `usage` MUST 為 `{ promptTokens: 3000, cachedTokens: 1000, candidatesTokens: 200, thoughtsTokens: 500 }`

#### Scenario: 回應缺 thoughtsTokenCount
- **WHEN** Gemini 回應的 `usageMetadata` 沒有 `thoughtsTokenCount` 欄位
- **THEN** `usage.thoughtsTokens` MUST 為 0，其餘欄位照常取值

#### Scenario: Ollama 回應帶 eval 計數
- **WHEN** Ollama `/api/chat` 回應含 `prompt_eval_count: 800` 與 `eval_count: 150`
- **THEN** `usage` MUST 為 `{ promptTokens: 800, cachedTokens: 0, candidatesTokens: 150, thoughtsTokens: 0 }`

### Requirement: 每次 LLM 呼叫寫入 AiUsage 記錄
`generateReply()` 每次呼叫 provider 後 MUST 寫入一筆 `AiUsage`，含 tenantId、provider、model、四類 token 數、totalTokens、costUsd、feature、success、可選 conversationId/caseId。寫入 MUST 為非同步 fire-and-forget：MUST NOT 增加回覆延遲，寫入失敗 MUST 只記 log 而不影響 AI 回覆結果。

#### Scenario: 成功呼叫寫入完整記錄
- **GIVEN** 租戶 T 經 KB 自動回覆呼叫 Gemini 成功
- **WHEN** `generateReply()` 完成
- **THEN** MUST 新增一筆 `AiUsage`，`tenantId=T`、`feature='kb-autoreply'`、`success=true`、token 數與 provider 回傳一致

#### Scenario: AiUsage 寫入失敗不影響回覆
- **GIVEN** AiUsage insert 因 DB 異常失敗
- **WHEN** `generateReply()` 已從 provider 取得回覆文字
- **THEN** 呼叫端 MUST 照常收到回覆文字
- **AND** 系統 MUST 記錄一筆 error log

#### Scenario: provider 未回傳 usage
- **WHEN** provider 回傳 `usage: undefined`
- **THEN** 該筆 `AiUsage` 的 token 欄位 MUST 全為 0、costUsd MUST 為 0、`usageMissing` MUST 為 true

### Requirement: 失敗呼叫留存記錄且不改變錯誤行為
provider 拋出錯誤時，`generateReply()` MUST 寫入一筆 `success=false`、token 全 0、costUsd=0 的 `AiUsage`（含錯誤摘要），並 MUST 將原錯誤原樣往上拋——既有錯誤處理行為 MUST NOT 改變。

#### Scenario: Gemini 回 429
- **WHEN** Gemini 回應 429 導致 provider 拋錯
- **THEN** MUST 寫入一筆 `success=false` 的 AiUsage
- **AND** `generateReply()` MUST 拋出與現行相同的錯誤給呼叫端

### Requirement: 呼叫來源標記與租戶隔離
各呼叫端 MUST 傳入 feature 標記（`kb-autoreply`、`suggestion`、`summary`、`classify`、`sentiment`、`automation`），未傳時記為 `unknown`。`AiUsage` 查詢 MUST 以 tenantId 過濾（依租戶隔離鐵律）。

#### Scenario: 自動化規則觸發的 AI 動作
- **WHEN** automation action-executor 經 `generateReply()` 呼叫 LLM
- **THEN** 該筆 AiUsage 的 `feature` MUST 為 `'automation'`
