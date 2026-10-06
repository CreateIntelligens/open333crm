## ADDED Requirements

### Requirement: 列表查詢套用渠道過濾

對話列表與工單列表 SHALL 只回傳渠道在可見渠道集合內的資料。

#### Scenario: 對話列表只含可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有 CH-A 與 CH-B 的對話
- **THEN** 該成員的對話列表只含 CH-A 的對話

#### Scenario: 工單列表只含可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有關聯 CH-A 與 CH-B 的工單
- **THEN** 該成員的工單列表只含關聯 CH-A 的工單

### Requirement: 單筆讀取與操作的存取檢查

成員以 ID 讀取或操作單一對話或工單，而該對話或工單的渠道不在可見渠道集合內時，系統 SHALL 回 HTTP 404，與資源不存在時相同。系統 MUST NOT 回傳資源內容，也 MUST NOT 執行操作。

#### Scenario: 讀取不可見渠道的對話被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 ID 讀取 CH-B 的對話
- **THEN** 系統回 HTTP 404，不回傳對話內容

#### Scenario: 讀取不可見渠道的工單被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 ID 讀取關聯 CH-B 的工單
- **THEN** 系統回 HTTP 404，不回傳工單內容

#### Scenario: 操作不可見渠道的對話被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，對 CH-B 的對話送出回覆或關閉
- **THEN** 系統回 HTTP 404，不送出訊息，對話狀態不變

### Requirement: 存取層級

成員對可見渠道的存取層級由低到高是 `read_only`、`reply_only`、`full`。同一個渠道有多個來源時，系統 SHALL 取最高的層級。對話與工單的操作 SHALL 要求下列層級：

- 讀取：`read_only`。
- 回覆、送出媒體、貼標與加註：`reply_only`。
- 修改、關閉與轉接對話；修改、刪除、指派、解決、關閉、重啟、升級工單，連結對話到工單，記錄滿意度：`full`。

層級不足時，系統 SHALL 回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，MUST NOT 執行操作。群發不受渠道存取層級限制，由權限碼 `marketing.broadcast` 控管。

#### Scenario: 多個來源取最高層級
- **WHEN** 成員直接綁定渠道 CH-A 的層級是 `read_only`，所屬團隊對 CH-A 的層級是 `full`
- **THEN** 該成員對 CH-A 的層級是 `full`

#### Scenario: 唯讀成員不能回覆
- **WHEN** 成員對 CH-A 的層級是 `read_only`，對 CH-A 的對話送出回覆
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，不送出訊息

#### Scenario: 回覆層級不能關閉對話
- **WHEN** 成員對 CH-A 的層級是 `reply_only`，關閉 CH-A 的對話
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，對話狀態不變

#### Scenario: 群發不檢查渠道層級
- **WHEN** 成員有 `marketing.broadcast`，對 CH-A 的層級是 `read_only`，透過 CH-A 送出群發
- **THEN** 系統不因渠道層級拒絕這次群發

### Requirement: 團隊對話只限團隊成員操作

對話設定了所屬團隊（`teamId`）時，沒有 `channel.view_all` 的成員 MUST 是該團隊的成員或對話的被指派人，才能操作該對話或訂閱該對話的 socket 房間。不符合時，REST 操作 SHALL 回 HTTP 403，socket 訂閱 SHALL 被拒，即使該成員可見對話的渠道。

#### Scenario: 非團隊成員操作團隊對話被拒
- **WHEN** 對話屬於團隊「分店A」，成員可見對話的渠道，但不是「分店A」的成員，也不是被指派人，對該對話送出回覆
- **THEN** 系統回 HTTP 403，不送出訊息

#### Scenario: 被指派人可以操作
- **WHEN** 對話屬於團隊「分店A」，成員不是「分店A」的成員，但是對話的被指派人，且可見對話的渠道
- **THEN** 該成員可以回覆這段對話

### Requirement: 與即時推播一致

REST 查詢與 socket 推播 SHALL 使用同一個可見渠道的判斷。成員訂閱不可見渠道的渠道房間或對話房間時，系統 SHALL 拒絕訂閱。不可見渠道的訊息事件 MUST NOT 送達該成員，包括送到租戶房間的事件。

#### Scenario: socket 與列表一致
- **WHEN** 成員不可見 CH-B，CH-B 收到一則新訊息
- **THEN** 該成員的對話列表看不到這則訊息，也收不到這則訊息的 socket 事件

#### Scenario: 訂閱不可見渠道的對話房間被拒
- **WHEN** 成員不可見 CH-B，訂閱 CH-B 某段對話的 socket 房間
- **THEN** 系統拒絕訂閱，ack 回傳 `{ ok: false, code: 'FORBIDDEN' }`

### Requirement: 進站訊息分派不受成員可見範圍限制

渠道收到的訊息 SHALL 依渠道本身的設定建立對話與訊息。系統 MUST NOT 因為沒有成員可見該渠道而丟棄訊息。可見範圍只作用於讀取、列表、操作與推播。

#### Scenario: 進站訊息正常建立
- **WHEN** CH-B 收到外部訊息，當下沒有任何成員可見 CH-B
- **THEN** 系統照常寫入訊息並建立對話；之後可見 CH-B 的成員可以讀取
