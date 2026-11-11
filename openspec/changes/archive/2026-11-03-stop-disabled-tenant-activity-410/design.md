## Context

租戶停用以 `Tenant.isActive = false` 表示（平台 `PATCH /platform/tenants/:id/active`，或試用排程到期停用）。
登入、refresh token 與 webhook 已檢查這個欄位；網站聊天室、排程群發與問卷排程沒有檢查。

## Decisions

### D1：進站檢查放在 `processInboundMessage()`，webhook 的提早丟棄保留

所有渠道（webhook、平台 Meta webhook、網站聊天室）都經過 `processInboundMessage()`，在這裡檢查一次，新渠道不會漏。
webhook 在驗簽前已經丟棄（並讓 LINE 照常回 200），保留不動，行為不變；進站多一次以主鍵查 `tenants` 的查詢，成本可接受。
查不到租戶時視為停用（fail-closed）。

### D2：網站聊天室在入口回 404，比照渠道停用

只靠 D1 時，聊天室送訊息會走到 `processInboundMessage()` 回傳空值，路由回 500。改在 `resolveChatboxChannel()` 與
`verifyChatboxSession()` 加上租戶條件：建立工作階段、bootstrap、送訊息與訪客 socket 都回與渠道停用相同的 404，
訪客端不會分辨租戶停用與渠道停用。

### D3：停用租戶的到期群發標為失敗，不保留 scheduled

保留 `scheduled` 時，租戶重新啟用後排程器會立刻送出停用期間到期的群發，內容可能已經過期。改為標 `failed`，
`failureCode = TENANT_DISABLED`，原因寫在 `failureReason`，後台列表看得到，需要時由成員確認內容後重新發送。
做法與 #409 的發送權限重驗相同（條件更新只動仍是 `scheduled` 的群發，不覆寫已在發送中的群發）。
檢查放在權限重驗之前：租戶停用時不必計算成員權限，原因也比較準確。

檢查與發送的搶占不在同一個交易，兩者之間的毫秒內停用時仍會送出，與 webhook 的提早丟棄相同。

### D4：問卷排程只過濾，不標記

問卷沒有「失敗」狀態可寫。停用租戶的工單不被撈出，`csatSentAt` 維持空值。租戶重新啟用後，解決時間已過的工單仍會寄出問卷
（與排程停擺後恢復相同），列為已知限制。

## Risks / Trade-offs

- 每則進站訊息多一次查詢（主鍵）。
- 其他對外動作（Canvas 等待節點恢復、自動化事件、客服在停用後仍有效的 access token 送訊息）不在本 change，見 issue #410 的回報。
