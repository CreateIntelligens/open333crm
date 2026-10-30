---
name: feature-platform-queue-monitoring
description: >
  open333CRM「佇列監控」功能顧問：平台後台側邊欄「佇列監控」開啟的 bull-board（/api/v1/platform/queues），
  BullMQ 各佇列的等待/進行/失敗數、失敗原因與 stack、單筆重送與平台稽核、job 資料遮蔽、
  QUEUE_DASHBOARD_ALLOWED_CIDRS 網段限制與監控 cookie、job 移到 failed set 時的 ops-alert 告警（Slack 或 log）、
  workers 行程與 api-scheduler 排程的健康狀態、outbox 積壓與補送、side_effect_claims 重送不重複副作用。
  當有人問「佇列監控打不開／回 403」「背景工作失敗看不到原因」「重送會不會重發訊息」「告警沒收到」
  「workers 掛了怎麼知道」「outbox 卡住」，或改到 queue-monitoring、ops-alert、outbox、subscriber-workers、
  job-scheduler、apps/workers 的 Worker 時使用。新增 BullMQ 佇列或排程前也要先讀。
---

# 佇列監控

## 先讀
- 功能現況（以它為準）：`docs/ref/features/platform/QUEUE-MONITORING.md`
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-QUEUE-MONITORING.md`
- 規格：`openspec/specs/queue-monitoring/spec.md`、`openspec/specs/ops-alert/spec.md`、`openspec/specs/event-delivery/spec.md`、`openspec/specs/side-effect-claims/spec.md`
- 設計決策：`openspec/changes/archive/2026-10-27-queue-monitoring/design.md`
- 事件與認領：`docs/ref/modules/EVENTS.md`
- 影響分析：`node scripts/feature-impact.mjs --domain platform-queue-monitoring`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 開啟監控 | 平台後台側邊欄「佇列監控」（`QueueMonitorLink.tsx`），點擊當下先開空白分頁 | `POST /api/v1/platform/queues/session`（平台 JWT，`withCredentials`）→ 設 `queue_dashboard_session` cookie（HttpOnly、SameSite=Strict、Path=`/api/v1/platform/queues`、1 小時）→ 新分頁導到 `/api/v1/platform/queues` | 無 | 先檢查來源 IP（`QUEUE_DASHBOARD_ALLOWED_CIDRS`），再 `authenticatePlatformSuperuser` + 不可須改密碼。失敗時關掉分頁、側邊欄顯示後端訊息（例如「此來源 IP 不能使用佇列監控」） |
| 2 | 看佇列清單與數量 | bull-board 左欄 18 個佇列（API 8、workers 9，以 `monitored-queues.ts` 為準） | `GET .../api/queues`、`/api/redis/stats`、`/api/queues/has-workers` | 無 | 每個請求：IP → Origin 同源 → cookie 簽章與到期 → 即時查 PlatformUser（停用 401、須改密碼 403） |
| 3 | 看失敗原因 | 佇列頁 FAILED 分頁，job 卡片的 Error 分頁 | `GET .../api/queues/:q/:jobId` | 無 | 失敗原因與 stack 原樣顯示，**可能含對方伺服器回應的個資** |
| 4 | 看 job 資料 | job 卡片 Data 分頁 | 同上，資料經 `maskJobData` | 無 | 只顯示 `name`、`type`（最上層）與 `id`／`*Id`，其他 `[已遮蔽]` |
| 5 | 看 log | job 卡片 Logs 分頁 | `GET .../:jobId/logs` | 無 | 一律 403，畫面跳英文「Forbidden」 |
| 6 | 重送單一個 failed job | job 卡片的重送圖示 | `PUT .../api/queues/:q/:jobId/retry` → before hook 確認狀態是 failed → `MonitoredQueueAdapter` 固定 `retry('failed')` | 成功 204，`onResponse` 寫 PlatformAuditLog（`queue.job.retry`、`queue_job`、`<佇列>:<id>`）；已認領的副作用不重做，回傳值列 `skippedClaims` | completed 或已重送過 → 403、不寫稽核 |
| 7 | 其他按鈕 | Retry all、Clean all、複製、修改資料、刪除、暫停、提前執行 | 各自的 PUT/POST/PATCH | 無 | 一律 403（按鈕**照樣顯示**，按下後跳英文「Forbidden」） |
| 8 | 失敗告警（系統） | 任何 `ALERTED_QUEUES` 的 job 移到 failed set | `failed-alerts.ts` 的 QueueEvents → `sendOpsAlert` → `ops-alert` 佇列 → Slack 或 log | 合併鍵 `queue-failed:<佇列>`，10 分鐘一則，下一則帶「前一段期間另有 N 次」；連結 `${WEB_BASE_URL}/api/v1/platform/queues/queue/<佇列>/<id>` | — |
| 9 | outbox 補送（系統） | api-scheduler 的 `outbox-relay`（每分鐘）、`outbox-cleanup`（03:30） | `outbox.scheduler.ts` → `dispatchOutboxRows` | 送不出的列留在 outbox、每分鐘再送一次並寫 error log | 沒有畫面 |

**有後端、沒有前端入口**：bull-board 畫面上的 Retry all、Clean all、修改、刪除、複製、暫停等按鈕都有，但後端全部 403；outbox 未送出的列數沒有任何畫面或告警；workers 行程是否活著只能在 bull-board 看「No workers」與 `/api/queues/:q/workers`，沒有告警。

**前端實際送出的值**：`POST /queues/session` 送空物件 `{}` 帶平台 JWT；bull-board 的請求由它自己的前端送出，路由樣式見 `operation-allowlist.ts` 的 `ALLOWED_READ_ROUTES` 與 `RETRY_JOB_ROUTE`。

## 不可破壞的規則
- 網段檢查在登入檢查之前，`/session` 也檢查；格式錯一個網段就整份清單作廢（`60.248.142.0/` 不可變成 `/0`）。
- 讀取與寫入都是**白名單**：升級 bull-board 時重新逐條核對 `ALLOWED_READ_ROUTES`，新路由預設 403。不要把 logs 加進白名單。
- 重送固定 `retry('failed')`，靠 BullMQ 的 Lua 原子檢查；不要改回 bull-board 預設（它接受 completed）。
- 監控 cookie 金鑰以 HKDF 從 `PLATFORM_JWT_SECRET` 衍生，與平台 JWT 不能互換；每個請求即時查平台帳號，停用立即生效。
- 帶 `Origin` 的請求必須同源（全域 CORS 反射任何 Origin，SameSite 擋不住同上層網域的子網域）。
- job 資料一律遮蔽；告警**不帶**失敗原因與 job 資料。
- `ops-alert` 自己失敗不再告警（避免迴圈），所以它不在 `ALERTED_QUEUES`。
- 新增 BullMQ 佇列：加進 `monitored-queues.ts`（`monitored-queues.test.ts` 會核對兩個行程的 Worker 清單），並設定完成 24 小時、失敗 7 天的保留期限（同時更新 AUDIT APP-08 的表）。
- processor 要讓錯誤**丟出去**才會進 failed set、才看得到原因、才會告警。在 processor 頂層 `catch` 後只寫 log，等於對監控隱形（HC-PLATFORM-QUEUE-MONITORING-01）。逐筆處理時可以吞單筆錯誤，但整輪失敗要丟出。
- outbox 的 job id 一定是 outbox id；`writeOutbox` 只接受白名單 job 選項（不可帶 `jobId`、`repeat` 等）。
- 不可重複的副作用執行前先認領（`side_effect_claims`），重送才安全。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-queue-monitoring` 看最新版本。重點：
- **被依賴**：所有背景工作的領域——通知、自動化與機器人回覆（收件匣）、行銷（附券廣播、排程群發）、SLA、治理（資料匯出／刪除、成員保留清理）、LINE（圖文選單綁定）、設定（對外 Webhook）、數據分析（每日彙總）。它們的佇列都在監控清單內，失敗都經這裡告警。
- **依賴**：平台登入（平台 JWT、`authenticatePlatformSuperuser`）、平台帳號（停用、須改密碼、平台稽核）。

## 回歸清單
改到本領域時，至少重走：
1. 在允許的網段：平台後台點「佇列監控」→ 新分頁開出 bull-board，18 個佇列都在。不在網段：側邊欄顯示「此來源 IP 不能使用佇列監控」、分頁關閉。
2. 造一個必定失敗的 job（例如對 `api-scheduler` 加一個沒有註冊的 job 名稱 `hc-...`，processor 會丟「沒有註冊的排程」），確認 FAILED 分頁看得到原因、Data 已遮蔽、Logs 403。
3. 重送 failed job → 204、PlatformAuditLog 多一筆；重送 completed 或同一筆第二次 → 403、不寫稽核。
4. Retry all、Clean all、修改、刪除 → 403；帶他站 `Origin` 的 PUT → 403。
5. 告警：上面那個 job 失敗後，API log 出現 `[ops-alert] *佇列 job 失敗*`；10 分鐘內第二個不出現；10 分鐘後下一則帶「前一段期間另有 1 次」。
6. 平台帳號停用後，舊 cookie 立刻 401 `PLATFORM_USER_DISABLED`。
- 自動測試：`pnpm --filter @open333crm/api test -- queue-monitoring ops-alert subscriber-workers job-scheduler outbox`；`pnpm --filter @open333crm/web test -- queue-monitor-link`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/queue-monitoring lib/job-scheduler lib/outbox`。
- 本機的 API 直接跑在主機上時看到的來源 IP 是 `127.0.0.1`／`::1`，根目錄 `.env` 要設 `QUEUE_DASHBOARD_ALLOWED_CIDRS=127.0.0.1/32,::1/128` 並重啟 API 才能開畫面（`.env.api.example` 的 `172.16.0.0/12` 只適用 Docker）。不能重啟共用 API 時，可以用 `apps/api/tests/support/queue-monitoring-app.ts` 的寫法另起一個只掛監控路由的 Fastify。

## 常見 bug 從哪裡查
- 「點佇列監控沒反應／403」：先看側邊欄的訊息。「此來源 IP」→ `QUEUE_DASHBOARD_ALLOWED_CIDRS`（API log 有沒有「網段格式錯誤」）與 `apps/api/src/lib/trust-proxy.ts` 算出的 `request.ip`；503 → 沒設 `PLATFORM_JWT_SECRET`；401「請從平台後台重新開啟」→ cookie 過期（1 小時）。
- 「某個背景功能壞了但監控全綠」：看該 Worker 的 processor 是不是 `catch` 後只寫 log（`apps/workers/src/index.ts` 的 sla、三個 cleanup；API 各模組 scheduler 的 `pollXxx`，例如 `apps/api/src/modules/csat/csat.scheduler.ts`）。只能去 log 找。
- 「告警沒收到」：`OPS_ALERT_SLACK_WEBHOOK_URL` 沒設就只寫 log；同一佇列 10 分鐘只送一則；API 停機期間的失敗不告警；`ops-alert` 佇列自己的失敗只寫 log。實作在 `apps/api/src/modules/queue-monitoring/failed-alerts.ts`、`apps/api/src/modules/ops-alert/ops-alert.service.ts`。
- 「事件好像沒送出」：查 `outbox` 表 `dispatchedAt is null` 的列與 API log 的 `[outbox] 送出失敗`、`[outbox-relay] 補送`（`apps/api/src/modules/outbox/outbox.scheduler.ts`、`packages/core/src/outbox/outbox.ts`）。
- 「重送後客人收到兩次」：查該副作用有沒有先認領（`packages/core/src/outbox/claims.ts`），以及 job 回傳值的 `skippedClaims`。
- 「workers 是不是掛了」：bull-board 佇列頁右上「No workers」或 `GET .../api/queues/has-workers`；docker-compose 的 workers 沒有 healthcheck。
