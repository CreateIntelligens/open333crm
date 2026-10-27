# 事件與背景工作

本文件說明模組之間不直接呼叫時，靠哪些通道傳遞：業務事件怎麼發布與訂閱、事件怎麼保證送達、哪些工作送到 `apps/workers` 執行、workers 怎麼把結果送回 API 與前端，以及 API 行程內有哪些定期排程。每個背景工作屬於哪個模組，見[模組總覽](./OVERVIEW.md#背景工作的歸屬)；選擇直接推送或走佇列的規則，見 [AGENTS.md 的 Socket 事件路由一節](../../../AGENTS.md#architecture-socket-event-routing-critical)。

- **資料來源**：`apps/api/src/events/`、`apps/api/src/lib/tenant-ctx.ts`、`apps/api/src/plugins/socket.plugin.ts`、`apps/api/src/modules/*/*.worker.ts`、`apps/api/src/modules/*/*.scheduler.ts`、`apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts`、`apps/api/src/index.ts`、`apps/workers/src/index.ts`、`apps/workers/src/lib/socket-bridge.ts`、`apps/workers/src/lib/notification-queue.ts`、`packages/core/src/outbox/`、`packages/core/src/event-bus/event-bus.ts`、`packages/core/src/canvas/*`
- **核對日期**：2026-10-21

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 系統有哪些傳遞通道？各自跨哪些行程？ | [先讀這一段](#先讀這一段) |
| 某個業務事件由誰發布、誰訂閱？ | [業務事件](#業務事件) |
| 事件會不會遺失？會不會處理兩次？ | [送達保證：outbox 與認領](#送達保證outbox-與認領) |
| Canvas 的事件為什麼不在 eventBus 上？ | [Canvas 的事件](#canvas-的事件) |
| 有哪些佇列？誰消費？完成的工作會保留多久？ | [BullMQ 佇列](#bullmq-佇列) |
| workers 怎麼推送即時事件、怎麼發出業務事件？ | [從 workers 回到 API](#從-workers-回到-api) |
| API 行程內有哪些定期排程？ | [API 行程內的排程](#api-行程內的排程) |
| 工作失敗時會重試嗎？API 重啟時會遺失什麼？ | [失敗與重試](#失敗與重試) |
| 怎麼查看失敗的工作？誰會收到告警？ | [監控與告警](#監控與告警) |
| 可以同時跑多個 API 行程嗎？ | [只能跑一個 API 行程](#只能跑一個-api-行程) |
| 新增一個事件或背景工作時，要選哪個通道？ | [新增事件或背景工作時](#新增事件或背景工作時) |
| 目前有哪些已知問題？ | [目前的限制](#目前的限制) |

## 先讀這一段

系統有兩個長駐行程：API 行程（`apps/api`）與 workers 行程（`apps/workers`）。兩者不共用記憶體，只透過 Redis 與資料庫溝通。

業務事件有三個訂閱者：通知、自動化與對外 Webhook。每個訂閱者有自己的 BullMQ 佇列，Worker 在 API 行程內。事件有兩種發出方式：

- **`ctx.publish()`**（`inTenant()`、`tenantHandler()` 的交易內）：事件寫進 `outbox` 資料表，與業務資料一起 commit；commit 之後送進訂閱者佇列。行程在送出之前結束時，補送排程會補送。保證是**至少一次**。
- **`eventBus.publish()`**（還沒搬遷的舊程式）：直接送進訂閱者佇列，不寫 outbox。行程在送出之前結束時，事件遺失。保證是**最多一次**。

因為事件可能送兩次，訂閱者與 workers 的規則動作都要承受重複。對客人發訊息等不能重複的副作用，執行前先寫一筆認領紀錄（`side_effect_claims`）。

模組之間的間接傳遞走下列通道：

| 通道 | 實作 | 方向 | 會不會持久化 |
| --- | --- | --- | --- |
| outbox | `outbox` 資料表，`packages/core/src/outbox/` | API 或 workers 的交易，到訂閱者佇列 | 會。資料列與業務資料一起 commit，送出後保留 7 天 |
| 訂閱者佇列 | BullMQ：`event-notification`、`event-automation`、`event-webhook` | 到 API 行程的訂閱者 Worker | 會。job 存在 Redis，直到被處理 |
| eventBus | `apps/api/src/events/event-bus.ts` | API 行程內，直接送進訂閱者佇列 | 不會。送進佇列之前行程結束時，事件遺失 |
| `crm:events` | `packages/core` 的 `EventBus`，Redis pub/sub | 發布者到所有訂閱的行程。目前只有 Canvas 使用 | 不會。發布當下沒有訂閱者就遺失 |
| 其他 BullMQ 佇列 | Redis | API 行程到 workers；workers 也會送工作給自己 | 會 |
| `socket:emit` | Redis pub/sub | workers 到 API 行程，再推給前端 | 不會 |

另外還有兩種定期工作：API 行程內以 BullMQ Job Scheduler 觸發的排程，以及 workers 行程以 BullMQ 重複工作執行的排程。

名稱容易誤導的地方：API 裡的 `setupNotificationWorker()`、`setupAutomationWorker()` 雖然叫 worker，實際上回傳訂閱者佇列的處理函式，由 `apps/api/src/events/subscriber-workers.ts` 建立的 Worker 呼叫。見 `../system/AUDIT.md` 的 APP-04。

## 業務事件

事件名稱列在 `packages/core/src/outbox/events.ts` 的 `APP_EVENT_NAMES`，`apps/api/src/events/event-bus.ts` 的 `AppEventName` 由它而來。

```ts
// 交易內：寫 outbox，至少一次
await ctx.publish('case.created', { caseId });
// 舊寫法：直接送進訂閱者佇列，最多一次
eventBus.publish({ name: 'case.created', tenantId, timestamp: new Date(), payload: { caseId } });
```

兩種寫法都產生一個事件 id，並以事件 id 當訂閱者 job 的 id。`eventBus.publish()` 仍在行程內 emit，只讓測試以 `subscribe()` 觀察發出的事件；正式程式不以 `subscribe()` 處理事件。

訂閱者：

| 訂閱者 | 佇列 | 處理函式 | 做什麼 |
| --- | --- | --- | --- |
| 通知 | `event-notification` | `notification.worker.ts` 的 `setupNotificationWorker()` | 決定收件人，送 `notification:dispatch` job，job id 是 `<事件 id>__<客服人員 id>`。用量告警信另送 `usage-alert-email` job |
| 自動化 | `event-automation` | `automation.worker.ts` 的 `setupAutomationWorker()` | 送 `automation:evaluate` job，job id 是事件 id。`message.received` 另外做自動轉接、AI 回覆與情緒分析，見[收件匣與對話](../features/tenant/INBOX.md) |
| 對外 Webhook | `event-webhook` | `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()` | 對外事件清單內的事件，為每個訂閱網址送一個 `webhook-delivery` job |

各訂閱者訂閱哪些事件，列在 `packages/core/src/outbox/queues.ts` 的 `EVENT_SUBSCRIBERS`。對外事件清單是同一個目錄的 `EXTERNAL_EVENT_NAMES`，第一版等於所有事件名稱，見 `../system/AUDIT.md` 的 HOOK-01。

各事件的發布端與訂閱端（2026-10-21 的快照；對外 Webhook 收到清單內的所有事件，下表不重複列出）：

| 事件 | 發布端 | 訂閱端 |
| --- | --- | --- |
| `message.received` | `webhook/inbound-side-effects.ts`、`channels/simulator/simulator.service.ts` | 通知、自動化 |
| `message.sent` | `conversation.service.ts` | 無 |
| `conversation.created` | `webhook/inbound-conversation-resolver.ts`、`chatbox.service.ts`、`simulator.service.ts` | 自動化 |
| `conversation.updated` | `conversation.service.ts` | 無 |
| `conversation.assigned` | **無** | 通知。見 CONV-02 |
| `conversation.closed` | `conversation.service.ts` | 無 |
| `conversation.handoff` | `automation.worker.ts`（outbox）、`webhook/inbound-postback-interceptors.ts` | 無 |
| `case.created` | `case.service.ts`；workers 的 `create_case`（outbox） | 自動化 |
| `case.updated` | **無** | 無 |
| `case.assigned` | `case.service.ts`、`assignment.service.ts` | 通知 |
| `case.escalated` | `case.service.ts` | 通知、自動化 |
| `case.resolved` | `case.service.ts` | 無 |
| `case.closed` | `case.service.ts`、`csat.service.ts`、`csat.scheduler.ts` | 無 |
| `contact.created` | `webhook/inbound-contact-resolver.ts` | 自動化 |
| `contact.updated` | **無** | 無 |
| `contact.tagged` | `tagging.service.ts`；workers 的 `add_tag`（outbox） | 自動化 |
| `keyword.matched` | workers 的 `automation.handler.ts`（outbox） | 無。關鍵字規則由 workers 處理 `message.received` 時直接比對 |
| `sentiment.negative` | `automation.worker.ts`（outbox） | 無 |
| `sla.warning`、`sla.breached` | **無** | 通知。見 APP-05 |
| `portal.activity.submitted` | `portal.service.ts` | 自動化 |
| `link.clicked` | `shortlink.service.ts` | 自動化 |
| `usage.quota.threshold` | `ai/llm.service.ts` | 通知 |

標「outbox」的發布端已經是至少一次，其他發布端仍用 `eventBus.publish()`。「無」發布端的事件，訂閱者永遠不會執行；自動化規則若以這些事件觸發，也永遠不會生效，見 `../system/AUDIT.md` 的 AUTO-05。

## 送達保證：outbox 與認領

### outbox 的送出流程

1. 交易內的 `ctx.publish()`、`ctx.enqueue()`，或 workers 交易內的 `writeOutbox()`，寫入一筆 `outbox`。`outbox` 的 id 就是事件 id，也是 BullMQ 的 job id。
2. 交易 commit 之後，快路徑（`dispatchOutboxRows()`）為每個訂閱者建立 job，再標記已送出。API 端以綁定租戶的短交易標記，workers 以 admin 連線標記。快路徑失敗只寫 log。
3. `outbox-relay` 排程每 60 秒補送建立超過 2 分鐘、還沒標記已送出的資料列，每次最多 500 筆。
4. 快路徑與補送同時送出時，BullMQ 以 job id 擋住重複的 job。訂閱者佇列保留完成的 job 24 小時、失敗的 job 7 天，這段時間內同一個事件 id 不會再建立 job。
5. `outbox-cleanup` 排程每天刪除已送出超過 7 天的資料列。未送出的資料列不刪。

`ctx.enqueue(queueName, name, data, opts)` 寫入的 job 也走同一條路，送到 `queueName` 的佇列。`opts` 只接受 `attempts`、`backoff`、`delay`、`priority`、`removeOnComplete`、`removeOnFail`，其他選項丟錯。`jobId`、`deduplication`、`debounce`、`repeat` 這類選項會讓 BullMQ 不建立這個 job，或不用 outbox id 當 job id。送出時，佇列回傳的 job id 不等於 outbox id，這一列就不標記已送出，留給補送排程。

### 副作用的認領紀錄

不能重複的副作用，執行前在交易內寫一筆 `side_effect_claims`。唯一鍵是 `(kind, sourceId, subKey)`，撞到唯一鍵時認領失敗，副作用不執行。寫入用 `INSERT … ON CONFLICT DO NOTHING`，所以認領失敗不會讓交易失效。認領紀錄保存 30 天，由 `outbox-cleanup` 刪除。

去重有期限：以 job id 去重，只在佇列保留這個 job 的期間有效（完成的 job 保留 24 小時）；以認領紀錄去重，只在 30 天內有效。超過期限之後同一個事件再送一次，沒有認領的處理會再做一次。

| kind | sourceId | subKey | 保護的副作用 |
| --- | --- | --- | --- |
| `bot_reply` | 入站訊息 id | 空字串 | agent 回覆、KB 自動回覆、自動轉接的轉接訊息：每則入站訊息最多一則機器人回覆 |
| `automation_action` | 觸發事件 id | `<規則 id>#<動作序號>` | workers 的每個規則動作。SLA 排程沒有事件 id，不認領 |
| `sentiment` | 入站訊息 id | 空字串 | 情緒分析的結果與 `sentiment.negative` |
| `keyword_matched` | 入站訊息 id | 規則 id | 給對外 Webhook 的 `keyword.matched` |

系統呼叫 LLM 之前，先查這則訊息有沒有認領紀錄。已有紀錄時，系統不呼叫 LLM。這個檢查只為了省費用；兩次處理同時通過檢查時，交易內的認領仍只讓一次成功。

認領成功之後，送出失敗或行程中斷時，認領紀錄不還原。所以這些副作用是最多一次：寧可少送一則，也不重複送。

認領 commit 之前的失敗要讓 job 失敗，由佇列重試，不能只記 log：

- 認領、寫入結果或寫入 outbox 的交易失敗。沒有 commit 就沒有認領紀錄，也沒有 outbox，只有佇列的重試能補做。API 的機器人回覆以 `ClaimTransactionError`（`bot-reply-guard.ts`）標示這種失敗。降級用的 catch（例如「agent 失敗改由 KB 回覆」）遇到這個錯誤時，會往外丟，不會吞掉。
- 把下一步的 job 送進佇列失敗，例如規則評估、站內通知、告警信。

刻意的降級不算失敗：LLM 失敗時改由 KB 回覆、KB 找不到答案、情緒分析的 LLM 失敗時改用關鍵字判斷，照舊只記 log。`message.received` 的每個步驟都會執行，處理結束時，再丟出失敗步驟的錯誤。重試時，已完成的步驟都已認領，會略過。轉接失敗時，這次不做 AI 回覆，因為 AI 回覆會先認領 `bot_reply`，重試時轉接就認領不到。

對話轉接以條件更新認領對話（`BOT_HANDLED` 改成 `AGENT_HANDLED`），不另外寫認領紀錄。

## Canvas 的事件

Canvas 的流程引擎在 `packages/core`，無法 import API 的 eventBus，因此另有一套事件通道：`packages/core/src/event-bus/event-bus.ts` 的 `EventBus`。它以 Redis pub/sub 的 `crm:events` 頻道傳遞，**與 API 的 eventBus 是兩個不相通的系統**，事件名稱欄位也不同（`type` 而不是 `name`）。這個通道沒有改走 outbox，保證仍是最多一次。

| 事件 | 發布端 | 訂閱端 |
| --- | --- | --- |
| `canvas.send_message` | `FlowRunner` 的 `MESSAGE` 節點 | API 行程的 `canvas.worker.ts`，發送訊息或寄信 |
| `canvas.action` | `FlowRunner` 的 `ACTION` 節點 | 同上，目前只處理 `add_tag` |
| `flow.completed` | `FlowRunner` 流程結束時 | 無 |

`packages/core` 裡另有 `InboxService` 也發布到這個頻道，但它在 `apps/*` 沒有呼叫端，見 `../system/AUDIT.md` 的 PKG-05。

Redis pub/sub 會把一則訊息送給每一個訂閱的連線。因此有幾個 API 行程在跑，每則 `canvas.send_message` 就會被發送幾次，見[只能跑一個 API 行程](#只能跑一個-api-行程)。

## BullMQ 佇列

由 API 行程消費的佇列：

| 佇列 | 生產者 | 消費者 | 重試 | 完成與失敗的工作保留多久 |
| --- | --- | --- | --- | --- |
| `event-notification`、`event-automation`、`event-webhook` | outbox 的快路徑與補送、`eventBus.publish()` | `apps/api/src/events/subscriber-workers.ts` 建立的 Worker | 共 3 次，指數退避，基準 5 秒 | 完成 24 小時、失敗 7 天 |
| `webhook-delivery` | 對外 Webhook 訂閱者 | `webhook-dispatcher.ts` 的 `processWebhookDelivery()` | 共 3 次，間隔 1 秒、5 秒 | 完成 24 小時、失敗 7 天 |
| `usage-alert-email` | 通知訂閱者 | `usage-alert-email.worker.ts` | 共 3 次，指數退避，基準 5 秒 | 完成 24 小時、失敗 7 天 |
| `api-scheduler` | `job-scheduler.ts` | 同一個檔案的 Worker | 不重試 | 完成 100 筆、失敗 50 筆 |
| `ops-alert` | `ops-alert.service.ts` 的 `sendOpsAlert()` | `ops-alert.worker.ts` | 共 3 次，指數退避，基準 5 秒 | 完成 24 小時、失敗 7 天 |

前 3 列的 Worker 每個同時處理多個 job，所以一個事件處理很久時，其他事件不用等。每個佇列的並行數見 `subscriber-workers.ts` 的 `WORKER_CONCURRENCY`。

由 `apps/workers` 消費的佇列（`apps/workers/src/handlers/`）：

| 佇列 | 生產者 | 消費者 | 完成與失敗的工作保留多久 |
| --- | --- | --- | --- |
| `notification` | API 的 `notification.worker.ts`；workers 的 `lib/notification-queue.ts` | `notification.handler.ts`。重試共 3 次，指數退避，基準 5 秒 | 完成 24 小時、失敗 7 天 |
| `automation` | API 的 `automation.worker.ts` | `automation.handler.ts`。重試共 3 次，指數退避，基準 5 秒 | 完成 24 小時、失敗 7 天 |
| `rich-menu-bind` | API 的 `rich-menu.service.ts` | `rich-menu-bind.handler.ts` | 完成 24 小時、失敗 7 天 |
| `data-export` | API 的 `data-export.service.ts` | `data-export.handler.ts` | 完成 24 小時、失敗 7 天 |
| `data-erasure` | API 的 `data-erasure.service.ts` | `data-erasure.handler.ts` | 完成保留 100 筆、失敗保留 50 筆 |
| `sla` | workers 啟動時註冊重複工作，每 5 分鐘 | `sla.handler.ts` | 完成 24 小時、失敗 7 天 |
| `data-export-cleanup` | workers 啟動時註冊重複工作，每小時 | `data-export.handler.ts` | 完成 24 小時、失敗 7 天 |
| `tag-expiry-cleanup` | workers 啟動時註冊重複工作，每小時 | `tag-expiry.handler.ts` | 完成 24 小時、失敗 7 天 |
| `agent-retention-cleanup` | workers 啟動時註冊重複工作，每小時 | `agent-retention.handler.ts` | 完成 24 小時、失敗 7 天 |

以事件 id 當 job id 的佇列，保留期限就是去重的期限，所以以時間計算，不以筆數計算。

重複工作列在 `apps/workers/src/lib/repeating-jobs.ts`。已排定的重複工作會延續註冊時的選項，所以 workers 每次啟動時，先刪除這 4 個佇列既有的重複工作，再以目前的選項重新註冊。刪除與重新註冊之間 workers 停止時，那一期會少執行一次，下次啟動時恢復。

`data-export`、`data-erasure` 的 worker 開頭以條件更新認領 `pending` 或 `processing` 的請求。`processing` 代表上一次執行中途結束，worker 重新處理；已結束的請求直接略過。

下列佇列有生產者、沒有消費者：

| 佇列 | 生產者 | 說明 |
| --- | --- | --- |
| `flow:resume` | `packages/core/src/canvas/scheduler.ts` 的 `scheduleWaitNode()` | 佇列名稱含冒號，BullMQ 建立佇列時直接拋出錯誤，所以從未成功送出；Canvas 實際靠資料庫輪詢喚醒。見 APP-07 |
| `broadcast` | 舊版的 workers | 已不再使用。workers 啟動時清掉殘留的重複工作 |

workers 以 `DATABASE_URL_ADMIN` 連線資料庫，這是 BYPASSRLS 的連線，因為一個 worker 要處理所有租戶的工作。租戶隔離由各 handler 的查詢條件負責；寫入 outbox 與認領紀錄時，明確帶入租戶 ID。

## 從 workers 回到 API

workers 行程沒有 socket 連線。即時事件透過 Redis 轉給 API 行程：

| 函式 | Redis 頻道 | API 端的接收者 | 用途 |
| --- | --- | --- | --- |
| `publishSocketEvent()`（`apps/workers/src/lib/socket-bridge.ts`） | `socket:emit` | `socket.plugin.ts`，轉成 `io.to(room).emit()` | 通知、渠道送達狀態、自動化與 SLA 造成的工單更新。可以指定 `namespace` |

workers 產生的業務事件（`create_case` 的 `case.created`、`add_tag` 的 `contact.tagged`、關鍵字規則的 `keyword.matched`）在寫入業務資料的同一個交易寫進 outbox，commit 之後以快路徑送進訂閱者佇列。API 沒有在執行時，job 留在佇列，或資料列留在 outbox，等 API 啟動後處理。

自動化可以連鎖：規則 A 在 workers 貼標，產生 `contact.tagged`，再觸發規則 B。自動化訂閱者略過 `source` 是 `automation` 的 `contact.tagged`，避免無限迴圈。

舊的 `domain:event` 頻道已移除，所以 API 與 workers 要一起部署：只部署 API 時，舊 workers 發到 `domain:event` 的事件沒有人接收。

## API 行程內的排程

這些排程在 `apps/api/src/index.ts` 啟動，跑在 API 行程內。各模組以 `registerSchedule()`（`apps/api/src/lib/job-scheduler.ts`）註冊，由 BullMQ Job Scheduler 觸發，queue 名稱是 `api-scheduler`：

| 排程 id | 註冊函式 | 所屬模組 | 頻率 | 做什麼 |
| --- | --- | --- | --- | --- |
| `broadcast-scheduled` | `setupBroadcastScheduler()` | `marketing` | 每 60 秒 | 執行到期的排程群發，每次最多 10 筆 |
| `csat-send` | `setupCsatScheduler()` | `csat` | 每 60 秒 | 發送滿意度調查 |
| `csat-auto-close` | `setupCsatScheduler()` | `csat` | 每 60 秒 | 逾時沒有回覆的工單自動結案 |
| `canvas-resume` | `setupCanvasScheduler()` | `canvas` | 每 60 秒 | 喚醒 `resumeAt` 已到期的 `WAITING` 流程 |
| `outbox-relay` | `setupOutboxSchedulers()` | `outbox` | 每 60 秒 | 補送建立超過 2 分鐘、還沒送出的 outbox 資料列 |
| `inactivity-close` | `setupInactivityCloseWorker()` | `conversation` | 每 5 分鐘 | 關閉閒置過久的對話 |
| `trial-lifecycle` | `setupTrialScheduler()` | `trial` | 每小時 | 試用到期的提醒、停用與軟刪 |
| `meta-token-health` | `setupMetaTokenHealthScheduler()` | `channel` | 每 6 小時 | 檢查 FB、IG 渠道的權杖，失效時通知租戶管理員 |
| `analytics-daily` | `setupAnalyticsScheduler()` | `analytics` | 每天 02:00（行程所在時區） | 把前一天的彙總寫入 `DailyStat` |
| `outbox-cleanup` | `setupOutboxSchedulers()` | `outbox` | 每天 03:30（行程所在時區） | 刪除已送出超過 7 天的 outbox 與建立超過 30 天的認領紀錄 |

`startA2ABridgeWorker()`（`settings`）也跑在 API 行程，但它是常駐輪詢 A2A Hub，不是排程，由 `A2A_BRIDGE_ENABLED` 控制。

Job Scheduler 的行為：

- 排程的定義存在 Redis。不論有幾個 API 行程，每一期只產生一筆 job。正常情況下，這筆 job 由一個行程執行一次。
- 同一筆 job 可能執行不只一次：執行中的行程被強制結束時，BullMQ 會重新執行這筆 job（見下一項）。所以 `run` 要承受重跑：寄信、發通知或改狀態之前，先以條件更新認領這一筆資料，重跑時就不會重複處理。
- 第一次註冊時，每隔固定時間的排程立刻執行一次；每天固定時間的排程等到下一個時間點。之後 API 重啟時再註冊，下次執行時間不變，所以重啟不會觸發額外的執行。
- Redis 斷線期間，排程停止執行。Redis 恢復後，到期的那一期補跑一次，更早錯過的期數不補。
- 部署時，API 收到 SIGTERM 後等執行中的 job 跑完；Docker 等 10 秒後強制結束。被強制結束的 job，由新的行程重新執行。用 BullMQ 的預設設定（`lockDuration` 30 秒、`stalledInterval` 30 秒）實測，約 60 秒後重新執行；改了這兩個設定，時間也會不同。

Job Scheduler 不保證同一個排程的兩次執行不重疊。BullMQ 在取走這一期的 job 時就產生下一期，所以一期跑得比週期久時，下一期可能在這一期跑完前開始。可能跑得比週期久的排程，註冊時設定 `withoutOverlapping`，目前有 `canvas-resume`、`trial-lifecycle` 與 `outbox-relay` 設定。`withoutOverlapping` 只在鎖有效期間防止兩期重疊：job 結束時釋放鎖；行程停掉或執行超過存活時間時，鎖到期失效，下一期就能開始。它也不防止被強制結束的 job 重跑，所以設定了鎖的排程，`run` 仍要以條件更新認領資料。`outbox-relay` 重跑時，以 job id 去重。其他排程避免重複處理，靠的是資料庫的條件更新，例如群發以條件更新把狀態改成 `sending`。

## 失敗與重試

| 通道 | 失敗時 | API 或 workers 重啟時 |
| --- | --- | --- |
| outbox（`ctx.publish()`、workers 的交易） | 快路徑失敗時寫 log，由 `outbox-relay` 補送 | 還沒送出的資料列由 `outbox-relay` 補送 |
| `eventBus.publish()` | 送進佇列失敗時寫 log，事件遺失 | 還沒送進佇列的事件遺失 |
| 訂閱者佇列 | 處理函式丟錯時，BullMQ 重試該訂閱者的 job，其他訂閱者不受影響 | job 留在 Redis，重啟後繼續處理 |
| `crm:events` | 寫 log，不重試 | 沒有訂閱者時發布的事件遺失 |
| 其他 BullMQ 工作 | 沒有設定 `attempts` 的佇列，失敗一次就標為 failed，不重試 | 工作留在 Redis，重啟後繼續處理 |
| `socket:emit` | API 端解析失敗時寫 log 並丟棄 | API 沒在跑時發布的訊息遺失 |
| 對外 Webhook | `webhook-delivery` job 每次送一次 HTTP，失敗時由 BullMQ 重試 | 重試排在 Redis，重啟後繼續 |
| API 行程內的排程 | 下一輪再試 | 下一輪再試 |

通知與自動化訂閱者的處理函式多數在內部捕捉錯誤並寫 log，所以失敗不會觸發重試。會丟錯而重試的有 `event-webhook`、`webhook-delivery` 與 `usage-alert-email`。

BullMQ 重複工作（`sla` 等）的 handler 在內部捕捉錯誤，所以失敗的一輪也記為完成。

`notification:dispatch` 寫入通知失敗時，job 失敗並重試。通知是至少一次：workers 在寫入通知之後、job 標為完成之前停止時，重試會再寫一筆相同的通知。寫入之後的推播失敗只記 log，job 照常完成。

### 監控與告警

平台管理員從平台後台的「佇列監控」開啟 bull-board，看兩個行程所有佇列的工作與失敗原因，並可以重送單一個 failed 的工作。存取限制與操作範圍見 [佇列監控](../features/platform/QUEUE-MONITORING.md)。

任何佇列（`ops-alert` 除外）的工作移到 failed set 時，API 以 `sendOpsAlert()` 發出一則告警，合併鍵是 `queue-failed:<佇列名稱>`：

- 還會重試的失敗不告警。重試用完、或工作丟出 `UnrecoverableError`，才算移到 failed set。
- 同一個合併鍵 10 分鐘內只送一則；下一則帶上這段期間沒有送出的次數。計數放在 Redis。
- 告警只帶佇列名稱、工作名稱、工作 id、租戶 id、重試次數與監控畫面的連結，不帶失敗原因與工作資料。
- 設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 時送到 Slack，否則只寫 log。`ops-alert` 自己的工作重試用完時只寫 log。
- 監聽用 `QueueEvents`，從最新的事件開始讀。API 停機期間移到 failed set 的工作不會告警，但會在 failed set 保留 7 天。

重送之後，3 個訂閱者佇列與 `automation` 的工作回傳值列出被認領擋下而沒有再執行的副作用（`skippedClaims`），包括呼叫 LLM 之前先查到認領紀錄而跳過的機器人回覆與情緒分析，見[副作用的認領紀錄](#副作用的認領紀錄)。沒有副作用被跳過時，回傳值是空的。

## 只能跑一個 API 行程

生產環境目前只跑一個 `api` 容器。API 行程有多處假設自己是唯一的一份，同時跑兩個以上時會出現下列問題：

| 機制 | 多個行程時 |
| --- | --- |
| API 行程內的排程 | 由 BullMQ Job Scheduler 觸發，每一期只產生一筆 job。job 可能在行程被強制結束後重跑，所以 `run` 以條件更新認領資料 |
| `crm:events` | 每個行程的 `canvas.worker.ts` 都收到，同一則 Canvas 訊息發送多次 |
| 行程記憶體的狀態 | 各行程各算各的：非營業時間回覆的去重、工單輪流指派的位置、價目表快取（USAGE-02）、租戶方案快取 |
| Socket.IO | 沒有設定 Redis adapter；`@socket.io/redis-adapter` 列在 `apps/api/package.json`，但程式沒有使用。API 直接 `io.to(room).emit()` 的事件只送到連在同一個行程的客戶端；經 `socket:emit` 轉發的事件則因每個行程都訂閱而送到所有客戶端 |

業務事件的訂閱者走 BullMQ 佇列，每個 job 只由一個行程處理，不受行程數影響。彙整見 `../system/AUDIT.md` 的 APP-09。

## 新增事件或背景工作時

1. **只是通知前端，而且資料已經在手上**：在交易內用 `ctx.notify()` 或 `ctx.notifyAgent()`。
2. **其他模組要跟著做事**：在交易內用 `ctx.publish()`。先在 `packages/core/src/outbox/events.ts` 的 `APP_EVENT_NAMES` 加上名稱，再在 `queues.ts` 的 `EVENT_SUBSCRIBERS` 決定哪些訂閱者收到。訂閱者要承受同一個事件處理兩次。
3. **工作會拖慢回應、需要查很多資料，或要能在失敗後保留**：在交易內用 `ctx.enqueue()`，由 `apps/workers` 消費。佇列名稱不能含冒號；設定 `removeOnComplete` 與 `removeOnFail`；需要重試時設定 `attempts`。job 可能送兩次，handler 要承受重複。
4. **workers 要推送即時事件**：用 `publishSocketEvent()`。
5. **workers 產生的事件要觸發自動化**：在寫入業務資料的交易內用 `writeOutbox()`，帶入租戶 ID；commit 之後呼叫 `dispatchOutboxRows()`。
6. **不能重複的副作用**：執行前在交易內用 `claimSideEffect()` 認領，或以條件更新認領資料列。認領的交易失敗時丟錯讓 job 重試；認領之後的失敗只記 log。
7. **定期工作**：需要 `fastify.io` 或 API 行程內的狀態時，在 API 行程以 `registerSchedule()` 註冊，`run` 要承受重跑；其他放在 workers 以 BullMQ 重複工作執行，並給固定的 `jobId`。兩種做法在多個行程時，每一期都只產生一筆 job；但 job 可能在行程被強制結束後重跑，所以都不保證只執行一次。不要用 `setInterval` 或 `setTimeout` 排定定期工作。

新增事件之後，確認它同時有發布端與訂閱端。只有一邊的事件，不會產生任何錯誤或警告。

## 目前的限制

| 限制 | 詳見 `../system/AUDIT.md` |
| --- | --- |
| 指派對話不發布 `conversation.assigned`，通知訂閱者永遠不執行 | CONV-02 |
| `sla.warning`、`sla.breached` 沒有發布端 | APP-05 |
| 自動化可選的部分事件沒有發布端 | AUTO-05 |
| API 的 `*.worker.ts` 實際是訂閱者的處理函式或佇列生產者 | APP-04 |
| Canvas 等待節點的 BullMQ 路徑永遠失敗，佇列也沒有消費者 | APP-07 |
| 部分佇列永遠保留已完成的工作，Redis 沒有記憶體上限 | APP-08 |
| API 行程假設只有一份，無法水平擴充 | APP-09 |
| 對外 Webhook 轉送所有事件，`message.received` 帶 `replyToken` | HOOK-01 |
| `packages/core` 有未使用的服務 | PKG-05 |
| 租戶房間的 `message.new` 不套用渠道可見範圍 | RBAC-04 |
| 還沒搬遷的發布端仍是最多一次（`eventBus.publish()`） | 搬遷進度見 issue #337 |

## 自己驗證的方法

```bash
# 發布端：outbox 與舊寫法
grep -rn "ctx.publish(\|writeOutbox(" apps --include='*.ts' | grep -v /tests/
grep -rn -A2 "eventBus.publish" apps/api/src | grep -o "name: '[a-z_.]*'" | sort | uniq -c

# 訂閱者訂閱哪些事件
grep -n -A10 "const NOTIFICATION_EVENTS\|const AUTOMATION_EVENTS" packages/core/src/outbox/queues.ts

# 佇列的生產者與消費者
grep -rn "new Queue(" apps packages --include='*.ts'
grep -n "new Worker(" apps/workers/src/index.ts apps/api/src/events/subscriber-workers.ts

# 佇列有沒有設定保留上限
grep -rn "removeOnComplete\|removeOnFail" apps packages --include='*.ts'
```
