## Why

#337 階段 3 把 `shortlink` 模組改成入口開交易（AGENTS.md 結構規則 2）。主規格 `shortlink-ua-strategy` 有兩處要跟著改：

- 「Tracking endpoint records the single authoritative click」寫明 `link.clicked` 走 eventBus。eventBus 是最多一次：行程在送出之前結束時，事件遺失。搬遷之後，`link.clicked` 與點擊貼標的 `contact.tagged` 改成與點擊一起寫進 outbox，至少送出一次（主規格 `event-delivery`）。
- 「OG snapshot captured on create and update」沒有寫明抓取發生在交易之外。附券廣播在交易內建立素材短連結，背景抓到 OG 後用已經結束的交易寫回，每次都失敗。

## What Changes

- 點擊的事件改走 outbox。點擊紀錄、次數與點擊貼標在同一個交易寫入，交易綁定短連結所屬的租戶。點擊貼標失敗時，點擊照樣記錄。
- `POST /s/track` 找到連結後立即回傳目標網址，點擊在背景寫入。點擊記錄是最多一次：寫入失敗只記 log，這次點擊不計入，與搬遷前相同。
- OG 快照在建立短連結的交易 commit 之後才抓取，再另開交易寫回，最多一次。群發與附券廣播自動建立的素材短連結也適用。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `shortlink-ua-strategy`：修改「Tracking endpoint records the single authoritative click」（拿掉 eventBus）與「OG snapshot captured on create and update」（MODIFIED）；新增「Click recording commits as one transaction」（ADDED）。

## Impact

- 後端：`apps/api/src/modules/shortlink/`（新增 `shortlink.flow.ts`、`og-snapshot.ts`），`marketing.service.ts` 的 `convertBodyUrlsToShortLinks`，`broadcast-coupon.flow.ts`。
- 測試：`tests/feature/modules/shortlink/shortlink-flow.test.ts`、`tests/unit/modules/shortlink/shortlink.flow.test.ts`、`tests/feature/modules/marketing/broadcast-coupon.test.ts`。
- API 回應、資料庫、前端：不變。
