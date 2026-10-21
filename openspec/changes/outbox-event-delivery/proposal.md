## Why

業務事件現在經 API 行程內的 `eventBus`（EventEmitter）送給訂閱者。API 在 commit 之後、訂閱者做完之前結束時（例如部署），事件就遺失：通知、自動化規則與對外 webhook 都不會發生，也不會補做。issue #337 決定事件改走 outbox，保證至少送出一次（規劃 D3）。

至少一次的代價是同一個事件可能處理兩次。盤點發現，三種訂閱者與 workers 的規則動作都沒有防重複，客人可能收到兩則一樣的回覆。所以本 change 同時讓每個副作用承受重複，並讓對客人發訊息的動作最多做一次。本 change 是 #337 的階段 1b，要在階段 3 開始搬有事件的模組之前完成。

## What Changes

- 新增 `outbox` 資料表（有 RLS）。`ctx.publish` 與 `ctx.enqueue` 在交易內寫入 outbox，與業務資料一起 commit。
- commit 之後的快路徑把事件送進各訂閱者的 BullMQ 佇列，並標記已送出。relay 排程每分鐘補送超過寬限時間、還沒標記的事件。BullMQ 以 job id 擋住重複的送出。清理排程刪除過期的 outbox 資料列。
- 三種訂閱者（通知、自動化、對外 webhook）從 `eventBus` 的 callback 改成 API 行程內的 BullMQ job，每個訂閱者一個佇列。還沒搬遷的程式仍呼叫 `eventBus.publish`，這些事件也送進同樣的佇列，保證維持最多一次。
- 新增 `side_effect_claims` 資料表。對客人的機器人回覆、規則動作、衍生事件，執行前先寫認領紀錄，撞到唯一鍵就跳過。
- `automation.worker.ts` 改寫：
  - 機器人回覆（agent、KB、自動轉接）每則入站訊息最多一則。
  - 關鍵字規則改由 workers 在處理 `message.received` 時直接比對。`keyword.matched` 不再是內部事件，只發給對外 webhook。
  - 關鍵字比對只留一份共用函式。
- 衍生事件（`conversation.handoff`、`sentiment.negative`、`keyword.matched`）由認領保護，每個來源事件最多發出一次。
- workers 的 `create_case`、`add_tag` 在同一個交易寫入 outbox，取代 Redis `domain:event` 轉發。
- 對外 webhook：
  - 只轉送對外事件清單內的事件。第一版清單等於現在所有事件名稱，行為不變。
  - payload 帶事件 id。
  - 每個訂閱網址各自一個 job，由 BullMQ 重試，不再在行程內等待。
- `data-export`、`data-erasure` 的 worker 只處理 `pending` 的請求。修正 bug：同一個刪除請求執行兩次時，第二次把 `completed` 改成 `failed`。
- **BREAKING（內部 API）**：`ctx.publish` 改成 async，要 `await`；`ctx.enqueue` 改收佇列名稱，不收 `Queue` 物件。正式程式目前沒有呼叫這兩個方法。

## Capabilities

### New Capabilities

- `event-delivery`：業務事件與佇列 job 的送達保證。內容包括 outbox、快路徑與 relay、訂閱者佇列、job id 去重、舊寫法事件的轉送、outbox 的清理，以及 workers 寫入 outbox。
- `side-effect-claims`：副作用的認領紀錄。一個認領鍵只能認領一次，以及認領紀錄的保存期限。

### Modified Capabilities

- `tenant-transaction-context`：移除「事件與佇列 job 最多送出一次」，改成「至少送出一次」。推播維持最多一次。
- `automation-engine`：「Worker-Owned Automation Triggering」改成由 BullMQ 訂閱者 job 送出規則評估。「Unified Contact Tagging Emits contact.tagged」的 workers 路徑改成寫 outbox。新增機器人回覆、規則動作、關鍵字規則與情緒分析的重複處理需求。
- `bot-handoff-config`：新增自動轉接與 `conversation.handoff` 每次轉接只發生一次。
- `webhook-subscription-egress`：新增對外事件清單、事件 id 與每個網址各自重試。
- `standalone-worker-runtime`：新增同一個事件不重複建立站內通知。
- `usage-quota-alerts`：新增事件重送時不重複寄出告警信。
- `tenant-data-erasure`、`tenant-data-export`：新增 worker 只處理 `pending` 的請求。

## Impact

- schema：新增 `outbox`、`side_effect_claims` 兩張租戶資料表與 RLS migration；`webhook_deliveries` 新增 `eventId` 欄位與唯一鍵。
- 新增程式：`packages/core/src/outbox/`（寫 outbox、寫認領紀錄、佇列名稱與訂閱者清單，api 與 workers 共用）；API 的 relay 與清理排程、三個訂閱者 job。
- 修改程式：`apps/api/src/lib/tenant-ctx.ts`、`apps/api/src/events/event-bus.ts`、`automation.worker.ts`、`notification.worker.ts`、`webhook-dispatcher.ts`、`kb-autoreply.service.ts`、`agent.service.ts`、`socket.plugin.ts`（移除 `domain:event` 轉發）、workers 的 `automation-actions.ts`、`automation.handler.ts`、`data-export.handler.ts`、`data-erasure.handler.ts`。`claimOne()` 從 `apps/api/src/lib/db-invariants.ts` 搬進 `packages/core`。
- 文件：`docs/ref/modules/EVENTS.md`、`docs/ref/features/tenant/GOVERNANCE.md`、`docs/ref/system/AUDIT.md`（RLS-08、HOOK-01、ARCH-02）、`CHANGELOG.md`。
- 部署：沒有新的環境變數。Redis 多出 5 個 BullMQ 佇列：3 個訂閱者佇列、每個網址的 webhook 送出、告警信。
