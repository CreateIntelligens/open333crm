## MODIFIED Requirements

### Requirement: 成本計算公式
成本 MUST 依下式以 Decimal 全程計算（不得經 float）：`(promptTokens − cachedTokens) × inputPer1M/1e6 + cachedTokens × cachedPer1M/1e6 + (candidatesTokens + thoughtsTokens) × outputPer1M/1e6`。若該模型設有 `tierThreshold` 且 `promptTokens > tierThreshold`，整筆 MUST 改用 tier 單價。計算結果 MUST 以 Decimal 存入 `AiUsage.costUsd`。

使用租戶自備金鑰（`keySource` 是 `byok`）的呼叫，成本由租戶自付：系統 MUST NOT 查詢 ModelPricing，`costUsd` 是 0，`usageMissing` 是 false。

#### Scenario: 含快取與 thinking 的成本
- **GIVEN** `gemini-2.5-flash` 單價 input $0.30 / output $2.50 / cached $0.03
- **WHEN** usage 為 promptTokens=3000、cachedTokens=1000、candidatesTokens=200、thoughtsTokens=500
- **THEN** costUsd MUST 為 (2000×0.30 + 1000×0.03 + 700×2.50)/1e6 = 0.00238

#### Scenario: 超過分級門檻整筆用高檔價
- **GIVEN** `gemini-2.5-pro` tierThreshold=200000、tier 價 input $2.50 / output $15.00
- **WHEN** promptTokens=250000
- **THEN** 整筆（含 output）MUST 以 tier 價計算

#### Scenario: Ollama 本機模型成本為零
- **WHEN** provider 為 ollama
- **THEN** costUsd MUST 為 0（不查 ModelPricing）

#### Scenario: 自備金鑰的呼叫成本為零
- **WHEN** 一次使用租戶自備金鑰的 Gemini 呼叫成功
- **THEN** 系統不查詢 ModelPricing，這筆 `AiUsage` 的 `costUsd` 是 0、`usageMissing` 是 false
