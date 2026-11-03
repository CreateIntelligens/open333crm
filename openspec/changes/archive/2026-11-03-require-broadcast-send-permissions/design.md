## Context

群發有三個送出入口：「立即發送」（`POST /broadcasts/:id/send`，要求 `marketing.broadcast`）、排程器
（`broadcast.scheduler.ts`，每 60 秒取時間到的 `scheduled` 群發），以及附券群發的 `coupon-broadcast` 佇列
（「立即發送」附券群發與券詳情批次發券排入，排程器是它的後備）。排程器沒有 request，原本不檢查任何人的權限。

## Decisions

### D1 建立時檢查，送出時再檢查一次

建立帶 `scheduledAt` 時就要求 `marketing.broadcast`，讓沒有權限的人在畫面上立刻知道，而不是到期後才失敗。
但建立後到送出前，成員可能被停用或降權，所以排程器送出前以該成員「當下」的有效權限
（`getEffectiveTenantPermissions()`：角色權限 ∩ 方案天花板）再檢查一次。

### D2 `audience-preview` 帶券時回 403，不是省略剩餘名額

`coupon.issue` 依賴 `coupon.view`（`dependsOn`），能附券的人一定有 `coupon.view`。沒有 `coupon.view` 的人在畫面上
載不到券清單，選不到券，所以前端不會帶 `couponId`。只有直接呼叫 API 的人會帶，回 403 比默默省略欄位清楚，
也不必讓前端處理「有選券但沒有名額資訊」的狀態。

### D3 排程器以「排定送出的成員」檢查：新增 `scheduledById`

只看建立者會誤擋：A（`marketing.manage`）建立草稿，B（`marketing.broadcast`）按「立即發送」附券群發，
群發改成 `scheduled`、排程時間為現在，由佇列 job 或排程器送出。排程器若剛好先搶到，用 A 的權限檢查就會失敗。
所以新增可為空的 `broadcasts.scheduledById`：

| 入口 | `scheduledById` |
| ---- | ---------------- |
| 建立時帶 `scheduledAt`（REST、MCP） | 建立者 |
| 附券群發「立即發送」（`queueCouponBroadcast()`） | 按下發送的人 |
| 券詳情批次發券 | 操作的人（也是建立者） |
| 舊資料（null） | 退回建立者 |

不加外鍵：成員被永久刪除時排程器查不到人，照「成員不存在」處理。

### D4 需要的權限依發放方式而定

- 一般群發：`marketing.broadcast`。
- 群發頁的附券群發（`couponIssuedVia = broadcast`）：`marketing.broadcast` 與 `coupon.issue`。
- 券詳情批次發券（`couponIssuedVia = batch`）：只要 `coupon.issue`（既有 design D31：批次發放只需要 coupon.issue）。

### D5 檢查不過時的寫法

排程器以條件更新（`status = 'scheduled'`）把群發改成 `failed` 並寫 `failureCode`、`failureReason`，不碰收件人。
條件更新讓同時執行的佇列 job 已搶占（`sending`）時不會覆寫。失敗原因不寫權限碼，寫中文權限名稱與成員名稱，
並說明可以由有權限的成員重新發送（「重新發送」走 `/send`，以當下操作者的權限檢查）。

### D6 錯誤可以分辨

建立群發可能因三個檢查回 403：`marketing.manage`、`marketing.broadcast`（排程）、`coupon.issue`（附券）。
`error.details.requiredPermission` 是缺少的那一個；條件式檢查的 `message` 也寫明是排程或附券需要的權限。

## Risks / Trade-offs

- 透過 MCP（CLI session）帶 `scheduledAt` 建立的群發，以前到期一定送出；現在要看建立者的角色有沒有 `marketing.broadcast`。
  這是預期的收緊：CLI 代表該成員操作，不應比成員本人權限大。
- 權限快取：`getEffectiveTenantPermissions()` 有 Redis 快取（角色權限變更時失效）與 60 秒的租戶方案快取，
  換方案後最多 60 秒內排程器仍用舊方案判斷。
