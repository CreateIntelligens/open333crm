## Context

兩個排程都在 `apps/api/src/modules/csat/csat.scheduler.ts` 註冊，以 `app.prismaAdmin` 執行（`apps/api/src/index.ts` 的 `setupCsatScheduler()`）。

- 寄送滿意度問卷：`pollSendCsat()` 查出候選工單，逐一呼叫 `csat.service.ts` 的 `sendCsatSurvey(prisma, io, caseId)`。`sendCsatSurvey()` 依序做：讀工單並在 JS 裡檢查、建立問卷訊息、以 `id` 寫入 `csatSentAt`、更新對話的 `lastMessageAt`、推送 `message.new`、送到渠道。
- 問卷逾時結案：`pollAutoClose()` 查出候選工單，逐一以 `id` 改成 `CLOSED`、發布 `case.closed`、推送 `case.updated`、呼叫 `closeConversationsForCase()`。

AGENTS.md「A job can run more than one time」要求排程在寄信或改狀態之前，先以條件更新認領資料。trial 的排程在 #313 已照這個結構改寫：讀取 → 認領 → 寄信與稽核。

## Goals / Non-Goals

**Goals:**

- 兩個排程都改成「讀取 → 認領 → 做事」，認領失敗就不做事。
- 每個認領失敗的情境都有一個先失敗、修正後通過的測試。

**Non-Goals:**

- 不加 `withoutOverlapping`。條件更新已經能擋住重疊時的重複處理，鎖只會增加一個要調的存活時間。
- 不改候選工單的查詢條件、批次大小、延遲時間與逾時時間。

## Decisions

### D1：寄送問卷時，先寫 `csatSentAt` 再建立訊息

認領用 `case.updateMany({ where: { id, tenantId, status: 'RESOLVED', csatSentAt: null }, data: { csatSentAt: now } })`。`count === 0` 時回傳 `false`。認領成功後才建立問卷訊息、更新對話、推送與送到渠道。後面的步驟改用同一個 `now`，所以訊息時間與 `csatSentAt` 一致。

`tenantId` 取自前一步讀到的工單。`sendCsatSurvey()` 的參數不變，呼叫端不用改。

替代做法：把認領、建立訊息、更新對話包進同一個 transaction，建立訊息失敗時認領一起還原，下一期會再寄。沒有採用，原因是：

- `sendCsatSurvey()` 收的是 `TenantDb`，呼叫端可能已經傳入 transaction client，不能再開巢狀的 transaction。
- 送到渠道是外部呼叫，不能放進 transaction，所以 transaction 也擋不住「已送出但沒寫入」或「已寫入但沒送出」。
- 現在渠道送信失敗時 `csatSentAt` 也照樣寫入，問卷不會重寄。先認領的行為與現況一致。

不包 transaction，所以建立訊息失敗時要自己還原認領（PR #335 審查意見）。修正前建立訊息失敗時 `csatSentAt` 還沒寫入，下一期會重試；只改成先認領的話，這張工單之後每一期都認領失敗，問卷永遠不會寄出。

- `message.create()` 丟錯時，以 `case.updateMany({ where: { id, csatSentAt: now }, data: { csatSentAt: null } })` 還原，再重新丟出錯誤。條件是這次寫入的時間，只還原自己的認領；認領之後別的執行都認領失敗，不會在還原前插進來。
- 只還原 `message.create()` 的失敗。訊息建立之後的步驟失敗時不還原，否則下一期會再建立一則問卷訊息。
- 行程在認領之後被強制結束時，還原的程式不會執行，仍是下面「Risks」的「少處理一次」。

### D2：逾時結案的認領就是結案本身

`case.update({ where: { id } })` 改成 `case.updateMany({ where: { id, tenantId: c.tenantId, status: 'RESOLVED', csatRespondedAt: null }, data: { status: 'CLOSED', closedAt: now } })`。`count === 0` 時跳過這張工單，不發布事件、不推送、不關閉對話。

條件不包含 `csatSentAt` 的時間。候選查詢已經用它篩選；`csatSentAt` 只由寄送問卷寫入一次，認領之前不會被改變。

### D3：用 unit test 重現「讀取之後被搶走」

這個時序要兩次執行交錯才會出現，feature test 無法穩定重現。unit test 讓 mock executor 在讀取時回傳「還沒處理」、在 `updateMany` 時回傳 `{ count: 0 }`，模擬另一次執行或客服在中間改了工單。修正前的程式不呼叫 `updateMany`，會照樣建立訊息或發布事件，所以 assertion 會失敗。

`pollAutoClose()` 是 `setupCsatScheduler()` 內的函式。測試傳入一個假的 `JobScheduler`，從 `registerSchedule()` 的參數取得 `run`。`closeConversationsForCase()` 與 `eventBus` 以 `vi.mock()` 或 spy 觀察。

不另寫 feature test。在真的資料庫上，「讀取之後被搶走」同樣無法穩定重現；工單一開始就不符合條件時，修正前的 JS 檢查也會擋下，測試不會先失敗。既有的 `tests/feature/modules/csat/` 仍要通過。

## Risks / Trade-offs

- [認領之後、做完之前行程被強制結束，這張工單不會再處理] → 問卷少寄一次，或工單已結案但沒有發事件、沒有關閉對話。重複寄問卷與覆蓋客服的操作比少做一次更糟，所以接受。發生時 log 會缺少「Sent CSAT survey」或「Auto-closed case」那一行，可以從 log 查出。
- [認領失敗時沒有 log] → 加一行 info log，寫明工單 id 與「已被處理或狀態已改變」，方便事後查證。
