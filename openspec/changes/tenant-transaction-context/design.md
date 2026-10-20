## Context

現況的三種 client 與各自的保證，見 issue #337 本文。跟本設計有關的現況：

- `apps/api/src/lib/tenant-db.ts` 的 `withTenant(prisma, tenantId, fn)` 已經符合主規格 `tenant-isolation-rls` 的「交易內注入租戶身分」：驗證 UUID，以 `set_config(..., true)` 設定租戶，再把 `tx` 交給 `fn`。
- 25 處呼叫 `withTenant(`，其中 16 處在 route 檔。route 寫法是 `withTenant(fastify.prisma, request.agent.tenantId, (tx) => service(tx, ...))`，回應在 commit 之後才送出，但 service 內的 `io.emit` 與 `eventBus.publish` 在 commit 之前就執行（例如 `case.service.ts` 的 `deleteCase()`）。
- `eventBus`（`apps/api/src/events/event-bus.ts`）是行程內的 EventEmitter。`publish()` 不等訂閱者執行完，訂閱者的錯誤由訂閱者自己記錄。
- Prisma 互動式交易的預設逾時是 5 秒，`maxWait` 是 2 秒。專案沒有調整。
- `scripts/check-prisma-admin-usage.mjs` 由單元測試 `apps/api/tests/unit/prisma-admin-whitelist.test.ts` 執行，所以 `pnpm test` 會跑到它。新的檢查腳本照同樣的方式接進 `pnpm test`。

整體搬遷計畫（階段 1～7）見 #337 的留言。本 change 是階段 1。

## Goals / Non-Goals

**Goals:**

- 提供新寫法需要的全部基礎：`TenantCtx`、`inTenant()`、`tenantHandler()`、測試用的 mock ctx。
- 新寫法的保證可以只讀 service 的參數型別就知道：有 RLS，同一個 ctx 內的寫入一起成功或一起失敗，推播與事件在 commit 之後才送出。
- 搬遷期間舊寫法只減不增。

**Non-Goals:**

- 不搬任何既有模組。階段 2 先試做 tag、role。
- 不做 outbox。`ctx.publish` 先交給 `eventBus`，保證與現況相同（最多一次）。階段 1b 再改，屆時以 MODIFIED 修改「事件最多送出一次」這條需求。
- 不改 `apps/workers` 與 `packages/core`。
- 不調整交易逾時（#337 規劃的 D4）。

## Decisions

### 1. `inTenant()` 建立在 `withTenant()` 上

```ts
export interface TenantCtx {
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
  emit(room: string, event: string, data: unknown): void;
  publish(name: AppEventName, payload: Record<string, unknown>): void;
}

export function inTenant<T>(
  deps: { prisma: PrismaClient; io?: Server },
  tenantId: string,
  fn: (ctx: TenantCtx) => Promise<T>,
): Promise<T>;
```

- 在 `withTenant()` 外面加一層，不另寫一份 `set_config`。UUID 驗證與 `SET LOCAL` 的語意都沿用既有、已經有主規格的實作。
- `emit` 與 `publish` 只把要做的事放進一個陣列。`withTenant()` resolve（也就是 commit 成功）之後，才依序執行。`withTenant()` reject 時陣列直接丟棄，錯誤原樣往外丟。
- 每一項各自包 `try/catch`，失敗時用 `@open333crm/core` 的 `logger` 記錄，再繼續下一項。理由：資料已經 commit，回應不該因為推播失敗而變成錯誤。
- `publish` 自己填 `tenantId` 與 `timestamp`，service 只給事件名稱與 payload。這樣事件的租戶一定等於交易綁定的租戶。
- `deps.io` 是選填，因為部分背景工作沒有 `io`。沒有 `io` 時呼叫 `emit`，會在交易內立刻丟錯，讓交易 rollback。這是寫錯程式，要在測試階段就發現，不要等到 commit 之後才默默丟掉推播。
- 房間以 `tenant:` 開頭、但不是 `tenant:<ctx.tenantId>` 時，`emit` 也在交易內丟錯（PR #341 審查意見）。`conversation:`、`agent:` 房間沒有租戶前綴，這個檢查擋不到，要由呼叫端確認 ID 屬於本租戶。房間名稱統一帶租戶 ID 之後才能全面檢查，見 #342 與 AUDIT RLS-09。不採用「`emit` 只能推到租戶房間」：既有程式有推到 `conversation:`、`agent:` 房間的需求。測試用的 `createMockTenantCtx()` 做同樣的檢查。

替代方案：`ctx` 只放 `afterCommit(fn)` 一個方法，推播和事件都由 service 自己寫 callback。不採用的原因：階段 1b 要把事件改走 outbox，事件必須是資料（名稱加 payload），才能寫進資料表。callback 寫不進去。

### 2. `tenantHandler()` 在 commit 之後送出回應

示意寫法（不是實際的 route）：

```ts
fastify.post<{ Params: { id: string } }>('/:id/resolve', { preHandler: [perm.update] },
  tenantHandler(fastify, async (request, reply, ctx) => {
    reply.code(201);
    return success(await resolveSomething(ctx, request.params.id));
  }));
```

- 回傳一個 Fastify handler。這個 handler 從 `request.agent?.tenantId` 取租戶 ID，沒有時丟 `AppError('需要已登入的租戶身分', 'UNAUTHORIZED', 401)`，不開交易。
- 交易內的程式回傳回應內容，`tenantHandler` 等 `inTenant()` 結束之後才把它交給 Fastify 送出。
- 交易內的程式拿到的 `reply` 型別只有 `code()`、`status()`、`header()`，沒有 `send()`。在交易內送出回應，等於 commit 之前就告訴前端成功，所以用型別擋掉。
- 交易內設定的狀態碼與 header 先存起來，commit 之後才套用到 Fastify 的 `reply`（PR #341 審查意見）。直接改 `reply` 的話，交易失敗時 error handler 雖然會重設狀態碼，但 `Location` 這類 header 會留在錯誤回應上。
- 型別參數沿用 Fastify 的 `RouteGenericInterface`，`request.params`、`request.body` 的型別與現在的 route 相同。

替代方案：用 Fastify hook 自動開交易，不必每個 route 手動包。Prisma 沒有手動 `BEGIN`／`COMMIT` 的 API，交易只在 `$transaction()` 的 callback 執行期間存在，但仍有兩種做法：

- **A. 用 promise 撐住 callback，跨 hook 使用。** `preHandler` 開交易，callback 拿到 `tx` 後 `await` 一個尚未 resolve 的 promise。`onSend` resolve 這個 promise，等 commit 完成才送出回應。`onError` 與 `onRequestAbort` 讓 callback 丟錯以 rollback。
- **B. 用 `onRoute` hook 換掉 handler。** 註冊 route 時，自動把 handler 包進 `inTenant()`，效果等於自動套用 `tenantHandler()`。

兩種做法的好處都是搬遷時 route 幾乎不用改。不採用的原因：

- **從 route 看不出有沒有交易、什麼時候 commit。** #337 要解決的正是「要往外追才知道保證」，A 與 B 又把這件事藏回 route 之外。
- **A 要自己處理交易結束的每一條路徑。** 成功、handler 丟錯、客戶端中途斷線，各要一個 hook。漏掉一條，連線就一直佔住，直到 Prisma 的 5 秒逾時 rollback。commit 失敗時能不能把回應改成錯誤，要看 Fastify 5 如何處理 `onSend` 丟出的錯誤，未驗證。5 秒的計時也會包含序列化回應的時間。
- **B 擋不住在交易內送出回應。** 既有 handler 都寫 `return reply.send(...)`，自動包進交易後，回應會在 commit 之前送出。手動包可以用型別拿掉 `send()`，B 只能在執行時檢查。

### 3. 測試用的 mock ctx

`apps/api/tests/support/mock-tenant-ctx.ts` 提供 `createMockTenantCtx(tx, tenantId?)`，回傳：

- `ctx`：`tx` 用呼叫端給的 mock。`emit`、`publish` 只記錄，不送出。
- `emitted`、`published`：記錄下來的推播與事件，讓測試斷言 service 登記了什麼。

service 的單元測試只需要確認「登記了什麼」。「commit 之後才送出」由 `inTenant()` 自己的測試負責，不必在每個 service 的測試重複。

### 4. ratchet 檢查腳本

`scripts/check-tenant-ctx.mjs`：

| 寫法 | 掃描範圍 |
| --- | --- |
| `TenantDb` | `apps/api/src` 全部 |
| `request.tenantPrisma`（含 `req.tenantPrisma`） | `apps/api/src` 全部 |
| `withTenant(` | service 檔：`*.service.ts`，以及 `apps/api/src/services/` |
| `$transaction(` | 同上 |
| `inTenant(` | 同上，基準 0 |

- 基準檔是 `scripts/check-tenant-ctx.baseline.json`，記錄每種寫法在每個檔案的次數。比較時以檔案為單位：任一檔案的次數變多就算增加，輸出該檔案路徑。只看總數的話，一個檔案減少、另一個檔案增加會互相抵銷。
- 次數減少時提示執行 `--update-baseline` 重寫基準檔。
- 用文字比對計數，註解裡的字也會算到。基準檔同樣是這樣算出來的，所以只要比較方式一致，就不影響「只減不增」。
- 支援 `--scan-dir` 與 `--baseline`，讓測試可以用暫存目錄驗證腳本本身。
- 新增單元測試 `apps/api/tests/unit/tenant-ctx-ratchet.test.ts`，在 `pnpm test` 時對 repo 執行 `--strict`。做法與 `prisma-admin-whitelist.test.ts` 相同，因為目前沒有 CI。

### 5. 檔案位置

新程式放在 `apps/api/src/lib/tenant-ctx.ts`，不放進 `tenant-db.ts`。階段 7 會刪掉 `tenant-db.ts` 裡的 `tenantScopedClient` 與 `TenantDb`，到時只會刪到舊的部分，不會動到新的。

## Risks / Trade-offs

- [搬遷之後，每個請求整段佔用一條連線] → 本 change 不搬模組，沒有影響。階段 2 試做時量測，`DATABASE_URL` 目前沒有設 `connection_limit`。
- [交易內的 `Promise.all` 會依序執行] → 同上，階段 2 量測。
- [交易內有外部呼叫時，會超過 5 秒逾時] → AGENTS.md 的新規則寫明「外部呼叫不能放在交易內」。搬遷 PR 依 #337 的檢查清單逐檔確認。
- [ratchet 只計數，不判斷語意] → 它的用途只是不讓舊寫法變多。新寫法是否正確，由 code review 與測試把關。
- [ratchet 以正規式比對，擋不住刻意繞過的寫法] → 它防的是照舊習慣寫出的一般寫法，例如 `withTenant(`、`inTenant<T>(`。泛型參數內含括號這類寫法要靠 code review 發現。不採用 TypeScript AST：要重寫計數方式並重算基準，換來的只是擋住罕見寫法（PR #341 審查時決定）。
- [`tenantHandler()` 的泛型與 Fastify 的型別推導不合] → 階段 2 試做時若推導不出 `request.params` 的型別，回頭調整 `tenantHandler()` 的型別，不在 route 裡加 `as`。

## Migration Plan

本 change 只新增程式與文件，不改既有程式的行為。部署不需要額外步驟，回滾就是 revert 這個 PR。

## Open Questions

無。
