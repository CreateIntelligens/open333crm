## Context

#337 的規劃把副作用依「什麼時候執行、有什麼保證」分成三種時機（2026-10-27 決定）：

| 時機 | 保證 | 放什麼 |
| ---- | ---- | ------ |
| 交易內 | 與資料一起 commit 或一起 rollback | 資料寫入、稽核、outbox（`publish`、`enqueue`） |
| commit 之後，最多一次 | 失敗只記 log；rollback 時丟棄 | 推播（`notify`）、快取失效（本 change 新增 `afterCommit`） |
| 交易之外 | 依流程寫在 spec | 外部呼叫、bcrypt |

`TenantCtx` 提供的是時機，不為每種副作用各加一個方法。之後其他模組要在 commit 之後執行新的動作時，不必再修改 `inTenant()`。

## Goals / Non-Goals

**Goals:**

- 補上「commit 之後」與「交易內稽核」兩個缺口，讓 `role`、`agent` 能完整搬遷。
- 以試點驗證檢查清單：mock ctx 的單元測試、feature 測試、ratchet 數字只減不增。

**Non-Goals:**

- 不搬其他呼叫 `writeTenantAudit()` 的模組。這些模組在各自的階段改用 `recordTenantAudit()`。
- 不搬 `services/channel-visibility.ts`。`resolveChannelGrantScope(request)` 在交易開始之前執行，仍用 `request.tenantPrisma`。
- 不搬 `services/channel-team-access.ts` 中給 channel 模組用的函式（決策 5）。
- 不量測 UAT 的效能基準：`role`、`agent` 是低流量的設定頁。基準留到階段 3 搬 `case`、`conversation` 之前量測。

## Decisions

### 決策 1：`afterCommit` 等待完成，推播與快路徑不等待

`afterCommit(label, fn)` 登記的動作，與推播、快路徑放在同一份清單，commit 之後依登記順序執行。`afterCommit` 的動作會被 `await`，所以 `inTenant()` 回傳時、`tenantHandler()` 送出回應時，動作已經執行完。

理由：主規格 `permission-check` 要求「在修改的請求回應之前，清除這個角色的快取」。

- 不等待的話，前端收到成功回應後立即以舊權限呼叫，仍可能通過。
- 推播與快路徑維持不等待（主規格「佇列沒有回應時不阻擋回傳」）。

失敗時只記 log，`inTenant()` 照常回傳：資料已經 commit，回應不能變成失敗。權限快取另有 10 分鐘的存活時間兜底。

`afterCommit` 不需要 `io`，背景工作也可以用。

考慮過的替代方案：

- 為快取失效加專用方法（例如 `ctx.invalidateCache`）：每多一種副作用就要改一次契約。
- route 改用 `inTenant()`，commit 之後自己清快取：寫法與其他 route 不同，而且 service 要把「該清哪些快取」回傳給 route。
- 維持在交易內清除：保留 commit 之前清除、被舊資料寫回的競態。

風險：`@open333crm/core` 的 Redis client 設定 `maxRetriesPerRequest: null`，Redis 斷線時指令會等待重新連線。`afterCommit` 等待完成，所以 Redis 斷線時回應也會等待。現況下 `invalidateRolePermissions()` 同樣在回應之前執行，而且權限 guard 在 handler 之前就讀 Redis，所以本 change 沒有增加這個風險。

### 決策 2：`recordTenantAudit(ctx, input)` 丟出錯誤，`writeTenantAudit()` 保留

- `recordTenantAudit` 的 `input` 不含 `tenantId`，由 `ctx.tenantId` 填入，所以呼叫端無法寫到別的租戶。
- 寫入失敗時丟出錯誤。錯誤穿過 `inTenant()` 讓交易 rollback，route 回錯誤回應。
- `writeTenantAudit(prisma, input)` 保留給還沒搬的呼叫端，行為不變（接住錯誤，只記 log）。搬遷完成後刪除（階段 7）。

理由：在交易內接住資料庫錯誤，PostgreSQL 把交易標成 aborted，之後的查詢都失敗（SQLSTATE 25P02），COMMIT 也變成 rollback。實測（2026-10-27，本機 PostgreSQL 16 與 Prisma 6）：交易內建立角色、接住稽核的外鍵錯誤之後，`inTenant()` 回傳成功，但角色沒有寫進資料庫。所以 route 會回成功，資料卻沒有變更。所以交易內的稽核只有兩種選擇：一起成功，或一起失敗。對安全稽核來說，「操作成立但沒有紀錄」比「操作失敗」更糟，所以選擇一起失敗。

### 決策 3：service 收 ctx 之後，不再另外收 `tenantId`

照已搬模組（`coupon`、`store`）的寫法，service 從 `ctx.tenantId` 取得租戶 ID，不另外收 `tenantId` 參數。

例外：`listChannelsForAgent` 之外的 `channel-team-access.ts` 函式不變（決策 5）。

### 決策 4：bcrypt 在交易之外

雜湊與比對是 CPU 密集的工作（約 100 毫秒）。交易內執行時，交易與資料庫連線會一直被佔住。

- `createAgent`、`resetAgentPassword`：route 先算好雜湊，service 收 `passwordHash`。`createAgent` 內部的雜湊 fallback 刪除。
- `changeOwnPassword`：新密碼的雜湊在交易外先算好；比對目前的密碼要讀出既有的雜湊，所以仍在交易內。拆成兩個交易可以把比對也移出去，但兩個交易之間密碼可能被改，換來的只是約 100 毫秒的連線佔用。

### 決策 5：`channel-team-access.ts` 只搬成員用的兩個函式

這個檔案的函式分屬兩個模組：

- `setAgentChannels`、`listChannelsForAgent`：只有 `agent.routes.ts` 呼叫。本 change 改收 `TenantCtx`，`setAgentChannels` 不再自己開交易。
- `grantChannelTeamAccess` 等 4 個函式：只有 `channel.routes.ts` 呼叫，留到階段 4 搬 `channel`。
- `insertAgentChannelAccess`：`agent.service.ts` 與 `channel.service.ts` 都呼叫，仍收 `TenantDb`。已搬的呼叫端傳 `ctx.tx`。

這違反「同一個 service 檔要一次搬完」，但不違反這條規則要防止的事：檔案內沒有收 `TenantDb` 的函式呼叫收 `TenantCtx` 的函式。一次搬完整個檔案，會把 21 個 route 的 `channel` 模組拉進試點。

## Risks / Trade-offs

- [稽核寫入失敗時，主操作也失敗] → 這是決策 2 的取捨。稽核只寫一筆，沒有外部呼叫，失敗的原因只有資料庫本身出錯，這時主操作通常也會失敗。
- [交易變長] → 一個請求只開一次交易，查詢次數不變。`role`、`agent` 的 route 都只有少數幾個查詢。
- [`resolveChannelGrantScope` 在交易之外讀取] → 建立成員時，可指派的渠道範圍在交易開始之前讀出。與現況相同。
- [成員被永久刪除之後，未過期的 JWT 仍可呼叫] → JWT 不查資料庫，被刪除的成員在權杖過期前仍能呼叫 `role`、`agent` 的 route。原本操作成功、稽核遺失；現在稽核的 `actorId` 違反外鍵，整筆請求失敗。新的行為更合理，但錯誤回應是 400 `DATABASE_ERROR`，不是 401。
- [交易之前要做的工作，route 的寫法不一樣] → 建立成員、改密碼、重設密碼要在交易之前雜湊密碼，所以這三個 route 先做完交易外的工作，再呼叫 `tenantHandler(fastify, …)(request, reply)`。其他 route 直接把 `tenantHandler()` 當 handler。試點後檢討是否要讓 `tenantHandler()` 支援交易前的步驟。
