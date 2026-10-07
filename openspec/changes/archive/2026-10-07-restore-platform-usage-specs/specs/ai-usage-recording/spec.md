## ADDED Requirements

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
