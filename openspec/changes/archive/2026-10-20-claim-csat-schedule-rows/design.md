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

寄送問卷有外部送出，做不到「剛好一次」，只能在「最多一次」與「至少一次」之間選一個。本 change 選**最多一次**：認領之後任何一步失敗，或行程中途結束，都不還原 `csatSentAt`，這份問卷不再寄。理由：

- 客人收到兩份問卷，比少收一份更糟。
- 建立訊息失敗與送到渠道失敗都是「少寄一份」，後果相同，用同一條規則處理。修正前渠道送信失敗時 `csatSentAt` 也照樣寫入，不會重寄。
- 不必判斷「失敗時訊息到底有沒有寫入」。連線在 commit 之後、回傳之前中斷時，程式無法可靠地判斷，任何補救都可能猜錯。

替代做法：把認領、建立訊息、更新對話包進同一個 transaction，資料庫出錯時一起還原，下一期重試，外部送出仍是最多一次。這個做法可行：`sendCsatSurvey()` 唯一的呼叫者是排程，傳入 `prismaAdmin`；照 `apps/api/src/lib/tenant-db.ts` 的規則，把參數改成 `PrismaClient` 就能開 transaction。沒有採用，是因為它只多處理「資料庫短暫出錯」這種很少見的情況，在最多一次的保證下用不到。之後若要讓資料庫出錯時重試，改用這個做法即可。

審查紀錄：PR #335 的審查機器人先指出「建立訊息失敗會少寄」，曾以 catch 還原認領（`66e0d5d5`）；第二次審查指出「訊息可能已經寫入，還原會造成重寄」。兩次都是在沒有先定下保證時做的補救，已撤回，改為明訂最多一次。這段經過也讓 `TenantDb` 的問題浮上來，見 issue #337。

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
