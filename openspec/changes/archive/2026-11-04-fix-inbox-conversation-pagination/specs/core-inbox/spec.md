## MODIFIED Requirements

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

## ADDED Requirements

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
