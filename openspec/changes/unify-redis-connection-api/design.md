# Design

## Context

動機見 proposal.md 的 Why。#443 的完整規劃（包括不用 `@fastify/redis` 的理由）在 issue 本文。

現在的寫法與限制：

- core 的 `redis` 在 `packages/core/src/redis/client.ts`。它在 import 時建立，用 `lazyConnect`，設定是 `maxRetriesPerRequest: null`。
- `apps/api/src/lib/redis-client.ts` 的 `getSharedRedis()` 第一次被呼叫時建立連線，設定是 `maxRetriesPerRequest: 2`，沒有 `lazyConnect`，也沒有關閉的方法。
- `login-attempts.ts` 與 `binding-code.ts` 已經是注入的寫法：函式接收 `LoginAttemptStore`、`BindingStore`。只有 `getLoginAttemptStore()`、`getBindingStore()` 取用 `getSharedRedis()`，再以 `as unknown as` 轉型。
- webhook 收訊流程的 `inbound-identity-binding.ts`、`inbound-coupon-claim.ts` 拿不到 `fastify`。它們的呼叫端 `processInboundMessage()` 有很多入口，屬於 #337 階段 4。
- `apps/api` 的 unit 測試把 `ioredis` 整個換成假的（`tests/setup/unit.setup.ts`）。`packages/core` 的 unit 測試用真的 ioredis，但不連 Redis。

## Goals / Non-Goals

**Goals:**

- 一個函式決定 Redis 連線的設定，呼叫端只選用途。
- API 的一般用途連線只有一條，由 Fastify 管理它的關閉。
- 入口把連線傳給既有的 store 參數，不需要轉型。

**Non-Goals:**

- 不改 `permission.service.ts`、`passkey.service.ts`、`ops-alert.service.ts`、`token-quota.service.ts`、`chatbox.service.ts`、`conversation.service.ts` 取得連線的方式（#337 的 10.4 PR 與階段 4）。
- 不改 `socket.plugin.ts` 的訂閱連線。它在註冊時就連線，這是 #439 要處理的事。
- 不改 workers 與 core 內部（#443 的 B）。例外是 `EventBus.subscribe()` 的一行，見 D3。
- 不讀新的環境變數。函式接收 URL，URL 的來源屬於 #244。

## Decisions

### D1：函式放在 `packages/core/src/redis/`，以用途選設定

`createRedisClient(url, purpose)`，`purpose` 是 `'command'` 或 `'queue'`。兩種都用 `lazyConnect`，都註冊 `error` 事件的 log。如果沒有 listener，ioredis 會把連線錯誤當成未處理的事件。

| 設定 | `'command'`（一般指令） | `'queue'`（BullMQ 與訂閱） |
| --- | --- | --- |
| `maxRetriesPerRequest` | 2 | `null` |
| `commandTimeout` | 1000 毫秒（見 D2） | 不設 |
| `lazyConnect` | 是 | 是 |

core 依賴 `database`、`shared`、`types`，這三個套件都不依賴 core。新檔只 import `ioredis` 與 core 的 `logger`，所以不會形成循環相依（查核：2026-11-04，main `cca213d9`）。

替代方案：API 與 workers 各寫一份設定。不採用，因為兩份設定一定會分歧，現在的問題就是這樣來的。

### D2：一般用途的等待上限由 `commandTimeout` 保證，不靠 `maxRetriesPerRequest`

`maxRetriesPerRequest` 計算的是重新連線的次數，不是時間：

- Redis 拒絕連線時，每次重新連線很快失敗。重試 2 次之後，指令大約在 0.3 秒內失敗。
- 封包沒有回應時，每次連線要等 `connectTimeout`（預設 10 秒），3 次可能超過 30 秒。
- Redis 已連上但不回應時，連線沒有中斷，重新連線的次數不會增加，指令一直等。

ioredis 5.9.3 在指令進入離線佇列之前就啟動 `commandTimeout` 的計時（`built/Redis.js` 的 `sendCommand`）。所以 `commandTimeout` 可以限制上面三種情況的總等待時間。

1 秒的根據：一般指令是快取與計數，正常時是毫秒級；租戶交易的逾時是 5 秒。tasks 2.1 的測試同時是實測：先在不加 `commandTimeout` 的設定下執行，記下兩種故障的實際等待時間，再定數值。數值需要不同於 1 秒時，先改 spec，再寫實作。

`maxRetriesPerRequest: 2` 保留：Redis 拒絕連線時，指令不必等滿 1 秒。

實測結果（2026-11-04，ioredis 5.9.3，本機，`create-redis-client.test.ts` 與一支量測腳本）：

| 故障 | ioredis 預設（20 次） | `maxRetriesPerRequest: 2` | 加上 `commandTimeout: 1000` |
| --- | --- | --- | --- |
| 拒絕連線 | 10537 毫秒 | 156 毫秒 | 154 毫秒 |
| 接受連線但不回應 | 沒有量 | 超過 5000 毫秒仍未結束 | 約 1000 毫秒 |

所以 1 秒的數值不改。

現有的呼叫端都已經處理 Redis 失敗，所以加上等待上限之後，呼叫端不必改（查核：2026-11-04）：

- `permission.service.ts`、`token-quota.service.ts`、`chatbox.service.ts` 的每個 Redis 呼叫都有 try/catch。
- `ops-alert` 唯一的呼叫端以 `.catch()` 接住錯誤。
- `getSharedRedis()` 的 4 個使用者從 PR #430 起就處理 `maxRetriesPerRequest: 2` 的失敗。

### D3：core 的 `redis` 改用 `'command'`，`EventBus` 的訂閱連線改用 `'queue'`

core 的 `redis` 改用 `createRedisClient(url, 'command')` 建立。它的使用者是 `permission.service.ts`、`token-quota.service.ts`、`chatbox.service.ts`、`ops-alert.service.ts` 與 `EventBus.publish()`，都只下一般指令，而且都已經處理失敗（D2）。改完之後，這些指令在 Redis 故障時不再一直等。這是 #443 要解決的主要問題，不必等 10.4 PR 與階段 4。

唯一的阻礙是 `EventBus.subscribe()`：它以 `redis.duplicate()` 建立訂閱連線，複製的連線會繼承 `commandTimeout`。Redis 在啟動時無法使用的話，`SUBSCRIBE` 會在 1 秒後失敗。`subscribe()` 沒有等待這個 Promise，結果是未處理的 rejection，canvas 的事件訂閱也會消失。所以 `subscribe()` 改用 `createRedisClient(url, 'queue')` 建立自己的訂閱連線，設定與現在相同。`subscribe()` 的 Promise 補上 catch 並寫 log：關閉連線時，還沒完成的訂閱會被拒絕，原本會變成未處理的 rejection。`EventBus` 的其他部分留到 #337 階段 6。

core 的 `redis` 沒有其他使用者把它當成 BullMQ 的連線。只有 channel-plugins 的 3 個 `worker-*.ts` 這樣做，但它們沒有呼叫端，不會執行，#443 的 B 會刪除它們（查核：2026-11-04）。

### D4：`fastify.redis` 與 `getSharedRedis()` 是同一條連線

`redis.plugin.ts` 以 `getSharedRedis()` 取得連線，掛到 `fastify.redis`，並在 `onClose` 呼叫 `closeSharedRedis()`。`getSharedRedis()` 改用 `createRedisClient(url, 'command')` 建立連線。`closeSharedRedis()` 關閉連線並清掉模組變數，下一次取用時建立新的連線。

理由：webhook 收訊流程、`passkey`、`downstream-loop-guard` 在這個 change 之後仍然呼叫 `getSharedRedis()`。如果 plugin 另外建立一條連線，API 會有兩條一般用途的連線，其中一條沒有在關閉時關掉。共用同一條連線，就能滿足「API 只有一條一般用途連線，關閉 Fastify 時一起關閉」。

這些使用者都改為注入之後，plugin 直接呼叫 `createRedisClient()`，再刪除 `lib/redis-client.ts`。

替代方案：plugin 自己建立連線，`getSharedRedis()` 讀 plugin 存下的連線。不採用，因為這會讓 `lib/` 依賴 plugin 的註冊順序，在註冊前呼叫的話，會拿到 `undefined`。

### D5：`fastify.redis` 的型別是 ioredis 的 `Redis`，入口直接傳入，不轉型

宣告 `fastify.redis: Redis`，`Redis` 以具名匯入的型別取得。以 `tsc --strict` 檢查過，`Redis` 可以直接指派給 `BindingStore` 與 `LoginAttemptStore`（2026-11-04）。現在的 `getBindingStore()`、`getLoginAttemptStore()` 用 `as unknown as` 轉型 `getSharedRedis()` 的回傳值。這個回傳值的型別來自 default import。D4 把回傳型別改成具名的 `Redis` 之後，就不需要轉型。

入口的改法：

- `auth.routes.ts`：`opts.loginAttempts ?? fastify.redis`，刪除 `getLoginAttemptStore()`。
- 路由檔與 `index.ts`：`getBindingStore()` 換成 `fastify.redis` 或 `app.redis`。路由已經有 `opts.xxx.store ?? ...` 的寫法時，保留 opts 的覆寫。
- `getBindingStore()` 保留，只剩 webhook 收訊流程的 2 個檔案使用。在函式的註解寫明它隨 #337 階段 4 移除。

### D6：測試的位置

| Scenario | 測試檔 | 為什麼放這裡 |
| --- | --- | --- |
| 一般用途：拒絕連線、接受連線但不回應 | `packages/core/tests/unit/redis/create-redis-client.test.ts` | core 的 unit 測試用真的 ioredis。測試在本機開一個不回應的 `net` server，以及一個沒有程式監聽的 port，不需要 Redis |
| BullMQ 用途：不回應時繼續等 | 同上 | 同上 |
| BullMQ 用途：交給 Worker | `apps/api/tests/feature/lib/redis-connection.test.ts` | Worker 在連上 Redis 之前關閉的話，BullMQ 呼叫的 `connect()` 會留下未處理的 rejection，unit 測試只能靠等待時間避開。所以用真的 Redis，等 Worker 就緒後正常關閉。另有一項對照組：一般用途的連線交給 Worker 時，BullMQ 丟出設定錯誤 |
| `EventBus` 的訂閱連線不繼承一般用途的設定 | `packages/core/tests/unit/event-bus/event-bus.test.ts` | 檢查 `subscribe()` 回傳的連線的 `commandTimeout` 與 `maxRetriesPerRequest`。行為測試要讓 Redis 在啟動時無法使用、之後恢復，unit 測試做不到 |
| 建立 API 應用程式時不連 Redis、關閉時關閉連線 | `apps/api/tests/unit/plugins/redis.plugin.test.ts` | 測試檔以 `vi.mock('ioredis', importOriginal)` 換回真的 ioredis，指向沒有程式監聽的 port。全域的假 Redis 永遠回報狀態 `end`，分不出「還沒連線」與「已關閉」 |

## Risks / Trade-offs

- [正常但較慢的指令超過 1 秒而失敗] → 一般用途的指令幾乎都是單一 key 的讀寫。例外是 `permission.service.ts` 清方案快取的 `SCAN` 迴圈：每次 `SCAN` 是一個指令，每批 100 個 key，各自受 1 秒限制。失敗時有 catch，快取靠 TTL 失效。
- [Redis 正常時的讀寫沒有專屬測試] → 既有的 feature 測試（綁定代碼、票券權杖、權限快取）經過真的 Redis，部署前 `pnpm test:feature` 會跑到。
- [註冊了 `fastify.redis` 的路由，在測試裡沒有 decorate 就呼叫] → 這些路由原本在 unit 測試拿到全域的假 Redis。改為 `fastify.redis` 之後，沒有 decorate 的測試會在執行時拿到 `undefined`。tasks 列出要補 decorate 的測試，以 `pnpm test` 與 `pnpm test:feature` 全部通過為準。
- [`closeSharedRedis()` 之後，模組內還有舊的參照] → 使用者都在每次呼叫時取用 `getSharedRedis()`，沒有存下連線。實作時以 grep 確認。

## Migration Plan

沒有資料或設定要遷移。部署後 API 的行為只有兩處不同：Redis 不回應時，一般指令在 1 秒內失敗，包括原本一直等的權限快取、token 額度與 chatbox 認領；API 關閉時多關一條連線。回復時 revert 這個 PR 即可。

## 審查基準（review-loop，2026-11-04）

至少達到 ioredis＋BullMQ 的常見用法，以及 Laravel Redis facade／Horizon 的水準。這些框架的專案也會有的情況，記錄在本節就好，不在這個 change 修正。例如：關機時正在執行的指令被中斷、Redis 叢集與 Sentinel 不支援。

### 記錄就好的項目

（review-loop 各輪補上）
