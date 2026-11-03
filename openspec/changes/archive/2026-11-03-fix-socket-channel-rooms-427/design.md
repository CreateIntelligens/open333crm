## Context

收件匣列表（`useConversations`）與聊天視窗（`useMessages`）聽 `message.new`、`conversation.updated`；
前端不訂閱對話房間，全靠租戶房間收到。通知鈴聽 `notification.new`（成員房間）。工單列表聽 `case.*`。

## Decisions

### 1. 依渠道分房，總店另一個房間

- 非總店成員：每個看得到的渠道加入 `tenant:<T>:channel:<C>`。
- 總店（`channel.view_all`）：只加入 `tenant:<T>:channels:all`。新增的渠道不必重新加入，總店不漏推播。
- 渠道推播同時送到兩種房間。一位成員只在其中一種，所以不重複。

替代方案「租戶房間只推不含內容的通知」需要改前端：列表與聊天視窗要改成收到通知後打 HTTP 重新載入，
未讀數與排序的本地更新（主規格 core-inbox「Inbox socket updates reorder locally」）也要重寫。依渠道分房前端不必改。

### 2. 連線前算好渠道房間

可見渠道在 socket 驗證的 middleware 解析（`resolveChannelRooms`），連線事件時同步加入。客戶端收到
`connect` 時已在正確的房間，不會在算房間的期間漏推播。解析使用 `resolveAgentChannelVisibility`，角色從資料庫讀，
不信任 token 裡的 roleId。

### 3. 授權變更時重新計算（`syncChannelRooms`）

socket plugin 提供 `fastify.syncSocketChannelRooms(tenantId, agentId?)`：

- 用 `fetchSockets()` 找出本租戶（或該成員）已連線的 socket，重新算渠道房間，離開多的、加入少的。
- subscribe 加入的房間（對話、渠道、團隊、其他成員）重新跑 `authorizeSocketRoom`，不再符合就離開。
  這裡給 roleId null，讓授權從資料庫讀目前的角色。
- 失敗只記 log：授權已經寫入，成員重新連線時仍依新授權加入房間。

呼叫的入口：成員可用渠道、改角色（只算該成員）；角色權限、渠道新增停用刪除、渠道團隊授權、Facebook 連結粉專
（算整個租戶）。flow 用 `resyncChannelRooms(scope, sync)`，commit 之後才算（角色權限在清快取之後）。

沒有呼叫到的變更：方案異動（`channel.view_all` 被方案天花板拿掉）與團隊成員異動（目前沒有 UI）。
這兩種在成員重新連線時生效。多台 API 時 `fetchSockets()` 需要 Socket.IO adapter（目前單台、沒有 adapter）。

### 4. workers 用 `rooms`

workers 不能用 `io.to([...])`，改在 `socket:emit` 帶 `rooms`。API 的 bridge 以一次 `to(rooms)` 送出。
房間名稱放 `@open333crm/shared`，兩個行程共用。`room` 字串照舊可用。

### 5. 範圍

改推到渠道房間：`message.new`、`conversation.updated`、`conversation.created`、`automation.executed`（有渠道時）。
留在租戶房間：`case.*`、`sla.event`、`contact.merged`／`contact.merge_reverted`、`link.stats.updated`、
`coupon.instance.updated`。其中 `case.created`／`case.deleted` 帶工單標題，`contact.merged` 帶聯絡人名稱，
仍會送給所有成員，留待後續處理。

## Risks

- 算房間多一次查詢（每次連線、每次授權變更 × 已連線成員數）。權限查詢有 Redis 快取，渠道查詢有索引。
- 授權變更沒有呼叫重新計算的路徑，已連線的成員要重新連線才生效（見決策 3）。
