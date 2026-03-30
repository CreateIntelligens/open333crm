## Why

`apps/workers/` 是一個獨立的 BullMQ worker 程序，設計用來將背景工作從 API 程序中分離，以便水平擴展。目前四個 worker（automation、broadcast、sla、notification）的 job handler 全是空殼，這些任務在 production 環境下完全不被執行。

## What Changes

- 為 `automation` queue 實作 job handler，消費由 API 發布的 automation evaluation 任務
- 為 `broadcast` queue 實作 job handler，執行 repeating scheduled job 來輪詢並發送到期的廣播
- 為 `sla` queue 實作 job handler，執行 repeating scheduled job 來輪詢 SLA warning、breach、first-response timeout
- 為 `notification` queue 實作 job handler，消費由 API 發布的通知任務並寫入 DB
- 在 `apps/workers/` 加入 Prisma 初始化、logger 設定、以及 channel plugin registry
- 建立 Redis pub/sub bridge：workers 發布 socket event，API 訂閱後轉發給 WebSocket clients
- 在 API 端加入 job enqueue 呼叫，將 automation 與 notification 事件轉為 BullMQ 任務

## Capabilities

### New Capabilities
- `standalone-worker-runtime`: 定義獨立 BullMQ worker 程序的 bootstrap 契約，包含 queue 名稱、job schema、repeating job 設定、以及 Prisma/channel plugin 初始化需求。

### Modified Capabilities
- `automation-engine`: Automation 任務除了 API 內部 event-bus 觸發外，新增透過 BullMQ `automation` queue 非同步消費的路徑。
- `core-inbox`: 從 worker 程序發出的通知改為先寫 DB、再透過 Redis pub/sub 橋接，由 API 轉發 WebSocket 事件。

## Impact

- 受影響程式碼：`apps/workers/src/index.ts`、`apps/api/src/modules/automation/automation.worker.ts`、`apps/api/src/modules/notification/notification.worker.ts`、`apps/api/src/plugins/socket.plugin.ts`
- 受影響 runtime：BullMQ queues（automation、broadcast、sla、notification）、Redis pub/sub channel
- 新增依賴：`apps/workers/` 需要 `@open333crm/database`（Prisma）、`@open333crm/channel-plugins`（已有）
