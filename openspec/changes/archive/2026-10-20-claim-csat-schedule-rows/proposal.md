## Why

滿意度問卷（CSAT）有兩個排程在 API 行程內執行：寄送滿意度問卷（`csat-send`）與問卷逾時結案（`csat-auto-close`）。BullMQ Job Scheduler 每一期只產生一筆 job，但這筆 job 可能執行兩次，兩期也可能重疊（AGENTS.md「A job can run more than one time」）。這兩個排程都先在 JS 裡檢查工單，再只用 `id` 更新，沒有用條件更新認領工單（issue #333，AUDIT APP-09）。結果是：

- 兩次執行都讀到「還沒寄」時，客人收到兩份問卷。
- 寄到一半時行程被強制結束，BullMQ 重跑，對話裡多一則問卷訊息。
- 客服在排程查詢之後重開工單，問卷照寄，或工單被蓋回 `CLOSED`。
- `case.closed` 發兩次，訂閱這個事件的對外 webhook 收到兩次。

部署時 Docker 會停掉 API，所以只有一個 API 實例時也可能發生。

## What Changes

- 寄送滿意度問卷：在建立問卷訊息之前，以條件更新寫入 `csatSentAt`。條件是工單屬於該租戶、狀態是 `RESOLVED`、`csatSentAt` 是空的。沒有更新到任何工單時，不建立訊息，不送到渠道。
- 問卷逾時結案：以條件更新把工單改成 `CLOSED`。條件是工單屬於該租戶、狀態是 `RESOLVED`、`csatRespondedAt` 是空的。沒有更新到任何工單時，不發布 `case.closed`，不推送 `case.updated`，不關閉對話。
- 兩者的行為從「可能重複處理」變成「可能少處理一次」：認領之後、做完之前行程被強制結束時，這張工單不會再處理。

不在本 change 的範圍：

- Canvas 等待節點喚醒（`canvas-resume`）的同類問題與等待節點的 bug，見 issue #334。
- 客人評分（`recordCsatScore()`）的條件更新。這不是排程。
- 工單重新解決時 `csatSentAt` 不會清除的問題。
- 非 LINE 渠道的客人無法回覆問卷（AUDIT CASE-02）。

## Capabilities

### New Capabilities

- `csat-survey`：滿意度問卷的生命週期：工單解決後寄出問卷、問卷逾時未回覆時結案。本 change 只寫入「每張工單最多寄一次」與「逾時結案不覆蓋已變更的工單」兩項行為。

### Modified Capabilities

（無）

## Impact

- `apps/api/src/modules/csat/csat.service.ts`：`sendCsatSurvey()`。
- `apps/api/src/modules/csat/csat.scheduler.ts`：`pollAutoClose()`。
- 沒有 schema 變更，也沒有 migration。
- 沒有 API 或前端的改動。
