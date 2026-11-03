## Why

Issue #415（AUDIT CHAN-02 的群發與發券部分）：對網站聊天室（WebChat）渠道做群發或批次發券，系統回報成功、送達數與發券數照算，
顧客卻什麼都沒收到。WebChat 外掛的 `sendMessage()` 只寫 log 就回 `success: true`；訪客畫面看到訊息，靠的是收件匣回覆路徑另外
推送到訪客的 socket 房間，群發與發券沒有這一步。群發頁的渠道選單列出 WebChat；批次發券的介面不列 WebChat，但 API 照收。

issue 的長期做法是把訪客推送移進外掛或共用的送出函式。這個 change 先採短期做法：在共用送出函式完成之前，
不能主動推送的渠道不能群發或批次發券，避免假成功。

## What Changes

- `@open333crm/shared` 新增 `PROACTIVE_PUSH_CHANNEL_TYPES`（LINE、FB、THREADS）與 `supportsProactivePush()`，前後端共用一份清單。
- 建立群發（含 MCP 與券詳情批次發券）時，渠道不能主動推送就回 400 `CHANNEL_PUSH_NOT_SUPPORTED`，不建立廣播。
- 送出群發（一般群發與附券廣播）時同樣回 400，不送出、不排入發送。
- 已存在的這類群發被排程或 `coupon-broadcast` job 執行時，標為失敗並寫 `failureReason`（附券廣播另寫 `failureCode`），
  不呼叫渠道外掛、不發券。
- 群發頁的渠道選單只列能主動推送的渠道，與券詳情的批次發券一致。
- WebChat 外掛的 `sendMessage()` 不改：收件匣回覆、`deliverToChannel()`（AI 回覆、CSAT 文字問卷）在呼叫後自己推送訪客房間，
  改成回失敗會讓這些路徑把已送達的訊息標為失敗或不推送。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `broadcast-audience`：新增「群發只能使用能主動推送的渠道」。
- `coupon-management`：修改「從券詳情頁批次發券」，加上網站聊天室渠道被拒的情境。

## Impact

- API：`marketing.service.ts`（`createBroadcast()`、`executeBroadcast()`）、`broadcast-coupon.service.ts`
  （`queueCouponBroadcast()`、`claimCouponBroadcast()`）。`broadcast.scheduler.ts` 不改。
- Web：`apps/web/src/app/dashboard/marketing/page.tsx`、`apps/web/src/lib/marketing/coupon-broadcast.ts`。
- Shared：`packages/shared/src/constants/channel-push.ts`。
- Web：券詳情「發送給…」改用同一個函式；移除 `COUPON_PUSH_CHANNEL_TYPES`。
