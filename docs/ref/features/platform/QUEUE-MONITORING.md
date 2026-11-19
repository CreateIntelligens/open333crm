# 佇列監控

佇列監控讓平台管理員查看 API 與 workers 兩個行程的所有 BullMQ 佇列：每個佇列有哪些工作、哪些工作失敗、失敗原因是什麼。管理員可以重送單一個失敗的工作。工作重試用完時，系統發出維運告警。

畫面是 [bull-board](https://github.com/felixmosh/bull-board)，掛在 API 行程的 `/api/v1/platform/queues`。系統只放行讀取與單筆重送，其他操作一律拒絕。

- **資料來源**：`apps/api/src/modules/queue-monitoring/*`、`apps/api/src/modules/ops-alert/*`、`apps/web/src/app/admin/lib/QueueMonitorLink.tsx`、`openspec/specs/queue-monitoring/`、`openspec/specs/ops-alert/`（設計決策見 `openspec/changes/archive/2026-10-27-queue-monitoring/design.md`）
- **核對日期**：2026-11-19

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 程式在哪裡？監控哪些佇列？ | [程式的入口](#程式的入口) |
| 怎麼開啟監控畫面？為什麼回 403 或 401？ | [怎麼進入](#怎麼進入) |
| 畫面上可以做什麼？哪些按鈕按了沒反應？ | [可以做什麼](#可以做什麼) |
| 重送一個工作，副作用會再執行一次嗎？ | [重送與認領](#重送與認領) |
| 什麼時候發出告警？告警送到哪裡？ | [告警](#告警) |
| 要設定哪些環境變數？ | [設定](#設定) |
| 沒有進 failed set 的問題（outbox 積壓、workers 停止）怎麼查？ | [監控畫面看不到的問題](#監控畫面看不到的問題) |
| 新增佇列或 processor 要注意什麼？ | [新增佇列與 processor](#新增佇列與-processor) |

## 程式的入口

| 位置 | 負責 |
| --- | --- |
| `apps/api/src/modules/queue-monitoring/queue-monitoring.routes.ts` | `POST /api/v1/platform/queues/session` 換發監控 cookie；掛 bull-board；`onResponse` 在重送成功時寫平台稽核 |
| `queue-session.ts` | 監控 cookie 的簽章與驗證。金鑰以 HKDF 從 `PLATFORM_JWT_SECRET` 衍生 |
| `ip-allowlist.ts` | `QUEUE_DASHBOARD_ALLOWED_CIDRS` 的網段檢查 |
| `operation-allowlist.ts` | 讀取的放行清單 `ALLOWED_READ_ROUTES`、重送的路由 `RETRY_JOB_ROUTE`，以及 `MonitoredQueueAdapter`（把重送固定成 `retry('failed')`） |
| `mask-job-data.ts` | `maskJobData()`，遮蔽工作資料與排程範本的資料 |
| `monitored-queues.ts` | 監控的佇列清單：API 行程消費的 `API_QUEUES`、workers 行程消費的 `WORKERS_QUEUES`；`ALERTED_QUEUES` 是除了 `ops-alert` 之外的全部佇列 |
| `failed-alerts.ts` | `startFailedAlerts()` 為 `ALERTED_QUEUES` 的每個佇列建立 BullMQ 的 QueueEvents，監聽 failed 事件。`apps/api/src/index.ts` 傳入的 `sendAlert` 呼叫 `sendOpsAlert()` |
| `apps/api/src/modules/ops-alert/ops-alert.service.ts` | 告警的合併與送出（`ops-alert` 佇列 → Slack 或 log） |
| `apps/api/src/modules/outbox/outbox.scheduler.ts` | `api-scheduler` 的 `outbox-relay` 與 `outbox-cleanup` |
| `apps/web/src/app/admin/lib/QueueMonitorLink.tsx` | 平台後台側邊欄的「佇列監控」 |

佇列清單以 `monitored-queues.ts` 為準，`monitored-queues.test.ts` 核對清單與兩個行程實際建立的 Worker 一致。

## 怎麼進入

1. 平台管理員在平台後台的側邊欄點「佇列監控」（`QueueMonitorLink.tsx`）。點擊當下，前端先開一個空白分頁。
2. 前端以平台 JWT 呼叫 `POST /api/v1/platform/queues/session`（body 是 `{}`，`withCredentials`），API 設定 `queue_dashboard_session` cookie。
3. 前端把新分頁導到 `/api/v1/platform/queues`。換發失敗時，前端關掉分頁，在側邊欄顯示後端的訊息，例如「此來源 IP 不能使用佇列監控」。

bull-board 自己的前端送出之後的請求（例如 `GET .../api/queues`、`/api/redis/stats`、`/api/queues/has-workers`、`GET .../api/queues/:queueName/:jobId`），路由樣式見 `ALLOWED_READ_ROUTES` 與 `RETRY_JOB_ROUTE`。

每個請求依序經過兩項檢查：

| 檢查 | 不通過時 | 說明 |
| --- | --- | --- |
| 來源 IP 在 `QUEUE_DASHBOARD_ALLOWED_CIDRS` 的網段內 | 403 `FORBIDDEN` | 畫面、靜態檔、API 與換發 cookie 的端點都檢查。沒有設定這個變數時，所有請求都回 403 |
| 換發端點：平台 JWT 有效（`authenticatePlatformSuperuser`），平台帳號存在、沒有停用、不需改密碼 | 401 或 403，與其他平台路由相同 | 租戶的 JWT 回 401 |
| 其他路徑：請求帶 `Origin` 時與監控畫面同一個來源 | 403 `FORBIDDEN` | `SameSite=Strict` 擋不住同一個上層網域的其他子網域，全域 CORS 又接受任何來源，所以監控路徑自己檢查 |
| 其他路徑：監控 cookie 的簽章正確、沒有過期，平台帳號存在、沒有停用、不需改密碼 | 401 `UNAUTHORIZED`、401 `PLATFORM_USER_DISABLED` 或 403 `MUST_CHANGE_PASSWORD` | 每個請求都即時查平台帳號，帳號停用後立即生效 |

來源 IP 依 API 的受信任代理設定計算（`apps/api/src/lib/trust-proxy.ts`）。請求自帶的 `X-Forwarded-For` 不會讓網段外的連線通過。

監控 cookie 的性質：

- `HttpOnly`、`SameSite=Strict`，`Path` 是 `/api/v1/platform/queues`，有效 1 小時。過期後從平台後台再點一次「佇列監控」。
- 簽章金鑰由 `PLATFORM_JWT_SECRET` 衍生，與平台 JWT 不同。監控 cookie 不能當作平台 JWT 呼叫其他平台路由；平台 JWT 也不能取代監控 cookie。

## 可以做什麼

| 操作 | 結果 |
| --- | --- |
| 查看佇列、工作清單、工作細節、失敗原因與 stack、排程 | 放行 |
| 查看工作的 log | 403。log 是 processor 寫的任意文字，無法遮蔽 |
| 重送一個狀態是 failed 的工作 | 放行，並寫入平台稽核。實際重送時以 Redis 原子地確認工作仍在 failed set，兩個重送請求同時送出時只有一個生效 |
| 重送一個 completed 的工作 | 403 |
| 重送整個狀態、清除、清空、刪除佇列、暫停、提前執行、修改工作資料或排程、新增工作 | 403 |

**監控畫面看不到的失敗。**

- processor 接住錯誤、只寫 log 的工作，在畫面上是 completed，不進 failed set，也不發告警。例如 workers 的 `sla` 輪詢接住整輪掃描的錯誤後只寫 log：SLA 預警與逾時全部停止時，監控畫面仍然是綠的。見健檢 HC-PLATFORM-QUEUE-MONITORING-01。
- outbox 積壓不在監控範圍。一直送不出的 outbox 列由 `outbox-relay` 每分鐘重送一次、每次寫一行 error log，但沒有畫面或告警；`outbox-relay` 這個工作本身照常 completed。見健檢 HC-PLATFORM-QUEUE-MONITORING-02。

bull-board 的畫面仍顯示這些按鈕（Retry all、Clean all、複製、修改資料、刪除、暫停、提前執行），按下後畫面只跳英文「Forbidden」，不說明這個操作已停用（HC-PLATFORM-QUEUE-MONITORING-04）。job 卡片的 Logs 分頁也一樣。讀取與寫入都只列出放行的操作，所以 bull-board 升級後新增的操作也會回 403。升級 bull-board 時，要重新核對讀取的放行清單（`operation-allowlist.ts` 的 `ALLOWED_READ_ROUTES`）。

工作資料只顯示識別欄位：最上層的 `name`、`type`，以及任一層名稱為 `id` 或以 `Id` 結尾的欄位。其他欄位顯示為 `[已遮蔽]`，之後新增的欄位也一樣。排程範本的資料依同樣規則遮蔽。失敗原因與 stack 照常顯示，所以可能帶出對方伺服器回應的內容。

重送的流程：bull-board 的 before hook（`allowQueueOperation`）先確認工作的狀態是 failed，`MonitoredQueueAdapter` 再固定呼叫 `retry('failed')`。bull-board 預設的重送也接受 completed 的工作，不要改回預設。重送成功回 204。

重送成功時，API 寫入一筆 `PlatformAuditLog`：action 是 `queue.job.retry`，targetType 是 `queue_job`，targetId 是 `<佇列名稱>:<工作 id>`。被拒絕的請求不寫入稽核。

## 重送與認領

不能重複的副作用（對客人發訊息、規則動作等）執行前先寫一筆認領紀錄，見[事件與背景工作](../../modules/EVENTS.md)的「副作用的認領紀錄」。重送一個工作時，已經認領過的副作用不會再執行。

3 個訂閱者佇列與 `automation` 佇列的工作，回傳值列出這次被認領擋下的副作用：

```json
{ "skippedClaims": [{ "kind": "automation_action", "sourceId": "<事件 id>", "subKey": "<規則 id>#0" }] }
```

沒有副作用被跳過時，回傳值是空的。管理員在工作細節的回傳值看得出哪些副作用沒有再執行。

## 告警

任何佇列（`ops-alert` 除外）的工作移到 failed set 時，API 發出一則告警。重試用完、或工作丟出不可重試的錯誤，都算移到 failed set；還會重試的失敗不告警。

| 項目 | 內容 |
| --- | --- |
| 合併 | 合併鍵是 `queue-failed:<佇列名稱>`。同一個合併鍵 10 分鐘內只送一則；下一則帶上這段期間沒有送出的次數，例如「前一段期間另有 N 次」 |
| 連結 | `${WEB_BASE_URL}/api/v1/platform/queues/queue/<佇列>/<id>` |
| 內容 | 佇列名稱、工作名稱、工作 id、租戶 id、重試次數與監控畫面的連結。不帶失敗原因與工作資料，兩者都可能含客人的個資 |
| 管道 | 設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 時送到 Slack，否則只寫 log |
| 送出 | 告警經 `ops-alert` 佇列送出，失敗時重試 3 次。保證是至少一次：Slack 收下之後、工作完成之前中斷時，同一則告警會再送一次 |
| 例外 | `ops-alert` 自己的工作重試用完時只寫 log，不再發出告警 |
| 遺漏 | API 停機期間移到 failed set 的工作不會告警。這些工作在 failed set 保留 7 天，監控畫面看得到 |

## 設定

兩個環境變數都寫在 `.env.api`，說明見 `.env.api.example`：

| 變數 | 沒有設定時 |
| --- | --- |
| `QUEUE_DASHBOARD_ALLOWED_CIDRS` | 監控畫面的所有請求回 403，其他平台功能不受影響 |
| `OPS_ALERT_SLACK_WEBHOOK_URL` | 告警只寫 log |

任一個網段格式錯誤時，API 記一行 error log，並把整份清單視為空清單。格式正確的網段是 `<IP 位址>/<十進位前綴>`，例如 `60.248.142.0/24`；`60.248.142.0/` 這類空白前綴也算格式錯誤。

本機以 Docker 執行時，瀏覽器的連線經 Docker 網路的閘道進入容器，API 看到的來源 IP 是閘道的位址（例如 `172.18.0.1`），不是 `127.0.0.1`。`.env.api.example` 因此寫 `172.16.0.0/12`。在主機上直接執行 API（`pnpm --filter @open333crm/api dev`）時，來源 IP 是 `127.0.0.1` 或 `::1`，要在根目錄的 `.env` 設 `QUEUE_DASHBOARD_ALLOWED_CIDRS=127.0.0.1/32,::1/128`。UAT 與正式環境的來源 IP 是 nginx 附加的使用者 IP，要設定公司網段。

告警裡的監控連結以 `WEB_BASE_URL` 加上 `/api/v1/platform/queues` 組成。正式環境的網頁與 API 同網域，連結可以開；本機的 `WEB_BASE_URL` 是 Next.js 的 `http://localhost:3000`，連結會 404（HC-PLATFORM-QUEUE-MONITORING-06）。

不能重啟共用的 API 時，可以照 `apps/api/tests/support/queue-monitoring-app.ts` 的寫法，另外啟動一個只掛監控路由的 Fastify。

## 監控畫面看不到的問題

| 問題 | 現況 | 怎麼查 |
| --- | --- | --- |
| processor 接住錯誤只寫 log | 工作是 completed，不進 failed set，也不告警（HC-PLATFORM-QUEUE-MONITORING-01）。例如 `apps/workers/src/index.ts` 的 `sla` 與三個清理佇列，以及 API 各模組排程的頂層 `catch`（例如 `apps/api/src/modules/csat/csat.scheduler.ts`） | 只能查 log |
| outbox 積壓 | 沒有畫面，也沒有告警（HC-PLATFORM-QUEUE-MONITORING-02）。`outbox-relay` 每分鐘以 `dispatchOutboxRows` 補送建立超過 2 分鐘、還沒標記已送出的列，依 `createdAt` 由舊到新取一批。送不出的列留在 outbox，每分鐘再送一次並寫 error log。`outbox-cleanup` 每天 03:30 只刪已送出超過 7 天的列與建立超過 30 天的認領紀錄 | 查 `outbox` 表 `dispatchedAt is null` 的列，與 API log 的 `[outbox] 送出失敗`、`[outbox-relay] 補送`（`outbox.scheduler.ts`、`packages/core/src/outbox/outbox.ts`） |
| workers 行程停止或卡住 | 沒有告警（HC-PLATFORM-QUEUE-MONITORING-03）。工作停在 waiting，不會失敗。docker-compose 的 workers 沒有 healthcheck | bull-board 佇列頁右上的「No workers」，或 `GET .../api/queues/has-workers` |

## 新增佇列與 processor

- 新增 BullMQ 佇列時，加進 `monitored-queues.ts`，並設定完成保留 24 小時、失敗保留 7 天（`removeOnComplete: { age: 86_400 }`、`removeOnFail: { age: 604_800 }`）。同時更新 `../../system/AUDIT.md` APP-08 的保留期限表。
- processor 要讓錯誤丟出去，工作才會進 failed set，監控才看得到原因並發告警。在 processor 頂層 `catch` 之後只寫 log，等於對監控隱形。逐筆處理時可以吞下單筆的錯誤，但整輪失敗要丟出。
- outbox 的 job id 一定是 outbox id。`writeOutbox` 只接受白名單的 job 選項（`attempts`、`backoff`、`delay`、`priority`、`removeOnComplete`、`removeOnFail`），不可帶 `jobId`、`repeat`。
- 不可重複的副作用執行前先認領（`side_effect_claims`，`packages/core/src/outbox/claims.ts`），重送才安全。
