## Context

動機見 proposal.md。規劃的完整討論（選項比較、Laravel 與 Node 社群的參照）記在 repo 外的規劃文件，本文件只記實作要用到的決定。

現況：

- API 行程消費 `event-notification`、`event-automation`、`event-webhook`、`webhook-delivery`、`usage-alert-email` 與 `api-scheduler`。workers 行程消費 `notification`、`automation`、`rich-menu-bind`、`data-erasure`、`data-export` 與 4 個週期佇列（`sla`、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup`）。
- API 的 Worker 由 `apps/api/src/events/subscriber-workers.ts` 的 `bullWorkerFactory()` 建立，失敗時記 log。workers 的 Worker 沒有 `failed` 監聽。
- 平台後台把平台 JWT 存在 `localStorage`，每個請求帶 `Authorization` 標頭。API 已註冊 `@fastify/cookie`，沒有註冊 helmet，也沒有 CSP。
- `notification:dispatch` 的處理函式（`apps/workers/src/handlers/notification.handler.ts`）在推播失敗時丟錯，job 跟著失敗。主規格「Notification Job Handling」寫的是推播失敗只記 log，job 照常完成，所以這是 bug。

## Goals / Non-Goals

**Goals:**

- 一個畫面涵蓋兩個行程的所有佇列。
- 預設拒絕：網段沒設定時拒絕連線，bull-board 升級後新增的寫入操作也預設拒絕，job 資料新增的欄位預設遮蔽。

**Non-Goals:**

- Redis 的 AOF 與 `maxmemory`（AUDIT.md APP-08 剩下的部分）。
- `notification` 以外的佇列設定 `attempts`。各佇列搬遷到 #337 階段 4、5 時處理。
- 週期佇列的 handler 自己 catch 錯誤、job 永遠不會失敗的問題（#337 階段 5）。
- `scheduleWaitNode()` 的 BullMQ 分支（AUDIT.md APP-07）與 LINE 沒有用到的三個佇列（PKG-06）。這些佇列不會在 Redis 留下 job，不列進監控。

## Decisions

### 1. bull-board 掛在 API 行程

使用 `@bull-board/api` 與 `@bull-board/fastify` 9.10.4，在 `apps/api/src/modules/queue-monitoring/` 註冊為一個獨立的 Fastify plugin，前綴是 `/api/v1/platform/queues`。nginx 與 Caddy 已經把 `/api/` 轉給 API，不用改部署。

佇列清單寫成一個常數，列出兩個行程的佇列名稱。API 為每個名稱建立一個只用來讀取的 `Queue` 物件，交給 bull-board 的 BullMQ adapter。這些物件與 Worker 分開，API 關機時一起關閉。

替代方案：獨立的服務。要多一個容器與一套登入，沒有好處。

### 2. 來源 IP 檢查

plugin 範圍內的第一個 `onRequest` hook 以 `request.ip` 比對 `QUEUE_DASHBOARD_ALLOWED_CIDRS`，用 Node 內建的 `net.BlockList`（`addSubnet()`）。`request.ip` 來自 `trustProxy`（`apps/api/src/lib/trust-proxy.ts`），只信任私有網段的代理，所以請求自帶的 `X-Forwarded-For` 無法偽造來源。`::ffff:` 開頭的位址先轉成 IPv4 再比對。API 在 `config/env.ts` 讀取這個環境變數。變數沒有設定，或任一個網段格式錯誤時，API 把整份清單視為空清單，並記一行 error log。這時所有請求回 403，API 照常啟動。

這個 hook 在登入檢查之前執行：網段外的請求不會碰到平台帳號的查詢。

### 3. 監控 cookie

瀏覽器開啟 bull-board 的畫面時不會帶 `Authorization` 標頭，所以以 cookie 補上 session：

1. 平台後台的「佇列監控」按鈕以平台 JWT 呼叫 `POST /api/v1/platform/queues/session`。這個端點走既有的 `authenticatePlatformSuperuser` 與 `blockIfMustChangePassword`。
2. API 設定 cookie：值是 `<payload>.<簽章>`，payload 含 `platformUserId` 與到期時間（1 小時），簽章是 HMAC-SHA256，金鑰由 `PLATFORM_JWT_SECRET` 以 HKDF 衍生（info 是 `queue-dashboard`）。
3. 前端在新分頁開啟 `/api/v1/platform/queues`。

plugin 的第二個 `onRequest` hook 驗證 cookie 的簽章與期限，再照 `authenticatePlatformSuperuser` 的順序即時查平台帳號：不存在、已停用、須改密碼，都拒絕。

cookie 用衍生的金鑰簽章，不是平台 JWT，所以它不能當作 `Authorization` 標頭使用在其他平台路由。反過來，平台 JWT 也不能當作監控 cookie。`SameSite=Strict` 讓其他網站無法以使用者的 cookie 發出重送請求。

替代方案：cookie 直接放平台 JWT。cookie 就能打所有平台 API，範圍太大。

### 4. 操作白名單

以 `createBullBoard()` 的 `options.handlerHooks.before` 檢查每個 bull-board API 請求。只放行：

- `method` 是 `get`。hook 收到的 method 是小寫。
- `method` 是 `put`，`route` 是 `/api/queues/:queueName/:jobId/retry`，而且以 `request.queues` 與 `params` 查到的 job 狀態是 `failed`。

其他請求回 `{ allow: false, status: 403 }`。這份清單只列放行的路由，所以 bull-board 升級後新增的寫入路由預設被拒絕。

bull-board 的畫面與靜態檔不經過 `handlerHooks`，所以 IP 與 cookie 的檢查放在 Fastify 的 `onRequest`（決策 2、3），不放在這裡。

### 5. 重送的稽核

`handlerHooks` 的 context 不含 Fastify 的 request，拿不到平台帳號。所以稽核寫在 plugin 範圍的 Fastify `onResponse` hook：`request.routeOptions.url` 是重送路由，method 是 `PUT`，狀態碼是 2xx 時，以 `prismaAdmin` 寫入 `PlatformAuditLog`（action `queue.job.retry`）。寫入稽核失敗時只記 log：重送已經完成，回應也已送出。

### 6. 遮蔽 job 資料

每個佇列的 adapter 呼叫 `setFormatter('data', maskJobData)`。`maskJobData` 遞迴走過 job 資料，只保留 spec 列出的識別欄位，其他值換成 `[已遮蔽]`。陣列的每個元素依同樣規則處理。

`returnValue` 不遮蔽：processor 目前只回傳跳過的認領鍵（決策 7），內容都是 id 與種類。失敗原因與 stack 照常顯示，見 Risks。

### 7. 被認領擋下的副作用

`packages/core/src/outbox/claims.ts` 加上以 `AsyncLocalStorage` 實作的收集器：

- `collectSkippedClaims(fn)`：在一個新的收集範圍內執行 `fn`，回傳 `fn` 的結果與被跳過的認領鍵清單。
- `claimSideEffect()` 回傳 false 時，把認領鍵加進目前範圍的清單。不在任何範圍內時，不做任何事。

job processor 的外層包上 `collectSkippedClaims()`：API 的 `subscriberProcessor()`，以及 workers 的 `automation` Worker。清單不是空的時，processor 回傳 `{ skippedClaims: [...] }`；清單是空的時回傳 `undefined`。

這樣不用修改每個認領呼叫端的回傳值，也不用一路傳到 processor。替代方案：改每個呼叫端回傳跳過的結果。四個呼叫端都在較深的呼叫層，要改的函式簽章多，之後新增的認領也容易漏掉。

`claimOne()`（條件更新）不在範圍內：它保護的是資料列的狀態轉換，不是認領鍵。

### 8. 告警監聽

API 為每個監控的佇列（`ops-alert` 除外）建立一個 `QueueEvents`，監聽 `failed` 事件。BullMQ 5.71 只在 job 移到 failed set 時寫入 `failed` 事件，重試時寫入的是 `delayed` 或 `waiting`（`moveToFinished-14.lua`），所以不用自己比對 `attemptsMade`。不用 `retries-exhausted` 事件：job 丟出 `UnrecoverableError` 而提早失敗時，不會觸發這個事件。

`failed` 事件只帶 `jobId` 與 `failedReason`。監聽者以 `Queue.getJob()` 讀出 job 名稱、`tenantId`（job 資料最上層有這個欄位時）與重試次數，再呼叫 `sendOpsAlert()`，合併鍵是 `queue-failed:<佇列名稱>`。

### 9. `ops-alert` 模組

`apps/api/src/modules/ops-alert/`：

| 檔案 | 職責 |
| --- | --- |
| `ops-alert.service.ts` | `sendOpsAlert(alert)`：以 Redis 檢查合併，通過時把 job 送進 `ops-alert` 佇列 |
| `ops-alert.worker.ts` | `ops-alert` 佇列的 processor，呼叫送出端 |
| `slack-sender.ts` | 把告警組成 Slack 訊息，以 `fetch` POST 到 Incoming Webhook，逾時 10 秒 |
| `log-sender.ts` | 沒有設定 Webhook 網址時的送出端，只寫 log |

合併：`SET ops-alert:<key> 1 NX PX 600000` 成功時送出，並以 `GETDEL ops-alert:<key>:suppressed` 取出上一段期間沒有送出的次數，放進訊息。`SET` 失敗時 `INCR ops-alert:<key>:suppressed`，不送出。計數鍵保留 24 小時：期限要比合併的 10 分鐘長，否則期間結束之前計數就過期，下一則告警讀不到次數。計數放在 Redis，所以多個 API 實例也只送一則。

`ops-alert` 佇列加進 `startQueueWorkers()`，job 選項是 `attempts: 3`、指數退避 5 秒、完成保留 24 小時、失敗保留 7 天。

`sendOpsAlert()` 不收 `TenantCtx`：告警是平台層的事，不讀寫租戶資料表。它會送出外部呼叫，所以不能在租戶的交易內呼叫。AGENTS.md 結構規則 2 目前寫「每個 service 函式」，範圍寫得太寬；本 change 把範圍限定為讀寫租戶資料的 service，並寫明兩類例外：平台層資料表的 service，以及不讀資料庫的函式。

### 10. `notification` 佇列

- 兩處生產者的 `defaultJobOptions` 都加上 `attempts: 3` 與指數退避 5 秒：API 的 `notification.worker.ts`，workers 的 `lib/notification-queue.ts`。
- `notification.handler.ts` 以 try/catch 包住 `publishSocketEvent()`，失敗時只記 log。依 AGENTS.md，推播是最多一次、可以遺失的副作用，所以這裡只記 log 是允許的。

### 11. 保留期限

- `rich-menu-bind`、`data-export`：建立 `Queue` 時加上 `defaultJobOptions`。
- 4 個週期佇列：workers 啟動時，先以 `getRepeatableJobs()` 與 `removeRepeatableByKey()` 刪除這個佇列既有的 repeatable job，再以新選項重新 `add()`。刪除 repeatable job 時，BullMQ 一併刪除已排好的下一期 job，所以舊選項不會延續。`index.ts` 清除 `broadcast` 佇列時已經這樣做。

不改用 `upsertJobScheduler()`：BullMQ 5.71 以 `repeat:<排程 id>:<時間>` 當作排程產生的 job id，而自訂 job id 只能剛好含 2 個 `:`。排程 id 沿用 `sla:poll` 時，job id 會含 3 個 `:` 而被拒絕；改名又會改變 `standalone-worker-runtime` 的「SLA Polling as Repeating BullMQ Job」。

## Risks / Trade-offs

- [失敗原因與 stack 可能含個資，例如錯誤訊息帶出 LINE API 回應的內容] → 畫面照常顯示，只有平台管理員從公司網段才能看到。告警不帶失敗原因。
- [`returnValue` 不遮蔽，之後新的 processor 可能回傳內容] → 單元測試確認監控的 processor 只回傳 `undefined` 或 `skippedClaims`。
- [API 停機期間移到 failed set 的 job 不會告警：`QueueEvents` 從最新的事件開始讀] → job 仍留在 failed set 7 天，監控畫面看得到。
- [多個 API 實例時，每個實例都收到同一個 `failed` 事件] → 合併計數放在 Redis，同一個合併鍵只送一則。
- [`notification` 重試時，客服人員可能收到兩則相同的通知] → spec 已寫明接受。
- [刪除舊的 repeatable job 與重新註冊之間，workers 停止時，週期 job 會少一期] → 下次啟動時重新註冊。週期是 5 分鐘與 1 小時，少一期沒有影響。
- [OpenAPI 產生器讀不懂 bull-board 以程式註冊的路由] → 換發 cookie 的路由寫在一般的路由檔；以 `pnpm test` 中的 `openapi-inventory-routes.test.ts` 確認產生器不會失敗。

## Migration Plan

1. 在 UAT 的 `.env.api` 設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS=60.248.142.0/24`，再部署。沒有設定時，監控畫面回 403，其他功能不受影響。
2. 建立 Slack Incoming Webhook 之後，設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 並重啟 API。沒有設定時，告警只寫 log。
3. 部署之後，從公司網段開啟監控畫面，確認兩個行程的佇列都列出。

回復：移除這兩個環境變數即可關閉監控與 Slack 告警。保留期限與 `notification` 的重試不需要回復。

## Open Questions

- Slack 訊息的版面（是否用 Block Kit）。不影響 spec，實作時決定。
