# chat-settings Specification

## Purpose
租戶的 Chat 設定（provider、模型、服務網址、生成參數、系統提示詞）與自備的 Gemini 金鑰。規定讀取設定時不寫入資料庫、設定與金鑰的修改和稽核一起寫入，以及設定頁的 Chat 服務健康檢查。

## Requirements

### Requirement: 讀取 Chat 設定不寫入資料庫

`GET /api/v1/settings/chat`、`POST /api/v1/settings/chat/health` 與所有呼叫 LLM 之前讀取 Chat 設定的處理 SHALL 只讀資料庫。租戶沒有設定列時，系統 SHALL 使用預設值：provider `ollama`、模型 `qwen2.5:3b`、服務網址 `http://localhost:11434`、temperature 0.2、maxTokens 500、四段系統提示詞都是空字串、clarifyThreshold 0.5、clarifyMaxAttempts 2。讀取 MUST NOT 建立設定列。資料庫欄位的預設值 SHALL 與這組預設值相同。因此第一次修改設定時，系統建立的設定列中，請求沒有帶的欄位也是這組值。

#### Scenario: 沒有設定列時回預設值
- **WHEN** 租戶沒有設定列，成員呼叫 `GET /api/v1/settings/chat`
- **THEN** 回應的 `settings` 是預設值，而且資料庫仍然沒有這個租戶的設定列

#### Scenario: 呼叫 LLM 不建立設定列
- **WHEN** 租戶沒有設定列，成員呼叫 `POST /api/v1/ai/rewrite`
- **THEN** 系統以預設的 provider 與模型呼叫 LLM，而且資料庫仍然沒有這個租戶的設定列

#### Scenario: 有設定列時回已存的值
- **WHEN** 租戶的設定列存了模型 `gemini-2.5-flash` 與 maxTokens 800，成員呼叫 `GET /api/v1/settings/chat`
- **THEN** 回應的 `settings.model` 是 `gemini-2.5-flash`，`settings.maxTokens` 是 800

#### Scenario: 只讀到本租戶的設定
- **WHEN** 租戶 A 有設定列，租戶 B 沒有，租戶 B 的成員呼叫 `GET /api/v1/settings/chat`
- **THEN** 回應是預設值，不是租戶 A 的值

### Requirement: 修改 Chat 設定

`PUT /api/v1/settings/chat` SHALL 把收到的欄位寫進租戶的設定列。租戶沒有設定列時，系統 SHALL 建立一列，沒有收到的欄位用預設值。設定的寫入與稽核紀錄（`settings.update`，`payload.section` 是 `chat`，`payload.keys` 是收到的欄位名）SHALL 在同一個交易內寫入：其中一筆寫入失敗時，兩筆都 MUST NOT 寫入。回應的 `providerChanged` SHALL 表示這次是否換了 provider。

#### Scenario: 沒有設定列時建立
- **WHEN** 租戶沒有設定列，成員送出 `PUT /api/v1/settings/chat`，body 是 `{ "maxTokens": 800 }`
- **THEN** 回應的 `settings.maxTokens` 是 800，其他欄位是預設值，`providerChanged` 是 false，資料庫有這個租戶的設定列與一筆 `settings.update` 稽核

#### Scenario: 換 provider
- **WHEN** 租戶的 provider 是 `ollama`，成員送出 `{ "provider": "gemini" }`
- **THEN** 回應的 `providerChanged` 是 true，`previousProvider` 是 `ollama`

#### Scenario: 稽核寫入失敗時設定不變
- **WHEN** 成員送出 `{ "maxTokens": 800 }`，寫入稽核紀錄失敗
- **THEN** 請求失敗，設定列的 maxTokens 仍是原本的值

### Requirement: 設定與清除自備的 Gemini 金鑰

`PUT /api/v1/settings/gemini-key` SHALL 加密後儲存 body 的 `apiKey`；`apiKey` 是 null 時 SHALL 清除金鑰。租戶沒有設定列時，系統 SHALL 建立一列。金鑰的寫入與稽核紀錄（`settings.update`，`payload.section` 是 `gemini-key`，`payload.operation` 是 `set` 或 `clear`）SHALL 在同一個交易內寫入。稽核 MUST NOT 含金鑰的明文。回應與 `GET /api/v1/settings/gemini-key` SHALL 只回 `configured` 與遮罩後的金鑰。

#### Scenario: 設定金鑰
- **WHEN** 租戶沒有設定列，成員送出 `{ "apiKey": "AIzaSyExample1234" }`
- **THEN** 回應是 `{ configured: true, masked: "AIza…1234" }`，資料庫存的是密文，稽核的 `payload.operation` 是 `set`，稽核不含 `AIzaSyExample1234`

#### Scenario: 清除金鑰
- **WHEN** 租戶已設定金鑰，成員送出 `{ "apiKey": null }`
- **THEN** 回應是 `{ configured: false, masked: null }`，稽核的 `payload.operation` 是 `clear`

#### Scenario: 稽核寫入失敗時金鑰不變
- **WHEN** 租戶沒有金鑰，成員送出 `{ "apiKey": "AIzaSyExample1234" }`，寫入稽核紀錄失敗
- **THEN** 請求失敗，`GET /api/v1/settings/gemini-key` 仍回 `configured: false`

### Requirement: Chat 服務的健康檢查

`GET /api/v1/settings/chat` 的 `health` 與 `POST /api/v1/settings/chat/health` SHALL 以租戶目前的 provider、模型與服務網址檢查 Chat 服務。provider 是 Gemini 時，系統 SHALL 以這次呼叫 LLM 會用的金鑰檢查：租戶設定了自備金鑰就用租戶的金鑰，否則用平台的金鑰。服務連不到時，兩個端點 SHALL 回 HTTP 200，在 `health` 說明錯誤。

#### Scenario: Gemini 以租戶的金鑰檢查
- **WHEN** 租戶的 provider 是 Gemini，租戶設定了自備金鑰，成員呼叫 `POST /api/v1/settings/chat/health`
- **THEN** 系統以租戶的金鑰呼叫 Gemini 檢查服務

#### Scenario: 服務連不到
- **WHEN** 租戶的 provider 是 Ollama，連線到服務網址失敗，成員呼叫 `POST /api/v1/settings/chat/health`
- **THEN** 回應是 HTTP 200，內容說明服務連不到
