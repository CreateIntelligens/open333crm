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
- 訂閱者 job 內的寫入一律用 `inTenant()`，`deps.events` 是寫 outbox 的實作。所以衍生事件也經 outbox。

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
- 自動轉接：一個 `inTenant()` 交易內，`claimOne(updateMany where status: 'BOT_HANDLED')` 成功才寫系統訊息、認領 `bot_reply`、`ctx.publish('conversation.handoff')`；commit 之後送出轉接訊息。摘要的 LLM 呼叫在交易之前。
- agent 與 KB：呼叫 LLM 之前先查有沒有 `bot_reply` 認領紀錄。產生回覆之後，一個交易內認領 `bot_reply` 並寫入回覆訊息；commit 之後送出。`persistAndDeliverAgentReply()` 自己開的 `$transaction` 拆掉，改由呼叫端的 `inTenant()` 提供。
- 情緒分析：同樣先查、再呼叫 LLM、再於一個交易內認領 `sentiment`、寫入結果、必要時 `ctx.publish('sentiment.negative')`。
- `case.created` 的自動分類維持現狀：主規格「新工單的自動分類不覆蓋既有分類」已經讓重複執行不改變結果，只多一次 LLM 費用。
- `hasMatchingKeywordRule()`、`BotConfig` 與關鍵字比對搬進 `packages/automation`。AI 讓步判斷與 workers 呼叫同一份比對函式（解決 AUDIT ARCH-02）。
- `automation.worker.ts` 只剩「把事件轉成 `automation:evaluate` job」與 `message.received` 的流程，檔名維持不變，避免在本 change 混入改名。

### 9. workers 的規則評估

- `automation:evaluate` 的 job id 是事件 id，payload 帶 `eventId`。
- trigger 是 `message.received` 時，workers 另外取出命中的 `keyword.matched` 規則，以 `trigger = 'keyword.matched'` 執行，讓 LINE 照舊用 reply 回覆。命中時，一個交易內認領 `keyword_matched` 並寫 outbox 的 `keyword.matched`（只給 webhook）。
- 每個動作執行前，在一個 `$transaction` 內認領 `automation_action`；認領失敗就跳過該動作。
- `create_case`：在既有的 `$transaction` 內寫 outbox 的 `case.created`。`add_tag`：upsert 與寫 outbox 包進一個 `$transaction`。workers 的快路徑在 commit 之後呼叫 `dispatchOutboxRows()`。
- `notify`、`notify_supervisor` 的 `notification:dispatch` job id 是 `<事件 id>__<規則 id>#<序號>__<客服人員 id>`。
- 移除 `socket.plugin.ts` 的 `domain:event` 訂閱與 workers 的 `publishDomainEvent()`。
- `automation` 佇列加 `attempts: 3`、指數退避與以時間計算的保留期限。

### 10. 通知訂閱者

- `notification:dispatch` 的 job id 是 `<事件 id>__<客服人員 id>`。workers 的 `notification` 佇列改成以時間保留完成的 job（24 小時）。
- 用量告警信移到新的 `usage-alert-email` 佇列，API 行程處理，job id 是 `<事件 id>__<管理員 id>`，`attempts: 3`。訂閱者 job 不直接寄信，所以重試不會重寄。

### 11. 對外 webhook

- 對外事件清單是 `packages/core/src/outbox/` 的常數，第一版等於 `AppEventName` 的全部名稱。
- `event-webhook` job 找出訂閱，對每個訂閱建立一個 `webhook-delivery` job，id 是 `<事件 id>__<訂閱 id>`。
- `webhook-delivery` job 每次只送一次 HTTP，`attempts: 3`，自訂退避 1 秒、5 秒（與現在的間隔相同）。
- `webhook_deliveries` 加 `eventId` 欄位與 `@@unique([subscriptionId, eventId])`。第一次執行以 `createOrFindExisting()` 建立紀錄，之後的重試更新同一筆，所以 `X-Webhook-Delivery` 不變。既有資料的 `eventId` 是空值，唯一鍵不影響它們。
- payload 加 `id`（事件 id），header 加 `X-Webhook-Event-Id`。

### 12. data-export 與 data-erasure

worker 開頭以 `claimOne(updateMany where { id, tenantId, status: 'pending' })` 改成 `processing`，認領失敗就結束。`data-erasure` 的修正照 bug 修的流程：第一個測試重現「第二次執行把 `completed` 改成 `failed`」。

rich-menu 的 bind 與 unbind 本 change 不改，見風險。

## Risks / Trade-offs

- **對客人的回覆可能少送一則。** 認領 commit 之後、送出之前行程結束或送出失敗，這則回覆不再送出。這是「最多一次」的代價，spec 已寫明。
- **舊寫法的事件仍會遺失。** 搬遷到 `ctx.publish` 之前，行為與現在相同。
- **API 行程負擔變重。** 訂閱者 job 原本就在 API 行程執行，現在改由 BullMQ `Worker` 執行，CPU 用量不變。API 停機時，事件留在佇列，啟動後處理。
- **rich-menu 的舊 job 可能晚到。** 經 outbox 補送的 bind 晚於之後的 unbind 執行時，客人會綁回舊選單。rich-menu 的 service 還沒搬到 `ctx.enqueue`，搬遷（階段 4）時再處理。
- **規則改了動作順序時，認領的子鍵會對不上。** 只在事件重送與修改規則同時發生時才會重複執行，可以接受。
- **部署順序。** API 移除 `domain:event` 訂閱，workers 改寫 outbox，兩者要一起部署。只部署 API 時，舊 workers 發出的 `domain:event` 沒有人接收，事件遺失，與現在 API 停機時相同。
- **outbox 寫入增加交易內的工作。** 每個事件多一筆 INSERT。正式程式要到搬遷時才使用，試點時一起量測（規劃 6.2）。
