# Design

## Context

- `TenantCtx`（change `tenant-transaction-context`，已歸檔）的 `publish` 在 commit 之後把事件交給注入的 `EventPublisher`，`enqueue` 在 commit 之後呼叫 `queue.add()`，兩者都是最多一次。正式程式目前沒有呼叫這兩個方法，舊程式直接呼叫 `eventBus.publish` 與 `queue.add()`。
- `eventBus` 是 API 行程內的 EventEmitter。三個訂閱者都在 API 行程內：
  - `notification.worker.ts`：送 `notification:dispatch` job 給 workers；用量告警直接寄信。
  - `automation.worker.ts`：送 `automation:evaluate` job 給 workers；收到 `message.received` 時，在 API 行程內直接做自動轉接、agent 回覆、KB 回覆與情緒分析，再發出衍生事件 `keyword.matched`、`sentiment.negative`、`conversation.handoff`。
  - `webhook-dispatcher.ts`：訂閱 `*`，在記憶體內重試 HTTP。
- workers 只有 admin 連線。`create_case`、`add_tag` 經 Redis `domain:event` pub/sub 把事件轉回 API 的 `eventBus`。
- 盤點細節與各項決定的理由，記在 #337 的規劃文件第 9 節（不在 repo 內）。本文件只記實作需要的決定。

## Goals / Non-Goals

**Goals:**

- 經 `ctx.publish`、`ctx.enqueue` 與 workers 寫入的事件和 job，至少送出一次。
- 三種訂閱者與 workers 的規則動作承受重複；對客人發訊息的動作最多一次。
- 舊程式（`eventBus.publish`）的行為不變，仍是最多一次，但改由同樣的訂閱者 job 處理。之後的搬遷 PR 只要把 `eventBus.publish` 換成 `ctx.publish`。

**Non-Goals:**

- 不搬任何既有模組的 service（階段 3～5）。
- 不縮減對外事件清單，也不拿掉 `message.received` 的 `replyToken`（AUDIT HOOK-01，待產品決定）。
- 不補 `conversation.handoff` 的主管通知（AUDIT CONV-03）。
- workers 不加 `app_tenant` 連線（階段 5）。
- 不保證事件之間的順序。
- 不改 `packages/core/src/event-bus/event-bus.ts` 的 `EventBus`。它走 Redis pub/sub `crm:events`，canvas 與 `inbox-service.ts` 使用，保證維持最多一次。多個 API 行程時重複處理的問題記在 AUDIT APP-09。

## Decisions

### 1. outbox 資料表

```prisma
model Outbox {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @db.Uuid
  kind         String    // 'event' | 'job'
  name         String    // 事件名稱或 job 名稱
  queueName    String?   // kind = 'job' 時的目標佇列
  payload      Json
  jobOptions   Json?     // kind = 'job' 時的 BullMQ 選項，不含 jobId
  createdAt    DateTime  @default(now())
  dispatchedAt DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([dispatchedAt, createdAt])
  @@map("outbox")
}
```

- 事件與 job 放同一張表，relay 與清理只有一套。
- `id` 就是事件 id，也是 BullMQ 的 job id。
- RLS：`ENABLE`、`FORCE`，加 `tenant_isolation` policy，步驟照 `postgres-rls-tenant-isolation` skill。relay 與清理用 `prismaAdmin`。

### 2. `side_effect_claims` 資料表

照規劃 9.8：`id`、`tenantId`、`kind`、`sourceId`（uuid）、`subKey`（預設空字串）、`createdAt`；`@@unique([kind, sourceId, subKey])`、`@@index([createdAt])`；RLS 同上；不記錄送出結果；`sourceId` 不設外鍵。

認領種類：

| kind | sourceId | subKey |
| ---- | -------- | ------ |
| `bot_reply` | 入站訊息 id | 空字串 |
| `automation_action` | 觸發事件 id | `<規則 id>#<動作序號>` |
| `sentiment` | 入站訊息 id | 空字串 |
| `keyword_matched` | 入站訊息 id | 規則 id |

`automation_action` 涵蓋所有規則動作，不只 `send_message`、`send_material`：`escalate_case` 沒有指定優先度時重複執行會再升一級，`notify` 會重複通知。每個動作一筆紀錄的成本很低。

寫入用 `claimOne(() => tx.sideEffectClaim.createMany({ data: [row], skipDuplicates: true }))`。`claimOne()` 從 `apps/api/src/lib/db-invariants.ts` 搬到 `packages/core`，api 改從 core import；`createOrFindExisting()` 一起搬，同一個檔案的兩個函式不拆開。

### 3. 共用模組 `packages/core/src/outbox/`

api 與 workers 共用（規劃 9.8 的決定）：

- `writeOutbox(tx, { tenantId, kind, name, payload, queueName?, jobOptions? })`：回傳 outbox id。`tenantId` 必填。參數型別只用 `Prisma.TransactionClient`。
- `claimSideEffect(tx, { tenantId, kind, sourceId, subKey? })`：回傳是否認領成功。
- `dispatchOutboxRows(rows)`：為每一列建立 job，再以條件更新標記已送出。快路徑與 relay 共用。
- 佇列名稱與訂閱者清單（下一節）。BullMQ 的 `Queue` 在 core 內延遲建立，連線讀 `REDIS_URL`。

### 4. 訂閱者佇列

| 訂閱者 | 佇列 | 訂閱的事件 | 處理的行程 |
| ------ | ---- | ---------- | ---------- |
| 通知 | `event-notification` | 現在 `notification.worker.ts` 訂閱的 7 種 | API |
| 自動化 | `event-automation` | 現在 `automation.worker.ts` 訂閱的事件，扣掉 `keyword.matched` | API |
| 對外 webhook | `event-webhook` | 對外事件清單 | API |

- 每個訂閱者一個佇列，所以 job id 直接用事件 id。不必組成 `<事件 id>__<訂閱者>`，也避開 bullmq 不接受單一 `:` 的限制。
- 訂閱者 job 在 API 行程處理：自動化要用 `fastify.io` 推播，也要呼叫 api 的 service（agent、KB、`deliverToChannel`）。BullMQ `Worker` 在 API 行程已有先例（`job-scheduler.ts`）。
- 三個佇列：`removeOnComplete: { age: 86400 }`、`removeOnFail: { age: 604800 }`、`attempts: 3`、指數退避，基準 5 秒。訂閱者在本 change 內都能承受重複，所以可以重試。
- Worker 的並行數：`event-automation` 與 `webhook-delivery` 是 10，其他是 5。BullMQ 預設是 1，一個事件的 AI 回覆跑幾十秒時，其他租戶的事件都要等；改成佇列之前，EventEmitter 的 handler 是並行執行的（review-loop 2026-10-22）。
- 還沒處理：`message.received` 先做完自動轉接與 AI 回覆，才送出規則評估，所以關鍵字規則的回覆要等 AI 回覆跑完。把規則評估移到最前面，或把 AI 工作拆到另一個佇列，另外評估（2026-10-22 決定）。
- 訂閱者 job 的資料庫存取分成兩段：
  - 呼叫外部服務的階段在交易之外，照舊用 `prismaAdmin`，查詢明確帶 `tenantId`。外部服務包括 LLM、去識別化服務與 KB 檢索。這個階段也有寫入，例如 `runAgentReply()` 建立 `agentRun`。
  - 認領、寫入結果與發出衍生事件放在一個 `inTenant()` 交易內。`deps.events` 是寫 outbox 的實作，所以衍生事件也經 outbox。
- job data 是 JSON，所以事件的 `timestamp` 存成 ISO 8601 字串。訂閱者 job 讀出 job data 之後，把 `timestamp` 轉回 `Date`，再交給處理程式。處理程式收到的 `AppEvent` 型別不變，例如 `webhook-dispatcher.ts` 仍可呼叫 `event.timestamp.toISOString()`。

### 5. `TenantCtx` 的改動

- `publish(name, payload): Promise<void>`：在交易內呼叫 `writeOutbox()`，回傳時 outbox 資料列已寫入。commit 之後交給快路徑。
- `enqueue(queueName, name, data, opts?): Promise<void>`：同上，`kind = 'job'`。收佇列名稱，因為 relay 要能依名稱找回佇列。
- `EventPublisher` 換成 outbox 的寫入與快路徑；`TenantCtxDeps.events` 保留，單元測試仍可注入假的實作。
- 快路徑在 commit 之後執行，不 `await`，失敗只記 log（與 `enqueue` 現在的做法相同）。推播的處理不變。

### 6. relay 與清理

- `outbox-relay`：`registerSchedule({ every: 60_000, withoutOverlapping })`。以 `prismaAdmin` 取出 `dispatchedAt` 是空值、`createdAt` 早於 2 分鐘前的資料列，每次最多 500 列，呼叫 `dispatchOutboxRows()`。
- `outbox-cleanup`：每天一次。刪除 `dispatchedAt` 早於 7 天前的 outbox，與 `createdAt` 早於 30 天前的認領紀錄。
- 兩個排程都在 API 行程，與既有排程相同。

### 7. 舊寫法的事件

`eventBus` 改成轉送器：`publish()` 產生一個 uuid 當事件 id，依訂閱者清單直接 `add()` 到訂閱者佇列，不寫 outbox。三個訂閱者不再訂閱 `eventBus`。所以：

- 舊程式不用改，保證仍是最多一次。
- 訂閱者只有一個來源（佇列），不必同時支援兩種來源（規劃的風險表）。
- `eventBus.publish()` 的簽名不變。

### 8. 自動化訂閱者

- `message.received` 的處理順序不變：自動轉接 → agent 或 KB → 情緒分析 → 送出 `automation:evaluate`。
- 自動轉接：一個 `inTenant()` 交易內，`claimOne(updateMany where status: 'BOT_HANDLED')` 成功才寫系統訊息、認領 `bot_reply`、`ctx.publish('conversation.handoff')`；commit 之後送出轉接訊息。交易之前先做兩個外部呼叫：產生摘要，以及以 `prepareStoredMessageContent()` 遮罩系統訊息。`prepareStoredMessageContent()` 會經 `maskTexts()` 呼叫去識別化服務。
- agent 與 KB：呼叫 LLM 之前先查有沒有 `bot_reply` 認領紀錄。產生回覆並以 `prepareStoredMessageContent()` 遮罩之後，一個交易內認領 `bot_reply` 並寫入回覆訊息；commit 之後送出。`persistAndDeliverAgentReply()` 自己開的 `$transaction` 拆掉，改由呼叫端的 `inTenant()` 提供。
- 情緒分析：同樣先查、再呼叫 LLM、再於一個交易內認領 `sentiment`、寫入結果、必要時 `ctx.publish('sentiment.negative')`。
- `case.created` 的自動分類維持現狀：主規格「新工單的自動分類不覆蓋既有分類」已經讓重複執行不改變結果，只多一次 LLM 費用。
- 下列符號與關鍵字比對搬進 `packages/automation`：`hasMatchingKeywordRule()`、`BotConfig`、`DEFAULT_BOT_CONFIG`、`DEFAULT_HANDOFF_PROMPT_TEXT`。`kb-autoreply.service.ts` 從 worker 檔 import 的就是這 4 個符號，全部搬走才能解決 AUDIT ARCH-02。
- AI 讓步判斷與 workers 呼叫同一份比對函式。
- `packages/automation` 以結構型別接收 Prisma executor（同 `AutomationFactsDb` 的做法），不新增 database 相依。
- `automation.worker.ts` 只剩「把事件轉成 `automation:evaluate` job」與 `message.received` 的流程，檔名維持不變，避免在本 change 混入改名。

### 9. workers 的規則評估

- `automation:evaluate` 的 job id 是事件 id，payload 帶 `eventId`。
- trigger 是 `message.received` 時，context 另外帶 `messageId`（入站訊息 id），`keyword_matched` 的認領要用它。現在 API 送出的 context 沒有這個欄位。
- trigger 是 `message.received` 時，workers 另外取出命中的 `keyword.matched` 規則，以 `trigger = 'keyword.matched'` 執行，讓 LINE 照舊用 reply 回覆。命中時，一個交易內認領 `keyword_matched` 並寫 outbox 的 `keyword.matched`（只給 webhook）。
- 每個動作執行前，在一個 `$transaction` 內認領 `automation_action`；認領失敗就跳過該動作。
- SLA 排程（`sla.handler.ts`）也呼叫 `executeWorkerAutomationActions()`，但沒有事件 id。所以 context 沒有 `eventId` 時不認領。SLA 的重複由主規格「SLA Outcome Recorded Once Per Deadline」處理。
- `create_case`：在既有的 `$transaction` 內寫 outbox 的 `case.created`。`add_tag`：upsert 與寫 outbox 包進一個 `$transaction`。workers 的快路徑在 commit 之後呼叫 `dispatchOutboxRows()`。
- `notify`、`notify_supervisor` 的 `notification:dispatch` job id 是 `<事件 id>__<規則 id>#<序號>__<客服人員 id>`。
- 移除 `socket.plugin.ts` 的 `domain:event` 訂閱與 workers 的 `publishDomainEvent()`。
- `automation` 佇列加 `attempts: 3`、指數退避與以時間計算的保留期限。

### 10. 通知訂閱者

- `notification:dispatch` 的 job id 是 `<事件 id>__<客服人員 id>`。
- `notification` 佇列有兩個發送端，各自建立 `Queue`：api 的 `notification.worker.ts` 與 workers 的 `lib/notification-queue.ts`。保留期限由發送端的 `defaultJobOptions` 決定，所以兩邊都改成完成的 job 保留 24 小時。
- 用量告警信移到新的 `usage-alert-email` 佇列，API 行程處理，job id 是 `<事件 id>__<管理員 id>`，`attempts: 3`。訂閱者 job 不直接寄信，所以訂閱者重試不會重寄。告警信的保證是至少一次：寄信服務收下信之後、job 完成之前中斷時，重試會多寄一封。不寄告警信（例如 AI 額度用完）的代價比多收一封大，所以不改成寄信前認領（review-loop 2026-10-22 決定）。

### 11. 對外 webhook

- 對外事件清單是 `packages/core/src/outbox/` 的常數，第一版等於 `AppEventName` 的全部名稱。
- `event-webhook` job 找出訂閱，對每個訂閱建立一個 `webhook-delivery` job，id 是 `<事件 id>__<訂閱 id>`。
- `webhook-delivery` job 每次只送一次 HTTP，`attempts: 3`，自訂退避 1 秒、5 秒（與現在的間隔相同）。
- `webhook_deliveries` 加 `eventId` 欄位與 `@@unique([subscriptionId, eventId])`。第一次執行以 `createOrFindExisting()` 建立紀錄，之後的重試更新同一筆，所以 `X-Webhook-Delivery` 不變。既有資料的 `eventId` 是空值，唯一鍵不影響它們。
- payload 加 `id`（事件 id），header 加 `X-Webhook-Event-Id`。
- `POST /webhook-subscriptions/:id/test` 不經佇列：在請求內送出一次，不重試，回應帶這次的結果。事件 id 是新產生的 uuid，送出紀錄的 `eventId` 也是這個 id。
  - 理由：成員按下測試，是要知道網址現在能不能收。現在的程式最多試 3 次，每次逾時 10 秒，間隔 1 秒與 5 秒，最久 36 秒才回應。重試還會蓋掉第一次的失敗。
  - 改成只送一次之後，`webhook-delivery` job 與測試路由共用同一個「送出一次 HTTP」的函式，行程內的重試迴圈可以刪掉。

### 12. data-export 與 data-erasure

兩張請求表都沒有 `updatedAt`，worker 分不出兩種情況：上一次執行中途結束，或另一個執行正在進行。BullMQ 只在 worker 的鎖過期時，才重新執行同一個 job，例如行程被強制結束。所以 worker 一律當作上一次執行中途結束，重新處理 `processing` 的請求。

- 開頭以 `claimOne(updateMany where { id, tenantId, status: { in: ['pending', 'processing'] } })` 改成 `processing`。認領失敗代表請求已經結束（`completed`、`failed`、`expired`），worker 直接結束。
- 寫入 `completed` 或 `failed` 時，都以 `status: 'processing'` 為條件，用 `claimOne()`。條件不成立時不寫稽核、不通知。所以已完成的請求不會被改成 `failed`，兩次執行也只發一則完成通知。
- data-erasure：把「`processing` 改成 `completed`」的條件更新放在刪除或匿名化交易的第一個語句，交易結尾再寫入 `affected`。
  - 交易 commit 之前行程結束時，資料與狀態一起 rollback，重新執行時從頭再做。
  - 兩次同時執行時，後到的交易在這個更新等待列鎖。前一個交易 commit 之後，更新筆數是 0，後到的交易 rollback，不會再刪一次，也不記錄失敗。
  - MinIO 檔案仍在交易之後刪除。
- data-export：重新執行時，worker 重新產生匯出檔，上傳到同一個 key（`export/<tenantId>/<requestId>.zip`），覆蓋前一次的檔案。
- `data-erasure` 的修正照 bug 修的流程：第一個測試重現「第二次執行把 `completed` 改成 `failed`」。

rich-menu 的 bind 與 unbind 本 change 不改，見風險。

### 13. 錯誤處理：認領之前與認領之後（review-loop 2026-10-22）

review-loop 第 1、3、4 輪都在同一類問題上找到漏洞：整段 try/catch 只記 log，連認領或 outbox 交易的失敗也吞掉。結果是事件或動作就此遺失。所以本 change 定一條規則（side-effect-claims「認領 commit 之前的失敗由佇列重試」），並依這條規則逐一檢查本 change 碰到的 catch：

- 認領、寫入結果或寫入 outbox 的交易失敗，以及送出下一步的 job 失敗：丟錯，由佇列重試。
- 認領 commit 之後執行副作用的失敗：只記 log，不重試。
- 刻意的降級（LLM 失敗改由 KB 回覆、略過情緒分析等）：照舊只記 log。

送出 job 的選項也從黑名單改成白名單，`dispatchOutboxRows()` 另外檢查佇列回傳的 job id。BullMQ 以後新增會讓 job 不被建立的選項時，`dispatchOutboxRows()` 也不會把資料列標記為已送出。

逐處檢查的結果（2026-10-22）：

| 位置 | 包住的內容 | 結論 |
| --- | --- | --- |
| `apps/workers/src/lib/automation-actions.ts`，動作迴圈的 catch | 動作本身 | 認領移到 try 之外，認領失敗丟錯；動作失敗只記 log（認領之後） |
| `automation-actions.ts`，`createCaseFromAutomation` 的 catch | 另一個執行已連結工單（`RACED`） | 其他錯誤照舊往外丟，不變 |
| `automation-actions.ts`，`dispatchAfterCommit` | commit 之後的快路徑 | 只記 log，資料列由 relay 補送，不變 |
| `apps/workers/src/handlers/automation.handler.ts`，`emitKeywordMatched` | 只包快路徑 | 第 3 輪已改：交易失敗丟錯 |
| `apps/api/src/modules/automation/automation.worker.ts`，`checkAutoHandoff` | 原本包住整段 | 拿掉外層 catch；只包 commit 之後的送出與推播 |
| `automation.worker.ts`，摘要的 catch | 摘要的 LLM 呼叫 | 降級（沒有摘要也轉接），不變 |
| `automation.worker.ts`，agent 與 KB 回覆的 catch | 回覆流程 | 遇到 `ClaimTransactionError` 往外丟，其他照舊降級 |
| `automation.worker.ts`，情緒分析 | 情緒分析 | LLM 失敗在 `analyzeSentimentOnce()` 內略過（降級）；查認領紀錄與交易的失敗往外丟（第 5 輪補上） |
| `automation.worker.ts`，`message.received` 與 `case.created` 的外層 catch | 整個處理 | 步驟的失敗最後一起丟錯；`case.created` 記 log 後丟錯 |
| `automation.worker.ts`，`autoClassifyNewCase` 的 catch | 自動分類（LLM） | 降級；重複執行不改變結果，不認領，不變 |
| `apps/api/src/modules/notification/notification.worker.ts` | 送出通知與告警信的 job | 第 1 輪已改：丟錯 |
| `apps/workers/src/handlers/data-export.handler.ts`，主流程的 catch | 認領 `processing` 之後的產生與上傳 | 改成 `failed`（終態），不重試；請求是使用者看得到的狀態，第 4 項已決定 |
| `data-export.handler.ts`，標記失敗與失敗通知的 catch | 改成 `failed` 之後的通知 | 只記 log（請求已結束） |
| `apps/workers/src/handlers/data-erasure.handler.ts`，主流程的 catch | 認領 `processing` 之後的刪除 | 同 data-export：改成 `failed`，不重試 |
| `data-erasure.handler.ts`，稽核紀錄的 catch | 刪除 commit 之後的稽核 | 只記 log，不變 |
| `apps/api/src/lib/tenant-ctx.ts`、`events/outbox-publisher.ts` | commit 之後的快路徑 | 只記 log，由 relay 補送，不變 |
| `apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts`，`sendOnce` 的 catch | HTTP 送出 | 轉成失敗結果，processor 丟錯讓 BullMQ 重試，不變 |

`data-export.handler.ts` 與 `data-erasure.handler.ts` 的保存期清理、MinIO 刪檔、網址解析的 catch，不是本 change 新增的認領路徑，沒有列入。

### 14. 審查基準與逐跳保證（2026-10-22）

**審查基準：至少達到 Laravel + Horizon 的水準。** Laravel 以 `afterCommit` 在 commit 之後推進 Redis，Horizon 提供重試、失敗清單與監控。本 change 比 Laravel 多保證一段：commit 之後、推進 Redis 之前（outbox）。Laravel 專案也會有的情況，例如重試時以當下的資料重新評估、多個 API 實例的推播，本 change 記為已知限制，不處理。

每條路徑的每一跳（2026-10-22）：

| 路徑 | 這一跳 | 失敗時 | 保證 |
| --- | --- | --- | --- |
| `ctx.publish`、`ctx.enqueue`、workers 的 `writeOutbox()` | commit → 訂閱者佇列或目標佇列 | 資料列留在 outbox，`outbox-relay` 補送；佇列沒有建立 id 相同的 job 時不標記已送出 | 至少一次 |
| `eventBus.publish()`（還沒搬遷） | 行程內 → 訂閱者佇列 | 只記 log | 最多一次 |
| 訂閱者 job（通知、自動化、webhook） | 佇列 → 處理程式 | 處理程式丟錯，BullMQ 重試 3 次；用完之後留在 failed set 7 天，沒有告警（見「後續」） | 至少一次，到重試用完為止 |
| 通知訂閱者 | → `notification:dispatch`、`usage-alert-email` | 送不出時丟錯，訂閱者 job 重試；job id 固定，不重複建立 | 站內通知：每位客服人員一個 job。告警信：至少一次，中斷時可能多寄一封 |
| 自動化訂閱者，`message.received` | 自動轉接 | 交易失敗丟錯重試；commit 之後送出轉接訊息失敗只記 log | 轉接最多一次 |
| | 機器人回覆（agent、KB） | 認領的交易失敗丟錯重試；LLM 失敗改由 KB 回覆（降級）；送出失敗只記 log | 每則入站訊息最多一則 |
| | 情緒分析 | 查認領或交易失敗丟錯重試；LLM 失敗略過 | 最多一次 |
| | → `automation:evaluate` | 送不出時丟錯重試；job id 是事件 id | 至少一次 |
| workers 規則評估 | `keyword.matched` | 認領與 outbox 同一個交易；交易失敗丟錯重試 | 每則訊息每條規則最多發出一次；發出之後至少一次送達 |
| | 規則動作 | 認領失敗丟錯重試；認領之後執行失敗只記 log | 每個事件每個動作最多一次。重試時以當下的資料重新評估條件（已知限制） |
| | `create_case`、`add_tag` 的事件 | 與資料同一個交易寫 outbox | 至少一次 |
| 對外 webhook | `event-webhook` → 每個網址一個 `webhook-delivery` job | HTTP 失敗由 BullMQ 重試，共 3 次 | 至少一次；接收端以 `X-Webhook-Event-Id` 去重 |
| data-export、data-erasure | 請求狀態 | 開頭以條件更新認領 `pending` 或 `processing`；失敗改成 `failed`（終態），不重試 | 每個請求最多完成一次 |

## Risks / Trade-offs

- **對客人的回覆可能少送一則。** 認領 commit 之後、送出之前行程結束或送出失敗，這則回覆不再送出。這是「最多一次」的代價，spec 已寫明。
- **舊寫法的事件仍會遺失。** 搬遷到 `ctx.publish` 之前，行為與現在相同。
- **API 行程負擔變重。** 訂閱者 job 原本就在 API 行程執行，現在改由 BullMQ `Worker` 執行，CPU 用量不變。API 停機時，事件留在佇列，啟動後處理。
- **rich-menu 的舊 job 可能晚到。** 經 outbox 補送的 bind 晚於之後的 unbind 執行時，客人會綁回舊選單。rich-menu 的 service 還沒搬到 `ctx.enqueue`，搬遷（階段 4）時再處理。
- **規則改了動作順序時，認領的子鍵會對不上。** 只在事件重送與修改規則同時發生時才會重複執行，可以接受。
- **部署順序。** API 移除 `domain:event` 訂閱，workers 改寫 outbox，兩者要一起部署。只部署 API 時，舊 workers 發出的 `domain:event` 沒有人接收，事件遺失，與現在 API 停機時相同。
- **刪除請求的 MinIO 檔案可能留下。** 刪除交易 commit 之後、刪除 MinIO 檔案之前行程結束時，重新執行會因請求已是 `completed` 而結束，不會再刪檔。現在的程式在同樣情況下，重新執行會因聯絡人不存在而記錄失敗，也不會刪檔。
- **匯出中途結束時會整份重做。** 匯出檔的 key 固定，重做的結果覆蓋前一次的檔案，只多花一次產生檔案的時間。
- **outbox 寫入增加交易內的工作。** 每個事件多一筆 INSERT。正式程式要到搬遷時才使用，試點時一起量測（規劃 6.2）。
- **每次都送不出的資料列會排在補送的最前面。** relay 依 `createdAt` 一次取 500 筆。某一列每次都送不出時，該列一直留在最前面；這種資料列累積到 500 筆，較新的資料列就補送不到。`writeOutbox()` 的型別要求 job 必須有 `queueName`，所以正常寫入的資料列不會每次失敗。review-loop 2026-10-22 記錄，先不處理。
- **匯出工作同時執行、其中一次失敗時，請求停在 `failed`。** 執行 A 失敗、把請求改成 `failed` 之後，執行 B 上傳成功，但 B 改成 `completed` 的條件（`processing`）不成立，B 直接結束。請求顯示失敗，上傳的檔案留在 MinIO，沒有請求指向它；使用者要重新申請匯出。要兩次執行同時進行、其中一次失敗才會發生；`failed` 維持終態（2026-10-22 決定）。
- **尖峰時可能等資料庫連線。** 5 個訂閱者 Worker 的並行數加起來是 35，可能超過 Prisma 連線池（`DATABASE_URL` 沒有設 `connection_limit`，預設是 CPU 數 × 2 + 1）。LLM 與 HTTP 呼叫都在交易之外，不佔連線，所以只在尖峰時排隊等連線；等超過 Prisma 的 `pool_timeout` 時，該 job 失敗並由 BullMQ 重試。試點時與規劃 6.2 的基準一起量測（review-loop 2026-10-22 記錄）。
- **規則動作重試時，以當下的資料重新評估條件。** 規則的第一個動作可能改變這條規則的觸發條件，例如把優先度從 LOW 升成 MEDIUM。接著下一個動作的認領交易失敗時，佇列重試這個 job，重新評估的結果可能是「不再命中」。這時還沒認領的動作不會執行。要同時遇到資料庫暫時失敗、與「動作改到自己的觸發條件」才會發生。把第一次評估的結果存下來就能解決，但要新增儲存機制。Laravel 的 queued listener 重試時也是重新執行，所以依第 14 節的基準，本 change 記為已知限制（review-loop 2026-10-22）。

## 後續（不在本 change）

2026-10-22 review-loop 與討論後移出本 change 的項目：

- **重試用完的監控與重送。** 訂閱者 job 重試用完之後留在 failed set 7 天，沒有告警，也沒有畫面。另開 change 導入 bull-board（以 Fastify hook 採白名單，只放行讀取與單筆重送），並在 Worker 的 `failed` 事件發出告警。
- **事件順序。** relay 補送的事件可能比之後的事件晚到；Worker 同時處理多個 job，同一段對話的事件會並行。目前只有 rich-menu 記在 Risks。
- **job 資料格式跨版本。** 部署前後的 job 格式不同（例如舊 job 沒有 `eventId`），目前各處各自判斷。
- **多個 API 實例的推播。** 背景處理的 Socket 推播只送到處理它的實例；要支援多實例時，整體加上 Socket.IO Redis adapter。
- **`message.received` 先送出規則評估。** 目前要等自動轉接與 AI 回覆跑完，才送出規則評估；可以把它移到最前面，或把 AI 工作拆到另一個佇列。
