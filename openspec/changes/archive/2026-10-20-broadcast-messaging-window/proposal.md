## Why

FB Messenger 只能發一般訊息給 24 小時內和粉專互動過的人。現在群發選 FB 渠道時，系統把整份受眾都送給 Meta：超過 24 小時的人被 Meta 擋下，算成發送失敗。大量送出會被擋的訊息，粉專可能被 Meta 限制發訊。行銷人員在發送前也不知道實際送得到幾個人。

## What Changes

- 渠道 plugin 可以宣告訊息視窗（`messagingWindowHours`）。FB 與 IG（`THREADS`）是 24 小時。LINE 沒有視窗，行為不變。
- 群發送出時，有視窗的渠道只送給視窗內傳過訊息給我們的人（收件匣裡顧客傳來的訊息，包含按鈕回應）。其他人不送出、不建收件紀錄，人數記在新欄位 `Broadcast.skippedCount`。
- 符合條件的人全部在視窗外時，群發標成失敗，原因寫出略過人數與視窗長度。
- 新增 `POST /marketing/broadcasts/audience-preview`：依渠道與受眾回傳符合條件的人數、可送達人數與視窗長度，不建立群發。
- 建立群發的表單顯示符合條件與可送達人數；群發列表顯示略過人數。
- FB 與 IG 群發的受眾只提供「24 小時內傳過訊息的人」，不提供分群與標籤：可送達的人本來就少，分眾意義不大，也避免讓人以為能像 LINE 一樣分眾群發。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `broadcast-audience`：新增「有訊息視窗的渠道只發給視窗內互動過的人」、「建立群發前可以看到可送達人數」與「FB 與 IG 群發不提供分眾」。

## Impact

- `packages/channel-plugins/src/index.ts`（`ChannelPlugin.messagingWindowHours`）、`facebook/index.ts`、`threads.ts`
- `apps/api/src/modules/marketing/marketing.service.ts`、`marketing.routes.ts`
- `packages/database/prisma/schema.prisma` 與 migration（`broadcasts.skippedCount`）
- `apps/web/src/app/dashboard/marketing/page.tsx`
- 只按表情回應、或點 m.me 連結但沒有傳訊息的人，系統沒有存成訊息，會被當成視窗外略過。這比較保守：少送，不會送出被 Meta 擋的訊息。
