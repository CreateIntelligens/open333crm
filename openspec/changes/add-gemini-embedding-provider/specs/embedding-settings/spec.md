## MODIFIED Requirements

### Requirement: 讀取向量化設定不寫入資料庫

`GET /api/v1/settings/embedding` 與所有讀取向量化設定的處理 SHALL 只讀資料庫。租戶沒有設定列時，系統 SHALL 使用預設值：服務 `ollama`、服務網址 `http://localhost:11434`、模型 `bge-m3`、topK 5、相似度門檻 0.3。讀取 MUST NOT 建立設定列。

#### Scenario: 沒有設定列時回預設值
- **WHEN** 租戶沒有設定列，成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應的 `settings` 是預設值，`settings.provider` 是 `ollama`，而且資料庫仍然沒有這個租戶的設定列

#### Scenario: 有設定列時回已存的值
- **WHEN** 租戶的設定列存了模型 `bge-m3-custom` 與 topK 8，成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應的 `settings.model` 是 `bge-m3-custom`，`settings.topK` 是 8

#### Scenario: 只讀到本租戶的設定
- **WHEN** 租戶 A 有設定列，租戶 B 沒有，租戶 B 的成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應是預設值，不是租戶 A 的值

### Requirement: 修改向量化設定

`PUT /api/v1/settings/embedding` SHALL 把收到的欄位寫進租戶的設定列。欄位包含服務（`provider`，值是 `ollama` 或 `gemini`）。租戶沒有設定列時，系統 SHALL 建立一列，沒有收到的欄位用預設值。設定的寫入與稽核紀錄（`settings.update`，`payload.section` 是 `embedding`）SHALL 在同一個交易內寫入：其中一筆寫入失敗時，兩筆都 MUST NOT 寫入。回應的 `modelChanged` SHALL 表示這次是否換了服務或模型。

服務是 `gemini` 時，模型 MUST 是 `gemini-embedding-001`。請求的服務與模型不搭配時，系統 MUST 回 400 `VALIDATION_ERROR`，設定不變。

#### Scenario: 沒有設定列時建立
- **WHEN** 租戶沒有設定列，成員送出 `PUT /api/v1/settings/embedding`，body 是 `{ "topK": 8 }`
- **THEN** 回應的 `settings.topK` 是 8，其他欄位是預設值，`modelChanged` 是 false，資料庫有這個租戶的設定列與一筆 `settings.update` 稽核

#### Scenario: 換模型
- **WHEN** 租戶的模型是 `bge-m3`，成員送出 `{ "model": "bge-m3-custom" }`
- **THEN** 回應的 `modelChanged` 是 true，`previousModel` 是 `bge-m3`

#### Scenario: 稽核寫入失敗時設定不變
- **WHEN** 成員送出 `{ "topK": 8 }`，寫入稽核紀錄失敗
- **THEN** 請求失敗，設定列的 topK 仍是原本的值

#### Scenario: 改成 Gemini
- **WHEN** 租戶的服務是 `ollama`、模型是 `bge-m3`，成員送出 `{ "provider": "gemini", "model": "gemini-embedding-001" }`
- **THEN** 回應的 `settings.provider` 是 `gemini`，`modelChanged` 是 true，`previousModel` 是 `bge-m3`，服務網址仍是原本的值

#### Scenario: Gemini 搭配不支援的模型
- **WHEN** 成員送出 `{ "provider": "gemini", "model": "bge-m3" }`
- **THEN** 回應是 400 `VALIDATION_ERROR`，設定列不變，沒有新的稽核紀錄

### Requirement: 向量化服務的健康檢查

`POST /api/v1/settings/embedding/health` 與 `GET /api/v1/knowledge/embedding-status` SHALL 以租戶目前的服務、服務網址與模型檢查向量化服務。兩者 SHALL 使用同一套判斷。`GET /api/v1/knowledge/embedding-status` 的回應格式 SHALL 維持 `{ ok, model?, error? }`。

- 服務是 `ollama` 時：服務連得到，而且服務回傳的模型清單中有一個模型的名稱等於租戶的模型，或以「租戶的模型名稱:」開頭，才算正常。
- 服務是 `gemini` 時：租戶有可用的 Gemini 金鑰（自備金鑰或平台金鑰），而且 Gemini 回報模型 `gemini-embedding-001` 存在，才算正常。沒有金鑰時，系統 MUST NOT 送出請求。

#### Scenario: 服務正常而且有這個模型
- **WHEN** 服務回傳的模型清單有 `bge-m3:latest`，租戶的模型是 `bge-m3`
- **THEN** `POST /api/v1/settings/embedding/health` 回 `ok: true`、`modelInstalled: true`；`GET /api/v1/knowledge/embedding-status` 回 `ok: true`、`model: "bge-m3:latest"`

#### Scenario: 服務沒有這個模型
- **WHEN** 服務回傳的模型清單沒有租戶的模型
- **THEN** 兩個端點都回 `ok: false`，`error` 列出服務上有的模型

#### Scenario: 服務連不到
- **WHEN** 連線到服務失敗
- **THEN** 兩個端點都回 HTTP 200 與 `ok: false`，`error` 說明連不到服務

#### Scenario: Gemini 沒有金鑰
- **WHEN** 租戶的服務是 `gemini`，租戶沒有自備金鑰，平台也沒有設定 Gemini 金鑰
- **THEN** 兩個端點都回 HTTP 200 與 `ok: false`，`error` 說明沒有設定 Gemini 金鑰，系統沒有呼叫 Gemini

#### Scenario: Gemini 正常
- **WHEN** 租戶的服務是 `gemini`，租戶有自備金鑰，Gemini 對模型查詢回 200
- **THEN** `GET /api/v1/knowledge/embedding-status` 回 `ok: true`、`model: "gemini-embedding-001"`

## ADDED Requirements

### Requirement: Gemini 向量化

服務是 `gemini` 時，系統 SHALL 以模型 `gemini-embedding-001` 產生 1024 維的向量。系統 SHALL 先依租戶的 AI 隱私政策去識別化文字，再呼叫 Gemini。系統 SHALL 先用租戶的自備金鑰；租戶沒有自備金鑰時，用平台金鑰。

- 文章向量化的 `taskType` SHALL 是 `RETRIEVAL_DOCUMENT`。
- 語意搜尋與 AI 自動回覆的客人訊息，`taskType` SHALL 是 `RETRIEVAL_QUERY`。
- 送給 Gemini 的文字超過 2000 字時，系統 SHALL 只送前 2000 字。
- 寫入文章的 `embeddingModel` SHALL 是 `gemini-embedding-001`。

#### Scenario: 文章以 Gemini 向量化
- **WHEN** 租戶的服務是 `gemini`，成員呼叫 `POST /api/v1/knowledge/:id/embed`，Gemini 回傳 1024 個數值
- **THEN** 系統送給 Gemini 的請求帶 `outputDimensionality: 1024` 與 `taskType: RETRIEVAL_DOCUMENT`，文章的 `embeddingModel` 是 `gemini-embedding-001`

#### Scenario: 搜尋以 Gemini 向量化查詢文字
- **WHEN** 租戶的服務是 `gemini`，成員呼叫 `POST /api/v1/knowledge/search`
- **THEN** 系統送給 Gemini 的請求帶 `taskType: RETRIEVAL_QUERY`

#### Scenario: 使用租戶的自備金鑰
- **WHEN** 租戶的服務是 `gemini`，租戶設定了自備金鑰，平台也設定了金鑰
- **THEN** 系統以租戶的自備金鑰呼叫 Gemini

#### Scenario: 長文章只送前 2000 字
- **WHEN** 租戶的服務是 `gemini`，文章向量化的文字有 3000 字
- **THEN** 送給 Gemini 的文字是前 2000 字，文章仍然寫入向量

#### Scenario: Gemini 回錯誤時文章的向量不變
- **WHEN** 租戶的服務是 `gemini`，Gemini 回 HTTP 400
- **THEN** 單篇向量化的請求失敗，文章的 `embedding` 與 `embeddingModel` 維持原本的值

### Requirement: Gemini 向量化記錄用量並檢查月額度

服務是 `gemini` 時，每次呼叫 Gemini 向量化之後，系統 SHALL 依 `ai-usage-recording` 寫一筆 `AiUsage`：`provider` 是 `gemini`，`model` 是 `gemini-embedding-001`，`feature` 是 `embedding`，`promptTokens` 是送出文字的字數，`completionTokens` 是 0。

使用平台金鑰時，系統 SHALL 在呼叫 Gemini 之前依 `token-quota` 檢查月額度。額度已滿時，系統 MUST NOT 呼叫 Gemini，MUST 拋出 403 `PLAN_LIMIT_EXCEEDED`。

服務是 `ollama` 時，系統 MUST NOT 寫 `AiUsage`，也 MUST NOT 檢查月額度。

#### Scenario: Gemini 向量化寫入用量
- **WHEN** 租戶的服務是 `gemini`，系統以平台金鑰向量化一篇 120 字的文章
- **THEN** 資料庫有一筆 `AiUsage`，`feature` 是 `embedding`，`model` 是 `gemini-embedding-001`，`promptTokens` 是 120，`keySource` 是 `platform`

#### Scenario: 額度已滿時不呼叫 Gemini
- **WHEN** 租戶的服務是 `gemini`，租戶沒有自備金鑰，本月用量大於或等於有效 `monthlyTokens`，成員呼叫 `POST /api/v1/knowledge/search`
- **THEN** 回應是 403 `PLAN_LIMIT_EXCEEDED`，系統沒有呼叫 Gemini

#### Scenario: Ollama 向量化不寫用量
- **WHEN** 租戶的服務是 `ollama`，系統向量化一篇文章
- **THEN** 資料庫沒有新的 `AiUsage`

### Requirement: 搜尋只比對目前模型的向量

語意搜尋與 AI 自動回覆的知識庫檢索 SHALL 只比對 `embeddingModel` 等於租戶目前模型的文章。向量化統計（`GET /api/v1/settings/embedding` 的 `stats.embedded`）SHALL 只計 `embeddingModel` 等於租戶目前模型的已發布文章。

文章已有租戶目前模型的向量時，系統 SHALL NOT 用其他模型產生的向量覆蓋它。向量化開始後租戶換了模型，而且新模型的向量化先完成時，較晚完成的舊模型請求不寫入。

#### Scenario: 換服務後舊向量不進搜尋結果
- **WHEN** 文章 A 的 `embeddingModel` 是 `bge-m3`，租戶的模型已改成 `gemini-embedding-001`，成員搜尋與文章 A 相同的文字
- **THEN** 搜尋結果沒有文章 A

#### Scenario: 換服務後統計顯示要重新嵌入
- **WHEN** 租戶有 10 篇已發布文章，`embeddingModel` 都是 `bge-m3`，租戶的模型已改成 `gemini-embedding-001`
- **THEN** `stats.embedded` 是 0，`stats.missing` 是 10

#### Scenario: 舊模型的向量不覆蓋目前模型的向量
- **WHEN** 文章 A 以 `bge-m3` 向量化期間，租戶的模型改成 `bge-m3-custom`，而且文章 A 已經寫入 `bge-m3-custom` 的向量，之後 `bge-m3` 的請求才完成
- **THEN** 文章 A 的向量與 `embeddingModel` 仍然是 `bge-m3-custom` 的結果

#### Scenario: 不比對其他租戶的文章
- **WHEN** 租戶 B 的文章與租戶 A 的模型相同，租戶 A 的成員搜尋
- **THEN** 搜尋結果只有租戶 A 的文章
