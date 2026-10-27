## Why

change `outbox-event-delivery`（#337 階段 1b）之後，業務事件與 job 都經 BullMQ 佇列送出，失敗時由 BullMQ 重試。重試用完的 job 留在 Redis 的 failed set，但沒有畫面，也沒有告警，只有一行 log，所以沒有人會知道。#337 階段 4 會把對客人發訊息的流程搬進佇列，重試用完的 job 會變多，所以本 change 要在階段 4 之前上線。

## What Changes

- 在 API 行程掛上 bull-board，路徑是 `/api/v1/platform/queues`，列出 API 與 workers 兩個行程的佇列。
  - 只允許環境變數 `QUEUE_DASHBOARD_ALLOWED_CIDRS` 列出的 IP 網段連線。沒有設定時，拒絕所有連線。
  - 平台管理員從平台後台的連結進入。API 以平台 JWT 換發一個只用在這個路徑的 cookie，之後以 cookie 驗證平台帳號。
  - 只放行讀取，以及重送單一個 failed job。其他會改變佇列的操作都回 403。
  - job 資料只顯示識別欄位，其他欄位顯示為 `[已遮蔽]`。
  - 重送單一個 job 時寫入平台稽核。
- 被認領紀錄擋下的副作用，在 job 的回傳值標示跳過，讓管理員看得出重送沒有真的執行。
- 新增維運告警模組 `ops-alert`。任何佇列的 job 移到 failed set 時發出告警，同一個佇列在 10 分鐘內只送一則。設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 時送到 Slack；沒有設定時只記 log。
- `notification` 佇列設定重試 3 次。修正 bug：`notification:dispatch` 推播失敗時，job 也跟著失敗。主規格寫的是推播失敗只記 log，job 照常完成。
- 沒有設定保留期限的佇列統一補上：完成的 job 保留 24 小時，失敗的 job 保留 7 天。已部署環境的週期 job 也要套用新的設定。
- AGENTS.md 結構規則 2 限定範圍：只有讀寫租戶資料的 service 要收 `TenantCtx`。

## Capabilities

### New Capabilities

- `queue-monitoring`：佇列監控畫面。內容包括連線來源限制、登入、可以執行的操作、job 資料的遮蔽、被認領擋下的重送結果、重試用完的告警，以及各佇列 job 的保留期限。
- `ops-alert`：平台層的維運告警。內容包括告警的送出管道、沒有設定管道時的行為、合併通知、告警內容不含 job 資料，以及告警本身失敗時不再告警。

### Modified Capabilities

- `platform-auth`：「平台路由一律驗證平台帳號」把佇列監控的路徑列為例外；新增「佇列監控路徑以監控 cookie 驗證平台帳號」。
- `standalone-worker-runtime`：
  - 「Notification Job Handling」的 Scenario 改成 job 照常完成；新增「Notification Job Retry」，寫明 `notification` 佇列的重試次數，以及至少一次的保證。
  - 「Notification Job Consumer」的 Scenario「Redis unavailable at enqueue time」改成現行的行為：送不出 job 時，通知訂閱者的 job 失敗，由佇列重試。change `outbox-event-delivery` 改了這個行為，也在 `event-delivery` 新增「Subscriber cannot enqueue the next job」，但沒有更新這個 scenario，兩份主規格因此互相矛盾。

## Impact

- 新增相依套件：`@bull-board/api`、`@bull-board/fastify`（9.10.4），以及它們帶進的 `@bull-board/ui`、`@fastify/static`、`@fastify/view`、`ejs`、`valibot`、`redis-info`。
- 新增程式：API 的佇列監控模組（掛載 bull-board、IP 檢查、cookie 換發、操作白名單、遮蔽、告警監聽），`apps/api/src/modules/ops-alert/`，以及平台後台的「佇列監控」連結。
- 修改程式：
  - 認領：`packages/core/src/outbox/claims.ts` 加上收集被跳過的認領鍵；API 的 `subscriberProcessor()` 與 workers 的 `automation` Worker 回傳收集結果。認領的呼叫端不用修改。
  - `notification` 佇列的兩處生產者（`notification.worker.ts`、workers 的 `notification-queue.ts`）與 `notification.handler.ts`。
  - 補上保留期限的佇列：`rich-menu.service.ts`、`data-export.service.ts`、workers 的 `index.ts`。
- 新增環境變數：`QUEUE_DASHBOARD_ALLOWED_CIDRS`、`OPS_ALERT_SLACK_WEBHOOK_URL`。兩者都寫進 `.env.api.example`。
- 文件：
  - `AGENTS.md` 結構規則 2。
  - `docs/ref/modules/EVENTS.md` 的佇列表與「失敗與重試」，`docs/ref/features/tenant/NOTIFICATIONS.md`，`docs/ref/features/platform/` 新增佇列監控的說明。
  - `docs/ref/system/AUDIT.md` 的 APP-08，以及 `AUDIT-REVIEWS.md`。
  - `CHANGELOG.md`。
- 部署：上線前在 UAT 的 `.env.api` 設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`。建立 Slack Incoming Webhook 之後，再設定 `OPS_ALERT_SLACK_WEBHOOK_URL`。
