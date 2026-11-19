---
name: feature-platform-queue-monitoring
description: >
  open333CRM「佇列監控」功能顧問：bull-board、失敗 job 與重送、ops-alert 告警、workers 與排程的健康狀態、outbox 積壓。改到 queue-monitoring、ops-alert、outbox、job-scheduler、apps/workers 的 Worker，或新增 BullMQ 佇列或排程之前使用。
---

# 佇列監控

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。佇列監控的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

平台後台側邊欄「佇列監控」開啟的 bull-board（`/api/v1/platform/queues`）：BullMQ 各佇列的等待、進行、失敗數，失敗原因與 stack，
單筆重送與平台稽核，job 資料遮蔽，`QUEUE_DASHBOARD_ALLOWED_CIDRS` 網段限制與監控 cookie。
job 移到 failed set 時的 ops-alert 告警（Slack 或 log）、workers 行程與 api-scheduler 排程的健康狀態、outbox 積壓與補送、`side_effect_claims` 讓重送不重複副作用。
常見問題：「佇列監控打不開或回 403」「背景工作失敗看不到原因」「重送會不會重發訊息」「告警沒收到」「workers 掛了怎麼知道」「outbox 卡住」。
改 queue-monitoring、ops-alert、outbox、subscriber-workers、job-scheduler、`apps/workers` 的 Worker 時使用。新增 BullMQ 佇列或排程之前也要先讀。

## 先讀

先讀功能文件 `docs/ref/features/platform/QUEUE-MONITORING.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `QUEUE-MONITORING.md` 的章節 |
| --- | --- |
| 找檔案、監控的佇列清單 | 程式的入口 |
| 網段、監控 cookie、Origin 檢查 | 怎麼進入 |
| 放行清單、遮蔽、重送、稽核 | 可以做什麼 |
| 重送時的副作用 | 重送與認領 |
| 告警 | 告警 |
| 環境變數、本機設定 | 設定 |
| outbox 積壓、workers 停止、processor 吞錯誤 | 監控畫面看不到的問題 |
| 新增佇列或 processor | 新增佇列與 processor |

事件與認領見 `docs/ref/modules/EVENTS.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/queue-monitoring/`、`apps/api/tests/unit/modules/ops-alert/`、`apps/api/tests/unit/modules/outbox/`、`apps/api/tests/feature/modules/queue-monitoring/`、`apps/api/tests/feature/lib/`、`apps/web/tests/unit/components/admin/`，寫法可以照著參考。

`QUEUE-MONITORING.md` 裡標 `HC-PLATFORM-QUEUE-MONITORING-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-QUEUE-MONITORING.md`
- 規格：`openspec/specs/queue-monitoring/spec.md`、`openspec/specs/ops-alert/spec.md`、`openspec/specs/event-delivery/spec.md`、`openspec/specs/side-effect-claims/spec.md`
- 設計決策：`openspec/changes/archive/2026-10-27-queue-monitoring/design.md`
- 影響分析：`node scripts/feature-impact.mjs --domain platform-queue-monitoring`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `QUEUE-MONITORING.md` 括號內的章節。

- 網段檢查在登入檢查之前，`/session` 也檢查。格式錯一個網段就整份清單作廢：`60.248.142.0/` 不可變成 `/0`。（怎麼進入、設定）
- 讀取與寫入都是**放行清單**。升級 bull-board 時，重新逐條核對 `ALLOWED_READ_ROUTES`，新路由預設 403。不要把 logs 加進放行清單。（可以做什麼）
- 重送固定 `retry('failed')`，靠 BullMQ 的 Lua 原子檢查。不要改回 bull-board 的預設，預設也接受 completed。（可以做什麼）
- 監控 cookie 的金鑰以 HKDF 從 `PLATFORM_JWT_SECRET` 衍生，與平台 JWT 不能互換。每個請求即時查平台帳號，停用立即生效。（怎麼進入）
- 帶 `Origin` 的請求必須同源。全域 CORS 接受任何 Origin，SameSite 擋不住同一個上層網域的子網域。（怎麼進入）
- job 資料一律遮蔽。告警**不帶**失敗原因與 job 資料。（可以做什麼、告警）
- `ops-alert` 自己失敗不再告警，避免迴圈，所以它不在 `ALERTED_QUEUES`。（告警）
- 新增 BullMQ 佇列：加進 `monitored-queues.ts`（`monitored-queues.test.ts` 核對兩個行程的 Worker 清單），設定完成 24 小時、失敗 7 天的保留期限，並更新 AUDIT APP-08 的表。（新增佇列與 processor）
- processor 要讓錯誤**丟出去**。在頂層 `catch` 後只寫 log，等於對監控隱形（HC-PLATFORM-QUEUE-MONITORING-01）。逐筆處理時可以吞單筆的錯誤，但整輪失敗要丟出。（新增佇列與 processor）
- outbox 的 job id 一定是 outbox id。`writeOutbox` 只接受放行清單的 job 選項，不可帶 `jobId`、`repeat`。（新增佇列與 processor）
- 不可重複的副作用執行前先認領（`side_effect_claims`），重送才安全。（重送與認領）

## 回歸清單

改到本領域時，至少重走：

1. 開啟監控：
   - 在允許的網段：平台後台點「佇列監控」→ 新分頁開出 bull-board，`monitored-queues.ts` 的佇列都在。
   - 不在網段：側邊欄顯示「此來源 IP 不能使用佇列監控」，分頁關閉。
2. 造一個必定失敗的 job：例如對 `api-scheduler` 加一個沒有註冊的 job 名稱 `hc-...`，processor 會丟「沒有註冊的排程」。確認 FAILED 分頁看得到原因、Data 已遮蔽、Logs 回 403。
3. 重送 failed job → 204，`PlatformAuditLog` 多一筆。重送 completed 的 job 或同一筆第二次 → 403，不寫稽核。
4. Retry all、Clean all、修改、刪除 → 403。帶他站 `Origin` 的 PUT → 403。
5. 告警：
   - 上面那個 job 失敗後，API log 出現 `[ops-alert] *佇列 job 失敗*`。
   - 10 分鐘內的第二個失敗不出現。
   - 10 分鐘後的下一則帶「前一段期間另有 1 次」。
6. 平台帳號停用後，舊 cookie 立刻回 401 `PLATFORM_USER_DISABLED`。

本機在主機上直接執行 API 時，來源 IP 是 `127.0.0.1` 或 `::1`。根目錄 `.env` 要設 `QUEUE_DASHBOARD_ALLOWED_CIDRS=127.0.0.1/32,::1/128`，並重啟 API 才能開畫面。`.env.api.example` 的 `172.16.0.0/12` 只適用 Docker。不能重啟共用的 API 時，照 `apps/api/tests/support/queue-monitoring-app.ts` 的寫法另外啟動一個只掛監控路由的 Fastify。

自動測試：

- `pnpm --filter @open333crm/api test -- queue-monitoring ops-alert subscriber-workers job-scheduler outbox`
- `pnpm --filter @open333crm/web test -- queue-monitor-link`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/queue-monitoring lib/job-scheduler lib/outbox`

## 常見 bug 從哪裡查

- 「點佇列監控沒反應或 403」：先看側邊欄的訊息。
  - 「此來源 IP」：查 `QUEUE_DASHBOARD_ALLOWED_CIDRS`（API log 有沒有「網段格式錯誤」），與 `apps/api/src/lib/trust-proxy.ts` 算出的 `request.ip`。
  - 503：沒設 `PLATFORM_JWT_SECRET`。
  - 401「請從平台後台重新開啟」：cookie 過期（1 小時）。
- 「某個背景功能壞了但監控全綠」：看該 Worker 的 processor 是不是 `catch` 後只寫 log（`apps/workers/src/index.ts` 的 sla 與三個 cleanup；API 各模組排程的 `pollXxx`，例如 `apps/api/src/modules/csat/csat.scheduler.ts`）。只能去 log 找。
- 「告警沒收到」：
  - `OPS_ALERT_SLACK_WEBHOOK_URL` 沒設時只寫 log。
  - 同一個佇列 10 分鐘只送一則。
  - API 停機期間的失敗不告警。
  - `ops-alert` 佇列自己的失敗只寫 log。
  - 實作在 `apps/api/src/modules/queue-monitoring/failed-alerts.ts`、`apps/api/src/modules/ops-alert/ops-alert.service.ts`。
- 「事件好像沒送出」：查 `outbox` 表 `dispatchedAt is null` 的列，與 API log 的 `[outbox] 送出失敗`、`[outbox-relay] 補送`（`apps/api/src/modules/outbox/outbox.scheduler.ts`、`packages/core/src/outbox/outbox.ts`）。
- 「重送後客人收到兩次」：查該副作用有沒有先認領（`packages/core/src/outbox/claims.ts`），以及 job 回傳值的 `skippedClaims`。
- 「workers 是不是掛了」：bull-board 佇列頁右上的「No workers」，或 `GET .../api/queues/has-workers`。docker-compose 的 workers 沒有 healthcheck。
