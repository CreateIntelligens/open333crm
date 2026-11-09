## Context

`GET /conversations/:id/messages` 以 `skip: (page - 1) * limit` 分頁、只依 `createdAt` 排序。聯絡人頁的
`GET /contacts/:id/messages`（change add-email-identity-merge）已經用 `createdAt|id` 的 base64url 游標往前翻，
前端 `ContactConversationHistory` 以「載入更早的訊息」按鈕觸發。

## Decisions

### D1：按鈕，不用捲到頂自動載入

訊息區頂端放「載入更早的訊息」按鈕，與聯絡人頁「對話紀錄」與對話列表的「載入更多對話」一致。理由：
- 客服往上捲找內容時，不會因碰到頂端就連續觸發請求；鍵盤與螢幕閱讀器也按得到。
- 失敗時「重試」就在同一個位置，狀態清楚。
- 行為不依賴捲動事件與版面尺寸，元件測試可以直接驗證。

### D2：沿用聯絡人訊息的游標格式，抽成共用函式

游標是 `base64url(createdAt.toISOString() + "|" + id)`，條件為
`createdAt < t OR (createdAt = t AND id < id)`，排序 `[{ createdAt: 'desc' }, { id: 'desc' }]`，取 `limit + 1` 筆判斷 `hasMore`。
`createdAt` 是 Prisma 預設的 `timestamp(3)`，毫秒精度與 `toISOString()` 相同。兩個端點用同一份
`apps/api/src/shared/utils/message-cursor.ts`，避免兩份游標規則分歧（AGENTS.md「不要重複造輪子」）。
格式錯誤的游標回 400 `VALIDATION_ERROR`（沿用聯絡人端點的訊息「分頁參數格式錯誤」）。游標只帶時間與 id，查詢條件仍限定在
這段對話與這個租戶，拿別段對話或別的租戶的游標也只會查到這段對話的訊息。

### D3：保留 `page` 相容

不帶 `before` 時照舊用 `page`／`limit`／`order`，`meta` 照舊有 `total`、`page`、`limit`、`totalPages`，另加 `hasMore`、`nextCursor`
（`order=desc` 且還有更早訊息時才有游標）。帶 `before` 時 `meta` 是 `total`、`limit`、`hasMore`、`nextCursor`。
`before` 只能搭配 `order=desc` 且 `page` 為 1，否則回 400：游標只往更早的方向翻，與 offset 混用沒有意義。

### D4：前端的合併

`useMessages()` 以 SWR 抓最新一頁（`limit=50&order=desc`），更早的頁存在 hook 的 state。`loadOlder()` 第一次用最新一頁的
`meta.nextCursor`，之後用上一次更早頁的 `nextCursor`。hook 記下這段對話出現過的最新一頁訊息；最新一頁因新訊息重新抓取時，
被擠出的訊息仍在回傳的訊息裡，已載入範圍不會出現缺口。這份紀錄在 render 中同步累積，不用 effect：用 effect 會先畫出少了
被擠出訊息的一格（元件測試在高負載時抓到這個閃動）。所有訊息依 `id` 去重。

### D5：捲動

`ChatWindow` 記錄最新一則訊息的 `id`。它改變時（第一次載入、socket 推來、自己送出）才捲到底。按「載入更早的訊息」前記下
訊息區的 `scrollHeight` 與 `scrollTop`，更早的訊息畫上去之後（`useLayoutEffect`）把 `scrollTop` 設成
`新的 scrollHeight - 舊的 scrollHeight + 舊的 scrollTop`，畫面停在原本那則訊息。

## Risks

- 前端 `ChatWindow` 依 `createdAt` 排序後，同一毫秒的訊息再依 `id` 排，與後端一致。
