## Context

`FlowRunner.run()` 每走一步先把 `currentNodeId` 寫成這一步的節點。等待節點回傳 `pause` 後，runner 只寫入 `WAITING` 與 `resumeAt`。
喚醒排程 `processResumeQueue()` 每 60 秒在 API 行程執行（`canvas-resume`，有 `withoutOverlapping`），以 singleton 查出到期的 execution，
以 `update({ where: { id } })` 改成 `RUNNING` 再呼叫 `FlowRunner.run(id)`。

## Goals / Non-Goals

**Goals:** 喚醒後從等待節點的下一個節點繼續；同一筆 execution 同時被兩次喚醒時只恢復一次；已停在等待節點的舊資料不會壞掉。

**Non-Goals:** `FlowRunner` 改走租戶連線（RLS-01）；移除或修好 BullMQ 的 `flow:resume`（APP-07）。

## Decisions

### D1：喚醒時略過等待節點，不在暫停時改寫 `currentNodeId`

issue 建議暫停時把 `currentNodeId` 寫成等待節點的 `nextNodeId`。這樣做有兩個問題：

- 等待節點是最後一個節點時，`nextNodeId` 是空值。`run()` 在 `currentNodeId` 為空值時從 `TRIGGER` 開始，喚醒會讓流程從頭再跑一次。
- 等待節點後面接另一個等待節點時，喚醒的 execution 停在第二個等待節點，這時要執行它；舊資料停在第一個等待節點本身，這時要略過它。
  兩者的資料形狀相同，無法區分，舊資料只能另外修補。

改為：暫停時 `currentNodeId` 留在等待節點（與修正前相同），喚醒排程以 `FlowRunner.run(id, { resumeFromWait: true })` 呼叫，
runner 看到 `currentNodeId` 是等待節點就寫一筆 `wait_resumed` 紀錄，改從它的 `nextNodeId` 繼續；沒有下一個節點時直接完成。
略過等待節點不增加 `stepCount`。舊資料與新資料形狀相同，不需要修補。

`currentNodeId` 不是等待節點時（不應該發生），寫 warning 並照原本的 `currentNodeId` 繼續。

### D2：條件更新認領，沿用 `claimOne()`

`claimDueExecution(tx, tenantId, id, now)` 以 `updateMany({ where: { id, tenantId, status: 'WAITING', resumeAt: { lte: now } }, data: { status: 'RUNNING', resumeAt: null } })`
認領，經 `packages/core/src/db/db-invariants.ts` 的 `claimOne()` 判斷 `count`。寫法與滿意度問卷逾時結案（#333）、附券廣播的 `claimCouponBroadcast()` 相同。

兩個交易同時更新同一列時，PostgreSQL 讓後到的等前一個 commit，再以新的列重新判斷 `WHERE`，所以後到的更新 0 筆。

`status` 與 `resumeAt` 兩個條件互為備援：第一次認領同時把 `resumeAt` 清空，所以只拿掉其中一個條件時，第二次認領仍然失敗。

### D3：掃描用 `prismaAdmin`，認領在 `withTenant` 交易內

`processResumeQueue(deps)` 收 `{ admin, inTenant, resumeFlow?, now? }`。`admin` 跨租戶查出到期的 execution（排程在 `prismaAdmin` 白名單內），
`inTenant` 由 API 傳入 `(tenantId, fn) => withTenant(app.prisma, tenantId, fn)`，認領在 app_tenant 連線上執行，RLS 生效，`where` 也帶 `tenantId`。
`packages/core` 不匯入 `withTenant`，也不再匯入 singleton（AGENTS.md 結構規則 2）。

認領的交易 commit 之後才呼叫 `resumeFlow`：`FlowRunner` 用另一條連線讀 execution。`FlowRunner` 先載入再進迴圈，
認領成功就同步開始恢復；排程不等流程跑完，與修正前相同。

## Risks / Trade-offs

- `FlowRunner` 仍用 singleton（RLS-01）：`DATABASE_URL` 指向 `app_tenant` 時，認領成功但 `FlowRunner` 讀不到 execution，execution 停在 `RUNNING`。這是修正前就有的問題，記在 AUDIT RLS-01。
- 認領之後、`FlowRunner` 開始之前行程結束時，execution 停在 `RUNNING`，沒有程式會再執行它。與手動觸發的已知限制相同。
