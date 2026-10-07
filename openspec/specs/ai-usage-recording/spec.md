# ai-usage-recording Specification

## Purpose

定義 AI 呼叫的用量記錄：provider 回傳 token 用量，每次 LLM 呼叫（含失敗的呼叫）寫入一筆 `AiUsage`，並標記呼叫來源。成本怎麼計算見 `model-pricing`。

## Requirements

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
- **WHEN** 自動化動作經 `generateReply()` 呼叫 LLM（自動化規則目前沒有呼叫 LLM 的動作：`llm_reply`、`kb_auto_reply` 已於 2026-10-05 從契約移除。之後新增時適用本情境）
- **THEN** 該筆 AiUsage 的 `feature` MUST 為 `'automation'`

### Requirement: 記錄金鑰來源
每筆 `AiUsage` SHALL 以 `keySource` 記錄這次呼叫使用的金鑰：

- 使用租戶自備的 Gemini 金鑰時，`keySource` 是 `byok`。
- 使用平台的 Gemini 金鑰（環境變數 `GEMINI_API_KEY`）時，`keySource` 是 `platform`。
- provider 是 Ollama 時不需要金鑰，`keySource` 是 `platform`。

#### Scenario: 租戶設定了自備金鑰
- **GIVEN** 租戶的 chat provider 是 Gemini，租戶設定了自備的 Gemini 金鑰
- **WHEN** `generateReply()` 呼叫 LLM 成功
- **THEN** 系統以租戶的金鑰呼叫 provider，`AiUsage` 的 `keySource` 是 `byok`

#### Scenario: 租戶沒有設定自備金鑰
- **GIVEN** 租戶的 chat provider 是 Gemini，租戶沒有設定自備金鑰
- **WHEN** `generateReply()` 呼叫 LLM 成功
- **THEN** 系統以平台的金鑰呼叫 provider，`AiUsage` 的 `keySource` 是 `platform`

#### Scenario: Ollama 的呼叫
- **GIVEN** 租戶的 chat provider 是 Ollama
- **WHEN** `generateReply()` 呼叫 LLM 成功
- **THEN** `AiUsage` 的 `keySource` 是 `platform`
