## 1. 測試（先寫，在現有程式上斷言失敗）

- [x] 1.1 `apps/api/tests/feature/modules/marketing/broadcast-plain-send.test.ts`：「立即發送一般群發回 202 並在背景送出」「背景發送時受眾為空」「發送失敗後 job 重試不重送」「Retry a failed broadcast」「Two send requests at the same time」——修正前路由回 200 與發送結果，斷言 202 失敗
- [x] 1.2 同檔：「一般群發額度不足」「額度查詢失敗」「額度足夠」——修正前在 202 斷言失敗；額度檢查另以突變驗證（見 4.1）
- [x] 1.3 同檔：「逐人送出時一位收件人失敗」「multicast 整批失敗」「重新發送後成功」——修正前在 202 斷言失敗；原因另以突變驗證（見 4.2、4.6）
- [x] 1.4 同檔：「排程器以租戶連線發送一般群發」——修正前跨租戶連線讀寫了 broadcast、channel、material、broadcastRecipient 等，斷言失敗
- [x] 1.5 同檔：「Sender lost the broadcast permission before the queued plain broadcast job ran」「Queued plain broadcast job of a disabled tenant」——修正前 job 只執行附券廣播，斷言失敗
- [x] 1.6 `apps/api/tests/unit/modules/marketing/broadcast-failure-reason.test.ts`：「以其他租戶的廣播 ID 發送」——修正前讀廣播只比對 id，同租戶的發送回 NOT_FOUND，測試失敗
- [x] 1.7 `apps/api/tests/unit/lib/schedule-registrations.test.ts`：「兩期排程不重疊」——修正前 `withoutOverlapping` 是 undefined，斷言失敗
- [x] 1.8 `apps/web/tests/unit/app/dashboard/marketing/broadcast-tab.test.tsx`：「一般群發的結果按鈕」「名額預估還沒回應」「名額預估失敗」——修正前沒有按鈕、建立按鈕可以按，失敗
- [x] 1.9 `apps/web/tests/unit/components/marketing/broadcast-coupon-result.test.tsx`：「一般群發的結果列出失敗的人」——修正前不顯示成功與失敗人數，失敗
- [x] 1.10 寫好就通過的情境：「Send a broadcast that is sending」「送出網站聊天室的舊一般群發」（既有行為），以突變驗證（見 4.4、4.5）

## 2. 實作

- [x] 2.1 `broadcast-quota.ts`：`checkBroadcastQuota()`，附券廣播改呼叫它；`executeBroadcast()` 解析完受眾、發送前呼叫（design D4）
- [x] 2.2 `executeBroadcast()`：收 `tenantId`、讀廣播比對 `tenantId`；`queued` 模式只搶已排程且時間已到的廣播（design D2）；失敗寫 `failureCode`；收件紀錄寫 `skipReason = DELIVERY_FAILED`，重新發送時更新（design D5）
- [x] 2.3 `queueBroadcast()`（`broadcast-coupon.service.ts`）與 `queueBroadcastFlow()`：一般群發也排入 `coupon-broadcast` job；網站聊天室的一般群發標為失敗（design D1、D6）
- [x] 2.4 `runQueuedBroadcast()`、`runPlainBroadcast()`（`tenantScopedClient()`，design D3）；`createBroadcastJobRunner()` 取代 `createCouponBroadcastJobRunner()`
- [x] 2.5 `broadcast.scheduler.ts`：跨租戶只查到期清單，交給 `createBroadcastJobRunner()`；`withoutOverlapping` 30 分鐘
- [x] 2.6 `marketing.routes.ts`：`POST /broadcasts/:id/send` 一律回 202；`mcp.server.ts` 傳入 `tenantId`（MCP 仍同步）
- [x] 2.7 前端：所有已發送的廣播有結果按鈕，一般群發的結果顯示成功、失敗、略過人數；附券時預估未完成或失敗不能建立，失敗時有「重試」；立即發送的確認文字說明背景發送
- [x] 2.8 既有測試配合：`channel-scoped-visibility.test.ts` 三個群發測試改成 202 後執行佇列 job 再斷言（行為刻意改變，本 change）；單元測試的 `executeBroadcast()` 呼叫加上 `tenantId`、mock 補 `upsert`／`updateMany`；`createCouponBroadcastJobRunner` 改名

## 3. 文件

- [x] 3.1 `docs/ref/features/tenant/MARKETING.md`、`.claude/skills/feature-marketing/SKILL.md`、操作手冊 `apps/web/public/manual/ch08-marketing.html`
- [x] 3.2 `docs/ref/system/AUDIT.md` MKT-01（送出改成背景工作，部分修正）與 `docs/ref/system/AUDIT-REVIEWS.md`

## 4. 突變驗證

- [x] 4.1 拿掉 `executeBroadcast()` 的額度檢查：「一般群發額度不足」「額度查詢失敗」失敗
- [x] 4.2 送不出時 `skipReason` 寫 null：「逐人送出時一位收件人失敗」「multicast 整批失敗」失敗
- [x] 4.3 `queued` 模式的搶占也接受 `failed`：「發送失敗後 job 重試不重送」失敗
- [x] 4.4 `queueBroadcast()` 讓一般群發也能從 `sending` 排入：「Send a broadcast that is sending」失敗
- [x] 4.5 拿掉 `queueBroadcastFlow()` 標失敗的那一段：「送出網站聊天室的舊一般群發」失敗
- [x] 4.6 逐人送出的 `upsert` 不更新狀態：「重新發送後成功」失敗
- [x] 4.7 排程器把跨租戶連線交給一般群發執行：「排程器以租戶連線發送一般群發」失敗
- [x] 4.8 `executeBroadcast()` 讀廣播不帶 `tenantId`：「以其他租戶的廣播 ID 發送」失敗

## 5. 完成定義

- [x] 5.1 `pnpm test`
- [x] 5.2 碰到的 feature 測試（`TEST_DATABASE_NAME=open333crm_test_362bc`）：`tests/feature/modules/marketing`、`channel/channel-scoped-visibility`、`mcp`、`coupon`；另跑完整 feature 套件 159 檔 1559 個全過
- [x] 5.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict`（`request.tenantPrisma` 少 1 處，已更新基準檔）
- [x] 5.4 `node scripts/validate-openspec.mjs fix-plain-broadcast-send-362` 與 `--specs`
- [x] 5.5 `pnpm build`
- [ ] 5.6 `CHANGELOG.md`（由使用者統一撰寫）
- [ ] 5.7 歸檔
