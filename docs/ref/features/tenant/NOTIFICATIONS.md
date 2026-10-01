# 通知

通知是租戶後台右上角的鈴鐺與「通知」頁。系統在客人傳訊息、工單被指派或升級、SLA 快到期、CSAT 低分、AI 額度快用完時，通知相關的成員。通知只在後台內顯示；除了 AI 額度告警，都不寄信。

- **資料來源**：`apps/api/src/modules/notification/*`、`apps/workers/src/handlers/notification.handler.ts`、`apps/workers/src/handlers/sla.handler.ts`、`apps/api/src/modules/csat/csat.service.ts`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `notification`（API 行程） | `notification.worker.ts` 訂閱 eventBus，決定收件人，把工作送進 `notification` queue。`notification.routes.ts` 提供通知清單、未讀數與標記已讀 |
| `apps/workers` 的 `notification.handler.ts` | 從 queue 取出工作，寫入 `Notification`，透過 Redis 推送 `notification.new` 到收件人的 socket 房間 |

`notification.worker.ts` 的名稱裡有 worker，但它不是 BullMQ consumer，而是把工作送進 queue 的 producer，見 `../../system/AUDIT.md` 的 APP-04。

## 一則通知怎麼送到

1. 業務模組在 API 行程的 eventBus 發布事件，例如 `case.assigned`。
2. `setupNotificationWorker()` 的訂閱者決定收件人，每位收件人送一個工作進 `notification` queue。
3. workers 行程的 `handleNotificationJob()` 寫入一筆 `Notification`。
4. workers 發布到 Redis 的 `socket:emit`，API 行程轉送 `notification.new` 到 `agent:<成員 ID>` 房間。
5. 前端收到後更新鈴鐺的未讀數。

每位收件人各有一筆通知紀錄。同一個事件通知五個人，就寫五筆。

下列來源不經過上面的流程：

- **CSAT 低分**：`csat.service.ts` 的 `recordCsatScore()` 直接呼叫 `createAndDispatch()`，在 API 行程寫入並推送。
- **SLA 預警與逾時**：workers 的 `sla.handler.ts` 自己送進 queue，見[服務水準協議](../SLA.md)。

## 哪些事件通知誰

| 事件 | 通知類型 | 收件人 | 來源 |
| --- | --- | --- | --- |
| 客人傳訊息 | `new_message` | 對話已指派時通知負責人；未指派時通知所有 `ADMIN` 與 `SUPERVISOR` | `message.received` |
| 工單被指派 | `case_assigned` | 被指派的成員 | `case.assigned` |
| 工單升級 | `case_escalated` | 所有 `ADMIN` 與 `SUPERVISOR` | `case.escalated` |
| CSAT 兩分以下 | `csat_low_score` | 所有 `SUPERVISOR`，不含 `ADMIN` | `recordCsatScore()` |
| SLA 預警與逾時 | `sla_warning`、`sla_breached` | 見[服務水準協議](../SLA.md) | workers |
| AI 額度達 80% 或 100% | `usage_quota_warning`、`usage_quota_critical` | 所有 `ADMIN`，另外寄 email | `usage.quota.threshold` |
| 自動化規則的通知動作 | 依規則 | 工單負責人，或所有 `ADMIN` 與 `SUPERVISOR` | workers 的自動化動作 |

收件人都以 `Agent.role` 這個舊的三級列舉判斷，不看「角色與權限」頁設定的細粒度角色，見 `../../system/AUDIT.md` 的 RBAC-03。

要知道的事：

- **未指派對話的每一則訊息都通知全部主管。** 機器人負責的對話也一樣。客人連傳十則，每位 `ADMIN` 與 `SUPERVISOR` 各收到十筆通知。
- **指派對話不會通知。** 通知模組訂閱了 `conversation.assigned`，但 API 行程沒有任何地方發布這個事件，見 `../../system/AUDIT.md` 的 CONV-02。
- **建立工單時直接指定負責人不會通知。** 只有 `POST /cases/:id/assign` 發布 `case.assigned`，見[工單](./CASES.md#指派)。
- **SLA 的兩個訂閱者不會觸發。** 通知模組也訂閱了 `sla.warning` 與 `sla.breached`，但這兩個事件在 API 行程沒有發布端，SLA 通知實際由 workers 直接送出，見 `../../system/AUDIT.md` 的 APP-05。

## 讀取與保留

| 端點 | 作用 |
| --- | --- |
| `GET /notifications` | 列出自己的通知，可以用 `isRead` 篩選，新的在前 |
| `GET /notifications/unread-count` | 自己的未讀數 |
| `PATCH /notifications/:id/read` | 標記一筆為已讀 |
| `POST /notifications/read-all` | 全部標記為已讀 |

每個成員只看得到自己的通知。路由只驗登入，不需要權限碼。

通知沒有保留期限，也沒有清除排程。只有成員被清除（`agent.service.ts` 的 `purgeAgent()`）時，他的通知才會一起刪除。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **指派對話不會通知被指派的人** | 詳見 `../../system/AUDIT.md` 的 CONV-02 |
| 收件人看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| API 行程的 SLA 訂閱永遠不會觸發 | 詳見 `../../system/AUDIT.md` 的 APP-05 |
| 未指派對話的訊息通知沒有彙整 | 每則訊息對每位主管各寫一筆通知 |
| 通知沒有保留期限 | 資料持續累積 |
| 除 AI 額度告警外不寄信 | 成員不在後台時收不到任何通知 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
