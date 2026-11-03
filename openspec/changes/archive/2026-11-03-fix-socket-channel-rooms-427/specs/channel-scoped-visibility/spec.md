## MODIFIED Requirements

### Requirement: 與即時推播一致

REST 查詢與 socket 推播 SHALL 使用同一個可見渠道的判斷。成員訂閱不可見渠道的渠道房間或對話房間時，系統 SHALL 拒絕訂閱。不可見渠道的訊息事件（`message.new`、`conversation.updated`、`conversation.created`）MUST NOT 送達該成員，包括送到租戶房間的事件。看得到該渠道的成員與有 `channel.view_all` 的成員 SHALL 照常收到這些事件。

#### Scenario: socket 與列表一致
- **WHEN** 成員不可見 CH-B，CH-B 收到一則新訊息
- **THEN** 該成員的對話列表看不到這則訊息，也收不到這則訊息的 `message.new` 與 `conversation.updated`

#### Scenario: 看得到的成員與總店照常收到
- **WHEN** CH-B 收到一則新訊息，成員 A1 的可用渠道有 CH-B，成員 HQ 有 `channel.view_all`
- **THEN** A1 與 HQ 都收到這則訊息的 `message.new`（含訊息內容）與 `conversation.updated`

#### Scenario: 客服操作的對話更新也依渠道送出
- **WHEN** 客服把 CH-B 的一段對話標為已讀
- **THEN** 不可見 CH-B 的成員收不到這段對話的 `conversation.updated`，看得到 CH-B 的成員與總店收得到

#### Scenario: 訂閱不可見渠道的對話房間被拒
- **WHEN** 成員不可見 CH-B，訂閱 CH-B 某段對話的 socket 房間
- **THEN** 系統拒絕訂閱，ack 回傳 `{ ok: false, code: 'FORBIDDEN' }`
