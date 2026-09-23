# 互動流程引擎（Canvas）

Canvas 讓租戶定義一條多步驟的流程，針對單一聯繫人執行，由系統自動推進。每個聯繫人各自持有一份執行狀態。流程可以停下來等待數天，之後再繼續。

- **資料來源**：`apps/api/src/modules/canvas/*`、`packages/core/src/canvas/*`、`packages/database/prisma/schema.prisma`、`apps/api/src/modules/webhook/inbound-side-effects.ts`
- **核對日期**：2026-09-23

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| Canvas 與 `automation` 有什麼不同？各自該用在哪裡？ | [與 automation 的分工](#與-automation-的分工) |
| 一條流程由哪些東西組成？ | [資料模型](#資料模型) |
| 七種節點各自做什麼？設定長什麼樣？ | [節點型別](#節點型別) |
| 流程怎麼開始？停下來之後怎麼繼續？ | [執行模型](#執行模型) |
| 程式碼分佈在哪幾個檔案？各自的職責是什麼？ | [程式碼分佈](#程式碼分佈) |
| 現在哪些部分不能用？ | [目前的限制](#目前的限制) |

## 與 automation 的分工

兩個模組都在做自動化，但處理的問題不同。

| | `automation` | `canvas` |
| --- | --- | --- |
| 形式 | 單次規則：事件進來、條件成立、動作執行、結束 | 多步驟旅程，節點之間以 `nextNodeId` 連成圖 |
| 狀態 | 無。每次事件獨立判斷 | 每個聯繫人一份 `FlowExecution`，記錄目前走到哪個節點 |
| 時間跨度 | 同一次事件處理內完成 | 可以停在 `WAIT` 節點數小時或數天 |
| 引擎 | `json-rules-engine`（`packages/automation`） | 自製狀態機（`packages/core/src/canvas`） |

「訊息含關鍵字就貼標籤」屬於 `automation`。「加好友 → 發歡迎訊息 → 等三天 → 查訂單 → 依結果分兩條路」屬於 `canvas`。

## 資料模型

四張表定義在 `packages/database/prisma/schema.prisma` 的 `Interaction Canvas` 區段。

| 表 | 存什麼 | 關鍵欄位 |
| --- | --- | --- |
| `InteractionFlow` | 流程定義 | `triggerType`、`triggerConfig`、`maxStepLimit`、`status`（`DRAFT`／`ACTIVE`／`ARCHIVED`） |
| `InteractionNode` | 流程中的一個節點 | `nodeType`、`config`、`position`、`nextNodeId`、`falseNodeId` |
| `FlowExecution` | 單一聯繫人在單一流程的進度 | `contactId`、`currentNodeId`、`contextVars`、`stepCount`、`resumeAt`、`status`（`RUNNING`／`WAITING`／`COMPLETED`／`FAILED`） |
| `FlowLog` | 每個節點的執行紀錄 | `executionId`、`nodeId`、`action`、`result` |

節點之間用兩個欄位接線。`nextNodeId` 是預設的下一個節點。`falseNodeId` 只有 `CONDITION` 節點會用，條件判斷為否時走這一條。沒有下一個節點時，`FlowRunner` 把執行狀態改為 `COMPLETED`。

`contextVars` 是這條執行累積的變數，結構見 `packages/core/src/canvas/types.ts` 的 `FlowContext`：

- `contact.*`：聯繫人資料
- `ext.*`：`API_FETCH` 節點寫入的外部資料
- `gen.*`：`AI_GEN` 節點寫入的生成結果

節點設定可以用 `{{ext.coupon_code}}` 這種 `{{...}}` 佔位符引用這些變數，支援點記法取巢狀值。

## 節點型別

`NodeType` enum 定義七種節點。執行邏輯在 `packages/core/src/canvas/flow-runner.ts` 的 `executeNode()`。

| 節點 | 職責 | 設定欄位 |
| --- | --- | --- |
| `TRIGGER` | 進入點，不執行動作，直接前往下一個節點 | 無 |
| `MESSAGE` | 發訊息給聯繫人 | `channelType`、`templateId`、`text` |
| `WAIT` | 暫停執行，排定稍後喚醒 | `delayMs` 或 `delayMinutes`、`smartWindow`、`timezone` |
| `CONDITION` | 依 `contextVars` 分兩條路 | `field`、`operator`（`eq`／`neq`／`contains`／`exists`）、`value` |
| `API_FETCH` | 呼叫外部 HTTP API，把回應寫進 `ext.*` | `url`、`method`、`headers`、`bodyTemplate`、`mapping`、`timeoutMs`（預設 10 秒） |
| `AI_GEN` | 呼叫 brain 服務生成文字，寫進 `gen.*` | `prompt`、`outputKey`、`model`、`maxTokens`、`systemInstruction` |
| `ACTION` | 執行一個副作用動作 | `actionType`、`params` |

`MESSAGE` 與 `ACTION` 兩種節點不自己執行動作。`FlowRunner` 發 `canvas.send_message` 或 `canvas.action` 到 eventBus，`apps/api/src/modules/canvas/canvas.worker.ts` 接手執行：

- `canvas.send_message`：`channelType` 是 `email` 時查聯繫人信箱並套用 `templateView` 寄信；其他渠道透過對應的 channel plugin 發送。
- `canvas.action`：目前只實作 `add_tag`，其餘 `actionType` 直接忽略。

`WAIT` 節點開啟 `smartWindow` 時，`packages/core/src/canvas/smart-window.ts` 會把落在安靜時段的喚醒時間往後推。預設安靜時段是 22:00–08:00，順延到 09:00，時區預設 `Asia/Taipei`。

## 執行模型

### 觸發

`triggerType` 有四個值：`webhook`、`schedule`、`manual`、`event`。目前只有兩個值有程式支援：

| 來源 | 路徑 |
| --- | --- |
| 渠道訊息進來 | `webhook` 收到訊息 → `inbound-side-effects.ts` 的 `triggerWebhookFlow()` → `canvas.webhook.ts` 的 `handleWebhookFlowTrigger()` |
| 手動呼叫 | `POST /api/v1/canvas/:id/trigger` → `canvas.service.ts` 的 `triggerFlow()` |

`handleWebhookFlowTrigger()` 查出所有 `status` 為 `ACTIVE`、`triggerType` 為 `webhook` 的流程，再逐一比對 `triggerConfig` 的 `channelType`、`eventType` 與 `postbackPattern`。比對成立時，這個函式建立一份 `FlowExecution` 並啟動流程。

### 推進

`FlowRunner.run(executionId)` 是一個 while 迴圈：

1. 載入 `FlowExecution` 與流程的所有節點。狀態已是 `COMPLETED` 或 `FAILED` 就直接返回。
2. 起點是 `currentNodeId`。`currentNodeId` 為空值時，改用流程中的 `TRIGGER` 節點。
3. 每走一步先寫回 `currentNodeId`、`stepCount`、`contextVars`，再寫一筆 `node_entered` 的 `FlowLog`。
4. 執行節點。節點拋錯時，`FlowRunner` 把這份執行標記為 `FAILED`，並記下錯誤訊息。
5. `stepCount` 達到 `maxStepLimit`（預設 100）時，`FlowRunner` 標記 `FAILED`，訊息為 `Max step limit reached`。這道上限用來防止無窮迴圈。
6. 沒有下一個節點時，`FlowRunner` 標記 `COMPLETED`，並發出 `flow.completed` 事件。

### 暫停與喚醒

`WAIT` 節點回傳 `pause`。`FlowRunner` 接著把狀態改成 `WAITING`、寫入 `resumeAt`，然後結束這一次 `run()`。

喚醒有兩種機制，都定義在 `packages/core/src/canvas/scheduler.ts` 的 `scheduleWaitNode()`：

1. 優先用 BullMQ 的延遲工作。`scheduleWaitNode()` 以動態 import 載入 BullMQ；載入失敗時改用第二種機制。
2. 退回資料庫輪詢。`apps/api/src/modules/canvas/canvas.scheduler.ts` 每 60 秒執行一次 `processResumeQueue()`，一次取最多 50 筆 `resumeAt` 已到期的 `WAITING` 執行，先改成 `RUNNING` 再交給 `FlowRunner.run()`。先改狀態，避免輪詢器重複處理同一筆執行。

輪詢器跑在 API 行程內，不在 `apps/workers`。

## 程式碼分佈

| 檔案 | 職責 |
| --- | --- |
| `apps/api/src/modules/canvas/canvas.routes.ts` | `/api/v1/canvas` 的 CRUD、啟用、觸發、執行紀錄與成效查詢；同一個檔案另外匯出 `/api/v1/identity` 的路由 |
| `apps/api/src/modules/canvas/canvas.service.ts` | 流程 CRUD 與 `getFlowAnalytics()`，全部收 `TenantDb` |
| `apps/api/src/modules/canvas/canvas.webhook.ts` | 比對 webhook 事件與流程的 `triggerConfig` |
| `apps/api/src/modules/canvas/canvas.worker.ts` | 訂閱 eventBus，實際發訊息、寄信、貼標籤 |
| `apps/api/src/modules/canvas/canvas.scheduler.ts` | 每 60 秒輪詢到期的 `WAITING` 執行 |
| `packages/core/src/canvas/flow-runner.ts` | 狀態機主體 |
| `packages/core/src/canvas/scheduler.ts` | 排定喚醒時間，以及 `processResumeQueue()` |
| `packages/core/src/canvas/api-fetch-node.ts` | `API_FETCH` 節點 |
| `packages/core/src/canvas/ai-gen-node.ts` | `AI_GEN` 節點 |
| `packages/core/src/canvas/smart-window.ts` | 安靜時段順延 |
| `packages/core/src/canvas/types.ts` | `FlowContext`、`FlowNode` 等共用型別 |

`/api/v1/identity` 與 Canvas 共用 `canvas.routes.ts` 這個檔案，但它是另一項功能：人工審核系統自動產生的聯繫人合併建議，實作在 `packages/core/src/identity/merge-suggestion-service.ts`。

### 權限

`/api/v1/canvas` 全部要求 `canvas.use`；`/api/v1/identity` 全部要求 `identity.review`。兩組路由都先經過 `fastify.authenticate`。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 沒有前端頁面 | `apps/web` 內沒有任何程式碼呼叫 `/api/v1/canvas`。`InteractionNode.position` 存的是畫布座標，顯示原本的設計包含拖拉編輯器。目前只能透過 API 建立與操作流程 |
| `AI_GEN` 節點無法運作 | 節點呼叫 `BRAIN_SERVICE_URL` 的 `/api/generate`。這個環境變數在 repo 內沒有任何地方設定，預設值 `http://localhost:3001` 指向 API 自己，而 API 沒有這個路由。節點會拋錯，該次執行轉為 `FAILED`。相關項目見 `../system/AUDIT.md` 的 PKG-03 |
| `ACTION` 只支援 `add_tag` | 其他 `actionType` 會被 `canvas.worker.ts` 直接忽略，不會報錯 |
| `schedule` 與 `event` 兩種 `triggerType` 沒有觸發來源 | Zod schema 接受這兩個值，但沒有程式會依它們啟動流程 |
| 引擎不走租戶連線 | `flow-runner.ts` 使用未綁租戶的 `prisma` singleton，查詢以主鍵定位且不帶 `tenantId`。詳見 `../system/AUDIT.md` 的 RLS-01 |
| `CONDITION` 只支援四個運算子 | `eq`、`neq`、`contains`、`exists`。比較一律以字串進行，沒有數值或日期比較 |
