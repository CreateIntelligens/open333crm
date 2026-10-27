## 1. `notification` 佇列（standalone-worker-runtime）

- [x] 1.1 寫失敗的單元測試 `apps/workers/tests/unit/handlers/notification.handler.test.ts`，涵蓋 Scenario「Database write succeeds but Redis publish fails」：mock 的 `redisPublisher.publish` 丟錯時，handler 不丟錯並記 log。執行後確認失敗在斷言（目前 handler 會丟錯）
- [x] 1.2 `notification.handler.ts` 以 try/catch 包住 `publishSocketEvent()`（design 決策 10），讓 1.1 通過
- [x] 1.3 在 1.1 的檔案加上 Scenario「Notification job consumed by worker」「Database write fails」「Worker stops after the record is written」（同一個 job 執行兩次，建立兩筆通知）。這些行為已存在，以突變驗證：(1) 把寫入改成依 job id 去重，確認「Worker stops after the record is written」失敗。(2) 在 handler 以 try/catch 吞掉 `create` 的錯誤，確認「Database write fails」失敗。還原後通過，突變記在本項下方
  - 突變 (1)：handler 以模組層的 `Set` 依 job id 去重。「Worker stops after the record is written」失敗。另外兩個測試也失敗，因為四個測試共用同一個 job id，`Set` 跨測試保留
  - 突變 (2)：以 try/catch 吞掉 `create` 的錯誤後 return。只有「Database write fails」失敗
- [x] 1.4 Scenario「Redis unavailable at enqueue time」（Notification Job Consumer）：行為已存在，由 `apps/api/tests/unit/modules/notification/notification.worker.test.ts` 的「Subscriber cannot enqueue the next job」涵蓋。測試名稱加上這個 scenario 名稱，再以突變驗證：把 `notification.worker.ts` 兩處 catch 的 `throw err` 拿掉，確認測試失敗，再還原。突變記在本項下方
  - 突變：拿掉兩處的 `throw err`，測試失敗。只拿掉 `message.received` 的 `throw err`，測試也失敗（第二個 `assert.rejects`）
- [x] 1.5 寫失敗的單元測試，涵蓋 Scenario「Both producers set the retry policy」與「Database write keeps failing」的 job 選項部分：`apps/api/tests/unit/modules/notification/notification-queue-options.test.ts` 檢查 API 的 `notification` 佇列，`apps/workers/tests/unit/lib/notification-queue.test.ts` 檢查 workers 的佇列；兩者的 `defaultJobOptions` 都是 `attempts: 3`、指數退避 5 秒
- [x] 1.6 兩處生產者的 `defaultJobOptions` 加上重試設定，讓 1.5 通過

## 2. 保留期限（queue-monitoring「各佇列 job 的保留期限」）

- [x] 2.1 寫失敗的單元測試 `apps/api/tests/unit/modules/line/rich-menu-bind-queue-options.test.ts` 與 `apps/api/tests/unit/modules/data-export/data-export-queue-options.test.ts`：建立 `Queue` 時的 `defaultJobOptions` 是完成保留 24 小時、失敗保留 7 天
- [x] 2.2 `rich-menu.service.ts`、`data-export.service.ts` 加上保留期限，讓 2.1 通過
- [x] 2.3 把 `apps/workers/src/index.ts` 註冊週期 job 的程式抽成 `apps/workers/src/lib/repeating-jobs.ts`（重構，行為不變），再寫失敗的單元測試 `apps/workers/tests/unit/lib/repeating-jobs.test.ts`，以 mock 的 `Queue` 涵蓋 Scenario「部署前已排定的週期 job」：先以 `removeRepeatableByKey()` 刪除既有的 repeatable job，再以帶保留期限的選項 `add()`，job id 維持 `sla:poll` 等名稱
- [x] 2.4 實作 design 決策 11 的重新註冊，讓 2.3 通過
- [x] 2.5 在本機 docker 的 Redis 驗證 Scenario「部署前已排定的週期 job」：先以舊版 workers 啟動，再以新版啟動，以 `redis-cli HGET bull:sla:<下一期 job id> opts` 確認新的一期帶 `removeOnComplete` 與 `removeOnFail`。結果記在本項下方
  - 2026-10-22：刪除 4 個週期佇列的排程後，以舊版 `index.ts` 啟動 workers。`sla` 的下一期 job（`repeat:1e0e…:1792658700000`）的 `opts` 沒有 `removeOnComplete` 與 `removeOnFail`
  - 換回新版重啟。同一期 job 的 `opts` 帶 `removeOnComplete: { age: 86400 }`、`removeOnFail: { age: 604800 }`，`repeat.jobId` 仍是 `sla:poll`
  - 這一期執行完後，BullMQ 產生的再下一期（`…:1792659000000`）也帶同樣的保留期限
- [x] 2.6 Scenario「completed job 超過 24 小時」「failed job 超過 7 天」由 BullMQ 依選項執行，2.1、2.3 檢查選項即涵蓋，不另寫測試

## 3. 被認領擋下的副作用（queue-monitoring「被認領擋下的副作用標示跳過」）

- [x] 3.1 寫失敗的單元測試 `packages/core/tests/unit/outbox/skipped-claims.test.ts`：`collectSkippedClaims()` 範圍內 `claimSideEffect()` 回傳 false 時，收集到這個認領鍵；回傳 true 時不收集；不在範圍內時不丟錯
- [x] 3.2 在 `claims.ts` 實作收集器（design 決策 7），讓 3.1 通過
- [x] 3.3 寫失敗的單元測試，涵蓋 Scenario「重送已執行過規則動作的 job」「第一次執行沒有跳過」：`apps/workers/tests/unit/handlers/automation-skipped-claims.test.ts` 以 mock 的交易讓 `automation_action` 認領失敗，檢查 workers `automation` processor 的回傳值；`apps/api/tests/unit/events/subscriber-workers.test.ts` 加上 `subscriberProcessor()` 的同樣檢查
- [x] 3.4 `subscriberProcessor()` 與 workers 的 `automation` Worker 包上 `collectSkippedClaims()`，讓 3.3 通過

## 4. 維運告警模組（ops-alert）

- [x] 4.1 寫失敗的單元測試 `apps/api/tests/unit/modules/ops-alert/ops-alert.service.test.ts`，以 mock 的 Redis 與佇列涵蓋 Scenario「短時間內大量失敗」「下一段期間的告警帶上次數」「不同合併鍵」
- [x] 4.2 實作 `ops-alert.service.ts` 的 `sendOpsAlert()`（design 決策 9），讓 4.1 通過
- [x] 4.3 寫失敗的單元測試 `apps/api/tests/unit/modules/ops-alert/ops-alert.worker.test.ts`，以 mock 的 `fetch` 涵蓋 Scenario「送出一則告警」「沒有設定 Slack Webhook」「Slack 暫時無法連線」（processor 丟錯讓佇列重試）
- [x] 4.4 實作 `ops-alert.worker.ts`、`slack-sender.ts`、`log-sender.ts`，讓 4.3 通過
- [x] 4.5 寫失敗的單元測試，涵蓋 Scenario「Slack 持續無法連線」：`ops-alert` 佇列的 job 選項是 `attempts: 3`，而且 `ops-alert` 佇列不在告警監聽的清單內（與 6.1 共用清單）
  - 4.2 已設定 job 選項，所以測試寫好就通過，改以突變驗證：`attempts` 改成 1，測試失敗；`ALERTED_QUEUES` 改成包含 `ops-alert`，測試失敗。檔案是 `apps/api/tests/unit/modules/ops-alert/ops-alert-queue.test.ts`，清單放在 `apps/api/src/modules/queue-monitoring/monitored-queues.ts`
- [x] 4.6 把 `ops-alert` 佇列加進 `apps/api/src/index.ts` 的 `startQueueWorkers()`，讓 4.5 通過。`config/env.ts` 加上 `OPS_ALERT_SLACK_WEBHOOK_URL`（選填）

## 5. 監控畫面的連線與登入

- [x] 5.1 加入相依套件 `@bull-board/api@9.10.4`、`@bull-board/fastify@9.10.4` 到 `apps/api`。`pnpm install` 之後 `pnpm --filter @open333crm/api build` 通過
  - 主機上 esbuild 0.28.2 的 postinstall 失敗（找到 0.25.12 的執行檔），與這兩個套件無關，所以以 `pnpm add --ignore-scripts` 加入。lockfile 不受安裝腳本影響。`pnpm why ioredis -r` 仍只有 5.9.3，bull-board 共用 bullmq 5.71.0
- [x] 5.2 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/ip-allowlist.test.ts`，以 `fastify.inject()` 的 `remoteAddress` 涵蓋 Scenario「網段內的 IP 連線」「網段外的 IP 連線」「網段外的 IP 偽造 X-Forwarded-For」「IPv4 對應的 IPv6 位址」「沒有設定網段」「換發 cookie 的端點也檢查網段」
- [x] 5.3 實作 IP 檢查的 `onRequest` hook（design 決策 2），`config/env.ts` 加上 `QUEUE_DASHBOARD_ALLOWED_CIDRS`（選填），讓 5.2 通過
- [x] 5.4 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/session.test.ts`，涵蓋 Scenario「換發成功」「以租戶 JWT 換發」「須改密碼的平台帳號換發」，以及 platform-auth 的 Scenario「佇列監控路徑沒有 cookie」「監控 cookie 的平台帳號已停用」「平台 JWT 不能取代監控 cookie」
- [x] 5.5 實作換發端點與 cookie 驗證的 `onRequest` hook（design 決策 3），讓 5.4 通過
  - 網段內回 200 要靠有效的 cookie 與 bull-board 的畫面，所以 5.3、5.5 一起實作，bull-board 也在這時掛上（佇列由選項傳入）。整個監控 plugin 寫成 `queue-monitoring.routes.ts`：OpenAPI 產生器只讀得到換發端點
- [x] 5.6 在 `apps/api/tests/unit/modules/platform/platform-auth-guard.test.ts` 確認 platform-auth 原有的 Scenario 仍通過；Scenario「平台後台的其他路由不受影響」加進 5.2 的檔案

## 6. 掛載 bull-board

- [x] 6.1 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/monitored-queues.test.ts`，涵蓋 Scenario「列出 workers 行程的佇列」：監控清單包含兩個行程的每個佇列，並以 `apps/workers/src/index.ts`、`subscriber-workers` 的 processor 清單核對沒有遺漏
  - 「列出 workers 行程的佇列」先以回傳空陣列的 `createMonitoredQueues()` 確認失敗。兩個核對測試寫好就通過（清單本來就正確），以突變驗證：從 `WORKERS_QUEUES` 拿掉 `sla`，workers 的核對失敗；從 `API_QUEUES` 拿掉 `ops-alert`，API 的核對失敗
- [x] 6.2 實作佇列清單與 bull-board plugin（design 決策 1），在 `apps/api/src/index.ts` 註冊，讓 6.1 通過
- [x] 6.3 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/operation-allowlist.test.ts`，涵蓋 Scenario「重送一個 failed job」「重送一個 completed job」「重送整個 failed 狀態」「刪除整個佇列」「修改 job 資料」，並對 design 決策 4 拒絕的每條路由檢查回 403
- [x] 6.4 實作 `handlerHooks.before` 的白名單，讓 6.3 通過
- [x] 6.5 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/retry-audit.test.ts`，涵蓋 Scenario「重送成功時寫入稽核」「被拒絕的重送不寫入稽核」
- [x] 6.6 實作稽核的 `onResponse` hook（design 決策 5），讓 6.5 通過
- [x] 6.7 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/mask-job-data.test.ts`，涵蓋 Scenario「遮蔽訊息內容」「巢狀的 name 不是識別欄位」，以及陣列與新增欄位
- [x] 6.8 實作 `maskJobData()` 並以 `setFormatter('data', …)` 套用到每個佇列（design 決策 6），讓 6.7 通過
- [x] 6.9 寫測試涵蓋 Scenario「顯示失敗原因」：以 `fastify.inject()` 讀取一個 failed job 的細節，回應含失敗原因。bull-board 本身就有這個行為，以突變驗證：把 `failedReason` 也套用遮蔽，確認測試失敗，再還原。突變記在本項下方
  - 測試在 `apps/api/tests/unit/modules/queue-monitoring/job-detail.test.ts`，同一個檔案也檢查經監控路由讀到的 job 資料已遮蔽（套用 `setFormatter` 之前失敗）
  - 突變：加上 `handlerHooks.after`，把 job 的 `failedReason` 換成 `[已遮蔽]`、清空 stack。「顯示失敗原因」失敗

## 7. 告警監聽（queue-monitoring「job 移到 failed set 時發出告警」）

- [x] 7.1 寫失敗的單元測試 `apps/api/tests/unit/modules/queue-monitoring/failed-alerts.test.ts`，以 mock 的 `QueueEvents` 與 `sendOpsAlert` 涵蓋 Scenario「重試用完」「workers 行程的佇列」「告警佇列本身失敗」，以及 ops-alert 的 Scenario「告警不含失敗原因」
- [x] 7.2 實作 design 決策 8 的監聽，讓 7.1 通過
- [x] 7.3 寫 feature 測試 `apps/api/tests/feature/modules/queue-monitoring/failed-event.test.ts`，以真實的 Redis 涵蓋 Scenario「還會重試的失敗」：設定 `attempts: 3` 的 job 第 1 次失敗時 `QueueEvents` 不觸發 `failed`，第 3 次失敗時觸發。這是 BullMQ 的行為，測試寫好就通過；以突變驗證：監聽改成 `retries-exhausted` 並讓 job 丟出 `UnrecoverableError`，確認測試失敗，再還原。突變記在本項下方
  - 測試有兩個：重試 3 次的 job（第 1 次失敗後 300 毫秒內沒有告警，第 3 次失敗後一則），以及丟出 `UnrecoverableError` 的 job（第 1 次就有一則告警）
  - 突變：監聽改成 `retries-exhausted`。「job 丟出不可重試的錯誤時發出告警」失敗；重試用完的測試仍通過，因為 `retries-exhausted` 在第 3 次失敗時也會觸發

## 8. 平台後台

- [x] 8.1 寫失敗的元件測試 `apps/web/tests/unit/components/admin/queue-monitor-link.test.tsx`：點擊「佇列監控」時，先呼叫 `POST /api/v1/platform/queues/session`，成功後在新分頁開啟 `/api/v1/platform/queues`
- [x] 8.2 在平台後台加上「佇列監控」連結（`apps/web/src/app/admin`），讓 8.1 通過
  - 分頁在點擊當下開啟，換發成功後才導向監控畫面：在 await 之後才呼叫 `window.open` 會被瀏覽器擋下。換發請求帶 `withCredentials`：本機的網頁與 API 不同來源，不帶時瀏覽器不存 cookie。換發失敗時關閉分頁並顯示錯誤訊息。瀏覽器擋下新分頁時顯示訊息，不換發 cookie

## 9. 文件

- [x] 9.1 `AGENTS.md` 結構規則 2：標題改成「讀寫租戶資料的 service 收 `TenantCtx`」，寫明不在範圍內的兩類（平台層資料表的 service、不讀資料庫的函式），ratchet 腳本不改
- [x] 9.2 `.env.api.example` 加上 `QUEUE_DASHBOARD_ALLOWED_CIDRS`（本機用 `127.0.0.1/32`，不寫公司網段）與 `OPS_ALERT_SLACK_WEBHOOK_URL`，附上說明
  - 範例值改成 `172.16.0.0/12`：10.6 實測本機 Docker 的 API 看到的來源 IP 是 Docker 閘道 `172.18.0.1`，設定 `127.0.0.1/32` 時一律 403。`.env.api` 只給 Docker 使用，主機直接執行的 API 讀根目錄的 `.env`
- [x] 9.3 `docs/ref/modules/EVENTS.md`：佇列表的重試與保留欄、「失敗與重試」一節，加上 `ops-alert` 佇列與監控畫面。`docs/ref/features/tenant/NOTIFICATIONS.md`：通知的重試與至少一次
- [x] 9.4 `docs/ref/features/platform/` 新增佇列監控的說明：怎麼進入、可以做什麼、重送與認領、告警，並加進該目錄的 `README.md`
- [x] 9.5 `docs/ref/system/AUDIT.md` 的 APP-08：移除已補上保留期限的佇列，表中補上 `tag-expiry-cleanup` 的狀態，只留下 Redis 的 `maxmemory`。`AUDIT-REVIEWS.md` 新增一筆紀錄
- [x] 9.6 `CHANGELOG.md` 在最新的日期段落新增 Added（佇列監控、維運告警）、Changed（保留期限、`notification` 重試）、Fixed（推播失敗讓通知 job 失敗）

## 10. 完成檢查

- [x] 10.1 `pnpm test` 通過，包括 `openapi-inventory-routes.test.ts`
- [x] 10.2 `pnpm build` 通過（改了 `packages/core` 與相依套件）
- [x] 10.3 `pnpm test:feature` 通過（7.3 使用 Redis）
- [x] 10.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有新增違規。稽核寫入使用 `prismaAdmin`，若不在白名單內，依腳本說明處理
  - `check-prisma-admin-usage` 擋下 `queue-monitoring.routes.ts` 的兩處 `prismaAdmin`（讀平台帳號、寫平台稽核）。兩者都是平台層資料表，所以只把這個檔案加進白名單並註明理由。`check-tenant-scoping`、`check-tenant-ctx` 沒有新增違規
- [x] 10.5 `node scripts/validate-openspec.mjs queue-monitoring` 與 `node scripts/validate-openspec.mjs --specs` 通過
- [x] 10.6 本機以 docker 起完整堆疊，設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS=127.0.0.1/32`，從平台後台點「佇列監控」，確認兩個行程的佇列都列出、job 資料已遮蔽、重送 failed job 成功、清空佇列的按鈕回 403
  - 2026-10-22：本機 `.env.api` 設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS=172.18.0.1/32`。從平台後台點「佇列監控」，新分頁開啟 bull-board，16 個佇列都列出
  - 送一個 `agentId` 不存在的 `notification:dispatch`：重試 3 次後移到 failed set，API log 出現一則告警，只含佇列、job id、job 名稱、租戶 id、重試次數與連結
  - 以 curl 確認：job 資料的 `title`、`body` 顯示為 `[已遮蔽]`，失敗原因照常顯示；重送這個 failed job 回 204，`platform_audit_logs` 多一筆 `queue.job.retry`（targetId `notification:qm-verify-1`）；清空佇列與重送整個 failed 狀態回 403；沒有 cookie 時靜態檔回 401

## Workflow follow-up

- 部署前在 UAT 的 `.env.api` 設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`；建立 Slack Incoming Webhook 之後設定 `OPS_ALERT_SLACK_WEBHOOK_URL`。
- 所有任務完成後，以 `openspec-archive-change` 歸檔。
