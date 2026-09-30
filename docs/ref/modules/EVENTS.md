# 事件與背景工作

本文件說明模組之間不直接呼叫時，靠哪些通道傳遞：業務事件怎麼發布與訂閱、哪些工作送到 `apps/workers` 執行、workers 怎麼把結果送回 API 與前端，以及 API 行程內有哪些定期排程。每個背景工作屬於哪個模組，見[模組總覽](./OVERVIEW.md#背景工作的歸屬)；選擇直接推送或走佇列的規則，見 [AGENTS.md 的 Socket 事件路由一節](../../../AGENTS.md#architecture-socket-event-routing-critical)。

- **資料來源**：`apps/api/src/events/event-bus.ts`、`apps/api/src/plugins/socket.plugin.ts`、`apps/api/src/modules/*/*.worker.ts`、`apps/api/src/modules/*/*.scheduler.ts`、`apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts`、`apps/api/src/index.ts`、`apps/workers/src/index.ts`、`apps/workers/src/lib/socket-bridge.ts`、`apps/workers/src/lib/notification-queue.ts`、`packages/core/src/event-bus/event-bus.ts`、`packages/core/src/canvas/*`
- **核對日期**：2026-09-30

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 系統有哪些傳遞通道？各自跨哪些行程？ | [先讀這一段](#先讀這一段) |
| 某個業務事件由誰發布、誰訂閱？ | [業務事件](#業務事件) |
| Canvas 的事件為什麼不在 eventBus 上？ | [Canvas 的事件](#canvas-的事件) |
| 哪些工作送到 workers？誰消費？完成的工作會保留多久？ | [BullMQ 佇列](#bullmq-佇列) |
| workers 怎麼推送即時事件、怎麼觸發 API 端的自動化？ | [從 workers 回到 API](#從-workers-回到-api) |
| API 行程內有哪些定期排程？ | [API 行程內的排程](#api-行程內的排程) |
| 工作失敗時會重試嗎？API 重啟時會遺失什麼？ | [失敗與重試](#失敗與重試) |
| 可以同時跑多個 API 行程嗎？ | [只能跑一個 API 行程](#只能跑一個-api-行程) |
| 新增一個事件或背景工作時，要選哪個通道？ | [新增事件或背景工作時](#新增事件或背景工作時) |
| 目前有哪些已知問題？ | [目前的限制](#目前的限制) |

## 先讀這一段

系統有兩個長駐行程：API 行程（`apps/api`）與 workers 行程（`apps/workers`）。兩者不共用記憶體，只透過 Redis 與資料庫溝通。模組之間的間接傳遞走下列通道：

| 通道 | 實作 | 方向 | 會不會持久化 |
| --- | --- | --- | --- |
| eventBus | `apps/api/src/events/event-bus.ts`，Node 的 `EventEmitter` | API 行程內 | 不會。行程重啟時，還沒處理完的事件遺失 |
| `crm:events` | `packages/core` 的 `EventBus`，Redis pub/sub | 發布者到所有訂閱的行程。目前只有 Canvas 使用 | 不會。發布當下沒有訂閱者就遺失 |
| BullMQ 佇列 | Redis | API 行程到 workers；workers 也會送工作給自己 | 會。工作存在 Redis，直到被消費 |
| `socket:emit` | Redis pub/sub | workers 到 API 行程，再推給前端 | 不會 |
| `domain:event` | Redis pub/sub | workers 到 API 行程的 eventBus | 不會 |

另外還有兩種定期工作：API 行程內以 `setInterval` 或 `setTimeout` 執行的排程，以及 workers 行程以 BullMQ 重複工作執行的排程。

名稱容易誤導的地方：API 裡的 `setupNotificationWorker`、`setupAutomationWorker` 雖然叫 worker，實際上是訂閱 eventBus、把工作送進佇列的生產者。真正消費佇列的只有 `apps/workers`，見 `../system/AUDIT.md` 的 APP-04。

## 業務事件

業務事件走 API 行程內的 eventBus。事件名稱列在 `event-bus.ts` 的 `AppEventName`，發布與訂閱的寫法：

```ts
eventBus.publish({ name: 'case.created', tenantId, timestamp: new Date(), payload: { caseId } });
eventBus.subscribe('case.created', async (event) => { /* … */ });
```

`publish()` 同步呼叫所有訂閱者，但不等待非同步的訂閱者完成，因此發布端不會被拖慢，也收不到訂閱者的錯誤。每個訂閱者自己以 `try`／`catch` 包住處理邏輯，失敗只寫 log。

訂閱者只有三個模組：

| 訂閱者 | 位置 | 做什麼 |
| --- | --- | --- |
| 通知 | `notification.worker.ts` 的 `setupNotificationWorker()` | 決定收件人，送工作到 `notification` 佇列 |
| 自動化 | `automation.worker.ts` 的 `setupAutomationWorker()` | 送工作到 `automation` 佇列。`message.received` 另外在 API 行程內直接處理機器人回覆，見[收件匣與對話](../features/tenant/INBOX.md) |
| 對外 Webhook | `webhook-dispatcher.ts` 的 `setupWebhookDispatcher()` | 以 `'*'` 訂閱所有事件，送給租戶設定的 Webhook 網址 |

各事件的發布端與訂閱端（2026-09-30 的快照；對外 Webhook 收到所有事件，下表不重複列出）：

| 事件 | 發布端 | 訂閱端 |
| --- | --- | --- |
| `message.received` | `webhook/inbound-side-effects.ts`、`channels/simulator/simulator.service.ts` | 通知、自動化 |
| `message.sent` | `conversation.service.ts` | 無 |
| `conversation.created` | `webhook/inbound-conversation-resolver.ts`、`chatbox.service.ts`、`simulator.service.ts` | 自動化 |
| `conversation.updated` | `conversation.service.ts` | 無 |
| `conversation.assigned` | **無** | 通知。見 CONV-02 |
| `conversation.closed` | `conversation.service.ts` | 無 |
| `conversation.handoff` | `automation.worker.ts`、`webhook/inbound-postback-interceptors.ts` | 無 |
| `case.created` | `case.service.ts` | 自動化 |
| `case.updated` | **無** | 無 |
| `case.assigned` | `case.service.ts`、`assignment.service.ts` | 通知 |
| `case.escalated` | `case.service.ts` | 通知、自動化 |
| `case.resolved` | `case.service.ts` | 無 |
| `case.closed` | `case.service.ts`、`csat.service.ts`、`csat.scheduler.ts` | 無 |
| `contact.created` | `webhook/inbound-contact-resolver.ts` | 自動化 |
| `contact.updated` | **無** | 無 |
| `contact.tagged` | `tagging.service.ts`；workers 經 `domain:event` 轉發 | 自動化 |
| `keyword.matched` | `automation.worker.ts` | 自動化 |
| `sentiment.negative` | `automation.worker.ts` | 無 |
| `sla.warning`、`sla.breached` | **無** | 通知。見 APP-05 |
| `portal.activity.submitted` | `portal.service.ts` | 自動化 |
| `link.clicked` | `shortlink.service.ts` | 自動化 |
| `usage.quota.threshold` | `ai/llm.service.ts` | 通知 |

「無」發布端的事件，訂閱者永遠不會執行；自動化規則若以這些事件觸發，也永遠不會生效，見 `../system/AUDIT.md` 的 AUTO-05。「無」訂閱端的事件仍會送到對外 Webhook。

## Canvas 的事件

Canvas 的流程引擎在 `packages/core`，無法 import API 的 eventBus，因此另有一套事件通道：`packages/core/src/event-bus/event-bus.ts` 的 `EventBus`。它以 Redis pub/sub 的 `crm:events` 頻道傳遞，**與 API 的 eventBus 是兩個不相通的系統**，事件名稱欄位也不同（`type` 而不是 `name`）。

| 事件 | 發布端 | 訂閱端 |
| --- | --- | --- |
| `canvas.send_message` | `FlowRunner` 的 `MESSAGE` 節點 | API 行程的 `canvas.worker.ts`，發送訊息或寄信 |
| `canvas.action` | `FlowRunner` 的 `ACTION` 節點 | 同上，目前只處理 `add_tag` |
| `flow.completed` | `FlowRunner` 流程結束時 | 無 |

`packages/core` 裡另有 `CaseService` 與 `InboxService` 也發布到這個頻道，`automation/engine.ts` 的 `AutomationEngine` 也訂閱它，但這三者在 `apps/*` 都沒有呼叫端，見 `../system/AUDIT.md` 的 PKG-05。

Redis pub/sub 會把一則訊息送給每一個訂閱的連線。因此有幾個 API 行程在跑，每則 `canvas.send_message` 就會被發送幾次，見[只能跑一個 API 行程](#只能跑一個-api-行程)。

## BullMQ 佇列

| 佇列 | 生產者 | 消費者（`apps/workers/src/handlers/`） | 完成與失敗的工作保留多少 |
| --- | --- | --- | --- |
| `notification` | API 的 `notification.worker.ts`；workers 的 `lib/notification-queue.ts` | `notification.handler.ts` | **全部保留** |
| `automation` | API 的 `automation.worker.ts` | `automation.handler.ts` | 完成保留 100 筆、失敗保留 50 筆 |
| `rich-menu-bind` | API 的 `rich-menu.service.ts` | `rich-menu-bind.handler.ts` | **全部保留** |
| `data-export` | API 的 `data-export.service.ts` | `data-export.handler.ts` | **全部保留** |
| `data-erasure` | API 的 `data-erasure.service.ts` | `data-erasure.handler.ts` | 完成保留 100 筆、失敗保留 50 筆 |
| `sla` | workers 啟動時註冊重複工作，每 5 分鐘 | `sla.handler.ts` | **全部保留** |
| `data-export-cleanup` | workers 啟動時註冊重複工作，每小時 | `data-export.handler.ts` | **全部保留** |
| `agent-retention-cleanup` | workers 啟動時註冊重複工作，每小時 | `agent-retention.handler.ts` | **全部保留** |

「全部保留」表示佇列與 worker 都沒有設定 `removeOnComplete`、`removeOnFail`，BullMQ 的預設是永遠保留。每則進站訊息至少產生一筆 `notification` 工作，因此 Redis 的用量會持續成長，見 `../system/AUDIT.md` 的 APP-08。

下列佇列有生產者、沒有消費者：

| 佇列 | 生產者 | 說明 |
| --- | --- | --- |
| `sla-monitoring` | `packages/core` 的 `CaseService` 在模組載入時建立 | 見 APP-01 |
| `flow:resume` | `packages/core/src/canvas/scheduler.ts` 的 `scheduleWaitNode()` | 佇列名稱含冒號，BullMQ 建立佇列時直接拋出錯誤，所以從未成功送出；Canvas 實際靠資料庫輪詢喚醒。見 APP-07 |
| `broadcast` | 舊版的 workers | 已不再使用。workers 啟動時清掉殘留的重複工作 |

workers 以 `DATABASE_URL_ADMIN` 連線資料庫，這是 BYPASSRLS 的連線，因為一個 worker 要處理所有租戶的工作。租戶隔離由各 handler 的查詢條件負責。

## 從 workers 回到 API

workers 行程沒有 socket 連線，也無法發布到 API 的 eventBus，兩件事都透過 Redis 轉給 API 行程。兩個函式都在 `apps/workers/src/lib/socket-bridge.ts`：

| 函式 | Redis 頻道 | API 端的接收者 | 用途 |
| --- | --- | --- | --- |
| `publishSocketEvent()` | `socket:emit` | `socket.plugin.ts`，轉成 `io.to(room).emit()` | 通知、渠道送達狀態、自動化與 SLA 造成的工單更新。可以指定 `namespace` |
| `publishDomainEvent()` | `domain:event` | `socket.plugin.ts`，轉成 `eventBus.publish()` | 讓 workers 產生的事件觸發 API 端的訂閱者。目前只有自動化貼標後的 `contact.tagged` |

`domain:event` 讓自動化可以連鎖：規則 A 在 workers 貼標，產生 `contact.tagged`，再觸發規則 B。

## API 行程內的排程

這些排程在 `apps/api/src/index.ts` 啟動，跑在 API 行程內：

| 排程 | 所屬模組 | 頻率 | 做什麼 |
| --- | --- | --- | --- |
| `setupBroadcastScheduler()` | `marketing` | 每 60 秒 | 執行到期的排程群發，每次最多 10 筆 |
| `setupCsatScheduler()` | `csat` | 每 60 秒 | 發送滿意度調查；逾時沒有回覆的工單自動結案 |
| `setupCanvasScheduler()` | `canvas` | 每 60 秒 | 喚醒 `resumeAt` 已到期的 `WAITING` 流程 |
| `setupInactivityCloseWorker()` | `conversation` | 每 5 分鐘 | 關閉閒置過久的對話 |
| `setupTrialScheduler()` | `trial` | 啟動時一次，之後每小時 | 試用到期的提醒與停用 |
| `setupAnalyticsScheduler()` | `analytics` | 每天 02:00（行程所在時區） | 把前一天的彙總寫入 `DailyStat` |
| `startA2ABridgeWorker()` | `settings` | 常駐輪詢 | 從 A2A Hub 取任務，由 `A2A_BRIDGE_ENABLED` 控制 |

這些排程都沒有鎖。`setInterval` 不等上一輪結束，下一輪時間到就開始。避免重複處理，靠的是每一輪先改狀態再處理，例如 Canvas 先把流程改成 `RUNNING`；這只在單一行程內有效。

## 失敗與重試

| 通道 | 失敗時 | API 或 workers 重啟時 |
| --- | --- | --- |
| eventBus 訂閱者 | 寫 log，不重試 | 還沒處理完的事件遺失 |
| `crm:events` | 寫 log，不重試 | 沒有訂閱者時發布的事件遺失 |
| BullMQ 工作 | 沒有設定 `attempts`，失敗一次就標為 failed，不重試 | 工作留在 Redis，重啟後繼續處理 |
| `socket:emit`、`domain:event` | API 端解析失敗時寫 log 並丟棄 | API 沒在跑時發布的訊息遺失 |
| 對外 Webhook | 在 API 行程內以 `sleep()` 等待後重試 | 等待中的重試遺失 |
| API 行程內的排程 | 下一輪再試 | 下一輪再試 |

BullMQ 重複工作（`sla` 等）的 handler 在內部捕捉錯誤，所以失敗的一輪也記為完成。

## 只能跑一個 API 行程

生產環境目前只跑一個 `api` 容器。API 行程有多處假設自己是唯一的一份，同時跑兩個以上時會出現下列問題：

| 機制 | 多個行程時 |
| --- | --- |
| API 行程內的排程 | 每個行程各自執行，沒有鎖。例如兩個行程在同一輪都查到同一筆 `scheduled` 的群發；`executeBroadcast()` 接受 `sending` 狀態，所以兩邊都會執行，見 MKT-01 |
| `crm:events` | 每個行程的 `canvas.worker.ts` 都收到，同一則 Canvas 訊息發送多次 |
| `domain:event` | 每個行程都轉成自己的 eventBus 事件，同一次貼標觸發多次自動化 |
| 行程記憶體的狀態 | 各行程各算各的：OAuth 的 state（IDENT-02）、非營業時間回覆的去重、工單輪流指派的位置、價目表快取（USAGE-02）、租戶方案快取 |
| Socket.IO | 沒有設定 Redis adapter；`@socket.io/redis-adapter` 列在 `apps/api/package.json`，但程式沒有使用。API 直接 `io.to(room).emit()` 的事件只送到連在同一個行程的客戶端；經 `socket:emit` 轉發的事件則因每個行程都訂閱而送到所有客戶端 |

彙整見 `../system/AUDIT.md` 的 APP-09。

## 新增事件或背景工作時

1. **只是通知前端，而且資料已經在手上**：直接 `fastify.io.to(room).emit()`。
2. **其他模組要跟著做事，而且不需要跨行程**：發布到 eventBus。先在 `AppEventName` 加上名稱。
3. **工作會拖慢回應、需要查很多資料，或要能在失敗後保留**：送進 BullMQ 佇列，由 `apps/workers` 消費。佇列名稱不能含冒號；設定 `removeOnComplete` 與 `removeOnFail`；需要重試時設定 `attempts`。
4. **workers 要推送即時事件**：用 `publishSocketEvent()`。
5. **workers 產生的事件要觸發自動化**：用 `publishDomainEvent()`，事件名稱必須是 `AppEventName` 之一。
6. **定期工作**：放在 workers 以 BullMQ 重複工作執行，並給固定的 `jobId`，多個 workers 行程時只會執行一次。不要在 API 行程新增 `setInterval`。

新增事件之後，確認它同時有發布端與訂閱端。只有一邊的事件，不會產生任何錯誤或警告。

## 目前的限制

| 限制 | 詳見 `../system/AUDIT.md` |
| --- | --- |
| 指派對話不發布 `conversation.assigned`，通知訂閱者永遠不執行 | CONV-02 |
| `sla.warning`、`sla.breached` 沒有發布端 | APP-05 |
| 自動化可選的部分事件沒有發布端 | AUTO-05 |
| API 的 `*.worker.ts` 實際是佇列生產者 | APP-04 |
| `packages/core` 載入時建立另一套 SLA 佇列 | APP-01 |
| Canvas 等待節點的 BullMQ 路徑永遠失敗，佇列也沒有消費者 | APP-07 |
| 多數佇列永遠保留已完成的工作，Redis 沒有記憶體上限 | APP-08 |
| API 行程假設只有一份，無法水平擴充 | APP-09 |
| `packages/core` 有未使用的服務與事件訂閱者 | PKG-05 |
| 租戶房間的 `message.new` 不套用渠道可見範圍 | RBAC-04 |

## 自己驗證的方法

```bash
# eventBus 的發布端與訂閱端
grep -rn -A2 "eventBus.publish" apps/api/src | grep -o "name: '[a-z_.]*'" | sort | uniq -c
grep -rn "eventBus.subscribe" apps/api/src

# 佇列的生產者與消費者
grep -rn "new Queue(" apps packages --include='*.ts'
grep -n "new Worker(" apps/workers/src/index.ts

# 佇列有沒有設定保留上限
grep -rn "removeOnComplete\|removeOnFail" apps packages --include='*.ts'
```
