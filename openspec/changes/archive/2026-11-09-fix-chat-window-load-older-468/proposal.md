## Why

收件匣的聊天視窗只載入最近 50 則訊息，捲到頂也看不到更早的內容（issue #468、健檢 HC-INBOX-07）。來回超過 50 則的長對話，
客服看不到客人最早報的訂單編號等資訊。`useMessages()` 已經有 `loadOlder()`，但 `ChatWindow` 沒有使用；它以 offset 分頁，
新訊息進來時頁界會位移，接上後會漏訊息或重複（`AUDIT-REVIEWS.md` 2026-11-04 的 HC-INBOX-07 列）。失敗時也只寫 `console.error`。
`getMessages()` 的 `where` 只有 `conversationId`，少了多租戶第一層的 `tenantId`。

## What Changes

- `GET /api/v1/conversations/:id/messages` 新增 `before` 參數：上一頁回傳的 `meta.nextCursor`（訊息 `createdAt` 與 `id`，
  與 `GET /contacts/:id/messages` 同一種游標）。回應的 `meta` 加 `hasMore` 與 `nextCursor`。排序改為 `createdAt` 再 `id`，
  同一毫秒的多則訊息不重複也不遺漏。`page`／`limit`／`order` 照舊可用，現有呼叫端（`OtherChannelConversations`、`HandoffModal`）不變。
- 查詢條件補上 `conversation.tenantId`。
- 游標的編碼、解碼與查詢條件從 `contact.service.ts` 移到共用的 `apps/api/src/shared/utils/message-cursor.ts`，兩個端點共用。
- `useMessages()` 的 `loadOlder()` 改用 `before`，`hasMore` 依 `nextCursor`；載入失敗回傳原因，不只寫 console。
- `ChatWindow` 訊息區頂端顯示「載入更早的訊息」按鈕（design D1：按鈕，不用捲到頂自動載入）。往上載入時保持畫面停在原本那則訊息；
  只有最新一則改變（socket 推來或自己送出）時才捲到底。更早的訊息或最新訊息載入失敗時，在畫面顯示原因與「重試」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `core-inbox`：修改「Inbox Refetches After A Message Burst」（重新抓取時保留已載入的更早訊息）；新增「對話訊息以游標往前分頁」、
  「聊天視窗可以載入更早的訊息」、「聊天視窗顯示訊息載入失敗」。

## Impact

- `apps/api/src/modules/conversation/conversation.routes.ts`（`messagesQuerySchema` 改用 `paginationSchema.extend()`、加 `before`）
- `apps/api/src/modules/conversation/conversation.service.ts`（`getMessages()` 改收 `TenantCtx`，游標與 `tenantId`）
- `apps/api/src/modules/conversation/conversation.flow.ts`（新檔，`getMessagesFlow = flowOf(getMessages)`）
- `apps/api/src/modules/contact/contact.service.ts`（改用共用游標）、`apps/api/src/shared/utils/message-cursor.ts`（新檔）
- `apps/web/src/hooks/useMessages.ts`、`apps/web/src/components/inbox/ChatWindow.tsx`
- 文件：`docs/ref/features/health/INBOX.md`（HC-INBOX-07）、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/tenant/INBOX.md`、
  `.claude/skills/feature-inbox/SKILL.md`、操作手冊 `ch01-inbox.html`、`CHANGELOG.md`
