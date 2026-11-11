## Purpose
定義客服收件匣的核心行為：即時訊息推播、對話列表與對話操作，以及對話、標籤、短連結路由的權限要求。工單的狀態轉換與刪除見 `case-management`；進站訊息的處理流程見 `inbound-message-processing`。

## Requirements

### Requirement: Real-time WebSocket Broadcasting
The system SHALL push new messages to connected frontend clients in real-time through the authoritative API bootstrap rooted at `apps/api/src/index.ts`.

#### Scenario: Pushing to online agent
- **WHEN** a new message is saved to an active conversation
- **THEN** the system pushes a WebSocket event `message.new` to clients subscribed to that conversation using the server initialized from `apps/api/src/index.ts`

### Requirement: Cross-Process WebSocket Event Emission via Redis Pub/Sub
When WebSocket events are emitted from within the API process, the existing `io.to(room).emit(event, data)` call path SHALL remain unchanged.

When WebSocket events need to be emitted from **outside the API process** (e.g., from standalone worker handlers), the emitting process SHALL NOT import or directly connect to the API's Socket.IO server. Instead, it SHALL publish a JSON-serialized message to the Redis pub/sub channel `socket:emit`.

#### Scenario: Standalone worker emits a real-time notification
- **WHEN** the standalone notification worker processes a job and needs to notify a connected user
- **THEN** the worker publishes `{ room: "user:7", event: "notification:new", data: { ... } }` to the `socket:emit` Redis channel, the API subscriber receives it, and calls `io.to("user:7").emit("notification:new", { ... })`

#### Scenario: Standalone worker emits a conversation update
- **WHEN** the standalone automation worker updates a conversation's status
- **THEN** the worker publishes `{ room: "conversation:42", event: "conversation:updated", data: { ... } }` to `socket:emit`, and the API forwards it to all clients subscribed to that conversation room

### Requirement: socket:emit Message Shape
Each message on the `socket:emit` Redis channel SHALL be JSON with the shape:

```ts
{
  room?: string;    // one Socket.IO room name, e.g. "conversation:42" or "user:7"
  rooms?: string[]; // several room names; the API emits once to all of them
  event: string;    // Socket.IO event name, e.g. "notification:new"
  data: unknown;    // Arbitrary serializable payload
}
```

A message SHALL give exactly one of `room` (a non-empty string) and `rooms` (a non-empty array of non-empty strings). When a message gives `rooms`, the API SHALL emit the event once to all the rooms, so that a connection in more than one of the rooms receives the event once. A worker SHALL send an event that carries the messages or the conversation data of a channel (`message.new`, `conversation.updated`, and `automation.executed` for an event with a channel) to the channel rooms (`tenant:<tenantId>:channel:<channelId>` and `tenant:<tenantId>:channels:all`), and SHALL NOT send it to `tenant:<tenantId>`.

#### Scenario: Malformed message received on socket:emit channel
- **WHEN** the API's Redis subscriber receives a message on `socket:emit` that cannot be parsed as JSON, has no `event`, gives both `room` and `rooms`, gives neither, or gives an empty room name
- **THEN** the API logs a warning with the raw message content and discards it without calling `io.emit`

#### Scenario: Worker sends a channel event to several rooms
- **WHEN** a worker writes a system message to a conversation of channel C and publishes `message.new` with `rooms` set to the conversation room and the two channel rooms of C
- **THEN** the API emits `message.new` once to these rooms; a member who cannot see channel C does not receive it

### Requirement: API Forwards socket:emit Messages
The API process SHALL subscribe to the `socket:emit` Redis channel at startup (inside the socket plugin initialization) and, upon receiving a valid message, forward it to the Socket.IO server using `io.to(room).emit(event, data)`, or `io.to(rooms).emit(event, data)` once for a message with `rooms`.

This bridge enables any Node.js process with Redis access to trigger real-time client updates without coupling to the API's internal Socket.IO instance.

#### Scenario: API process starts before Redis is available
- **WHEN** the API attempts to subscribe to `socket:emit` during socket plugin initialization but Redis is not yet ready
- **THEN** the socket plugin initialization fails fast, the API logs an error, and does not start accepting connections until Redis is available (consistent with existing Redis dependency behavior)

### Requirement: Conversation Route Access Is Open to All Authenticated Roles
Conversation and message routes SHALL allow access for all authenticated roles: `AGENT`, `SUPERVISOR`, and `ADMIN`. No RBAC guard restricting conversation access by role SHALL be introduced in this change.

Data-level filtering — such as restricting an AGENT to only their own assigned conversations — is explicitly deferred to a future change and is outside the scope of this RBAC guard rollout.

#### Scenario: AGENT accesses conversation routes
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any conversation or message route is called (e.g., `GET /conversations`, `GET /conversations/:id/messages`)
- **THEN** the request SHALL reach the route handler without a 403 response from an RBAC guard

#### Scenario: SUPERVISOR accesses conversation routes
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler

#### Scenario: ADMIN accesses conversation routes
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler

### Requirement: Inbox Page Conversation Data Fetching
`InboxPage` SHALL use `useSWR` (keyed by `/conversations/:id`) to fetch the selected conversation's details, so that any `globalMutate('/conversations/:id')` call from child components immediately triggers a revalidation and re-render with the latest data.

#### Scenario: Handoff to human agent unlocks message input
- **WHEN** an agent clicks the takeover button and `handleTakeover()` completes successfully
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation in `InboxPage`, the `conversation.status` prop updates to a non-`BOT_HANDLED` value, `isBotHandled` becomes `false`, and the message input box becomes enabled

#### Scenario: Status change reflects immediately in Select
- **WHEN** an agent selects a new status from the status `Select` dropdown and `handleStatusChange()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.status` updates, and the status `Select` displays the newly selected value

#### Scenario: Agent assignment reflects immediately in Select
- **WHEN** an agent selects a new assignee from the agent `Select` dropdown and `handleAssign()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.assignedToId` updates, and the agent `Select` displays the newly assigned agent

#### Scenario: No conversation selected
- **WHEN** `convId` is null (no conversation selected)
- **THEN** SWR SHALL NOT issue any API request (null key pattern), and `selectedConversation` SHALL be null

---

### Requirement: Inbox message input respects IME composition
The inbox message input SHALL NOT submit a message when the Enter key is pressed while IME composition is active. Enter submission SHALL only occur after composition ends, while Shift+Enter continues to insert a newline.

#### Scenario: Agent is choosing a Chinese candidate
- **WHEN** the agent presses Enter to confirm an IME candidate in the inbox textarea
- **THEN** the message is not sent and the textarea remains editable

#### Scenario: Agent inserts a newline
- **WHEN** the agent presses Shift+Enter in the inbox textarea
- **THEN** the textarea inserts a newline instead of sending the message

#### Scenario: Agent sends after composition completes
- **WHEN** IME composition has ended and the agent presses Enter without Shift
- **THEN** the current message is submitted once

### Requirement: Inbox Case Creation SLA Policy Selection
The inbox create-case modal SHALL allow a user to select an SLA policy from the available policy options. The selected option SHALL remain visibly selected in the dropdown and the selected policy id SHALL be included in the case creation request when present.

#### Scenario: Select SLA policy option
- **WHEN** a user opens the create-case modal from `/dashboard/inbox` and selects an SLA policy option
- **THEN** the dropdown displays the selected option instead of reverting to the default option

#### Scenario: Submit selected SLA policy
- **WHEN** a user submits the create-case modal after selecting an SLA policy
- **THEN** the create-case request includes the selected SLA policy id

#### Scenario: Use automatic SLA policy
- **WHEN** a user leaves the SLA policy dropdown on the default automatic option
- **THEN** the create-case request omits the explicit SLA policy id and allows backend priority-based policy selection

### Requirement: Team-level conversation read state
The inbox SHALL treat `Conversation.unreadCount` as a shared team-level unread state. When any authenticated agent opens a tenant-owned conversation from the inbox, the system SHALL mark that conversation read by clearing its `unreadCount` for all agents in the tenant.

#### Scenario: Agent opens unread conversation
- **WHEN** an authenticated agent selects a conversation in `/dashboard/inbox` and the conversation has `unreadCount` greater than 0
- **THEN** the frontend clears that conversation's unread badge optimistically and the backend persists `unreadCount` as 0

#### Scenario: Other agents observe cleared unread state
- **WHEN** agent A marks a conversation read
- **THEN** agent B receives or observes the same conversation with `unreadCount` 0

#### Scenario: Mark read emits conversation update
- **WHEN** the backend clears a conversation's unread count
- **THEN** it emits `conversation.updated` to the conversation room and the channel rooms of the conversation's channel (not the tenant room) with `id`, `unreadCount`, `updatedAt`, and `lastMessageAt`

### Requirement: Inbox initial ordering uses updatedAt
The conversation list API SHALL order initial inbox conversation results by `updatedAt` descending unless a future explicit sort option overrides it.

#### Scenario: Initial inbox load
- **WHEN** the inbox requests `/api/v1/conversations`
- **THEN** the returned conversations are ordered from newest `updatedAt` to oldest `updatedAt`

#### Scenario: Pagination respects updatedAt order
- **WHEN** the inbox requests subsequent pages of conversations
- **THEN** pagination is based on the same `updatedAt desc` ordering

### Requirement: Inbox socket updates reorder locally
The web inbox SHALL update its cached conversation list locally when `message.new` or `conversation.updated` socket events arrive. For conversations present in any loaded page of the cached list, the frontend SHALL merge the socket payload into that row and reorder the displayed list by `updatedAt desc` without immediately refetching `/conversations`.

#### Scenario: Existing conversation receives new message
- **WHEN** the web client receives `message.new` for a conversation already present in the cached list
- **THEN** it updates that row's `lastMessage`, timestamp fields, and unread count according to the event context, then moves the conversation to the top according to `updatedAt desc`

#### Scenario: Existing conversation receives update
- **WHEN** the web client receives `conversation.updated` for a conversation already present in the cached list
- **THEN** it merges updated status, assignee, unread count, `updatedAt`, and `lastMessageAt` into the row and re-sorts the cached list by `updatedAt desc`

#### Scenario: Selected conversation receives inbound message
- **WHEN** the currently selected conversation receives an inbound `message.new` event
- **THEN** the web client keeps that conversation's displayed unread count at 0 and may call the mark-read endpoint to persist the team-level read state

#### Scenario: Missing conversation cannot be built from socket payload
- **WHEN** a socket event references a conversation that is not present in the cached list and the payload lacks the fields needed to render a full list item
- **THEN** the web client revalidates `/conversations` through SWR as a fallback

#### Scenario: Conversation on a later loaded page receives new message
- **WHEN** the inbox has loaded pages 1 and 2 and receives `message.new` for a conversation that came from page 2
- **THEN** that conversation moves to the top of the list, appears exactly once, and the client does not request `/conversations` again

### Requirement: 對話、標籤、短連結路由依權限碼授權
對話、標籤、短連結路由 SHALL 依 proposal 對照表檢查權限碼，缺少時回傳 HTTP 403；具備該權限碼（含其依賴的權限碼）時 SHALL 通過權限檢查。

#### Scenario: 只能檢視的角色送訊息
- **WHEN** 只有 `inbox.view` 的成員呼叫 `POST /conversations/:id/messages`
- **THEN** 回傳 HTTP 403

#### Scenario: 具備需要的權限碼
- **WHEN** 成員只具備某條路由需要的權限碼（含依賴）
- **THEN** 通過權限檢查（資料不存在時回 404 等，不回 403）

### Requirement: Inbox Shows Inbound Media
The inbox message bubble SHALL show image, video, audio and file messages with their media. The bubble SHALL try `content.url` before `content.mediaUrl`, in the same order as `getMediaUrl` in `@open333crm/shared`. When no such URL exists, it SHALL show the message text, followed by `content.mediaError` when the download failed.

#### Scenario: Audio message
- **WHEN** an audio message has a Storage URL
- **THEN** the bubble shows an audio player for that URL

#### Scenario: File message
- **WHEN** a file message with `fileName`「報價單.pdf」and `fileSize` 20480 has a Storage URL
- **THEN** the bubble shows a download link with the text「報價單.pdf」and the size「20 KB」

#### Scenario: Stored LINE message still holds the placeholder
- **WHEN** a message has `content.mediaUrl`「line-content:123」and `content.url`「https://cdn.example.com/a.jpg」
- **THEN** the bubble uses「https://cdn.example.com/a.jpg」

#### Scenario: Media not downloaded yet
- **WHEN** a file message has only `content.mediaUrl`「line-content:123」
- **THEN** the bubble shows the message text and no link

#### Scenario: Media download failed
- **WHEN** a file message has `content.mediaError`「檔案超過 25 MB，未下載」and no Storage URL
- **THEN** the bubble shows the message text and「檔案超過 25 MB，未下載」

### Requirement: Inbox Media URLs Are Safe
The inbox message bubble SHALL use only a URL that a browser can open safely: `http:`, `https:`, a path that starts with `/`, or a `data:` URI of a PNG, JPEG, GIF or WebP image. A file link SHALL NOT use a `data:` URI, whatever the case of the scheme.

#### Scenario: Unsafe data URI
- **WHEN** a message has `content.url`「data:image/svg+xml,<svg>」or「data:text/html,<p>」
- **THEN** the bubble shows the message text and no media

### Requirement: Inbox Refetches After A Message Burst
The inbox SHALL refetch messages after the last `message.new` event of a burst, so that the event sent when a download finishes is not dropped. A refetch of the latest page SHALL keep the older messages that the agent already loaded, and SHALL keep each message that the refetch pushes out of the latest page.

#### Scenario: Download finishes right after the message arrives
- **WHEN** two `message.new` events for the conversation arrive 300 ms apart
- **THEN** the inbox refetches messages once immediately and once more after 500 ms

#### Scenario: 已載入更早的訊息時收到新訊息
- **WHEN** 客服已按「載入更早的訊息」，之後收到 `message.new`，重新抓取的最新一頁把原本最新一頁最舊的一則擠出
- **THEN** 聊天視窗仍顯示已載入的更早訊息與被擠出的那一則，每則只出現一次

### Requirement: 客服把對話交回 Bot
具備 `inbox.manage` 且能完整存取該渠道的成員呼叫 `POST /conversations/:id/return-to-bot` 時，對話狀態為 `AGENT_HANDLED` 或 `ACTIVE` 的，系統 SHALL 把狀態改為 `BOT_HANDLED`、bot 回覆次數歸零、清除轉真人原因，並保留指派的客服。系統 SHALL 在對話寫入一則系統訊息，記錄是哪位成員交回 Bot；這則訊息 SHALL NOT 送給顧客。對話已結案、已經是 `BOT_HANDLED`、或渠道的 bot 模式為 `off` 時，系統 SHALL 回 400 並說明原因，不改變對話。

#### Scenario: 客服接手的對話交回 Bot
- **WHEN** 對話狀態為 `AGENT_HANDLED`、bot 回覆次數 3、轉真人原因 `manual_takeover`、指派給客服 A，成員呼叫交回 Bot
- **THEN** 對話狀態為 `BOT_HANDLED`、bot 回覆次數 0、轉真人原因為空、仍指派給客服 A，對話多一則系統訊息，渠道沒有送出任何訊息

#### Scenario: 已結案的對話
- **WHEN** 對話狀態為 `CLOSED`，成員呼叫交回 Bot
- **THEN** 回 400，說明要先重新開啟對話，狀態不變

#### Scenario: 檢查後對話被結案
- **WHEN** 系統讀到對話為 `AGENT_HANDLED` 之後、改狀態之前，另一位成員把對話結案
- **THEN** 回 400，對話維持結案，不寫系統訊息

#### Scenario: 已經是 Bot 處理
- **WHEN** 對話狀態為 `BOT_HANDLED`，成員呼叫交回 Bot
- **THEN** 回 400，狀態不變

#### Scenario: 渠道的 bot 已關閉
- **WHEN** 渠道設定的 `botConfig.botMode` 為 `off`，成員呼叫交回 Bot
- **THEN** 回 400，說明這個渠道的機器人已關閉，狀態不變

#### Scenario: 沒有管理對話的權限
- **WHEN** 只有 `inbox.view` 與 `inbox.reply` 的成員呼叫交回 Bot
- **THEN** 回傳 HTTP 403

#### Scenario: 收件匣的交回 Bot 按鈕
- **WHEN** 客服在收件匣打開狀態為 `AGENT_HANDLED` 或 `ACTIVE` 的對話並按「交回 Bot」
- **THEN** 前端呼叫 `POST /conversations/:id/return-to-bot`；狀態為 `BOT_HANDLED` 或 `CLOSED` 的對話不顯示這個按鈕

### Requirement: 無法解析的訊息顯示佔位文字
訊息的 `content` 是物件、但沒有 `text` 時，收件匣的訊息泡泡 SHALL 顯示「[不支援的訊息類型]」，SHALL NOT 顯示 `[object Object]`。

#### Scenario: 無法解析的訊息
- **WHEN** 收件匣顯示一則 `contentType` 為 `unknown`、`content` 為 `{}` 的訊息
- **THEN** 訊息泡泡顯示「[不支援的訊息類型]」

### Requirement: Inbox text messages show web addresses as links
The inbox SHALL show each `http://` or `https://` address in a text message as a link that opens in a new tab with `rel="noopener noreferrer"`. This applies to messages from the customer, an agent and the bot. Punctuation directly after the address SHALL NOT be part of the link. Other schemes SHALL stay plain text, and the inbox SHALL NOT parse message text as HTML. System notices SHALL stay plain text.

#### Scenario: Customer message with an address
- **WHEN** the inbox shows an inbound text message `我看 https://example.com/p/1 這頁`
- **THEN** the message has one link with `href` `https://example.com/p/1`, target `_blank` and `rel` `noopener noreferrer`, and the text before and after the link stays plain text

#### Scenario: Bot reply with an address
- **WHEN** the inbox shows a bot text message `請看 https://example.com/manual—有問題再問我`
- **THEN** the message has one link with `href` `https://example.com/manual`, and `—有問題再問我` is not part of the link

#### Scenario: Other schemes and HTML stay text
- **WHEN** the inbox shows a text message `javascript:alert(1) <a href="https://x.test">x</a>`
- **THEN** the message has no link for `javascript:`, and shows the HTML tag as text, not as an element

#### Scenario: System notice stays text
- **WHEN** the inbox shows a system message `請看 https://example.com`
- **THEN** the message has no link

### Requirement: 收件匣對話列表可以載入更多
收件匣 SHALL 以每頁 50 段請求 `GET /api/v1/conversations`，並依回應的 `meta.totalPages` 讓客服載入下一頁。已載入的各頁 SHALL 合併成一份列表：同一段對話只出現一次，依 `updatedAt desc` 排序。載入失敗時 SHALL 在列表上顯示錯誤訊息。

#### Scenario: 還有下一頁
- **WHEN** 第 1 頁回應 50 段且 `meta.totalPages` 為 2，客服按「載入更多對話」
- **THEN** 前端請求 `page=2`，列表顯示兩頁合起來的對話

#### Scenario: 已是最後一頁
- **WHEN** 已載入的最後一頁 `meta.page` 等於 `meta.totalPages`
- **THEN** 列表不顯示「載入更多對話」

#### Scenario: 下一頁有重複的對話
- **WHEN** 第 2 頁回應中有一段對話已在第 1 頁出現
- **THEN** 列表只顯示那段對話一次

#### Scenario: 載入失敗
- **WHEN** `GET /api/v1/conversations` 回應錯誤
- **THEN** 列表顯示「對話列表載入失敗」與重試按鈕，不顯示「沒有對話」

#### Scenario: 下一頁載入失敗
- **WHEN** 第 1 頁已載入，請求 `page=2` 失敗
- **THEN** 已載入的對話留在列表上，列表顯示「對話列表載入失敗」與重試按鈕；按重試再請求 `page=2`，不請求 `page=3`

#### Scenario: 結果數量
- **WHEN** 後端回應 `meta.total` 為 56，列表已載入 50 段
- **THEN** 篩選列顯示 56 筆結果

### Requirement: 收件匣的未讀與我的篩選由後端執行
收件匣「進行中」的「未讀」子分頁 SHALL 以 `unread=true`、「我的」子分頁 SHALL 以 `assigneeId=<目前成員的 id>` 請求對話列表，從第 1 頁重新載入，不只過濾已載入的資料。

#### Scenario: 切到未讀
- **WHEN** 客服在「進行中」點「未讀」
- **THEN** 前端以 `unread=true&page=1` 請求 `/conversations`

#### Scenario: 切到我的
- **WHEN** 成員 A 在「進行中」點「我的」
- **THEN** 前端以 `assigneeId=<A 的 id>&page=1` 請求 `/conversations`

#### Scenario: 後端只回未讀的對話
- **WHEN** 租戶有未讀數 0 與未讀數 3 的對話，以 `unread=true` 請求 `GET /api/v1/conversations`
- **THEN** 回應只包含未讀數大於 0 的對話，`meta.total` 也只計這些對話

### Requirement: 對話列表依關鍵字搜尋
`GET /api/v1/conversations` SHALL 接受 `search` 參數：去頭尾空白後最多 100 字，比對聯絡人名稱或對話中任一則訊息的文字內容，不分大小寫。去頭尾空白後為空時 SHALL 視為沒有搜尋。搜尋 SHALL 與其他篩選、tenantId 及渠道可見範圍同時套用。收件匣的搜尋框 SHALL 把輸入的文字送到這個參數，從第 1 頁重新載入。

#### Scenario: 依聯絡人名稱搜尋
- **WHEN** 以 `search=王小明` 請求，租戶有一段聯絡人名稱為「王小明」的對話排在第 51 段以後
- **THEN** 回應包含那段對話

#### Scenario: 依訊息內容搜尋
- **WHEN** 以 `search=退貨` 請求，某段對話有一則訊息的 `content.text` 為「我想退貨」
- **THEN** 回應包含那段對話，不包含名稱與訊息都不含「退貨」的對話

#### Scenario: 不分大小寫
- **WHEN** 以 `search=ALICE` 請求，聯絡人名稱為「alice」
- **THEN** 回應包含那段對話

#### Scenario: 看不到的渠道
- **WHEN** 成員只能看渠道 A，以符合渠道 B 某段對話的關鍵字搜尋
- **THEN** 回應不包含渠道 B 的對話

#### Scenario: 其他租戶的資料
- **WHEN** 以只符合其他租戶對話的關鍵字搜尋
- **THEN** 回應沒有任何對話

#### Scenario: 關鍵字太長
- **WHEN** 以 101 字的 `search` 請求
- **THEN** 回應 HTTP 400 `VALIDATION_ERROR`

#### Scenario: 只有空白
- **WHEN** 以 `search=%20%20` 請求
- **THEN** 回應與不帶 `search` 相同

#### Scenario: 收件匣搜尋框
- **WHEN** 客服在搜尋框輸入「退貨」
- **THEN** 前端以 `search=退貨&page=1` 請求 `/conversations`，列表只顯示後端回應的對話

### Requirement: 對話訊息以游標往前分頁
`GET /api/v1/conversations/:id/messages` SHALL 接受 `before`（上一頁回應的 `meta.nextCursor`），回傳比游標更早的最多 `limit` 則訊息，依 `createdAt` 再 `id` 由新到舊排序。回應 `meta` SHALL 帶 `hasMore` 與 `nextCursor`（沒有更早的訊息時為 `null`）。查詢 SHALL 限定在這段對話與目前的租戶。不帶 `before` 時 `page`、`limit`、`order` 的行為不變。

#### Scenario: 60 則訊息分頁取完
- **WHEN** 一段對話有 60 則訊息，以 `limit=25` 先不帶 `before`，再依每次的 `meta.nextCursor` 帶 `before` 請求，直到 `meta.hasMore` 為 `false`
- **THEN** 三次請求共取得 60 則，沒有重複也沒有遺漏，最後一次 `meta.nextCursor` 為 `null`

#### Scenario: 同一時間的多則訊息
- **WHEN** 一段對話有 5 則 `createdAt` 相同的訊息，以 `limit=2` 依游標往前取完
- **THEN** 共取得 5 則，每則只出現一次

#### Scenario: 其他租戶的對話
- **WHEN** 租戶 A 有 `channel.view_all` 的成員請求租戶 B 的對話的訊息
- **THEN** 回應 200，`data` 為空陣列，`meta.total` 為 0

#### Scenario: 游標格式錯誤
- **WHEN** `before` 不是有效的游標
- **THEN** 回應 400，錯誤代碼 `VALIDATION_ERROR`

#### Scenario: 游標搭配 page 或升冪
- **WHEN** 請求同時帶 `before` 與 `page=2`，或帶 `before` 與 `order=asc`
- **THEN** 回應 400，錯誤代碼 `VALIDATION_ERROR`

#### Scenario: 不帶 before 的舊呼叫
- **WHEN** 呼叫端以 `page=2&limit=25&order=desc` 請求 60 則訊息的對話
- **THEN** 回應第 26 到 50 新的訊息，`meta` 有 `total` 60、`page` 2、`totalPages` 3

### Requirement: 聊天視窗可以載入更早的訊息
聊天視窗 SHALL 在最新一頁的 `meta.hasMore` 為 `true` 時，於訊息區頂端顯示「載入更早的訊息」按鈕。按下後 SHALL 以 `before` 請求更早的一頁，把它接在已顯示訊息的前面，並保持畫面停在原本看的那則訊息。沒有更早的訊息時 SHALL 不顯示按鈕。只有最新一則訊息改變時（socket 推來、自己送出）聊天視窗才捲到底。

#### Scenario: 有更早的訊息
- **WHEN** 最新一頁回應 `meta.hasMore` 為 `true`、`meta.nextCursor` 為 `c1`，客服按「載入更早的訊息」
- **THEN** 前端請求 `before=c1`，畫面同時顯示更早一頁與最新一頁的訊息

#### Scenario: 已載入全部
- **WHEN** 最近一次回應的 `meta.hasMore` 為 `false`
- **THEN** 不顯示「載入更早的訊息」

#### Scenario: 往上載入保持捲動位置
- **WHEN** 客服在訊息區頂端按「載入更早的訊息」，更早的訊息畫上去後訊息區變高
- **THEN** 訊息區的 `scrollTop` 增加的量等於增加的高度，聊天視窗不捲到底

#### Scenario: 新訊息捲到底
- **WHEN** 已載入更早的訊息後收到 `message.new`，重新抓到一則更新的訊息
- **THEN** 聊天視窗捲到底

### Requirement: 聊天視窗顯示訊息載入失敗
聊天視窗載入最新一頁或更早的訊息失敗時 SHALL 在訊息區顯示失敗原因與「重試」按鈕，不只寫 console。重試更早的訊息時 SHALL 用同一個游標。

#### Scenario: 更早的訊息載入失敗
- **WHEN** 請求更早的訊息回應錯誤，錯誤訊息為「伺服器忙碌」
- **THEN** 訊息區顯示「更早的訊息載入失敗：伺服器忙碌」與「重試」，已顯示的訊息留在畫面上；按「重試」以同一個 `before` 再請求

#### Scenario: 最新訊息載入失敗
- **WHEN** 開啟對話時請求最新一頁回應錯誤
- **THEN** 訊息區顯示「訊息載入失敗」與原因及「重試」，不顯示「尚無訊息」
