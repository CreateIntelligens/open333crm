## ADDED Requirements

### Requirement: 讀取向量化設定不寫入資料庫

`GET /api/v1/settings/embedding` 與所有讀取向量化設定的處理 SHALL 只讀資料庫。租戶沒有設定列時，系統 SHALL 使用預設值：服務網址 `http://localhost:11434`、模型 `bge-m3`、topK 5、相似度門檻 0.3。讀取 MUST NOT 建立設定列。

#### Scenario: 沒有設定列時回預設值
- **WHEN** 租戶沒有設定列，成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應的 `settings` 是預設值，而且資料庫仍然沒有這個租戶的設定列

#### Scenario: 有設定列時回已存的值
- **WHEN** 租戶的設定列存了模型 `bge-m3-custom` 與 topK 8，成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應的 `settings.model` 是 `bge-m3-custom`，`settings.topK` 是 8

#### Scenario: 只讀到本租戶的設定
- **WHEN** 租戶 A 有設定列，租戶 B 沒有，租戶 B 的成員呼叫 `GET /api/v1/settings/embedding`
- **THEN** 回應是預設值，不是租戶 A 的值

### Requirement: 修改向量化設定

`PUT /api/v1/settings/embedding` SHALL 把收到的欄位寫進租戶的設定列。租戶沒有設定列時，系統 SHALL 建立一列，沒有收到的欄位用預設值。設定的寫入與稽核紀錄（`settings.update`，`payload.section` 是 `embedding`）SHALL 在同一個交易內寫入：其中一筆寫入失敗時，兩筆都 MUST NOT 寫入。回應的 `modelChanged` SHALL 表示這次是否換了模型。

#### Scenario: 沒有設定列時建立
- **WHEN** 租戶沒有設定列，成員送出 `PUT /api/v1/settings/embedding`，body 是 `{ "topK": 8 }`
- **THEN** 回應的 `settings.topK` 是 8，其他欄位是預設值，`modelChanged` 是 false，資料庫有這個租戶的設定列與一筆 `settings.update` 稽核

#### Scenario: 換模型
- **WHEN** 租戶的模型是 `bge-m3`，成員送出 `{ "model": "bge-m3-custom" }`
- **THEN** 回應的 `modelChanged` 是 true，`previousModel` 是 `bge-m3`

#### Scenario: 稽核寫入失敗時設定不變
- **WHEN** 成員送出 `{ "topK": 8 }`，寫入稽核紀錄失敗
- **THEN** 請求失敗，設定列的 topK 仍是原本的值

### Requirement: 向量化服務的健康檢查

`POST /api/v1/settings/embedding/health` 與 `GET /api/v1/knowledge/embedding-status` SHALL 以租戶目前的服務網址與模型檢查向量化服務。兩者 SHALL 使用同一套判斷：服務連得到，而且服務回傳的模型清單中有一個模型的名稱等於租戶的模型，或以「租戶的模型名稱:」開頭，才算正常。`GET /api/v1/knowledge/embedding-status` 的回應格式 SHALL 維持 `{ ok, model?, error? }`。

#### Scenario: 服務正常而且有這個模型
- **WHEN** 服務回傳的模型清單有 `bge-m3:latest`，租戶的模型是 `bge-m3`
- **THEN** `POST /api/v1/settings/embedding/health` 回 `ok: true`、`modelInstalled: true`；`GET /api/v1/knowledge/embedding-status` 回 `ok: true`、`model: "bge-m3:latest"`

#### Scenario: 服務沒有這個模型
- **WHEN** 服務回傳的模型清單沒有租戶的模型
- **THEN** 兩個端點都回 `ok: false`，`error` 列出服務上有的模型

#### Scenario: 服務連不到
- **WHEN** 連線到服務失敗
- **THEN** 兩個端點都回 HTTP 200 與 `ok: false`，`error` 說明連不到服務
