## Context

`GET /api/v1/conversations` 已支援 `page`、`limit`（上限 100）、`unread`、`assigneeId`，回應有 `meta.total`、`totalPages`。
前端從未用到這些參數。

## Decisions

### D1：前端用 `useSWRInfinite`，「載入更多」按鈕

每頁 50 段。`getKey(index, previous)` 在上一頁的 `meta.page >= meta.totalPages` 時回 `null`。選按鈕而非捲動自動載入：
jsdom 測試容易驗證，也不會在捲動時連發請求。篩選或搜尋改變時 key 改變，SWR 從第 1 頁重新開始。

### D2：多頁合併在衍生資料做

`conversations` = 所有已載入頁攤平 → 依 `id` 去重（保留第一次出現）→ 依 `updatedAt desc` 排序。offset 分頁期間有對話被更新
往前移時，下一頁會出現重複的列，去重處理它；被擠到已載入範圍外的列要等重新整理，這是 offset 分頁的已知限制。

socket 更新改成對每一頁做 `rows.map`，找得到那一列就合併；排序在衍生資料統一做，跨頁移動也正確。列表找不到那一段對話時
呼叫 `mutate()`，SWR 會重新載入所有已載入的頁。

### D3：搜尋比對聯絡人名稱或任一則文字訊息

issue 寫「聯絡人名稱、最後訊息內容」。Prisma 無法表達「最後一則訊息」的條件，只能用原生 SQL，而 `request.tenantPrisma`
對原生查詢的租戶綁定沒有測試保護。改成比對對話中任一則訊息的 `content.text`（文字、快速回覆、模板等訊息都存在這個欄位），
是舊行為（只比對最後一則）的超集合：以前找得到的，現在也找得到；客服也可以用顧客早先說過的話找對話。

效能：條件是 `EXISTS (messages where conversation_id = c.id and content->>'text' ILIKE ...)`，外層先套 tenantId、
渠道、狀態條件。訊息量很大的租戶可能變慢；之後若需要，再加 trigram 索引或反正規化的最後訊息欄位。

長度上限 100 字，去頭尾空白後為空字串時視為沒有搜尋（不回 400，因為前端清空搜尋框時不送這個參數）。

### D4：「我的」與進階篩選的負責人同時選時

「我的」子分頁送 `assigneeId=<自己>`，覆蓋進階篩選的負責人（`unassigned`）。以前兩者同時選時結果為空，現在以「我的」為準。

### D5：service 沿用模組現況

`listConversations()` 仍收 `TenantDb`（模組尚未遷到 `TenantCtx`，見 #337）；本 change 只加一個篩選條件，不改簽章，
`check-tenant-ctx` 的計數不變。
