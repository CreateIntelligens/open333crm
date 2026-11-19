# API 模組的寫法

本文件說明 `apps/api/src/modules/<name>/` 的三層：

- route、flow、service 各做什麼；
- 由哪一層開交易、在哪一層觸發副作用；
- route 怎麼驗證輸入。

規則本身與檢查指令寫在 `AGENTS.md` 的結構規則 2 與 Conventions 一節。本文件補充規則的寫法細節與範例。事件、佇列與排程的送達保證，見[事件與背景工作](./EVENTS.md)。

- **資料來源**：`apps/api/src/lib/tenant-ctx.ts`、`apps/api/src/events/socket-push.ts`、`apps/api/src/events/outbox-publisher.ts`、`apps/api/src/modules/tenant-audit/tenant-audit.service.ts`、`packages/core/src/db/db-invariants.ts`、`packages/core/src/outbox/claims.ts`、`scripts/check-tenant-ctx.mjs`、`apps/api/src/modules/portal/`
- **核對日期**：2026-11-18

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| route、flow、service 各做什麼？ | [三層的分工](#三層的分工) |
| 一個完整的 flow 長什麼樣子？ | [範例](#範例) |
| 為什麼不在 `TenantScope` 加方法？ | [TenantScope 與副作用函式](#tenantscope-與副作用函式) |
| service 要呼叫 LINE 或 LLM 時怎麼辦？ | [交易內不呼叫外部服務](#交易內不呼叫外部服務) |
| 模組要用 Redis 時，連線從哪裡來？ | [Redis 連線](#redis-連線) |
| Socket 事件、業務事件、job、快取清除、稽核各在什麼時候發生？ | [flow 與背景工作的副作用](#flow-與背景工作的副作用) |
| job handler 什麼錯誤可以捕捉？ | [job handler 的錯誤](#job-handler-的錯誤) |
| 撞到唯一鍵時怎麼處理？ | [唯一鍵衝突](#唯一鍵衝突) |
| 哪些函式不用接收 `TenantCtx`？ | [不接收 TenantCtx 的函式](#不接收-tenantctx-的函式) |
| `check-tenant-ctx.mjs` 檢查什麼？ | [檢查腳本](#檢查腳本) |
| route 怎麼驗證輸入？ | [驗證輸入](#驗證輸入) |

## 三層的分工

入口開啟一個綁定租戶的交易。入口是 flow（`<name>.flow.ts`）或背景工作。入口呼叫 `apps/api/src/lib/tenant-ctx.ts` 的 `inTenant(prisma, tenantId, (scope) => ...)`。

| 層 | 做什麼 | 接收 |
| --- | --- | --- |
| route | 解析輸入、檢查權限、以 `actorOf(request)` 建立操作者、把結果轉成 HTTP 回應 | `request`、`reply` |
| flow | 交易外的工作（bcrypt、外部呼叫）、`inTenant()`、呼叫 service、寫稽核、送 Socket 事件、業務事件與 job、清除快取 | `TenantScope`、注入的相依 |
| service | 一個聚合的業務規則與查詢 | `TenantCtx` |

- 每個讀寫租戶資料的 route 都呼叫 flow，查詢也一樣。原因是查詢之後可能要加快取，而快取必須放在 flow。理由有兩個：service 不能使用 Redis；快取命中時不可以開交易。
- 不讀租戶資料的 route（例如固定的權限矩陣）可以直接回應。
- request 沒有租戶時，`actorOf(request)` 回傳 401。
- 只呼叫一個 service 函式的 flow，可以用 `flowOf(fn)`，例如 `export const listStoresFlow = flowOf(listStores)`。操作多了副作用或交易外的工作時，改寫成一般的 flow 函式。
- route 不自己呼叫 `inTenant()`。

每個讀寫租戶資料、且被 export 的 service 函式，第一個參數都是 `TenantCtx`。`TenantCtx` 只有 `tx` 與 `tenantId` 兩個欄位。service 回傳 flow 需要的事實，由 flow 決定副作用。

## 範例

```ts
// case.service.ts
export async function resolveCase(ctx: TenantCtx, caseId: string) {
  const updated = await ctx.tx.case.updateMany({ where: { id: caseId, tenantId: ctx.tenantId }, ... });
  return updated;
}

// case.flow.ts
export function resolveCaseFlow(deps: { prisma: PrismaClient; io: Server; events: EventPublisher }, actor: RequestActor, caseId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const updated = await resolveCase(scope, caseId);
    await recordTenantAudit(scope, { actorId: actor.agentId, action: 'case.resolve', ... });
    notifyTenant(scope, deps.io, 'case.updated', payload);              // commit 之後送到 tenant:<tenantId>
    await publishEvent(scope, deps.events, 'case.resolved', payload);  // 寫進 outbox，commit 之後送出
    return updated;
  });
}
```

## TenantScope 與副作用函式

`TenantScope` 是多了一個方法的 `TenantCtx`：`afterCommit(label, fn)`。只有 `inTenant()` 知道交易什麼時候 commit，所以這個物件只有這一個方法。

其他每種副作用都是一個獨立函式，以 scope 當參數。呼叫端以參數傳入相依（`io`、`EventPublisher`），所以從參數就看得出程式依賴什麼。新增一種副作用時，寫一個接收 scope 的函式，不要在 `TenantCtx` 或 `TenantScope` 加方法。

## 交易內不呼叫外部服務

service 不在交易內呼叫外部服務（LINE、LLM、S3）。交易的逾時是 5 秒，而且交易期間佔用一條資料庫連線。

flow 把工作拆成三段：交易、外部呼叫、交易。拆開之前，先在規格寫明外部呼叫是「最多一次」還是「至少一次」。

如果流程經過佇列，為流程的每一段寫下：

- 這一段可能在哪裡失敗；
- 失敗之後資料留在哪裡；
- 由哪段程式重做這一段；
- 這一段的保證。

change `outbox-event-delivery` 的 `design.md` 第 14 節有這樣的表。

## Redis 連線

在 API 行程，入口從 `fastify.redis` 取得下指令用的 Redis 連線（快取、計數器、短期驗證碼），以參數傳給 flow。模組不 import Redis client。

`fastify.redis` 在應用程式啟動時不連線。`fastify.redis` 在送出第一個指令時連線，在 Fastify 關閉時一起關閉。

在其他地方建立連線時，呼叫 `@open333crm/core` 的 `createRedisClient(url, purpose)`，不要用 `new IORedis`：

| `purpose` | 用途 | Redis 拒絕連線或沒有回應時 |
| --- | --- | --- |
| `'command'` | 下指令 | 指令在 1 秒內失敗 |
| `'queue'` | BullMQ 與訂閱者 | 指令一直等到 Redis 回應，這是 BullMQ 的要求 |

## flow 與背景工作的副作用

| 副作用 | 函式 | 什麼時候發生 | 次數 |
| --- | --- | --- | --- |
| Socket 事件給租戶所有成員 | `notifyTenant(scope, io, name, data)` | commit 之後；rollback 時丟棄 | 最多一次 |
| Socket 事件給看得到渠道的成員 | `notifyChannel(scope, io, { channelId, conversationId }, name, data)` | 同上 | 最多一次 |
| Socket 事件給一位成員 | `notifyAgent(scope, io, agentId, name, data)` | 同上 | 最多一次 |
| 業務事件 | `await publishEvent(scope, publisher, name, payload)` | 交易內寫進 outbox，commit 之後送出 | 至少一次 |
| BullMQ job | `await enqueueJob(scope, publisher, queueName, name, data)` | 同上 | 至少一次 |
| 清除快取 | `scope.afterCommit(label, fn)` | commit 之後 | 最多一次 |
| 租戶稽核 | `await recordTenantAudit(scope, input)` | 交易內，與資料一起 commit | 與資料相同 |

Socket 的三個函式在 `apps/api/src/events/socket-push.ts`。`publishEvent` 與 `enqueueJob` 在 `apps/api/src/events/outbox-publisher.ts`，`publisher` 是 `EventPublisher`，例如 `createOutboxPublisher(prisma)`。

- **房間：**呼叫端不指定房間名稱，由 `socket-push.ts` 為每個 Socket 事件選房間。帶渠道的訊息或對話資料的事件（`message.new`、`conversation.*`）用 `notifyChannel`。這類資料送到租戶房間時，沒有該渠道權限的成員也會收到。
- **不直接送出：**不要直接呼叫 `io.emit`、`eventBus.publish` 或 `queue.add()`。
- **重複：**業務事件與 job 是至少一次，接收端可能收到兩次。不能重複的副作用（例如發訊息給客人），執行前以 `@open333crm/core` 的 `claimSideEffect()` 或條件更新認領。細節見[送達保證：outbox 與認領](./EVENTS.md#送達保證outbox-與認領)。
- **快取：**不要在交易內清除快取。另一個請求可能在 commit 前讀到舊資料，再把舊資料寫回快取。`inTenant()` 在 commit 之後執行 `fn`，並等 `fn` 結束，所以 flow 在 `fn` 結束之後才回傳。`fn` 失敗時，系統寫 log，結果仍然成功。rollback 之後，`fn` 不執行。
- **稽核：**稽核資料列需要請求的操作者與 IP，所以由 flow 寫入，不由 service 寫入。寫入失敗時，`recordTenantAudit` 丟錯，交易 rollback。不要在交易內呼叫 `writeTenantAudit()`：它會捕捉資料庫錯誤，而 PostgreSQL 在錯誤之後拒絕這個交易的所有查詢。commit 因此變成 rollback，但請求仍可能回傳成功。`writeTenantAudit()` 只保留給還沒搬遷的呼叫端。
- **共用的事件內容：**多個入口送出同一個 Socket 事件時，在模組裡寫一個函式產生事件內容。各入口都呼叫這個函式。範例是 `apps/api/src/modules/coupon/coupon-effects.ts`。

## job handler 的錯誤

job handler 指 BullMQ processor 或事件訂閱者。在 job handler 裡，不要只為了寫 log 而捕捉錯誤。捕捉之後 job 會標記完成，佇列不會重試，工作就遺失了。

下列錯誤要丟出 handler，讓佇列重試：

- 認領 commit 之前的錯誤，或認領交易本身的錯誤；
- handler 把下一個 job 送進佇列時的錯誤。

只有兩種情況可以捕捉錯誤並寫 log：

- 認領已經 commit（副作用是最多一次）；
- 程式刻意使用備用做法，例如 LLM 失敗時改用知識庫回覆。

各種情況的列表見[副作用的認領紀錄](./EVENTS.md#副作用的認領紀錄)。

## 唯一鍵衝突

不要在交易內捕捉唯一鍵錯誤（`P2002`）後繼續執行。第一個錯誤之後，PostgreSQL 拒絕這個交易的所有後續查詢。

改用 `packages/core/src/db/db-invariants.ts` 的函式：

- 要寫入一筆資料，已存在時使用既有的那筆：`createOrFindExisting()`。
- 要以條件更新認領一筆資料：`claimOne()`。

## 不接收 TenantCtx 的函式

結構規則 2 不涵蓋下列兩種函式：

- **平台層資料表的 service：**例如 `platform-audit.service.ts`。這些資料表不屬於任何租戶，所以 service 使用 `prismaAdmin`。平台層資料表的清單見 `AGENTS.md` 的多租戶一節。
- **不讀資料庫的函式：**例如 `apps/api/src/modules/ops-alert/ops-alert.service.ts` 的 `sendOpsAlert()`。`sendOpsAlert()` 只寫 Redis 與佇列，所以不要在租戶交易內呼叫 `sendOpsAlert()`。

## 檢查腳本

`node scripts/check-tenant-ctx.mjs --strict` 在一個檔案的下列計數增加時失敗：

- 舊寫法：`TenantDb`、`request.tenantPrisma`，以及 service 檔案內開啟的交易。
- service 檔案引用 Redis client：`redis`、`createRedisClient` 或整個 `@open333crm/core` 模組、`ioredis`、`lib/redis-client`。
- service 檔案引用 LLM 模組：`ai/llm-client.js`、`ai/llm.flow.js`、`ai/providers/` 中 `types.js` 以外的檔案。

型別檢查無法阻止 service 在交易內使用這些模組層級的 client。所以 flow 以注入相依的方式接收這些 client。

腳本解析 TypeScript 語法來找出最後一種引用。re-export、動態 `import()`、`require()`、改名的 import 與 namespace 呼叫都算。只引用型別的 import 與註解不算。

腳本不認得[不接收 TenantCtx 的函式](#不接收-tenantctx-的函式)。腳本只計算舊寫法，所以這些函式不影響結果。

各檔案目前的計數記在 `scripts/check-tenant-ctx.baseline.json`。

## 驗證輸入

API 以 Zod schema 解析每個輸入欄位，不依賴前端的驗證。CLI、MCP、webhook 與腳本都不經過前端。

- 使用 `request.params`、`request.query`、`request.body` 之前，先以 Zod schema 解析。不要用 `as` 轉型：`as` 只告訴編譯器型別，執行時不檢查值。
- 每個欄位都要寫出型別與限制：格式（例如 `.uuid()`）、長度、範圍、允許的值（`z.enum`）。
- 存進資料庫 `Int` 欄位的值必須在 int4 範圍內。用 `apps/api/src/shared/utils/numeric-bounds.ts` 的 `int4Schema`。
- `page` 與 `limit` 用 `apps/api/src/shared/utils/pagination.ts` 的 `paginationSchema`。
- JSON 欄位（例如 `settings`、`config`）裡，程式會讀的每個鍵都要有 schema，不要用 `z.record(z.unknown())` 接收。schema 放在模組的檔案，route 與 service 使用同一個 schema。
- 程式從資料庫讀 JSON 欄位時，也用同一個 schema 解析，不要用 `as` 轉型。schema 存在之前寫入的資料可能是任何值。值無效時，改用不會造成傷害的預設值。例如 `apps/api/src/modules/portal/portal-settings.ts` 的 `readActivitySettings()` 不允許第二次提交，並給 0 點。
- 只有程式儲存或轉送、但從不讀取的值，才用 `z.record(z.unknown())`，並寫註解說明原因。例如 WebAuthn 的 `clientExtensionResults`。
- 前端驗證（例如 `<input min={0}>`）只是方便使用者。API 對相同的無效值回傳 HTTP 400。

範例是 `apps/api/src/modules/portal/`：`portal.routes.ts` 與 `portal-public.routes.ts` 解析每個輸入，`portal-settings.ts` 定義 route 與 service 共用的活動設定。

許多既有的 route 仍以 `as` 轉型輸入。issue #405 列出使用 `z.record(z.unknown())` 的欄位。因為其他原因修改這些 route 時，一併修正。
