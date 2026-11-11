## ADDED Requirements

### Requirement: 以平台訊息 ID 去重
進站訊息帶 `channelMsgId`（平台的訊息 ID）時，系統 SHALL 以 `(conversationId, channelMsgId)` 去重。同一段對話已有相同 `channelMsgId` 的訊息時，`processInboundMessage` SHALL 回傳既有的訊息與 `duplicate: true`，SHALL NOT 建立新訊息、更新對話、發出 socket 事件或發布 `message.received`。

兩個相同的請求同時通過查重、寫入時撞到資料庫的唯一限制，後寫入的一方 SHALL 以同樣的方式視為重複。

#### Scenario: 平台重送同一則訊息
- **WHEN** 同一段對話已有 `channelMsgId` 為 `m-1` 的訊息，平台再送一次 `channelMsgId` 為 `m-1` 的訊息
- **THEN** `processInboundMessage` 回傳既有的訊息與 `duplicate: true`，沒有建立訊息，沒有發出 socket 事件，也沒有發布 `message.received`

#### Scenario: 兩個相同的請求同時寫入
- **WHEN** 查重時沒有 `channelMsgId` 為 `m-1` 的訊息，建立訊息時資料庫回傳唯一限制錯誤（P2002），再查詢時找到另一個請求剛建立的訊息
- **THEN** `processInboundMessage` 回傳那則訊息與 `duplicate: true`，沒有更新對話，也沒有發布 `message.received`
