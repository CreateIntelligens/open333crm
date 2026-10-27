## 1. 附券廣播馬上開始執行

- [x] 1.1 測試 `apps/api/tests/unit/modules/marketing/broadcast-coupon-immediate-run.test.ts`：「立即發送後馬上開始執行」（排入發送時排 `coupon-broadcast` job）與 job 交給 `runCouponBroadcast()`，在現有程式上斷言失敗
- [x] 1.2 測試 `apps/api/tests/feature/modules/marketing/broadcast-coupon.test.ts`：「立即發送不等待完成」加上 outbox job 的斷言，「排在未來的廣播不會被提前發送」，在現有程式上斷言失敗
- [x] 1.3 `queueCouponBroadcast()` 以 `ctx.enqueue()` 排 job；`claimCouponBroadcast()` 加上排程時間已到；新增 `broadcast-coupon.worker.ts` 並在 `apps/api/src/index.ts` 註冊；`monitored-queues.ts` 列入新佇列（design D1、D3、D4）
- [x] 1.4 「立即執行與排程同時執行時只發送一次」（`broadcast-coupon.test.ts`）是既有的搶占行為，寫好就通過；突變驗證：搶占條件改成 `status in (scheduled, sending)` 時失敗
- [x] 1.5 「批次發券送出後馬上開始執行」（`apps/api/tests/feature/modules/coupon/coupon-batch-issue.test.ts`）在 1.3 之後補寫；突變驗證：拿掉 `ctx.enqueue()` 時失敗
- [x] 1.6 `monitored-queues.test.ts` 的 API 佇列核對加上 `COUPON_BROADCAST_QUEUE` 的來源

## 2. 畫面自動更新

- [x] 2.1 測試 `apps/web/tests/unit/hooks/use-broadcasts-polling.test.tsx`：「廣播列表自動更新到已完成」在現有程式上失敗；「排程在未來的廣播不自動更新」
- [x] 2.2 `useBroadcasts()` 加上 `refreshInterval`（`broadcastsNeedRefresh()`，design D5）
- [x] 2.3 測試 `apps/web/tests/unit/hooks/coupon-batch-issues-polling.test.tsx`：「發放紀錄自動更新到已完成」「發放紀錄顯示失敗原因」——行為已存在，寫好就通過；突變驗證：`useCouponBatchIssues()` 的重新載入條件拿掉 `scheduled` 時兩個都失敗
- [x] 2.4 確認視窗、完成提示與發放紀錄的文字改成馬上開始、自動更新；`broadcast-tab.test.tsx` 的提示文字斷言跟著改；操作手冊 `apps/web/public/manual/ch18-coupons.html` 同步

## 3. 完成定義

- [x] 3.1 `pnpm test`（api、web、workers、channel-plugins unit）
- [x] 3.2 api feature 以獨立測試庫（`TEST_DATABASE_NAME=open333crm_coupon_test`）完整執行
- [x] 3.3 三種 tsc
- [ ] 3.3a web build（2026-10-27 本機磁碟已滿 ENOSPC 未能完成，push 前要補跑）
- [x] 3.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 3.5 `node scripts/validate-openspec.mjs fix-coupon-broadcast-immediate-run`
- [x] 3.6 `CHANGELOG.md` 的 `## [2026-10-27]` Fixed 加條目；`docs/ref/features/tenant/MARKETING.md` 更新
- [ ] 3.7 歸檔：`add-coupon-system` 歸檔之後才可歸檔本 change（見 proposal「歸檔順序」）
