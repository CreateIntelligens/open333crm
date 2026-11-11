## Why

Issue #427（AUDIT RBAC-04 的 socket 部分）：成員連上 socket 後自動加入整個租戶的 `tenant:<租戶 ID>` 房間，
進站與送出的訊息都推一份含全文的 `message.new` 到這個房間，不看渠道可見範圍。只綁 LINE-A 的分店成員打開後台，
就會即時收到其他渠道客人的訊息內容與對話更新。HTTP API 已依渠道過濾（CM-173），即時推播沒有。

主規格 `channel-scoped-visibility`「與即時推播一致」已經要求不可見渠道的訊息事件不送達成員，但
`socket-room-authorization` 與 `tenant-transaction-context` 只定義了租戶房間與成員房間，沒有可以只送給
看得到某渠道的成員的房間。

## What Changes

- 新增渠道房間 `tenant:<租戶 ID>:channel:<渠道 ID>` 與總店房間 `tenant:<租戶 ID>:channels:all`。
  連線時依可見渠道（與 REST 同一個判斷）加入；有 `channel.view_all` 的成員加入總店房間。
- 帶渠道資料的推播（`message.new`、`conversation.updated`、`conversation.created`，以及 workers 經
  `socket:emit` 推的同類事件與 `automation.executed`）改推到對話房間、渠道房間與總店房間，不再推到租戶房間。
  呼叫端只給渠道與對話，房間由 `events/socket-push.ts` 決定。
- `automation.executed` 的內容改為只帶 ID（原本帶整個事件內容，含訊息全文與 replyToken）。
- `socket:emit` 訊息可以用 `rooms`（字串陣列）指定多個房間，API 以一次送出，同一個連線只收到一次。
- 成員可用渠道、角色、角色權限、渠道新增停用刪除、渠道團隊授權、Facebook 連結粉專改變後，重新計算
  已連線 socket 的渠道房間，並重新授權 subscribe 加入的房間。方案異動與團隊成員異動在重新連線時生效。
- 租戶房間保留，給不帶渠道資料的推播（工單、聯絡人合併、短連結統計、已發優惠券）。

## Capabilities

### Modified Capabilities

- `socket-room-authorization`：連線時加入的房間增加渠道房間；新增授權變更時重新計算房間。
- `tenant-transaction-context`：推播的房間由系統決定，增加渠道推播。
- `core-inbox`：`socket:emit` 訊息可以帶 `rooms`。
- `channel-scoped-visibility`：與即時推播一致，補上有授權與總店照常收到的情境。

## Impact

- API：`events/socket-push.ts`、`plugins/socket.plugin.ts`、`modules/socket/`、所有推 `message.new`／
  `conversation.*` 的入口（conversation、webhook 進站、csat、kb-autoreply、agent、automation worker、canvas、
  chatbox、simulator、identity-binding、coupon）、agent／role／channel／meta-connect 的授權變更入口。
- workers：`lib/socket-bridge.ts`、`lib/channel-delivery.ts`、`lib/rule-coupon-issue.ts`、
  `handlers/automation.handler.ts`。
- `@open333crm/shared`：房間名稱 `constants/socket-rooms.ts`（API 與 workers 共用）。
- 前端不需修改：收件匣列表、未讀數只聽 `message.new`／`conversation.updated`，有授權的成員照常收到；
  通知鈴聽成員房間的 `notification.new`，不受影響。
