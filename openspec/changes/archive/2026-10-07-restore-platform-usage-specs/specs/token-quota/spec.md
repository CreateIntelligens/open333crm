## ADDED Requirements

### Requirement: 本月 AI 用量的計數
系統 SHALL 以 Redis 計數器記錄每個租戶本月的 AI token 用量。計數器的 key 是 `aiquota:{tenantId}:{YYYY-MM}`，月份依 UTC 計算，計數器在下個月 1 日 0 時（UTC）過期。

只有成功、而且 `keySource` 是 `platform` 的呼叫會累加，累加量是這次呼叫的 totalTokens。Ollama 的呼叫也是 `platform`，所以也會累加。

計數器不存在時，系統 SHALL 以本月 `AiUsage` 中成功、`keySource` 是 `platform` 的 totalTokens 加總建立計數器。Redis 無法使用時，系統 SHALL 改用同一個加總判斷本月用量。

#### Scenario: 成功的呼叫累加用量
- **GIVEN** 租戶本月的計數器是 400000
- **WHEN** 一次使用平台金鑰的呼叫成功，totalTokens 是 1500
- **THEN** 計數器變成 401500

#### Scenario: 自備金鑰與失敗的呼叫不累加
- **WHEN** 一次使用租戶自備金鑰（`keySource` 是 `byok`）的呼叫成功，或一次使用平台金鑰的呼叫失敗
- **THEN** 計數器不變

#### Scenario: 計數器不存在時從 AiUsage 建立
- **GIVEN** Redis 沒有租戶本月的計數器
- **AND** 本月的 `AiUsage` 有一筆平台金鑰的成功呼叫 3000 tokens、一筆自備金鑰的成功呼叫 5000 tokens、一筆平台金鑰的失敗呼叫
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000，Redis 的計數器也是 3000

#### Scenario: Redis 無法使用時改用資料庫的加總
- **GIVEN** Redis 無法連線，本月 `AiUsage` 中平台金鑰的成功呼叫加總是 3000
- **WHEN** 系統讀取租戶本月的用量
- **THEN** 本月用量是 3000

#### Scenario: 每個月重新計數
- **GIVEN** 租戶 2026-08 的計數器是 950000
- **WHEN** 時間進入 2026-09（UTC），系統讀取本月用量
- **THEN** 系統讀取 `aiquota:{tenantId}:2026-09`，不採用 2026-08 的計數

### Requirement: 呼叫 LLM 之前檢查月額度
`generateReply()` 與 Agent 回覆（`runAgentReply()`）呼叫 LLM 之前，系統 MUST 檢查月額度。下列條件都成立時，系統 MUST NOT 呼叫 LLM，MUST 拋出 403 `PLAN_LIMIT_EXCEEDED`，details 含 `limitKey: 'monthlyTokens'`：

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
