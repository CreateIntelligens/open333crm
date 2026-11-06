## Context

#337 階段 4 第二批。盤點與選擇的理由見 `tmp/337-入口開交易-規劃.md` 5.5（本機檔案，不在 git）。

`canvas` 模組的檔案：

- `canvas.service.ts`：流程的 CRUD、分析、執行紀錄與手動觸發，收 `TenantDb`。只被 `canvas.routes.ts` import。
- `canvas.routes.ts`：流程管理的 8 條路由（`/api/v1/canvas`），以 `request.tenantPrisma` 呼叫 service。同一個檔案也有 `identityRoutes`：身分合併建議的 3 條路由（`/api/v1/identity`），已經用 `withTenant(fastify.prisma, ...)` 開交易，核准之後以 `fastify.io.to(...).emit('contact.merged')` 直接推播。
- `canvas.webhook.ts`、`canvas.worker.ts`、`canvas.scheduler.ts`：引擎的入口，用 `@open333crm/database` 的 singleton。這一批不動（階段 5、6）。

`FlowRunner.run(executionId)` 在 `packages/core`。它以 singleton 讀 execution 與流程，依節點送訊息、呼叫外部 API、排等待。沒有前端呼叫 Canvas 的路由。

`identityRoutes` 用的 `listSuggestions`、`claimSuggestionForApproval`、`rejectMerge` 在 `@open333crm/core`，收 `(tx, tenantId, ...)`，可以直接接 `scope.tx`。核准呼叫的 `mergeContacts()`（`contact-merge.service.ts`）已經收 `TenantCtx`。

## Goals / Non-Goals

**Goals:**

- `canvas.service.ts` 的每個函式改收 `TenantCtx`，`canvas.routes.ts` 改呼叫 `canvas.flow.ts`。
- 手動觸發在交易內檢查流程與聯絡人，引擎在 commit 之後開始執行（spec）。
- 合併建議的路由搬到 `contact` 模組，推播改在 commit 之後送出。

**Non-Goals:**

- 核准合併建議時，系統不寫稽核，也不檢查渠道可見範圍。客服手動合併時，系統兩者都做。
  - 目前沒有程式產生合併建議（AUDIT IDENT-01），所以這一批不改這兩點。
  - 在 AUDIT IDENT-01 補記這兩個差異。
- 引擎、webhook 觸發、等待節點的恢復（RLS-01、APP-07）。

## Decisions

### D1. 手動觸發的檢查放在 service，與建立 execution 在同一個交易

`triggerFlow(ctx, flowId, contactId, vars)` 依序執行：

1. `interactionFlow.findFirst({ where: { id: flowId, tenantId } })`。沒有結果時丟 404（`notFound('flow')`）。狀態不是 `ACTIVE` 時，丟 409 `FLOW_NOT_ACTIVE`。
2. `contact.findFirst({ where: { id: contactId, tenantId } })`。沒有結果時丟 404（`notFound('contact')`）。
3. 建立 execution，回傳 `executionId`。

`where` 帶 `tenantId`，連線也有 RLS，兩層都擋另一個租戶的 id。外鍵檢查不套用 RLS，所以第 1 步不能省：只靠外鍵，另一個租戶的流程 id 仍能寫入。

另一個請求可能在檢查與寫入之間把流程改成 `ARCHIVED`。這種情況下，execution 照樣建立，引擎照樣執行。這一批不加鎖：搬遷前也沒有檢查狀態，這個情況不會比搬遷前差。

`RESOURCE_LABELS` 沒有流程時，加上 `flow: '互動流程'`。

**替代方案：** 加一個 `flow_executions.contactId` 的外鍵。不採用：外鍵同樣不套用 RLS，擋不住另一個租戶的聯絡人；而且要 migration，與搬遷無關。

### D2. 引擎在 `afterCommit` 開始執行

`triggerFlowFlow` 在 `inTenant()` 內呼叫 `triggerFlow()`，再登記：

```ts
scope.afterCommit('canvas.flow-run', () => {
  deps.runFlow(executionId).catch((err) => logger.error(...));
});
```

- `fn` 呼叫 `runFlow` 之後馬上 return，不等流程執行完。`afterCommit` 等 `fn` 結束之後，flow 才 return。如果 `fn` 等流程執行完，回應要等流程跑到等待節點或結束才送出。
- `runFlow` 是注入的依賴，預設是 `FlowRunner.run`。單元測試以假的 `runFlow` 檢查它在 commit 之後才被呼叫。
- 保證：最多開始一次。commit 之後、呼叫 `runFlow` 之前處理程序結束時，execution 停在 `RUNNING`，`processResumeQueue()` 只恢復 `WAITING`，所以沒有程式會再執行它。手動觸發只用在測試流程，接受這個限制，寫進 spec。
- 搬遷前，失敗以 `.catch(() => {})` 丟掉，沒有 log。改成寫 error log。

**替代方案：** 經 outbox 送進 BullMQ，由 worker 執行，至少一次。不採用：引擎本身不是冪等的。`FlowRunner.run` 從 `currentNodeId` 繼續，而 `currentNodeId` 在節點執行之前寫入，所以重新執行時會再執行一次中斷時的節點。至少一次會讓客人收到重複訊息。引擎要先能承受重複，這是階段 6 的事。

### D3. 執行紀錄的列表先查流程

`listExecutions(ctx, flowId, opts)` 先以 `findFirst({ where: { id: flowId, tenantId } })` 確認流程存在，不存在時丟 404。這樣它與 `getFlow`、`getFlowAnalytics` 一致（spec「流程管理只作用在本租戶的流程」）。

`getFlow`、`getFlowAnalytics` 用 `findFirstOrThrow`，Prisma 丟 `P2025`，錯誤處理器回 404。`updateFlow`、`activateFlow` 的 `update({ where: { id, tenantId } })` 找不到時也丟 `P2025`。在交易內丟出錯誤會 rollback，結果同樣是 404，所以保留這個寫法。

`getFlowAnalytics` 對 `TenantDb` 的 `as PrismaClient` 轉型改掉：`ctx.tx` 是單一型別，`groupBy` 可以直接呼叫。

### D4. 路由的 `:id` 以 Zod 解析

8 條路由的 `request.params` 以 `z.object({ id: z.string().uuid() })` 解析，取代泛型 `Params` 的轉型（AGENTS.md 的 Validation 慣例）。搬遷前，非 UUID 的 id 在 Prisma 丟 `P2023`，錯誤處理器的預設分支回 400，所以狀態碼不變，錯誤碼從 Prisma 的預設改成 `VALIDATION_ERROR`。

`config`、`triggerConfig`、`vars` 仍是 `z.record(z.unknown())`。引擎會讀這些值，要依節點類型定義 schema（#405），不在這一批。

### D5. 合併建議的路由搬到 `contact` 模組

- 新檔 `contact/merge-suggestion.routes.ts`，匯出 `mergeSuggestionRoutes`，`index.ts` 仍註冊在 `/api/v1/identity`。
- flow 加進 `contact.flow.ts`：
  - `listMergeSuggestionsFlow`：`flowOf` 包 core 的 `listSuggestions`。
  - `approveMergeSuggestionFlow`：認領建議、`mergeContacts()`（來源 `SUGGESTION`）、`notifyTenant(scope, io, 'contact.merged', ...)`。推播內容與手動合併相同，抽成 `contact.flow.ts` 內的一個函式，兩個 flow 共用。
  - `rejectMergeSuggestionFlow`：`flowOf` 包 `rejectMerge`。
- `SuggestionNotFoundError`、`SuggestionNotPendingError` 轉成 `AppError` 的函式隨路由搬走。
- 搬遷前，推播在 `withTenant()` return 之後送出，也已經在 commit 之後。改用 `notifyTenant()` 之後時機不變，只是改由 `socket-push.ts` 決定房間。

**替代方案：** 留在 `canvas` 模組拆檔。不採用：這些路由與 Canvas 無關，合併引擎與合併的 flow 都在 `contact`。

### D6. 建立與開始執行寫成兩個共用的函式

自動觸發（`canvas.webhook.ts`）這一批不搬，但它之後要做的事與手動觸發相同：在交易內建立 execution，commit 之後開始執行。為了不讓兩條路徑各寫一份，這一批把手動觸發拆成三個函式：

| 函式 | 檔案 | 做什麼 | 自動觸發之後是否沿用 |
| --- | --- | --- | --- |
| `assertFlowTriggerable(ctx, flowId, contactId)` | `canvas.service.ts` | D1 的第 1、2 步 | 不沿用。自動觸發自己查 `ACTIVE` 的流程，聯絡人由收訊流程解析 |
| `createFlowExecution(ctx, { flowId, contactId, vars })` | `canvas.service.ts` | 建立 `RUNNING` 的 execution，回傳 id | 沿用 |
| `startFlowAfterCommit(scope, runFlow, executionId)` | `canvas-effects.ts` | D2 的 `afterCommit` 與失敗的 log | 沿用 |

`triggerFlow()` 依序呼叫前兩個，`triggerFlowFlow` 再呼叫第三個。寫法同 `coupon/coupon-effects.ts`：多個入口共用的副作用寫在一個模組函式裡。

自動觸發搬遷時（`webhook` 收訊模組，階段 4；引擎連線，階段 6），在收訊的交易內查流程、呼叫 `createFlowExecution()`，再呼叫 `startFlowAfterCommit()`。

## Risks / Trade-offs

- [手動觸發的 409、404 是新的錯誤] → 沒有前端呼叫 Canvas 的路由；CLI 與 MCP 也沒有 Canvas 的指令。CHANGELOG 寫明。
- [引擎仍用 singleton] → 搬遷後，execution 在 commit 之後才交給引擎，引擎讀得到。`DATABASE_URL` 指向 `app_tenant` 時，引擎仍讀不到任何列（RLS-01），與搬遷前相同。
- [`/:id/analytics` 是長讀取的端點，搬進交易後佔連線的時間變長] → 搬遷前後各量一次回應時間（規劃 6.3）。UAT 沒有流程，所以在本機用 seed 加上產生的執行紀錄量測。

## Migration Plan

沒有 migration。部署之後不需要額外步驟。回復時 revert 這個 PR 即可。
