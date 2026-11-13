## Context

附券廣播的背景發送（`broadcast-coupon.flow.ts`）已經有：排入發送寫 outbox job、`coupon-broadcast` 佇列在 API 行程執行、
排程器為後備、發送前查訊息額度、每位收件人的原因。一般群發走 `executeBroadcast()`，在 HTTP 請求或排程器裡同步執行。

## Decisions

### D1：一般群發沿用 `coupon-broadcast` 佇列

不新增佇列。佇列 job 只帶 `{ tenantId, broadcastId }`，執行函式讀廣播後依 `couponId` 分派：有券走 `runCouponBroadcast()`，
沒券走一般群發。佇列名稱保留 `coupon-broadcast`：Redis 裡可能還有排著的 job，佇列監控與告警也已列入。

### D2：背景發送只搶「已排程且時間已到」的廣播

`executeBroadcast()` 加上 `queued` 模式：以條件更新 `status = 'scheduled' AND scheduledAt <= now` 搶占，搶不到回 `null`，不丟錯。
發送失敗後廣播是 `failed`，job 重試或排程器都搶不到，不會重送。MCP 仍用原本的模式（`draft`、`scheduled`、`failed` 都可以開始）。

### D3：背景發送用綁定租戶的連線，不包一個大交易

`inTenant()` 是一個交易，交易內不可呼叫渠道 API，而且 `executeBroadcast()` 失敗時要先把原因寫進資料庫再丟錯，包在同一個交易裡
會一起 rollback。所以一般群發以 `tenantScopedClient(prisma, tenantId)` 執行：每個查詢各自開一個 `withTenant()` 交易，
效果等於附券廣播「每一步一個 `inTenant()`」。排程器的 `prismaAdmin` 只用來跨租戶查到期清單與計算有效權限。

### D4：額度檢查共用

`checkBroadcastQuota(plugin, credentials, needed, { coupon })` 回 `null` 或 `{ code, reason }`。附券廣播的原因文字不變；
一般群發的原因少了「也沒有發出任何券」。`needed` 是要送出的人數（視窗外略過的人不算）。

### D5：收件人原因沿用 `skipReason` 與既有代碼

一般群發送不出時寫 `DELIVERY_FAILED`，前端已有中文標籤。渠道的錯誤原文仍寫在 multicast 的 `BroadcastDeliveryAttempt.errorMessage`
與全部失敗時的 `failureReason`；不新增欄位（schema 不變）。

### D6：網站聊天室舊草稿仍標失敗

排入發送遇到不能主動推送的渠道時，service 丟 400；flow 在交易外另開一個 `inTenant()` 把一般群發標為失敗並寫原因，再把錯誤往上丟。
附券廣播維持原狀（不排入、不改狀態）。

## Risks

- 一般群發在 API 行程的佇列 worker 裡執行，名單大時佔住一個 worker；與附券廣播相同。
- 排程的 `withoutOverlapping` 鎖存活 30 分鐘：一期處理最多 10 則，單則名單很大時可能超過，鎖到期後下一期才會開始；
  同一則廣播仍由條件更新保證只發送一次。
