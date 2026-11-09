## MODIFIED Requirements

### Requirement: Inbox Refetches After A Message Burst
The inbox SHALL refetch messages after the last `message.new` event of a burst, so that the event sent when a download finishes is not dropped. A refetch of the latest page SHALL keep the older messages that the agent already loaded, and SHALL keep each message that the refetch pushes out of the latest page.

#### Scenario: Download finishes right after the message arrives
- **WHEN** two `message.new` events for the conversation arrive 300 ms apart
- **THEN** the inbox refetches messages once immediately and once more after 500 ms

#### Scenario: 已載入更早的訊息時收到新訊息
- **WHEN** 客服已按「載入更早的訊息」，之後收到 `message.new`，重新抓取的最新一頁把原本最新一頁最舊的一則擠出
- **THEN** 聊天視窗仍顯示已載入的更早訊息與被擠出的那一則，每則只出現一次

## ADDED Requirements

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
