## Why

Issue #410（`docs/ref/system/AUDIT.md` AUTH-11，健檢 HC-PLATFORM-TENANTS-01、HC-PLATFORM-TENANTS-04）：
平台停用租戶（手動停用或試用到期自動停用）之後，LINE、FB、IG 的 webhook 會丟棄進站訊息，但其他路徑仍對外活動：

- 網站聊天室（WebChat）：`resolveChatboxChannel()` 與 `verifyChatboxSession()` 只看渠道的 `isActive`。既有訪客可以繼續送訊息，
  新訪客也能開工作階段，系統照常建立聯絡人、對話與訊息，並進入自動化與 AI 回覆。
- 排程群發：`broadcast.scheduler.ts` 只依 `status = 'scheduled'` 與 `scheduledAt` 撈群發，停用租戶的群發到期照常送給顧客；
  附券群發的 `coupon-broadcast` 佇列 job 也一樣。
- 滿意度問卷：寄送問卷的排程不看租戶，停用租戶的工單解決後仍寄出問卷。

主規格 `inbound-message-processing`「停用租戶的進站事件直接丟棄」只描述 webhook；排程群發與問卷沒有描述停用租戶的行為，所以開 change。

## What Changes

- `processInboundMessage()`（所有渠道共用的進站入口）先查租戶是否啟用，停用時丟棄進站事件、不建立任何資料、只記 warn log。
  webhook 在驗簽前的提早丟棄保留不動。
- 網站聊天室：建立工作階段（`resolveChatboxChannel()`）與驗證工作階段（`verifyChatboxSession()`，送訊息、bootstrap、訪客 socket
  `/visitor` 都經過）在租戶停用時比照渠道停用回 404 `NOT_FOUND`。
- 排程器與 `coupon-broadcast` 佇列 job 送出前先檢查租戶：停用時不送出，群發標為 `failed`，`failureCode` 是 `TENANT_DISABLED`，
  `failureReason` 寫中文原因。不保留 `scheduled`，避免租戶重新啟用後突然送出過期內容。租戶檢查在發送權限重驗之前。
- 寄送滿意度問卷的排程不處理停用租戶的工單。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `inbound-message-processing`：修改「停用租戶的進站事件直接丟棄」（所有渠道共用入口）；新增「停用租戶的網站聊天室入口回 404」。
- `marketing-scheduling`：新增「The Scheduler Does Not Send Broadcasts Of A Disabled Tenant」。
- `csat-survey`：新增「停用租戶不寄出滿意度問卷」。

## Impact

- `apps/api/src/modules/webhook/webhook.service.ts`（`processInboundMessage()`）
- `apps/api/src/modules/chatbox/chatbox.service.ts`
- `apps/api/src/modules/marketing/broadcast.scheduler.ts`、`broadcast-coupon.worker.ts`，新檔 `broadcast-tenant-active.ts`
- `apps/api/src/modules/csat/csat.scheduler.ts`
- 每則進站訊息多一次以主鍵查 `tenants` 的查詢。
- 沒有 schema 變更、沒有 migration。
