## Why

PR #364 審查延後項目（issue #362 A1）。發券 API `POST /api/v1/coupons/:id/issue` 的 `issuedVia` 格式允許「.」
（`^[a-z][a-z0-9._-]{0,39}$`），但 `isReservedCouponIssuedVia()` 把**所有**含「.」的值都當成舊的觸發事件名稱而回 400。
整合程式用 `partner.sync` 這類合法代碼會被誤擋，錯誤訊息還說它是「系統保留」。後台序號明細也把這類代碼顯示成「自動化」。

舊資料的來源只有一個：#347～#364 期間 workers 以 `context.trigger ?? 'automation'` 寫入 issuedVia，
`context.trigger` 是當時 `packages/automation` 的自動化事件名稱（`git log -S issuedVia -- apps/workers`）。
所以只有那份事件清單裡的名稱需要保留。

## What Changes

- `packages/shared/src/coupon/issued-via.ts`：舊事件名稱改用凍結的清單（當時 19 個自動化事件，加上之後新增的 `contact.followed`），
  不再以「含 `.`」判斷。
- 發券 API：清單內的舊事件名稱仍回 400；其他含「.」的自訂代碼照常發券。
- 序號明細：清單內的舊事件名稱照舊顯示「關鍵字」或「自動化」；其他不認得的代碼（含有「.」的也一樣）顯示「其他方式」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `coupon-management`：修改「發券 API 不預設為對話發券」（保留值改為代碼＋舊事件名稱清單，含「.」的自訂代碼可用）、
  「自動化發券記錄發券的規則」（只有舊事件名稱顯示為「自動化」）。

## Platform layer

這個 change 只改租戶的發券 API 驗證與序號明細的顯示文字，平台後台（`/admin/*`）沒有發放方式的設定或報表，不需要連動。

## Impact

- 程式：`packages/shared/src/coupon/issued-via.ts`（API 的 Zod 驗證與 core 的 `couponSourceName`、web 的序號明細共用）。
- 資料：不回填、不遷移。曾寫入的舊事件名稱都在清單內，顯示不變。
- 同一批 #362 的其他修正（`confirmPendingInstance` 比對持有人、作廢歸還序號比對券與狀態、`coupon_claim_links` 複合外鍵、
  `broadcasts.couponId` 外鍵）是還原既有規格行為或資料完整性的修正，不改呼叫端看得到的行為，不在這個 change 的規格內。
