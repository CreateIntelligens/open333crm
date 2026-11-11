## Why

issue #334：Canvas 流程永遠過不了等待（WAIT）節點。`FlowRunner.run()` 暫停時 `currentNodeId` 停在等待節點，
喚醒時又從 `currentNodeId` 開始，於是再執行同一個等待節點、再暫停，直到 `stepCount` 達到 `maxStepLimit` 被標成 `FAILED`。

喚醒排程 `processResumeQueue()` 也只以 `id` 把 execution 改成 `RUNNING`，沒有條件。`withoutOverlapping` 的鎖過期後兩期同時執行時，
同一個 execution 會被恢復兩次，訊息節點送兩次（AUDIT APP-09）。

主規格 `interaction-canvas` 的「節點執行引擎」只寫「必須支援等待節點」，沒有寫喚醒後從哪個節點繼續，也沒有寫同一次等待只喚醒一次，
所以開 change 補上規格。

## What Changes

- 喚醒時略過讓流程暫停的等待節點，從它的 `nextNodeId` 繼續；等待節點沒有下一個節點時流程完成（`FlowRunner.run(id, { resumeFromWait: true })`）。
- 暫停時 `currentNodeId` 仍停在等待節點，與修正前寫入的資料形狀相同，所以已經停在等待節點的舊資料喚醒後也從下一個節點繼續，不需要修補資料。
- `processResumeQueue()` 改收執行器：跨租戶掃描用 `prismaAdmin`，每筆在 execution 所屬租戶的 `withTenant` 交易內以
  `updateMany({ where: { id, tenantId, status: 'WAITING', resumeAt: { lte: now } } })` 認領（沿用 `claimOne()`），
  更新 1 筆才恢復，0 筆略過。commit 之後才交給 `FlowRunner`。
- `processResumeQueue()` 不再使用 module-level 的 `prisma` singleton（RLS-01 的這一部分）。`FlowRunner` 本身仍用 singleton，RLS-01 其餘部分不在本 change。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `interaction-canvas`：修改「節點執行引擎」（等待節點喚醒後從下一個節點繼續）；新增「同一次等待只喚醒一次」。

## Platform layer

沒有任何一項適用：本 change 只修正 Canvas 引擎的喚醒行為，不新增權限碼、功能模組、方案上限、AI 呼叫、渠道類型、租戶設定、平台稽核動作或 BullMQ 佇列。

## Impact

- `packages/core/src/canvas/flow-runner.ts`、`packages/core/src/canvas/scheduler.ts`
- `apps/api/src/modules/canvas/canvas.scheduler.ts`、`apps/api/src/index.ts`（`setupCanvasScheduler()` 改收 `{ admin, prisma }`）
- 不需要資料庫 migration。UAT 的 `flow_executions` 是 0 筆，不需要修補資料。
- 不處理：`scheduleWaitNode()` 的 BullMQ 路徑（AUDIT APP-07）、`FlowRunner` 與 `canvas.webhook.ts` 的 singleton（RLS-01 其餘部分）。
