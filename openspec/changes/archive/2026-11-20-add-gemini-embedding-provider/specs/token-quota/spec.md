## MODIFIED Requirements

### Requirement: 呼叫 LLM 之前檢查月額度
`generateReply()`、Agent 回覆（`runAgentReply()`）與 Gemini 向量化（見 `embedding-settings`）呼叫模型之前，系統 MUST 檢查月額度。下列條件都成立時，系統 MUST NOT 呼叫 LLM，MUST 拋出 403 `PLAN_LIMIT_EXCEEDED`，details 含 `limitKey: 'monthlyTokens'`：

- 這次呼叫使用平台金鑰。
- 租戶的有效 `monthlyTokens`（見 `plan-limits-core`）不是無上限。
- 本月用量大於或等於有效 `monthlyTokens`。

使用租戶自備金鑰的呼叫，系統不檢查月額度。

#### Scenario: 未達上限時照常呼叫
- **GIVEN** 租戶的有效 `monthlyTokens` 是 1000000，本月用量是 400000
- **WHEN** 系統以平台金鑰產生 AI 回覆
- **THEN** 系統呼叫 LLM，回傳 LLM 的回覆

#### Scenario: 達到上限時不呼叫 LLM
- **GIVEN** 租戶的有效 `monthlyTokens` 是 1000000，本月用量是 1000000
- **WHEN** 系統以平台金鑰產生 AI 回覆
- **THEN** 系統不呼叫 LLM，拋出 403 `PLAN_LIMIT_EXCEEDED`，details 的 `limitKey` 是 `monthlyTokens`

#### Scenario: 自備金鑰的呼叫不檢查月額度
- **GIVEN** 租戶設定了自備的 Gemini 金鑰，本月平台金鑰的用量已經超過有效 `monthlyTokens`
- **WHEN** 系統產生 AI 回覆
- **THEN** 系統呼叫 LLM

#### Scenario: 沒有上限時不檢查
- **GIVEN** 租戶的有效 `monthlyTokens` 是無上限
- **WHEN** 系統以平台金鑰產生 AI 回覆
- **THEN** 系統呼叫 LLM

#### Scenario: Agent 回覆達到上限
- **GIVEN** 租戶的有效 `monthlyTokens` 是 1000000，本月用量是 1000000
- **WHEN** 系統以平台金鑰執行 Agent 回覆（例如成員呼叫 `POST /api/v1/ai/agent/run`）
- **THEN** 系統拋出 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 LLM，也不建立 Agent 執行紀錄

#### Scenario: Gemini 向量化達到上限
- **GIVEN** 租戶的向量化服務是 Gemini，租戶沒有自備金鑰，有效 `monthlyTokens` 是 1000000，本月用量是 1000000
- **WHEN** 系統要以 Gemini 向量化一篇文章
- **THEN** 系統拋出 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 Gemini
