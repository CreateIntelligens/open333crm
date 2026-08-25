# model-pricing

## ADDED Requirements

### Requirement: 模型單價參數化儲存與版本化
系統 SHALL 以 `ModelPricing` 表儲存每模型單價（inputPer1M / outputPer1M / cachedPer1M，另有可選 tierThreshold / tierInputPer1M / tierOutputPer1M），以 `(model, effectiveFrom)` 版本化：改價 MUST 以新增一列表達，MUST NOT 修改既有列。查價 MUST 取該模型 `effectiveFrom <= now` 中最新的一列。單價 MUST NOT 以程式碼常數寫死。

#### Scenario: 改價後新呼叫用新價、歷史帳不變
- **GIVEN** `gemini-2.5-flash` 現行列 output 單價 $2.50，既有 AiUsage 以此計算
- **WHEN** 平台方新增一列 `effectiveFrom=now`、output 單價 $3.00
- **THEN** 之後的呼叫 MUST 以 $3.00 計算
- **AND** 既有 AiUsage 的 costUsd MUST 維持原值

#### Scenario: 查無價目的模型
- **WHEN** 呼叫使用的 model 在 ModelPricing 無任何列
- **THEN** 該筆 AiUsage 的 costUsd MUST 為 0、`usageMissing` MUST 為 true
- **AND** 系統 MUST 記錄 warning log

### Requirement: 成本計算公式
成本 MUST 依下式以 Decimal 全程計算（不得經 float）：`(promptTokens − cachedTokens) × inputPer1M/1e6 + cachedTokens × cachedPer1M/1e6 + (candidatesTokens + thoughtsTokens) × outputPer1M/1e6`。若該模型設有 `tierThreshold` 且 `promptTokens > tierThreshold`，整筆 MUST 改用 tier 單價。計算結果 MUST 以 Decimal 存入 `AiUsage.costUsd`。

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

### Requirement: 價目種子資料
seed MUST 以 idempotent 方式建立現行 Gemini 價目（至少涵蓋 provider 白名單內模型：2.5-flash、2.5-flash-lite、2.5-pro 及其分級價）。seed 重複執行 MUST NOT 產生重複列。

#### Scenario: 重複執行 seed
- **WHEN** pricing seed 執行兩次
- **THEN** 每個 `(model, effectiveFrom)` MUST 只存在一列
