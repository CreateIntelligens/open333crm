## Why

2026-10-27 UAT 驗收：券詳情「發送給…」批次發券送出後，「發放紀錄」顯示「排入發送」，最多要等一分鐘才發出。
附券廣播的「立即發送」也一樣。原因是兩者都只把廣播設成 `scheduled`、排程時間設為現在（`queueCouponBroadcast()`），
實際發送要等每 60 秒輪詢一次的排程（`broadcast.scheduler.ts`）。需求「附券廣播在背景執行且重送不重複發券」寫的就是
「排入排程立即執行」，所以這是規格內的行為，要改規格。

另外廣播列表（`useBroadcasts()`）不會自動更新，送出後要手動重新整理才看得到結果。券詳情的發放紀錄已在排入發送與發送中時
每 5 秒重新載入（`useCouponBatchIssues()`），但沒有規格與測試保護。

## What Changes

- 附券廣播「立即發送」與券詳情批次發券：排入發送的同一個交易在 outbox 寫一個 `coupon-broadcast` job，commit 後由 API 行程
  馬上執行 `runCouponBroadcast()`，不等每分鐘的排程。HTTP 請求仍不等發送完成（回 202）。
- 每分鐘的排程保留為後備：job 沒送出或沒執行時，時間到的附券廣播照樣發送。job 與排程以既有的條件更新搶占，只有一個發送。
- 搶占加上「排程時間已到」：job 晚到時，廣播可能已改成未來的排程時間，不能提前發送。
- 廣播列表在有發送中、或排程時間已到的廣播時每 5 秒重新載入，完成或失敗後停止；排程在未來的廣播不觸發重新載入。
- 券詳情的發放紀錄維持每 5 秒重新載入到完成或失敗，失敗時顯示原因（行為已存在，補規格與測試）。
- 確認視窗與完成提示的文字改成「馬上開始、畫面自動更新」；操作手冊第 18 章同步。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `coupon-management`：修改「附券廣播在背景執行且重送不重複發券」（立即開始執行、排程為後備、時間未到不搶占）；
  新增「發放紀錄與廣播列表在發送完成前自動更新」。

## 歸檔順序

「附券廣播在背景執行且重送不重複發券」由 open change `add-coupon-system` 以 ADDED 新增，目前**不在** `openspec/specs/`。
本 change 必須在 `add-coupon-system` 歸檔之後才歸檔；先歸檔會在 archive 時出現「MODIFIED failed ... not found」。
`add-fb-ig-keyword-coupon` 也 MODIFIED `coupon-management`，但不動這條需求，與本 change 的先後沒有限制（兩者都要在 `add-coupon-system` 之後）。

## Impact

- `apps/api/src/modules/marketing/broadcast-coupon.service.ts`（`COUPON_BROADCAST_QUEUE`、`queueCouponBroadcast()`、`claimCouponBroadcast()`）
- `apps/api/src/modules/marketing/broadcast-coupon.worker.ts`（新增）、`apps/api/src/index.ts`、`apps/api/src/modules/queue-monitoring/monitored-queues.ts`
- `apps/web/src/hooks/useMarketing.ts`、`apps/web/src/app/dashboard/marketing/page.tsx`、`apps/web/src/components/coupons/detail/*`
- 新的 BullMQ 佇列 `coupon-broadcast`（Redis），佇列監控會列出它。不需要資料庫 migration。
