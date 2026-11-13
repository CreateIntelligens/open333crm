## Why

issue #362 盤點 LINE 加好友／封鎖（follow／unfollow）時發現，收訊管線把這些系統事件當成一般訊息處理：

- 沒見過的 uid 送來 unfollow 時，`resolveInboundContact()` 會建立聯絡人與渠道身分，接著送首次招呼語。對方已封鎖，push 一定失敗，還多出一位空的聯絡人。
- 非營業時間的離線自動回覆（`sendOutsideHoursAutoReply()`）不看事件類型，follow、unfollow、join、unsend 等系統事件也會觸發。
- 首次招呼語一律用 push 送出，沒用 follow 事件帶的 replyToken，每位新好友都消耗 LINE 訊息額度。
- Canvas 的 webhook 觸發讀 `parsed.eventType`／`parsed.type`，但外掛解析出的 `ParsedWebhookMessage` 沒有這兩個欄位，follow 永遠被當成 `message`：設定「加好友」觸發的流程永遠不會執行，設定「收到訊息」的流程反而被 follow 與 unfollow 觸發。
- 系統不記錄顧客封鎖官方帳號，客服在聯絡人詳情看不出對方已封鎖。

## What Changes

- 收訊管線依外掛正規化後的 `contentType` 分流系統事件（`follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon`），不依渠道類型分支。
- unfollow：這個渠道查不到該 uid 的渠道身分時，不建立聯絡人、對話與訊息，也不送招呼語；查得到時照舊存成一則進站訊息，並記下封鎖時間。
- 系統事件不觸發非營業時間的自動回覆。
- 首次招呼語在 follow 事件帶 replyToken 時以 reply 送出；reply 失敗時沿用 `deliverToChannel()` 既有的退回 push。
- Canvas 的 webhook 觸發改從 `contentType` 推導事件類型：follow 以 `follow` 比對，postback 以 `postback` 比對，其他系統事件以自己的類型比對，只有一般訊息以 `message` 比對；unfollow 不觸發任何流程。
- 渠道身分新增 `blockedAt`：收到 unfollow 時記下時間，重新 follow 時清空。聯絡人詳情的渠道身分顯示「已封鎖官方帳號」。
- **發送路徑不改**：群發、自動化、招呼語仍照常送給已封鎖的人，送不出照舊記錄失敗（使用者決定：只記錄、不排除）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `line-webhook-events`：修改「Parse all LINE Webhook event types」（follow／unfollow 改為記錄與清除渠道身分的封鎖時間，不是 `Contact.channelStatus`）；新增「沒見過的顧客封鎖時不建立聯絡人」。
- `first-contact-greeting`：修改「首次進站時送出招呼語」（follow 事件用 replyToken 回覆、失敗退回 push）。
- `inbound-message-processing`：新增「系統事件不觸發非營業時間的自動回覆」。
- `interaction-canvas`：新增「Webhook 觸發依進站事件類型比對」。
- `contact-management`：新增「聯絡人詳情顯示渠道封鎖狀態」。

## Platform layer

不適用：這個 change 沒有新增權限碼、方案功能、上限、AI 呼叫、渠道類型、平台需要看的租戶設定、平台稽核動作或 BullMQ 佇列，只修正收訊管線對 LINE 系統事件的處理，並在渠道身分記錄封鎖時間。

## Impact

- `apps/api/src/modules/webhook/webhook.service.ts`、`inbound-system-events.ts`（新增）、`inbound-follow-tracking.ts`、`inbound-side-effects.ts`
- `packages/database/prisma/schema.prisma`（`ChannelIdentity.blockedAt`）、migration `20261113100000_add_channel_identity_blocked_at`
- `apps/web/src/components/contact/ChannelIdentityList.tsx`、`ContactDetail.tsx`、`apps/web/src/app/dashboard/contacts/[contactId]/page.tsx`
- 資料匯出（`channelIdentities: true` 整列匯出）會自動帶出 `blockedAt`；資料刪除的匿名化會刪除渠道身分、硬刪除連鎖刪除，都不需要修改。
