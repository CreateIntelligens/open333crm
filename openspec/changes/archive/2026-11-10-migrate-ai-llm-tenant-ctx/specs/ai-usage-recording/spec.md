# Spec Delta

## MODIFIED Requirements

### Requirement: 每次 LLM 呼叫寫入 AiUsage 記錄
`generateReply()` 每次呼叫 provider 後 MUST 寫入一筆 `AiUsage`，含 tenantId、provider、model、四類 token 數、totalTokens、costUsd、feature、success、可選 conversationId/caseId。系統 SHALL 在呼叫 provider 的交易之外寫入，並在寫入完成之後才把回覆交給呼叫端。寫入失敗 MUST 只記 log，MUST NOT 影響 AI 回覆結果。這筆紀錄最多寫入一次：寫入失敗或處理程序中斷時，系統不補寫。

#### Scenario: 成功呼叫寫入完整記錄
- **GIVEN** 租戶 T 經 KB 自動回覆呼叫 Gemini 成功
- **WHEN** `generateReply()` 完成
- **THEN** MUST 新增一筆 `AiUsage`，`tenantId=T`、`feature='kb-autoreply'`、`success=true`、token 數與 provider 回傳一致

#### Scenario: 呼叫端收到回覆時紀錄已寫入
- **WHEN** 成員呼叫 `POST /api/v1/ai/rewrite`，provider 回傳成功
- **THEN** 回應送出時，資料庫已有這次呼叫的 `AiUsage`，`feature` 是 `ai-rewrite`

#### Scenario: AiUsage 寫入失敗不影響回覆
- **GIVEN** AiUsage insert 因 DB 異常失敗
- **WHEN** `generateReply()` 已從 provider 取得回覆文字
- **THEN** 呼叫端 MUST 照常收到回覆文字
- **AND** 系統 MUST 記錄一筆 error log

#### Scenario: provider 未回傳 usage
- **WHEN** provider 回傳 `usage: undefined`
- **THEN** 該筆 `AiUsage` 的 token 欄位 MUST 全為 0、costUsd MUST 為 0、`usageMissing` MUST 為 true
