# Proposal

## Why

API 有兩條一般用途的 Redis 連線，兩條的設定不同（#443）：

- `@open333crm/core` 的 `redis` 是 `maxRetriesPerRequest: null`。Redis 連不上時，指令一直等，不會報錯。
- `lib/redis-client.ts` 的 `getSharedRedis()` 重試 2 次就報錯。但 Redis 已連上卻不回應時，指令仍然沒有等待上限。

同樣的 GET、SET，行為取決於檔案 import 了哪一條連線。兩條連線也都沒有在 Fastify 關閉時關掉。

#337 階段 4 是 Redis 用得最多的地方。這個 change 先提供一條由 Fastify 管理的連線 `fastify.redis`，讓階段 4 的每個 PR 直接注入它，每個檔案只改一次。

## What Changes

- `packages/core` 新增建立 Redis 連線的函式。函式依用途給兩種設定：
  - 一般指令：Redis 連不上或不回應時，指令在固定的時間內失敗。
  - BullMQ 與訂閱：指令不設上限，符合 BullMQ 的要求。
- core 的 `redis` 改由這個函式建立，改用一般指令的設定。權限快取、token 額度、chatbox 認領在 Redis 故障時不再一直等。`EventBus` 的訂閱改用自己的 BullMQ／訂閱用途連線。core 的 `redis` 的使用者在 #337 的 10.4 PR、階段 4 與階段 6 改為注入，之後才移除。
- API 新增 `plugins/redis.plugin.ts`：
  - 把一般用途的連線掛到 `fastify.redis`。
  - 註冊時不連 Redis，第一次執行指令才連線。
  - 關閉 Fastify 時關閉這條連線。
- `getSharedRedis()` 改由同一個函式建立，並且與 `fastify.redis` 是同一條連線。API 的一般用途連線只剩這一條與 core 的 `redis`；core 的 `redis` 沒有在關閉時關掉，隨 #337 移除。
- 登入失敗計數與綁定代碼的入口改從 `fastify.redis` 取得連線：
  - 刪除 `getLoginAttemptStore()`。
  - 路由與 `index.ts` 不再呼叫 `getBindingStore()`。webhook 收訊流程的 2 個檔案仍然呼叫它，隨 #337 階段 4 的 `webhook` 改為注入。

## Capabilities

### New Capabilities

- `redis-connection`：各行程建立 Redis 連線的規則。包括兩種用途的設定、一般指令的等待上限，以及 API 的連線在什麼時候連上與關閉。

### Modified Capabilities

- `tenant-transaction-context`：「service 直接使用 Redis 與 LLM 的數量不得增加」改為寫明目標：service 自己取得 Redis 連線的引用都要計入，包括 core 建立連線的函式。這次 core 新匯出 `createRedisClient`，原本逐一列出的寫法沒有包含它，service 可以藉此繞過檢查（review-loop 第 1 輪，Codex）。

登入鎖定與綁定代碼的行為不變。`auth-session` 的「計數儲存故障」scenario 在新的等待上限下仍然成立。

## Impact

- 行為：
  - Redis 故障時，一般用途的指令原本可能一直等，現在在等待上限內失敗。登入計數、綁定代碼、passkey、webhook 去重、權限快取、token 額度、chatbox 認領、ops 告警都已經處理這種失敗。
  - API 關閉時多關一條 Redis 連線。
- 程式：
  - `packages/core/src/redis/`、`packages/core/src/event-bus/event-bus.ts` 的 `subscribe()`。
  - `apps/api/src/plugins/redis.plugin.ts`（新增）、`lib/redis-client.ts`、`index.ts`。
  - `auth/login-attempts.ts`、`auth/auth.routes.ts`、`identity-binding/binding-code.ts`，以及取用綁定代碼儲存的路由檔。
- 不在範圍：
  - `passkey.service.ts`、`permission.service.ts`、`ops-alert.service.ts`：在 #337 的 10.4 PR 改為注入。
  - `downstream-loop-guard.ts`、`conversation.service.ts`、webhook 收訊流程：在 #337 階段 4。
  - workers 與 core 內部（`EventBus.subscribe()` 除外）：#443 的 B 部分。
  - `lib/redis-client.ts` 要等上面的使用者都改完才刪除。
- 沒有 migration，沒有新的環境變數，沒有新的套件。
