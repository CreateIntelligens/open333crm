# request-payload-limits Specification

## Purpose
API 收到 JSON 請求時，在 `JSON.parse` 與 Zod 驗證之前，先限制陣列長度、物件鍵數、總項目數與巢狀深度。超過上限的請求直接回 400，避免超大陣列耗盡記憶體（issue #382）。公開 webhook 套用同樣的上限，個別路由可以依需要調整上限。

## Requirements

### Requirement: 陣列元素過多的 JSON 請求在解析前被拒絕
API 收到 `application/json` 請求時 SHALL 在建立物件之前掃描內容。任何一個陣列的元素數超過上限（預設 10,000）時，API MUST 回 400，`error.code` 是 `PAYLOAD_ARRAY_TOO_LARGE`，`error.message` 是中文，`error.details` 帶 `path`（以 `.` 連接的位置，根層是空字串）與 `limit`。這個請求 MUST NOT 進入路由的 handler，也 MUST NOT 進入 Zod 驗證。

#### Scenario: 根層陣列超過上限
- **WHEN** 用戶對任何 JSON 路由送出 10,001 個元素的陣列
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_ARRAY_TOO_LARGE`，`error.details` 是 `{ path: "", limit: 10000 }`，handler 沒有被呼叫

#### Scenario: 巢狀物件裡的陣列超過上限
- **WHEN** 用戶送出 `{ "items": [ { "tags": [ …10,001 個元素… ] } ] }`
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_ARRAY_TOO_LARGE`，`error.details.path` 是 `items.0.tags`

#### Scenario: 陣列剛好等於上限
- **WHEN** 用戶送出 10,000 個元素的陣列
- **THEN** 請求照常進入 handler

#### Scenario: 二十萬個不合格元素只得到一筆錯誤
- **WHEN** 用戶對以 `z.array(z.string()).max(10)` 驗證的路由送出 200,000 個數字
- **THEN** API 回 400，回應裡只有一筆 `PAYLOAD_ARRAY_TOO_LARGE` 錯誤，沒有 Zod 的 `issues`

#### Scenario: 字串裡的括號與逗號不計數
- **WHEN** 用戶送出一個字串欄位，內容含 20,000 個逗號與 `[`、`{`
- **THEN** 請求照常進入 handler

### Requirement: 物件欄位過多的 JSON 請求在解析前被拒絕
任何一個物件的欄位數超過上限（預設 10,000）時，API MUST 在解析前回 400，`error.code` 是 `PAYLOAD_OBJECT_TOO_LARGE`，`error.details` 帶 `path` 與 `limit`，請求 MUST NOT 進入 handler。

#### Scenario: 物件欄位超過上限
- **WHEN** 用戶送出 `{ "map": { …10,001 個欄位… } }`
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_OBJECT_TOO_LARGE`，`error.details.path` 是 `map`

### Requirement: 元素總數過多的 JSON 請求在解析前被拒絕
整個請求的陣列元素與物件欄位總數超過上限（預設 100,000）時，API MUST 在解析前回 400，`error.code` 是 `PAYLOAD_TOO_MANY_ENTRIES`，`error.details.limit` 是總數上限，請求 MUST NOT 進入 handler。

#### Scenario: 多個未超過單一上限的陣列合計超過總數上限
- **WHEN** 用戶送出 11 個各有 10,000 個元素的陣列
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_TOO_MANY_ENTRIES`

### Requirement: 巢狀過深的 JSON 請求在解析前被拒絕
陣列與物件的巢狀深度超過上限（預設 64 層）時，API MUST 在解析前回 400，`error.code` 是 `PAYLOAD_TOO_DEEP`，`error.details.limit` 是深度上限，請求 MUST NOT 進入 handler。掃描 MUST 以迭代方式進行，深度再大也不會堆疊溢位。

#### Scenario: 巢狀深度超過上限
- **WHEN** 用戶送出 65 層巢狀的陣列
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_TOO_DEEP`

#### Scenario: 極深的巢狀不讓 API 當掉
- **WHEN** 用戶送出 1,000,000 層巢狀的陣列
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_TOO_DEEP`

### Requirement: 上限可由環境變數設定
四個上限 SHALL 由 API 環境設定讀取：`REQUEST_JSON_MAX_ARRAY_LENGTH`、`REQUEST_JSON_MAX_OBJECT_KEYS`、`REQUEST_JSON_MAX_TOTAL_ENTRIES`、`REQUEST_JSON_MAX_DEPTH`。沒有設定時使用預設值。值不是正整數時，API MUST 拒絕啟動。

#### Scenario: 未設定時使用預設值
- **WHEN** 環境變數沒有設定任何 `REQUEST_JSON_MAX_*`
- **THEN** 設定值是陣列 10,000、物件欄位 10,000、總數 100,000、深度 64

#### Scenario: 設定錯誤的值
- **WHEN** `REQUEST_JSON_MAX_ARRAY_LENGTH` 是 `0` 或 `abc`
- **THEN** 環境設定驗證失敗，錯誤訊息指出 `REQUEST_JSON_MAX_ARRAY_LENGTH`

### Requirement: 路由可以調高自己的上限
路由 SHALL 能以 route config `jsonPayloadLimits` 覆寫部分上限，未覆寫的上限沿用全域值。`POST /api/v1/knowledge/import` SHALL 接受最多 50,000 篇文章、總數 500,000 的請求。

#### Scenario: 調高上限的路由接受大陣列
- **WHEN** route config 設定 `jsonPayloadLimits.maxArrayLength` 為 20,000，用戶送出 15,000 個元素的陣列
- **THEN** 請求照常進入 handler

#### Scenario: 調高上限的路由仍受其他上限限制
- **WHEN** route config 只設定 `maxArrayLength`，用戶送出 65 層巢狀的陣列
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_TOO_DEEP`

#### Scenario: 知識庫匯入接受超過一萬篇文章
- **WHEN** 有 `knowledge.manage` 權限的成員對 `POST /api/v1/knowledge/import` 送出 12,000 篇文章
- **THEN** 請求沒有被 `PAYLOAD_*` 錯誤擋下

### Requirement: 進站 webhook 套用相同的上限
保留原始內容驗簽的進站 webhook 路由（LINE、Meta、FB、IG）SHALL 在自己的 JSON 解析器套用相同的掃描與上限。超過上限的請求 MUST 回 400，MUST NOT 進入驗簽與事件處理。

#### Scenario: LINE webhook 的 events 超過上限
- **WHEN** 外部對 `POST /api/v1/webhooks/line/:channelId` 送出 `events` 有 10,001 筆的內容
- **THEN** API 回 400，`error.code` 是 `PAYLOAD_ARRAY_TOO_LARGE`，`error.details.path` 是 `events`，沒有查詢渠道

#### Scenario: 一般大小的 webhook 照常處理
- **WHEN** 外部對 `POST /api/v1/webhooks/line/:channelId` 送出一筆事件
- **THEN** 請求進入 webhook handler，handler 取得原始內容
