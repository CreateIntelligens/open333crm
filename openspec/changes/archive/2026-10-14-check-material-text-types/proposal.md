## Why

2026-10-13 UAT 素材欄位探測（API 直打）發現兩個前端擋得住、後端擋不住的值：

- LINE 純文字素材的 `text` 送數字 `12345` 回 200，以數字存進資料庫。素材路由的 body 是 `z.record(z.unknown())`，LINE validate API 也接受數字，所以沒有任何一層檢查型別。編輯器與其他程式都把 `text` 當字串用。
- FB 優惠券的 `coupon_code` 送 `AB C` 回 200。編輯器的折扣碼欄位標示「不可含空格」並在輸入時去掉空白，但後端的 `fb_coupon` 檢查沒有看這個欄位。

## What Changes

- LINE 純文字素材的 `text` 不是字串時回 400 並指出 `body.text`。在呼叫 LINE validate 之前檢查，沒有啟用中的 LINE 渠道時也會擋。
- FB 優惠券的 `coupon_code` 有值時必須是字串、不可含空白，否則回 400 並指出 `body.coupon_code`。空值照舊可以存（折扣碼非必填）。

## Capabilities

### Modified Capabilities

- `material-system`：新增「LINE Text Message Body Is Text」「FB Coupon Code Has No Whitespace」兩條需求。

## Impact

- API：`apps/api/src/modules/marketing/material.service.ts`、`fb-material-validation.ts`
- 前端送出的值不受影響：純文字編輯器送 textarea 的字串；折扣碼欄位輸入時就去掉空白。
