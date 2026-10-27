## Context

#337 的規劃把副作用依「什麼時候執行、有什麼保證」分成三種時機（2026-10-27 決定）：

| 時機 | 保證 | 放什麼 |
| ---- | ---- | ------ |
| 交易內 | 與資料一起 commit 或一起 rollback | 資料寫入、稽核、outbox（`publishEvent`、`enqueueJob`） |
| commit 之後，最多一次 | 失敗只記 log；rollback 時丟棄 | 推播（`notifyTenant`、`notifyAgent`）、快取失效（本 change 新增 `afterCommit`） |
| 交易之外 | 依流程寫在 spec | 外部呼叫、bcrypt |

`inTenant()` 只提供時機（交易與 `afterCommit`），不為每種副作用各加一個方法（決策 6）。之後其他模組要在 commit 之後執行新的動作時，不必再修改 `inTenant()`。

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

`afterCommit(label, fn)` 登記的動作放在同一份清單，commit 之後依登記順序執行。推播與 outbox 的快路徑也經由 `afterCommit` 登記（決策 6）。`inTenant()` 會 `await` 每個動作，所以 `inTenant()` 回傳時，動作已經執行完；flow 在 `inTenant()` 回傳之後才回到 route，所以回應在動作之後送出。

理由：主規格 `permission-check` 要求「在修改的請求回應之前，清除這個角色的快取」。

- 不等待的話，前端收到成功回應後立即以舊權限呼叫，仍可能通過。
- 快路徑登記的函式只發出送進佇列的請求，不等待完成（主規格「佇列沒有回應時不阻擋回傳」）。推播的 `emit` 是同步的。

失敗時只記 log，`inTenant()` 照常回傳：資料已經 commit，回應不能變成失敗。權限快取另有 10 分鐘的存活時間兜底。

`afterCommit` 不需要 `io`，背景工作也可以用。

考慮過的替代方案：

- 為快取失效加專用方法（例如 `ctx.invalidateCache`）：每多一種副作用就要改一次契約。
- flow 在 `inTenant()` 回傳之後自己清快取：可行，但推播與快路徑也需要「commit 之後」的時機，統一由 `afterCommit` 登記，順序才一致。
- 維持在交易內清除：保留 commit 之前清除、被舊資料寫回的競態。

風險：`@open333crm/core` 的 Redis client 設定 `maxRetriesPerRequest: null`，Redis 斷線時指令會等待重新連線。`afterCommit` 等待完成，所以 Redis 斷線時回應也會等待。現況下 `invalidateRolePermissions()` 同樣在回應之前執行，而且權限 guard 在 handler 之前就讀 Redis，所以本 change 沒有增加這個風險。

### 決策 2：`recordTenantAudit(ctx, input)` 丟出錯誤，`writeTenantAudit()` 保留

- `recordTenantAudit` 的 `input` 不含 `tenantId`，由 `scope.tenantId` 填入，所以呼叫端無法寫到別的租戶。
- 稽核由 flow 寫，不由 service 寫：稽核需要 actor 與 IP，這些是請求的資訊（決策 7）。
- 寫入失敗時丟出錯誤。錯誤穿過 `inTenant()` 讓交易 rollback，route 回錯誤回應。
- `writeTenantAudit(prisma, input)` 保留給還沒搬的呼叫端，行為不變（接住錯誤，只記 log）。搬遷完成後刪除（階段 7）。

理由：在交易內接住資料庫錯誤，PostgreSQL 把交易標成 aborted，之後的查詢都失敗（SQLSTATE 25P02），COMMIT 也變成 rollback。實測（2026-10-27，本機 PostgreSQL 16 與 Prisma 6）：交易內建立角色、接住稽核的外鍵錯誤之後，`inTenant()` 回傳成功，但角色沒有寫進資料庫。所以 route 會回成功，資料卻沒有變更。所以交易內的稽核只有兩種選擇：一起成功，或一起失敗。對安全稽核來說，「操作成立但沒有紀錄」比「操作失敗」更糟，所以選擇一起失敗。

### 決策 3：service 收 ctx 之後，不再另外收 `tenantId`

照已搬模組（`coupon`、`store`）的寫法，service 從 `ctx.tenantId` 取得租戶 ID，不另外收 `tenantId` 參數。

例外：`listChannelsForAgent` 之外的 `channel-team-access.ts` 函式不變（決策 5）。

### 決策 4：bcrypt 在交易之外

雜湊與比對是 CPU 密集的工作（約 100 毫秒）。交易內執行時，交易與資料庫連線會一直被佔住。

- `createAgent`、`resetAgentPassword`：flow 先算好雜湊，service 收 `passwordHash`。`createAgent` 內部的雜湊 fallback 刪除。
- `changeOwnPassword`：新密碼的雜湊在交易外先算好；比對目前的密碼要讀出既有的雜湊，所以仍在交易內。拆成兩個交易可以把比對也移出去，但兩個交易之間密碼可能被改，換來的只是約 100 毫秒的連線佔用。

### 決策 5：`channel-team-access.ts` 只搬成員用的兩個函式

這個檔案的函式分屬兩個模組：

- `setAgentChannels`、`listChannelsForAgent`：只有 `agent.routes.ts` 呼叫。本 change 改收 `TenantCtx`，`setAgentChannels` 不再自己開交易。
- `grantChannelTeamAccess` 等 4 個函式：只有 `channel.routes.ts` 呼叫，留到階段 4 搬 `channel`。
- `insertAgentChannelAccess`：`agent.service.ts` 與 `channel.service.ts` 都呼叫，仍收 `TenantDb`。已搬的呼叫端傳 `ctx.tx`。

這違反「同一個 service 檔要一次搬完」，但不違反這條規則要防止的事：檔案內沒有收 `TenantDb` 的函式呼叫收 `TenantCtx` 的函式。一次搬完整個檔案，會把 21 個 route 的 `channel` 模組拉進試點。

### 決策 6：`TenantCtx` 只留資料存取，副作用改成獨立函式

試點的檢討發現，`TenantCtx` 同時放了三種層級不同的能力：

| 能力 | 原本的方法 | 層級 |
| ---- | ---- | ---- |
| 資料存取 | `tx`、`tenantId` | 資料 |
| 業務事件 | `publish` | 領域 |
| 反應的傳遞方式 | `notify`、`notifyAgent`、`enqueue`、`afterCommit` | UI 推播、佇列、快取 |

這造成三個問題：

1. service 拿得到這些方法，就由 service 決定所有反應。例如 `coupon` 的 service 決定前端要收到哪個推播。
2. 選方法就等於選時機，時機的決定藏在 service 裡。
3. 每多一種反應，物件就多一個方法。`afterCommit` 就是本 change 加上去的。

新的契約：

```ts
interface TenantCtx { readonly tx: Prisma.TransactionClient; readonly tenantId: string }
interface TenantScope extends TenantCtx { afterCommit(label: string, fn: () => unknown): void }
function inTenant<T>(prisma: PrismaClient, tenantId: string, fn: (scope: TenantScope) => Promise<T>): Promise<T>
```

- `afterCommit` 是唯一留在物件上的方法，因為只有 `inTenant()` 知道交易什麼時候 commit。
- 推播、事件、job、稽核都是收 scope 的函式。函式需要的依賴（`io`、`EventPublisher`）由呼叫端傳入，所以從參數看得出依賴。沒有 `io` 的背景工作呼叫推播函式時，型別檢查就會失敗；原本要到執行時才在交易內丟錯。
- 什麼時候用哪個函式、放在哪一層，寫在 `AGENTS.md` 結構規則 2，不由物件的方法決定。

考慮過的替代方案：

- 業務事件加上 listener 登記：service 只記錄事件，listener 宣告時機。解耦最徹底，但讀 service 看不出會發生什麼事。等「同一個反應要在多個 flow 重複寫」變多時，再把那個反應改成 listener。非同步的反應已經是這個做法（outbox 加訂閱者）。
- 只用型別縮小（`Pick<TenantCtx, 'tx' | 'tenantId'>`）：物件不變，service 仍可轉型取用。

### 決策 7：use case 層沿用 `<name>.flow.ts`

`coupon`、`marketing`、`member-binding`、`store` 已有 6 個 `.flow.ts`，做的就是 use case：注入依賴、開啟 `inTenant()`、編排「交易、外部呼叫、交易」。本 change 沿用這個後綴，寫進 `AGENTS.md`。

分工：

| 層 | 做什麼 | 拿到什麼 |
| ---- | ---- | ---- |
| route | 解析輸入、檢查權限、以 `actorOf(request)` 組出 actor、呼叫 flow、把結果轉成 HTTP 回應 | `request`、`reply` |
| flow | 交易外的工作（bcrypt、外部呼叫）、開啟 `inTenant()`、呼叫 service、稽核、推播、事件、快取 | `TenantScope`、注入的依賴 |
| service | 單一聚合的業務規則與資料存取 | `TenantCtx` |

- 讀寫租戶資料的 route 一律呼叫 flow，查詢也一樣。不讀租戶資料的 route（例如權限矩陣）直接回應。
- 原本的分界是「route 有沒有副作用」，這個分界會隨需求移動：角色的建立與改名原本沒有稽核，補上稽核就要換寫法。查詢也會長出副作用以外的編排：資料量變大時要加 read-through 快取，而 service 不能碰 Redis（決策 9），快取命中時也不該開交易，所以快取只能放在 flow。
- 代價是查詢的 flow 多半只有一行（`inTenant()` 包一個 service 呼叫）。同一個模組的 flow 放在同一個檔案。
- `tenantHandler()` 成為舊寫法：ratchet 計算模組內的 `tenantHandler(`，只減不增。`coupon`、`store`、`member-binding`、`analytics` 的 route 在階段 2 的第二個 PR 改成呼叫 flow，之後刪除 `tenantHandler()`、`TenantReply` 與 `deferReply()`，並修改主規格「route 的回應在 commit 之後才送出」中依賴 `TenantReply` 的 Scenario。
- `actorOf(request)` 在請求沒有租戶身分時回 401，與 `tenantHandler()` 相同。
- 試點時「交易之前要做的工作」的寫法（`tenantHandler(fastify, …)(request, reply)`）移除，改由 flow 處理。
- actor（租戶、成員、角色、IP）由 route 從 request 組出，傳給 flow，flow 不讀 request。

### 決策 8：service 回傳結果，flow 決定副作用

原本在 service 內推播或發事件的地方，改成 service 回傳 flow 需要的結果。例如：

- `confirmIssue()` 原本在新加標籤時發 `contact.tagged`，改成回傳 `tag`，flow 依 `tag` 決定要不要發事件。
- `redeemCoupon()` 有 4 個入口。推播的內容由 `coupon` 模組的一個 flow 層函式組出，4 個入口都呼叫它，不各自組推播的內容。

背景工作（`automation.worker.ts`）本身就是入口，直接呼叫副作用函式。

### 決策 9：service 直接使用 Redis 與 LLM 的數量只減不增

決策 6 之後，service 拿不到推播與事件的能力，型別檢查會擋下。Redis 與 LLM 的 client 則是模組層級的 singleton，service 直接 import 就能用，所以型別擋不住兩條規則：交易內不呼叫外部服務、commit 之後才清快取。

本 change 先補檢查，不搬遷：`check-tenant-ctx.mjs` 計算 service 檔以值的 import 引入 Redis client（`@open333crm/core` 的 `redis` 或 namespace import、`ioredis`）或 LLM 模組（`ai/llm.service.js`、`ai/providers/` 底下除了 `types.js` 的檔案）的次數，記進同一個基準檔，只減不增。腳本以 TypeScript 的 API 解析語法樹計數：靜態 import、re-export、`import x = require()`、動態 `import()`、`require()` 都算；只引用型別的、註解與字串裡的文字不算。模組內的 `tenantHandler` 呼叫也以語法樹計數，只算封閉清單內的三種寫法：直接呼叫、`as` 改名後呼叫、`ns.tenantHandler(` 或 `ns['tenantHandler'](`。各模組搬遷時，把這些依賴改由 flow 注入。

- 只算 import，不算呼叫：import 才是依賴的來源，一個檔案 import 一次就能多處呼叫。
- `import type` 不算：以參數傳入 client 時，service 只需要型別。
- flow、route 檔不算：flow 是負責外部呼叫的那一層。
- 從 `llm.service.js` import 不呼叫 LLM 的函式（例如 `recordAiUsage`）也算：多算只讓檢查變嚴，基準檔照實記下。
- 不用文字比對：review-loop 第 1、2 輪連續找到同一類問題，namespace import、import 內的註解、行首空白、`as` 改名，換一種合法寫法就擋不到。每補一種寫法就會再出現下一種，所以改成解析語法。代價是腳本依賴 `typescript`，以 `createRequire` 從 `apps/api` 載入。既有的文字計數（`TenantDb` 等）不在本 change 改寫，主規格「舊寫法的數量不得增加」寫明它以文字比對。
- 改用語法樹之後，基準多記 `chatbox.service.ts`：它以動態 `import('@open333crm/core')` 取得 `core.redis`，文字比對沒有算到。`tenantHandler` 的基準從 13 處變成 11 處，少掉的是註解裡的文字。
- `tenantHandler` 經過變數、解構或參數轉手的呼叫（例如 `const wrap = tc.tenantHandler`）不計數。要追到這些寫法得用型別檢查器解析每個呼叫，而 `tenantHandler()` 在階段 2 的第二個 PR 就刪除，這個計數只是過渡，所以不追（review-loop 第 3 輪，使用者決定）。刻意繞過由 code review 擋下。review-loop 第 4 輪又找到 `tc['tenantHandler'](`：spec 寫「涵蓋 namespace 呼叫」這一類，沒有邊界，總能找到下一種寫法。所以改成封閉清單，清單以外的寫法一律不在範圍內（使用者決定）。
- 擋不到的寫法：經過其他非 service 檔轉手，例如 `lib/cacheStore.ts` 包著 ioredis；以變數組出模組名稱的動態 `import()`。這是以引用計數的極限，記錄就好。

## 審查基準

本 change 是架構重構。可觀察的行為只允許 proposal 與 CHANGELOG 列出的差異。保證的水準以 Laravel 為參照：

- controller → action（本 repo 的 flow）的分層。
- `DB::afterCommit()`：commit 之後才執行，rollback 時丟棄。
- 稽核與資料在同一個交易寫入。

Laravel 專案也會有的情況，記錄就好，不修。下方 Risks 已經列出的限制不必重複提出。

## Risks / Trade-offs

- [稽核寫入失敗時，主操作也失敗] → 這是決策 2 的取捨。稽核只寫一筆，沒有外部呼叫，失敗的原因只有資料庫本身出錯，這時主操作通常也會失敗。
- [交易變長] → 一個請求只開一次交易，查詢次數不變。`role`、`agent` 的 route 都只有少數幾個查詢。
- [`resolveChannelGrantScope` 在交易之外讀取] → 建立成員時，可指派的渠道範圍在交易開始之前讀出。與現況相同。
- [成員被永久刪除之後，未過期的 JWT 仍可呼叫] → JWT 不查資料庫，被刪除的成員在權杖過期前仍能呼叫 `role`、`agent` 的 route。原本操作成功、稽核遺失；現在稽核的 `actorId` 違反外鍵，整筆請求失敗。新的行為更合理，但錯誤回應是 400 `DATABASE_ERROR`，不是 401。
- [同一個反應要在多個 flow 重複寫] → 決策 6 的取捨。重複的反應先收成模組內的 flow 層函式（決策 8）；重複變多時改成 listener。
- [改動範圍超出 `role`、`agent`] → 契約改變之後，已用 `TenantCtx` 的模組都要改。這些模組有 feature 測試經由真實 route 與 flow 檢查推播（例如 `coupon-realtime.test.ts`），推播移到 flow 之後，這些測試必須維持通過。
