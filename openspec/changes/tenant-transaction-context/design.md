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

- 提供新寫法需要的全部基礎：`TenantCtx`、`inTenant()`、`tenantHandler()`、測試用的 mock ctx、決定推播房間的模組、交易內處理唯一約束與條件認領的共用函式。
- 新寫法的保證可以只讀 service 的參數型別就知道：有 RLS，同一個 ctx 內的寫入一起成功或一起失敗，推播、事件與佇列 job 在 commit 之後才送出，推播不會送到別的租戶的 `tenant:` 房間。
- 搬遷期間舊寫法只減不增。

**Non-Goals:**

- 不搬任何既有模組。階段 2 先試做 role、agent。
- 不做 outbox。`ctx.publish` 先交給 `eventBus`，保證與現況相同（最多一次）。階段 1b 再改，屆時以 MODIFIED 修改「事件最多送出一次」這條需求。
- 不改 `apps/workers` 與 `packages/core`。
- 不調整交易逾時（#337 規劃的 D4）。

## Decisions

### 1. `inTenant()` 建立在 `withTenant()` 上

```ts
export interface TenantCtx {
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
  notify(name: TenantPushName, data: unknown): void;
  notifyAgent(agentId: string, name: AgentPushName, data: unknown): void;
  publish(name: AppEventName, payload: Record<string, unknown>): void;
  enqueue(queue: Queue, name: string, data: unknown, opts?: JobsOptions): void;
}

export interface TenantCtxDeps {
  prisma: PrismaClient;
  /** 沒有 io 的背景工作不能推播 */
  io?: Server;
  /** 業務事件的送出方式；route 與背景工作傳 eventBus */
  events: EventPublisher;
}

export function inTenant<T>(deps: TenantCtxDeps, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>): Promise<T>;
```

- 在 `withTenant()` 外面加一層，不另寫一份 `set_config`。UUID 驗證與 `SET LOCAL` 的語意都沿用既有、已經有主規格的實作。
- `notify`、`notifyAgent`、`publish`、`enqueue` 只把要做的事放進一個陣列。`withTenant()` resolve（也就是 commit 成功）之後，才依序執行。`withTenant()` reject 時陣列直接丟棄，錯誤原樣往外丟。
- 每一項依序執行並 `await`，各自包 `try/catch`。失敗時用 `@open333crm/core` 的 `logger` 記錄，再繼續下一項。理由：資料已經 commit，回應不該因為推播或送 job 失敗而變成錯誤。`queue.add()` 回傳 promise，不 `await` 的話，失敗會變成未處理的 rejection。`await` 讓回應多等一次 Redis 寫入，通常在毫秒內完成。
- `publish` 自己填 `tenantId` 與 `timestamp`，service 只給事件名稱與 payload。這樣事件的租戶一定等於交易綁定的租戶。
- **事件的送出方式從 `deps.events` 注入，`inTenant()` 不 import `eventBus` 單例。** `io` 已經從 `deps` 注入，事件也應該一樣。階段 1b 改走 outbox 時，只要換掉注入的實作，不必改 `inTenant()`。單元測試也不必 `vi.mock` 整個 `event-bus.js`。`tenantHandler()` 傳入 `eventBus`。
- `deps.io` 是選填，因為部分背景工作沒有 `io`。沒有 `io` 時呼叫 `notify` 或 `notifyAgent`，會在交易內立刻丟錯，讓交易 rollback。這是寫錯程式，要在測試階段就發現，不要等到 commit 之後才默默丟掉推播。
- `enqueue` 收呼叫端的 BullMQ `Queue`，不從 `deps` 注入。各模組已經各自持有自己的佇列（例如 `data-export.service.ts` 的 `exportQueue()`），由 `deps` 列舉所有佇列反而讓 `inTenant()` 依賴每個模組。保證是最多一次，與推播相同。階段 1b 改由 outbox 送出，保證變成至少一次。

替代方案：`ctx` 只放 `afterCommit(fn)` 一個方法，推播、事件、job 都由 service 自己寫 callback。不採用的原因：階段 1b 要把事件與 job 改走 outbox，它們必須是資料（名稱加 payload），才能寫進資料表。callback 寫不進去。

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

另一個替代方案：`inTenant()` 把 `ctx` 放進 Node 的 `AsyncLocalStorage`，service 不收 `ctx` 參數，而是呼叫 `getCtx()` 取出目前的交易。NestJS 的 `@nestjs-cls/transactional` 用的就是這個做法。好處是 service 的簽名不變，搬遷的改動少。不採用的原因：

- **只讀 service 看不出保證。** 要追呼叫鏈上有沒有 `inTenant()`，這正是 #337 要解決的問題。
- **忘了開交易，要到執行時才發現。** 收 `ctx` 參數時，這是編譯錯誤。
- **交易內啟動、但沒有 await 的非同步工作會繼承 `ctx`。** 這些工作在交易結束之後才執行時，查詢會失敗（`Transaction already closed`）。收 `ctx` 參數時，這些工作拿不到 `ctx`，不會誤用。
- 單元測試要先呼叫 `run()` 把 ctx 放進去，不能直接傳 mock ctx。

### 3. 測試用的 mock ctx

`apps/api/tests/support/mock-tenant-ctx.ts` 提供 `createMockTenantCtx(tx, tenantId?)`，回傳：

- `ctx`：`tx` 用呼叫端給的 mock。`notify`、`notifyAgent`、`publish`、`enqueue` 只記錄，不送出。
- `pushed`、`published`、`enqueued`：記錄下來的推播、事件與 job，讓測試斷言 service 登記了什麼。`pushed` 記錄的是系統決定的房間，所以測試也能斷言推播送到哪個房間。

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

### 6. 推播的房間由集中的模組決定

`apps/api/src/events/socket-push.ts` 定義推播的種類，並決定每種推播送到哪個房間：

```ts
export type TenantPushName = 'message.new' | 'conversation.updated' | 'conversation.created' | 'case.created'
  | 'case.updated' | 'case.deleted' | 'contact.merged' | 'contact.merge_reverted' | 'link.stats.updated';
export type AgentPushName = 'notification.new';

export function tenantPushRoom(tenantId: string): string; // tenant:<tenantId>
export function agentPushRoom(agentId: string): string;   // agent:<agentId>
```

- service 只說「什麼東西變了」，不說推到哪個房間。`ctx.notify` 的房間一律由 `ctx.tenantId` 組成，所以從結構上不可能推到別的租戶的 `tenant:` 房間。原本 `ctx.emit(room, …)` 在執行時檢查 `tenant:` 前綴的做法，以及對應的 Scenario「推播到別的租戶房間」，一起移除。
- 推播名稱用型別列舉。全租戶推播與給客服人員的推播是兩個型別，用錯方法是編譯錯誤。名單是 `apps/api` 現在推到 `tenant:`、`agent:` 房間的全部名稱（2026-10-21 以 grep 盤點）。其中 5 種沒有前端監聽，要不要刪除已在 #337 詢問，在答覆之前先保留，讓既有程式可以照原樣搬遷。
- 不提供推到 `conversation:` 房間的方法。這個房間沒有任何連線加入（#337 規劃第 8 節），既有程式推到這個房間的推播，搬遷時直接刪除。
- `agent:` 房間沒有租戶前綴，這個模組無法檢查客服人員 ID 屬於哪個租戶，所以 spec 要求呼叫端只用交易內查詢取得的 ID。#342 統一房間名稱之後，只要改這個模組。之後的渠道可見範圍（AUDIT RBAC-04）也在這個模組實作。
- 不採用「推播由業務事件推導」：webhook 訂閱 `*`，畫面通知變成事件之後，租戶就能訂閱到；而且 `message.new` 這類只用來更新畫面的推播，沒有對應的業務事件。

### 7. 交易內處理唯一約束與條件認領的共用函式

`apps/api/src/lib/db-invariants.ts`：

```ts
export function createOrFindExisting<T>(
  create: () => Promise<T[]>,              // 例如 () => ctx.tx.tag.createManyAndReturn({ data: [row], skipDuplicates: true })
  findExisting: () => Promise<T | null>,
): Promise<{ row: T; created: boolean }>;

export function claimOne(update: () => Promise<{ count: number }>): Promise<boolean>;
```

- **為什麼需要 `createOrFindExisting`：** 現有的寫法是撞到 P2002 之後接住錯誤，再查一次。搬進同一個交易後，PostgreSQL 的交易在第一個錯誤之後進入 aborted 狀態，之後的查詢全部失敗。`createManyAndReturn` 加 `skipDuplicates` 的底層是 `INSERT … ON CONFLICT DO NOTHING`，衝突時不丟錯，只回傳實際寫入的資料列，所以交易仍可使用。Prisma 6 沒有 savepoint 的 API，這個做法不需要 savepoint。
- 函式以兩個 callback 接收寫入與查詢，不收 model 名稱。泛型地包裝 Prisma 的 model delegate 會失去 `select` 決定的回傳型別，也可能撞上 TS 的推導上限（`TenantDb` 曾造成 470 個 TS2349）。
- `create` 回傳超過 1 筆時丟錯：這個函式只寫入一筆。
- `skipDuplicates` 會略過任何唯一約束的衝突，不只呼叫端想到的那一個。所以略過之後查不到既有資料時，函式丟錯，不回傳空值。
- **`claimOne`：** 條件更新認領的寫法在 repo 裡有 11 處，各自檢查 `count`。共用函式多做一件事：更新筆數大於 1 時丟錯，因為認領條件寫錯（例如 where 漏了 id）會一次認領多筆。
- 這兩個函式只處理和 model 無關的寫法。某個 model 的查詢條件，放在該模組的 queries 檔（#337 規劃 D7），不在本 change 的範圍。

## Risks / Trade-offs

- [搬遷之後，每個請求整段佔用一條連線] → 本 change 不搬模組，沒有影響。階段 2 試做時量測，`DATABASE_URL` 目前沒有設 `connection_limit`。
- [交易內的 `Promise.all` 會依序執行] → 同上，階段 2 量測。
- [交易內有外部呼叫時，會超過 5 秒逾時] → AGENTS.md 的新規則寫明「外部呼叫不能放在交易內」。搬遷 PR 依 #337 的檢查清單逐檔確認。
- [ratchet 只計數，不判斷語意] → 它的用途只是不讓舊寫法變多。新寫法是否正確，由 code review 與測試把關。
- [ratchet 以正規式比對，擋不住刻意繞過的寫法] → 它防的是照舊習慣寫出的一般寫法，例如 `withTenant(`、`inTenant<T>(`。泛型參數內含括號這類寫法要靠 code review 發現。不採用 TypeScript AST：要重寫計數方式並重算基準，換來的只是擋住罕見寫法（PR #341 審查時決定）。
- [`tenantHandler()` 的泛型與 Fastify 的型別推導不合] → 階段 2 試做時若推導不出 `request.params` 的型別，回頭調整 `tenantHandler()` 的型別，不在 route 裡加 `as`。
- [commit 之後送進佇列的 job 可能遺失] → 保證是最多一次。例如 `data-export` 的 job 遺失時，請求會停在 pending。階段 1b 改由 outbox 送出，屆時以 MODIFIED 修改「事件與佇列 job 最多送出一次」。
- [`createManyAndReturn` 的行為依賴 Prisma 版本] → feature 測試以真實的 PostgreSQL 驗證三個 Scenario，包括兩個交易同時寫入。升級 Prisma 時，這些測試會發現行為改變。

## Migration Plan

本 change 只新增程式與文件，不改既有程式的行為。部署不需要額外步驟，回滾就是 revert 這個 PR。

## Open Questions

無。
