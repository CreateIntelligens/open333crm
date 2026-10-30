# 佇列監控 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，Redis 與 API、workers 為多個代理共用）／ UAT（只以未登入的 HTTP 請求探測，沒有登入平台後台）
- 規格：`docs/ref/features/feature-map.json` 的 `platform-queue-monitoring`；功能文件 `docs/ref/features/platform/QUEUE-MONITORING.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | `queue-monitoring` 36 個、`ops-alert` 9 個 scenario，全部有實作。42 個有同名測試；`queue-monitoring` 的 3 個保留期限 scenario 沒有同名測試，但有以 job 選項斷言的單元測試（`rich-menu-bind-queue-options`、`repeating-jobs`、`data-export` 等）。前端入口只有一個（側邊欄「佇列監控」），其餘在 bull-board 畫面內。`event-delivery`、`side-effect-claims` 只核對了和監控有關的補送、認領、`skippedClaims` |
| 自動測試 | unit：api 16 檔 108 通過（queue-monitoring、ops-alert、subscriber-workers、job-scheduler、outbox）、web 1 檔 3 通過。feature：6 檔 17 通過（`modules/queue-monitoring`、`lib/job-scheduler`、`lib/outbox*`）。無失敗、無 skip |
| 實際操作 | 9 條流程。正常 7，異常 0，部分 2（本機真實 API 沒設網段，畫面只能以另起的監控程式驗；UAT 只驗到網段檢查）。另以實測確認 3 個監控盲點（見問題清單） |

**本機怎麼驗的。** 共用的 API 沒有設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`，所有監控請求都回 403（實測），又不能重啟共用 API。所以：
1. 真實 API 只驗「網段外」的路徑：平台後台點「佇列監控」→ 側邊欄顯示「此來源 IP 不能使用佇列監控」，空白分頁關閉。
2. 另起一個只掛監控路由的 Fastify（`127.0.0.1:3917`，與 `apps/api/tests/support/queue-monitoring-app.ts` 相同組法，但用真實的 auth plugin、平台帳號資料表、bull-board 9.10.4 與共用 Redis），網段設 `127.0.0.1/32`。只建 Queue 物件讀取，不啟動 Worker。以 Playwright 操作 bull-board 畫面，以 curl 打 bull-board API。
3. 告警以真實 API 驗：對 `api-scheduler` 加入 job 名稱沒有註冊的 job（`hc-platform-queue-monitoring-fail-N`），processor 一定丟「沒有註冊的排程」，沒有副作用。

## 問題清單（依嚴重度）

P0：無。P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-QUEUE-MONITORING-01 | P2 | 多個週期工作的 processor 在頂層 `catch` 錯誤後只寫 log，job 照常 completed。這些失敗不會進 failed set：佇列監控看不到原因、不發告警。workers：`sla`（整輪 SLA 掃描失敗時 SLA 警告與逾時全部停擺，監控仍全綠）、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup`。API 的 `api-scheduler`：`csat-send`、`csat-auto-close`、`broadcast-scheduled`、`inactivity-close` 的頂層 `catch`；`analytics-daily`、`trial-lifecycle` 逐租戶吞錯（逐筆吞錯合理，但沒有任何彙總失敗）。違反記憶規則「失敗不可以只寫 log」 | 讀程式。另實測對照：同一個 `api-scheduler` 佇列，processor 丟出的錯誤（沒有註冊的排程）會進 FAILED 並告警；`sla` 佇列 256 筆全部 completed，失敗只會出現在 workers log | `apps/workers/src/index.ts:79-83, 137-141, 150-154, 163-167`；`apps/api/src/modules/csat/csat.scheduler.ts:53, 136`；`apps/api/src/modules/marketing/broadcast.scheduler.ts:48`；`apps/api/src/modules/conversation/inactivity-close.worker.ts:59` | APP-12 |
| HC-PLATFORM-QUEUE-MONITORING-02 | P2 | outbox 積壓沒有任何畫面或告警。一筆永遠送不出的 outbox 列會被 `outbox-relay` 每分鐘重送一次、每次寫一行 error log，永遠不標記、不被清理（清理只刪已送出的列），`outbox-relay` 的 job 本身照常 completed。relay 依 `createdAt` 由舊到新取 500 筆，累積 500 筆以上送不出的列時，之後較新的未送出列永遠輪不到補送 | **實測**（本機）：插入一筆 `jobOptions: {"priority": 99999999}` 的 outbox 列（BullMQ 拒絕）→ API log 每分鐘出現「[outbox-relay] 補送 1 筆」與「[outbox] 送出失敗，留給 relay 補送 … Priority should be between 0 and 2097152」；沒有 ops-alert、bull-board 沒有任何 failed job。測試列已刪除。500 筆的阻塞只讀程式 | `apps/api/src/modules/outbox/outbox.scheduler.ts:21-31`；`packages/core/src/outbox/outbox.ts:115-117` | APP-13 |
| HC-PLATFORM-QUEUE-MONITORING-03 | P2 | workers 行程停止或卡住時沒有告警。告警只監聽 failed 事件；workers 停掉時 job 停在 waiting，不會失敗。只有打開 bull-board 才看得到「No workers」。`docker-compose.yml` 的 workers 沒有 healthcheck；API 的 `/health` 不檢查 Redis 與 Worker。API 停機時同理，而且 API 停機期間移到 failed set 的 job 不告警（功能文件已註明） | 讀程式。實測確認 `GET .../api/queues/has-workers` 與 `/api/queues/sla/workers` 有回傳 Worker 連線（`sla` 有 1 個，來自 Docker 網路 `192.168.65.1`），沒有自建 Worker 的佇列顯示「No workers」 | `apps/api/src/modules/queue-monitoring/failed-alerts.ts:57-68`；`docker-compose.yml` 的 `workers` 服務；`apps/api/src/index.ts:184-188` | APP-14 |
| HC-PLATFORM-QUEUE-MONITORING-04 | P3 | bull-board 畫面照樣顯示 Retry all、Clean all、修改、刪除、複製等按鈕，按下後只跳英文「Forbidden」，沒有說明「此操作已停用」。功能文件已記載這個行為 | **實測**（監控程式）：Retry all → 確認 → `PUT .../retry/failed` 403，畫面「Forbidden」；job 卡片的刪除圖示 `PUT .../3/clean` 403、複製圖示 `POST .../add` 403；修改資料以 API `PATCH .../update-data` 驗為 403；Logs 分頁 `GET .../logs` 403 | `apps/api/src/modules/queue-monitoring/operation-allowlist.ts:35`（`DENY` 沒有訊息） | 新 |
| HC-PLATFORM-QUEUE-MONITORING-05 | P3 | 本機以主機直接執行 API 時，監控畫面無法使用：根目錄 `.env` 沒有 `QUEUE_DASHBOARD_ALLOWED_CIDRS`，而 `.env.api.example` 的 `172.16.0.0/12` 只適用 Docker（主機上的來源 IP 是 `127.0.0.1`／`::1`）。功能文件與 example 都沒有寫主機執行時要設什麼 | **實測**：`POST /api/v1/platform/queues/session` 帶有效平台 JWT，`127.0.0.1` 與 `[::1]` 都回 403「此來源 IP 不能使用佇列監控」 | `.env.api.example:104-107`；`docs/ref/features/platform/QUEUE-MONITORING.md`「設定」 | 新（文件） |
| HC-PLATFORM-QUEUE-MONITORING-06 | P3 | 告警連結以 `WEB_BASE_URL` 組成。正式環境網頁與 API 同網域，連結可用；本機 `WEB_BASE_URL=http://localhost:3000` 是 Next.js，連結 404 | **實測**：本機告警 log 的連結是 `http://localhost:3000/api/v1/platform/queues/queue/api-scheduler/…` | `apps/api/src/index.ts:284` | 新 |
| HC-PLATFORM-QUEUE-MONITORING-07 | P3 | 失敗原因與 stack 原樣顯示，會帶出對方伺服器回應或例外訊息裡的個資（功能文件已註明是設計取捨）；data 遮蔽則正確 | **實測**：job 失敗原因含 `{"phone":"0912345678"}` 時，Error 分頁完整顯示；同一 job 的 Data 分頁 `payload.content`、`payload.name` 為 `[已遮蔽]`，`tenantId`、`contactId` 照常顯示 | `apps/api/src/modules/queue-monitoring/operation-allowlist.ts:18-31` | 新（設計取捨，建議只記錄） |
| HC-PLATFORM-QUEUE-MONITORING-08 | P3 | 文件過時：AUDIT.md APP-08 的保留期限表漏列 `coupon-broadcast`（實際是完成 24 小時、失敗 7 天）。`monitored-queues.ts` 已列它 | 讀 `apps/api/src/modules/marketing/broadcast-coupon.service.ts:62-63` | `docs/ref/system/AUDIT.md` APP-08 表 | APP-08（文件） |
| APP-08 | P3 | Redis 沒有 `maxmemory`（已記錄）。保留期限部分本次確認有效：`rich-menu-bind` 新 job 帶 `removeOnFail: {age: 604800}`；`data-export` 兩個 2026-10-19 的 failed job 仍在，因為它們建立於保留期限加入之前、`opts` 沒有保留設定，該佇列之後也沒有新的失敗觸發清理（符合 scenario「佇列之後又有 job 失敗」的前提） | 本機讀 Redis：`data-export` failed 2 筆，`opts: {"attempts":0}` | — | APP-08（已記錄） |

### 已確認正常（AUDIT 與規格的關鍵保證）

- 網段檢查在登入之前，換發端點也檢查；`127.0.0.0/` 這種空白前綴讓整份清單作廢並寫 error log（實測）；從 loopback 帶 `X-Forwarded-For: 203.0.113.5` 時 `request.ip` 取該值，被拒絕（實測）。
- 租戶 JWT 換發 401；沒帶 cookie 401「請從平台後台重新開啟佇列監控」；他站 `Origin` 的 PUT 403「只能從佇列監控畫面操作」（實測）。
- 重送 failed job 204、PlatformAuditLog 寫入 `queue.job.retry`／`queue_job`／`hc-platform-queue-monitoring-q:1`、platformUserId 正確；同一 job 第二次重送 403；completed job 重送 403；被拒絕的重送不寫稽核（實測，UI 圖示與 API 都走過）。
- 告警：真實 API 對 `api-scheduler` 的失敗 job 寫出 `[ops-alert] *佇列 job 失敗*`，含佇列、job id、job 名稱、租戶 id、重試次數與連結，**不含**失敗原因；10 分鐘內第二個失敗只計數（Redis `suppressed=1`）；一個半小時後第三個失敗的告警帶「前一段期間另有 1 次相同的告警沒有送出」（實測）。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 開啟監控 | 本機真實 API、監控程式、UAT | 監控程式：換發 200，cookie `HttpOnly; SameSite=Strict; Path=/api/v1/platform/queues; Max-Age=3600`，畫面標題「open333CRM 佇列監控」 | 真實 API 網段外：側邊欄顯示訊息、分頁關閉；空白前綴 403 | 租戶 JWT 401；無 token 401 | UAT：見下方 UAT 段落 |
| 2 佇列清單與數量 | 監控程式 | 18 個佇列（API 8、workers 9 與自建 1）與各狀態數量正確 | — | — | `has-workers`、`workers`、`redis/stats`、`job-schedulers` 200 |
| 3 失敗原因 | 監控程式 | 正常：Error 分頁顯示原因與兩次嘗試的 stack | — | — | 原因含個資（HC-…-07） |
| 4 job 資料遮蔽 | 監控程式 | 正常：只露出識別欄位 | — | — | 排程範本的 data 也遮蔽（`job-schedulers` 回傳） |
| 5 log | 監控程式 | — | 403，畫面「Forbidden」，log 內容沒有出現 | — | |
| 6 重送單一 failed job | 監控程式 | 正常：204、稽核寫入 | 第二次 403；completed 403 | 只有平台管理員能取得 cookie | 重送後的 `skippedClaims` 回傳值未在畫面實測（需要有認領的真實事件 job 失敗，以 feature／unit 測試為準） |
| 7 其他操作 | 監控程式 | — | Retry all、Clean all、empty、pause、clean 單筆、promote、update-data、add 全部 403；`DELETE /api/queues/:q` 404（bull-board 9.10.4 沒有這個路由） | — | 按鈕不隱藏（HC-…-04） |
| 8 失敗告警 | 本機真實 API | 正常（見上） | `ops-alert` 自己失敗不告警：只讀程式與單元測試 | — | Slack 管道沒設定，只驗 log 管道；Slack 以單元測試為準 |
| 9 outbox 補送 | 本機真實 API | 補送路徑正常執行 | 送不出的列無限重送、無告警（HC-…-02） | — | |

**非管理員角色。** 本領域沒有租戶權限點，只有平台管理員能用。租戶 JWT（agent）換發 401（實測）。停用平台帳號與須改密碼的即時拒絕，以單元測試 `session.test.ts` 為準，沒有在本機實測（不改 seed 帳號狀態；其他代理建立的 `hc-platform-users-*` 帳號沒有可用的 token）。

## 完備度對照

| Spec | Requirement | Scenario | 同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| queue-monitoring | 10 | 36 | 33（3 個保留期限 scenario 以 job 選項的單元測試覆蓋，名稱不同） | 0 | 側邊欄「佇列監控」→ bull-board |
| ops-alert | 5 | 9 | 9 | 0 | 無（系統行為） |
| event-delivery（相關部分：補送、清理） | 2 | — | `outbox-relay.test.ts`、`outbox-cleanup.test.ts` | 0；但沒有規格要求積壓要被看見（HC-…-02） | 無 |
| side-effect-claims | 4 | 11 | 未逐條核 | 0（`skippedClaims` 由 `subscriber-workers.test.ts` 覆蓋） | 重送後在 job 回傳值顯示 |

**有後端、沒有前端入口**：沒有（反過來，bull-board 有許多按鈕對應的後端一律 403）。outbox 積壓、workers 健康沒有畫面也沒有 API。

**前端送出的值與後端**：`POST /queues/session` 送 `{}` 與平台 JWT，後端接受；bull-board 的請求格式由它自己的前端決定，全部對上白名單。

## 待真機驗

- UAT 的平台後台「佇列監控」點擊後的畫面：本次沒有登入平台後台（UAT 平台密碼不確定，見記憶「UAT seed 會重設平台密碼」）。
- `OPS_ALERT_SLACK_WEBHOOK_URL` 設定時，Slack 實際收到的訊息格式。
- 停用平台帳號後舊 cookie 立即 401 `PLATFORM_USER_DISABLED`（只有單元測試）。

## UAT 操作紀錄

沒有建立、修改任何資料，沒有登入。持 UAT 鎖以未帶憑證的 HTTP 請求探測（`https://uat.open333crm.create360.ai`）：

- `POST /api/v1/platform/queues/session`（不帶 JWT）→ 401「平台登入已過期，請重新登入」；`GET /api/v1/platform/queues`、`/api/queues` → 401「請從平台後台重新開啟佇列監控」；`/api/v1/platform/zz-nonexistent` → 404。
- 結論：UAT 已部署佇列監控，而且本次的出口 IP（`60.248.142.124`，公司網段）**通過**網段檢查（網段檢查在登入之前，不通過會回 403）。網段外的來源是否被拒絕無法從單一出口驗證，建議由維運確認 `.env.api` 的值不是 `.env.api.example` 的 `172.16.0.0/12`。

## 本機操作紀錄（共用環境）

- 自建佇列 `hc-platform-queue-monitoring-q`（4 個 job）：已 obliterate。
- `api-scheduler` 佇列的 `hc-platform-queue-monitoring-fail-1..3`：已逐筆刪除。告警合併鍵 `ops-alert:queue-failed:api-scheduler` 在測試後 10 分鐘內，其他人在 `api-scheduler` 的失敗只計數不送（之後下一則會帶上次數）。
- outbox 測試列 `4fa206b7-…`：已刪除。
- PlatformAuditLog 留下 2 筆 `queue.job.retry`（targetId `hc-platform-queue-monitoring-q:1`、`:3`），稽核紀錄不刪除。
- 監控程式（port 3917、3918）已關閉。沒有停止或重啟共用的 API、workers、web。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-QUEUE-MONITORING-01：週期工作在頂層吞錯，失敗對佇列監控與告警隱形（`sla` 最嚴重）。
- HC-PLATFORM-QUEUE-MONITORING-02：outbox 積壓沒有畫面與告警；送不出的列無限重送，500 筆以上會擋住補送。
- HC-PLATFORM-QUEUE-MONITORING-03：workers／API 行程停止沒有告警，workers 沒有 healthcheck。
- HC-PLATFORM-QUEUE-MONITORING-04：被拒絕的操作只顯示英文「Forbidden」（可併入佇列監控的已知限制，不一定進 AUDIT）。

## 文件過時之處

- `docs/ref/system/AUDIT.md` APP-08 保留期限表漏列 `coupon-broadcast`（HC-…-08）。
- `docs/ref/features/platform/QUEUE-MONITORING.md`「設定」只寫 Docker 的來源 IP，沒寫主機直接執行 API 時要設 `127.0.0.1/32,::1/128`；也沒提告警連結在本機會 404（HC-…-05、06）。
- 同文件「可以做什麼」沒有提到：processor 吞掉的錯誤不會出現在畫面上（HC-…-01），以及 outbox 積壓不在監控範圍（HC-…-02）。
