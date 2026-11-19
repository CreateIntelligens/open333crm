# 通知

通知是租戶後台右上角的鈴鐺與「通知」頁。系統在客人傳訊息、工單被指派或升級、SLA 快到期、CSAT 低分、AI 額度快用完時，通知相關的成員。通知在後台內顯示；AI 額度告警與 FB、IG 權杖失效另外寄 email 給管理員，其他通知不寄信。

- **資料來源**：`apps/api/src/modules/notification/*`、`apps/workers/src/handlers/notification.handler.ts`、`apps/workers/src/handlers/sla.handler.ts`、`apps/api/src/modules/csat/csat.flow.ts`、`apps/workers/src/lib/automation-actions.ts`、`apps/web/src/components/notification/NotificationBell.tsx`、`apps/web/src/app/dashboard/notifications/page.tsx`、`apps/web/src/hooks/useNotifications.ts`
- **核對日期**：2026-11-19

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `notification`（API 行程） | `notification.worker.ts` 處理 `event-notification` 佇列的事件，決定收件人，把工作送進 `notification` queue。`notification.routes.ts` 提供通知清單、未讀數與標記已讀 |
| `apps/workers` 的 `notification.handler.ts` | 從 queue 取出工作，寫入 `Notification`，透過 Redis 推送 `notification.new` 到收件人的 socket 房間 |

`notification.worker.ts` 的名稱裡有 worker，但它回傳的是訂閱者的處理函式，由 API 行程的訂閱者 Worker 呼叫，再把工作送進 queue，見 `../../system/AUDIT.md` 的 APP-04。

`docs/20_NOTIFICATION.md` 是早期的設計稿。設計稿裡的 Web Push、靜音設定、工單事件寄信都沒有實作。

## 程式的入口

通知的路由在 `notification.routes.ts`，前綴是 `/api/v1/notifications`。

| 操作 | 路由 | flow 或 service 函式 |
| --- | --- | --- |
| 列表 | `GET /notifications?isRead&page&limit` | `listNotificationsFlow()` → `listNotifications()` |
| 未讀數 | `GET /notifications/unread-count` | `getUnreadCountFlow()` → `getUnreadCount()` |
| 標記一筆已讀 | `PATCH /notifications/:id/read` | `markAsReadFlow()` → `markAsRead()` |
| 全部已讀 | `POST /notifications/read-all` | `markAllAsReadFlow()` → `markAllAsRead()` |
| 依事件決定收件人 | 沒有路由，訂閱 `event-notification` 佇列 | `notification.worker.ts` 的 `setupNotificationWorker()`；每位收件人以 `enqueueDispatch()` 送一個工作 |
| 寫入一則通知 | 沒有路由 | workers 的 `notification.handler.ts`；API 行程的 `notification-effects.ts` 的 `createAndDispatch()` → `recordNotification()`。兩者都經過 `packages/core` 的 `createNotificationForActiveAgent()` |
| 升級的收件人 | 沒有路由 | `notification.service.ts` 的 `resolveEscalationRecipients()` |
| CSAT 低分的收件人 | 沒有路由 | `notification.service.ts` 的 `resolveCaseManagerRecipients()` |

`setupNotificationWorker()` 收到的是 BYPASSRLS 的 `app.prismaAdmin`，所以每個查詢都要自帶 `tenantId`。

## 一則通知怎麼送到

1. 業務模組發布事件，例如 `case.assigned`。事件送進通知訂閱者的佇列 `event-notification`，見[事件與背景工作](../../modules/EVENTS.md)。
2. `setupNotificationWorker()` 的處理函式決定收件人，每位收件人送一個工作進 `notification` queue。工作的 id 是 `<事件 id>__<成員 ID>`，所以同一個事件處理兩次時，同一位成員只收到一則通知。自動化動作的 id 是 `<事件 id>__<規則 id>#<序號>__<成員 id>`。新增收件人邏輯時沿用 `enqueueDispatch()`，不要自己送沒有 job id 的工作。這個去重只在 job 的保留期間有效：完成的 job 保留 24 小時，失敗的保留 7 天。
3. workers 行程的 `handleNotificationJob()` 寫入一筆 `Notification`。寫入失敗時，工作失敗並由 BullMQ 重試，共 3 次，指數退避，基準 5 秒。
4. workers 發布到 Redis 的 `socket:emit`，API 行程轉送 `notification.new` 到 `agent:<成員 ID>` 房間。推播失敗時只記 log，工作照常完成：通知已經寫入，成員重新整理後就看得到。
5. 前端收到後更新鈴鐺的未讀數。

每位收件人各有一筆通知紀錄。同一個事件通知五個人，就寫五筆。

站內通知是至少一次：workers 在寫入通知之後、工作標為完成之前停止時，BullMQ 重新執行這個工作，成員會收到兩則相同的通知。系統接受這個重複。

AI 額度告警的信不在訂閱者內直接寄出。訂閱者為每位管理員送一個工作進 `usage-alert-email` queue，工作的 id 是 `<事件 id>__<成員 ID>`，由 API 行程的 `usage-alert-email.worker.ts` 寄出。所以事件重送時不會重寄；寄送失敗時，BullMQ 重試，共 3 次。

系統信可選擇啟用 SMTP 至 Resend 備援：`EMAIL_DELIVERY_MODE=smtp`、`EMAIL_SMTP_FAILOVER=true`，並設定 `RESEND_API_KEY` 與 Resend 已驗證的 `EMAIL_FALLBACK_FROM`。Redis 以滑動 1 秒視窗協調跨實例並行數與每秒速率上限（預設 SMTP 並行 3、總速率 10/秒、批次速率 8/秒，保留即時系統信額度；Resend 並行 5、速率 2/秒；可透過環境變數調整），SMTP 故障後冷卻 60 秒（`EMAIL_FAILOVER_COOLDOWN_MS`）再由單一請求探測恢復。遇到 SES `454 Maximum sending rate exceeded` 節流會釋放租約並延遲重試，不誤開 Resend 電路；送出後若無法確認是否已收件，不以 Resend 重寄該封信。大量郵件與 Canvas 郵件走 `email-dispatch` 佇列（依 `EMAIL_BATCH_SIZE` 自動分批錯峰投遞，遇限流自動延後重排）。

**收件成員已被永久刪除或已停用時不寫入。** 每個寫入通知的地方（workers 的通知工作、API 的 `createAndDispatch()`）都用 `packages/core` 的 `createNotificationForActiveAgent()` 寫入：一條條件寫入（`INSERT … SELECT … FROM agents … FOR KEY SHARE`），只有收件成員同租戶、還在、仍啟用時才寫入。查完才被永久刪除的競爭也不會撞外鍵；在交易內也不會讓交易中止。成員不存在或 `isActive` 為 `false` 時，這則通知被略過：不寫入、不推送，寫一行 info log（「略過通知」），工作正常完成，不重試。成員重新啟用後，停用期間略過的通知不會補送。

新增寫入通知的地方，也要用 `createNotificationForActiveAgent()`。不要改成「先查成員，再 `notification.create`」：查完到寫入之間，成員可能被永久刪除。也不要 catch 外鍵錯誤 `P2003`：在交易內接住時，交易已經中止。

成員被永久刪除（`purgeAgent()`）時，他的通知先被刪除，因為通知以 RESTRICT 參照成員。新增掛在成員上的通知相關資料表，也要加進 `purgeAgent()`。

下列來源不經過上面的流程：

- **API 行程直接寫入的通知**：FB／IG 權杖失效、留言私訊健康告警、序號明細背景匯出都呼叫 `notification/notification-effects.ts` 的 `createAndDispatch()`。它在綁定租戶的交易內寫入（`app_tenant` 連線），commit 之後才推播到 `tenant:<租戶 id>:agent:<成員 id>`；交易 rollback 時通知與推播都作廢。這些寫入點沒有經過佇列，所以沒有重試，也沒有去重（HC-NOTIFICATIONS-09）。不要再新增這類寫入點。
- **CSAT 低分**：`csat.flow.ts` 的 `notifyCsatLowScoreFlow()` 在記分 commit 之後另開一個交易，呼叫 `createAndDispatch()` 寫入並在 commit 之後推播。送不出時，這個交易 rollback，再另開交易在工單時間軸寫一筆 `csat_low_score_notify_failed`，分數不受影響。
- **SLA 預警與逾時**：workers 的 `sla.handler.ts` 自己送進 queue，見[服務水準協議](../SLA.md)。

## 哪些事件通知誰

| 事件 | 通知類型 | 收件人 | 來源 |
| --- | --- | --- | --- |
| 客人傳訊息 | `new_message`，連到 `/dashboard/inbox?conv=<對話 id>` | 對話已指派、且負責人仍啟用並看得到該渠道時只通知負責人；未指派，或負責人已停用、看不到該渠道時，通知看得到該渠道的 `ADMIN` 與 `SUPERVISOR`（持有 `channel.view_all` 或被授權該渠道）。由 `getConversationRecipients()` 計算 | `message.received` |
| 機器人轉接真人（客人要求、自動轉真人、知識庫追問用完） | `conversation_handoff` | 對話已指派、且負責人仍啟用並看得到該渠道時只通知負責人；未指派，或負責人已停用、看不到該渠道時，通知看得到該渠道的 `ADMIN` 與 `SUPERVISOR`（持有 `channel.view_all` 或被授權該渠道）。內容含聯絡人名稱與轉接原因 | `conversation.handoff` |
| 工單被指派 | `case_assigned`，連到 `/dashboard/cases/:id` | 被指派的成員 | `case.assigned` |
| 工單升級 | `case_escalated` | 依 `notifyTargets`（升級對話框的勾選）：含 `supervisor` 時通知所有啟用中的 `ADMIN` 與 `SUPERVISOR`；含 `original_assignee` 時通知升級前的負責人。沒有帶 `notifyTargets` 時只通知主管；送 `[]` 時沒有人收到。升級的人自己一律不收。升級時改派的新負責人不收到通知（HC-NOTIFICATIONS-03）。見[工單](./CASES.md#升級) | `case.escalated` |
| CSAT 兩分以下 | `csat_low_score` | 有效權限（角色權限 ∩ 方案天花板）含 `case.assign`、啟用中、看得到工單渠道的成員，含管理員；不看舊的角色列舉（`resolveCaseManagerRecipients()`）。預設的客服角色也有 `case.assign`。連結是 `/dashboard/cases?id=<工單 id>`，但工單列表頁不讀 `id`，點了停在列表（HC-NOTIFICATIONS-05） | `recordCsatScoreFlow()` → `notifyCsatLowScoreFlow()` |
| SLA 預警與逾時 | `sla_warning`、`sla_breached`、`first_response_warning`、`first_response_breached`、`customer_waiting_breached` | 負責人；逾時再加上所有 `ADMIN` 與 `SUPERVISOR`。見[服務水準協議](../SLA.md) | workers 的 `sla.handler.ts`，直接以 `enqueueNotification()` 送進 queue |
| AI 額度達 80% 或 100% | `usage_quota_warning`、`usage_quota_critical`，連到 `/dashboard/plan` | 所有啟用中的 `ADMIN`，另外寄 email | `usage.quota.threshold`，見[AI 額度告警](#ai-額度告警) |
| 自動化規則的「傳送通知」 | `sla_rule` | 依序找第一個啟用中的成員：動作指定的客服、工單負責人、對話負責人。都沒有時，通知所有 `ADMIN` 與 `SUPERVISOR`。見[自動化](./AUTOMATION.md#哪些動作會執行) | workers 的 `automation-actions.ts` |
| 自動化規則的「通知主管」 | `sla_rule` | 所有啟用中的 `ADMIN` 與 `SUPERVISOR`。只有觸發帶工單時才有連結；沒有工單的觸發（例如關鍵字）沒有連結（HC-NOTIFICATIONS-08） | workers 的 `automation-actions.ts` |
| FB、IG 權杖失效 | `channel_token_invalid`，連到 `/dashboard/settings/channels` | 該租戶所有啟用中的 `ADMIN`，另外寄 email。持續失效時每 3 天再提醒一次 | API 行程的 `meta-token-health.ts` 排程每 6 小時檢查一次，以 `createAndDispatch()` 寫入，以 `sendEmail()` 寄信，見[渠道管理](./CHANNELS.md) |
| 資料匯出完成或失敗 | `data_export_ready`、`data_export_failed` | 發起匯出的成員。連結指向不存在的頁面（EXPORT-01） | workers 的 `data-export.handler.ts`，以 `enqueueNotification()` 寫入 |
| 資料刪除完成 | `data_erasure_done`，沒有連結 | 發起刪除請求的成員；發起人已被永久刪除時不送 | workers 的 `data-erasure.handler.ts` |

除了 CSAT 低分，「主管」「管理員」都以 `Agent.role` 這個舊的三級列舉判斷，不看「角色與權限」頁設定的細粒度角色，見 `../../system/AUDIT.md` 的 RBAC-03。看舊列舉的地方有六個：未指派對話的新訊息與轉接、升級、SLA 逾時、自動化的兩個通知動作、AI 額度告警、權杖失效。改成看權限時，六個地方要一起改，可以沿用 `resolveCaseManagerRecipients()`。渠道可見範圍只影響新訊息與轉接通知的收件人。

改 `case.assigned`、`case.escalated`、`message.received`、`usage.quota.threshold` 的 payload 欄位之前，先看 `notification.worker.ts` 讀了哪些欄位。

要知道的事：

- **未指派對話的每一則訊息都通知全部主管。** 機器人負責的對話也一樣。客人連傳十則，每位看得到該渠道的 `ADMIN` 與 `SUPERVISOR` 各收到十筆通知。
- **指派對話不會通知。** 通知模組訂閱了 `conversation.assigned`，但 API 行程沒有任何地方發布這個事件，見 `../../system/AUDIT.md` 的 CONV-02。
- **建立工單時直接指定負責人不會通知。** 只有 `POST /cases/:id/assign` 與自動指派發布 `case.assigned`（HC-NOTIFICATIONS-04），見[工單](./CASES.md#指派)。
- **升級的 API 接受 `notifyTargets: 'team'`，但沒有人收到。** `case.routes.ts` 的 Zod 接受 `supervisor`、`original_assignee`、`team` 三個值，收件人計算不處理 `team`（HC-NOTIFICATIONS-12）。要收緊這個列舉之前，先確認沒有呼叫端送 `team`，否則那個呼叫端會收到 400。
- **負責人已停用時，工單指派與 SLA 預警沒有人收到。** 這兩種通知的收件人是負責人本人，收件人計算不會改發主管；寫入前的檢查略過停用的負責人。對話的新訊息與轉接通知不受影響，負責人停用時改通知主管。見 `../../system/AUDIT.md` 的 CONV-06。
- **SLA 的兩個訂閱者不會觸發。** 通知模組也訂閱了 `sla.warning` 與 `sla.breached`，但這兩個事件在 API 行程沒有發布端，SLA 通知實際由 workers 直接送出，見 `../../system/AUDIT.md` 的 APP-05。

## AI 額度告警

`llm.flow.ts` 在記錄 AI 用量、累加 Redis 的月計數之後，判斷這次用量是否跨過 80% 或 100%。跨過的門檻以 Redis `SET NX` 認領旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`，每個月每個門檻只發一次 `usage.quota.threshold`，事件經 outbox 送出。

- `USAGE_QUOTA_ALERTS_ENABLED` 不是 `1` 時不發告警。
- 換方案或核准加購時，月額度提高才清除旗標；額度沒有提高時不清除。
- 租戶自帶金鑰（BYOK）的用量不計入額度。
- 告警不能擋住 AI 回覆：每一步失敗只寫 log，回覆最多多等一個 Redis 指令的逾時（1 秒）。
- 告警信一定經 `usage-alert-email` 佇列寄出，不在訂閱者內直接寄。寄信的模式由 `EMAIL_DELIVERY_MODE` 決定（`apps/api/src/modules/email/email.service.ts`）。
- 告警信與權杖失效信裡的使用者輸入（租戶名稱、渠道名稱）要經過 HTML 轉義。

## 讀取與保留

| 端點 | 作用 |
| --- | --- |
| `GET /notifications` | 列出自己的通知，可以用 `isRead` 篩選，新的在前 |
| `GET /notifications/unread-count` | 自己的未讀數 |
| `PATCH /notifications/:id/read` | 標記一筆為已讀，寫入 `isRead` 與 `readAt` |
| `POST /notifications/read-all` | 全部標記為已讀 |

每個成員只看得到自己的通知（以 `agentId` 與 `tenantId` 篩選）。路由只驗登入，不需要權限碼。標記別人的通知為已讀回 404。

查詢參數的檢查：`isRead` 只接受 `true`、`false`；`page` 是正整數；`limit` 是 1～100 的整數，預設 20；`:id` 必須是 UUID。不符時回 400。

通知沒有保留期限，也沒有清除排程。只有成員被清除（`agent.service.ts` 的 `purgeAgent()`）時，他的通知才會一起刪除。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| Topbar 的鈴鐺（`NotificationBell.tsx`）未讀數 | `GET /notifications/unread-count` | 每 60 秒輪詢。收到 socket `notification.new` 時立即重抓 |
| 點鈴鐺，打開下拉 | `GET /notifications?page=1&limit=10` | |
| 點一則通知（鈴鐺下拉或通知列表） | 未讀時 `PATCH /notifications/:id/read`，再 `router.push(clickUrl)` | 標記已讀失敗時畫面沒有提示，也不跳頁（HC-NOTIFICATIONS-07） |
| 側欄「客服工作 → 通知」`/dashboard/notifications` | `GET /notifications?isRead=true|false&page&limit=20` | 分頁「全部／未讀／已讀」。「全部」不送 `isRead` |
| 列表卡片右側的雙勾 | `PATCH /notifications/:id/read` | 不跳頁 |
| 列表 Topbar 或鈴鐺下拉的「全部已讀」 | `POST /notifications/read-all` | 只改自己的未讀。列表頁的按鈕沒有未讀時也顯示。失敗時畫面沒有提示（HC-NOTIFICATIONS-07） |

即時推播的路徑：workers 寫入之後呼叫 `publishSocketEvent`，發布到 Redis 的 `socket:emit`。`apps/api/src/plugins/socket.plugin.ts` 訂閱這個頻道，轉送到 `agent:<成員 ID>` 房間。前端 `useNotifications.ts` 監聽 `notification.new`，重抓列表與未讀數。推播是盡力而為，60 秒的輪詢會補上。

通知類型的顯示方式有兩份表，兩份都叫 `TYPE_CONFIG`：列表頁 `page.tsx` 的表有名稱與圖示，鈴鐺 `NotificationBell.tsx` 的表只有圖示。新增類型時兩份要一起改。表裡沒有的類型顯示成「通知」。`csat_low_score`、`usage_quota_warning`、`usage_quota_critical`、`channel_token_invalid`、`data_export_ready`、`data_export_failed`、`data_erasure_done` 不在列表頁的表裡（HC-NOTIFICATIONS-06）。

升級對話框（`apps/web/src/components/case/EscalationModal.tsx`）的 `notifyTargets` 是 `['supervisor', 'original_assignee']` 的子集，兩個都不勾時送 `[]`。

下列功能前端與後端都沒有：通知偏好與靜音、刪除通知、保留期限、Web Push、工單事件寄信。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **指派對話不會通知被指派的人** | 詳見 `../../system/AUDIT.md` 的 CONV-02 |
| 收件人看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| API 行程的 SLA 訂閱永遠不會觸發 | 詳見 `../../system/AUDIT.md` 的 APP-05 |
| 未指派對話的訊息通知沒有彙整 | 每則訊息對每位主管各寫一筆通知 |
| 通知沒有保留期限 | 資料持續累積 |
| 只有 AI 額度告警與權杖失效寄信 | 其他通知只在後台顯示，成員不在後台時收不到 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
