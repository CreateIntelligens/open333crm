# Tasks

## 1. 建立連線的函式

- [x] 1.1 在 `packages/core/tests/unit/redis/create-redis-client.test.ts` 寫 Scenario「Redis 拒絕連線」「Redis 接受連線但不回應」「Redis 不回應時指令繼續等待」；「交給 BullMQ 的 Worker」寫在 `apps/api/tests/feature/lib/redis-connection.test.ts`（design.md D6）。先建立只匯出函式簽名的檔案，確認測試因斷言失敗，不是因為 import 失敗
- [x] 1.2 新增 `packages/core/src/redis/create-client.ts` 的 `createRedisClient(url, purpose)`，先不加 `commandTimeout`，執行 1.1，把兩種故障的實際等待時間記進 design.md D2。再依 D1 加上 `commandTimeout`（實測結果需要不同於 1 秒時，先改 spec）。從 core 的 index 匯出。1.1 通過
- [x] 1.3 在 `packages/core/tests/unit/event-bus/event-bus.test.ts` 寫測試：`EventBus.subscribe()` 回傳的連線沒有 `commandTimeout`，`maxRetriesPerRequest` 是 `null`。改 `subscribe()` 之前，先把 core 的 `redis` 改成 `'command'`，確認測試因斷言失敗
- [x] 1.4 core 的 `redis` 改用 `createRedisClient(REDIS_URL, 'command')`；`EventBus.subscribe()` 改用 `createRedisClient(REDIS_URL, 'queue')`，`subscribe()` 的 Promise 補上 catch（design.md D3）。1.3 通過。`load-without-redis.test.ts` 仍然通過，並以突變驗證：拿掉 `lazyConnect` 時，「import core 後，redis 在第一次執行指令前不連線」失敗

## 2. API 的 plugin 與共用連線

- [x] 2.1 在 `apps/api/tests/unit/plugins/redis.plugin.test.ts` 寫 Scenario「Redis 無法使用時建立 API 應用程式」「關閉 API 應用程式」。測試檔以 `vi.mock('ioredis', importOriginal)` 換回真的 ioredis，指向沒有程式監聽的 port（design.md D6）。執行後確認因斷言失敗
- [x] 2.2 `lib/redis-client.ts` 改用 `createRedisClient(url, 'command')`，回傳型別改成具名的 `Redis`，新增 `closeSharedRedis()`（design.md D4）
- [x] 2.3 新增 `apps/api/src/plugins/redis.plugin.ts`：宣告 `fastify.redis: Redis`，decorate `getSharedRedis()`，`onClose` 呼叫 `closeSharedRedis()`。在 `index.ts` 於路由之前註冊。2.1 通過

## 3. 入口改從 `fastify.redis` 取得連線

- [x] 3.1 `auth.routes.ts` 改成 `opts.loginAttempts ?? fastify.redis`，刪除 `login-attempts.ts` 的 `getLoginAttemptStore()`。登入鎖定的既有測試（`login-rate-limit-route.test.ts` 等以 `loginAttempts` 注入的測試）通過
- [x] 3.2 路由檔與 `index.ts` 的 `getBindingStore()` 換成 `fastify.redis` 或 `app.redis`，保留既有的 opts 覆寫：`contact.routes.ts`、`channel.routes.ts`、`liff-test-public.routes.ts`、`coupon-fan.routes.ts`、`coupon-inbox.routes.ts`、`coupon-instance.routes.ts`、`registration-routes.ts`、`meta-connect.routes.ts`、`store-console.routes.ts`、`index.ts`。動手前以 grep 重新列出呼叫處。完成後 `grep -rn "getBindingStore()" apps/api/src` 只剩 `inbound-identity-binding.ts` 與 `inbound-coupon-claim.ts`
- [x] 3.3 `binding-code.ts` 的 `getBindingStore()` 拿掉 `as unknown as`，註解寫明只剩 webhook 收訊流程使用，隨 #337 階段 4 移除
- [x] 3.4 註冊了 3.2 路由的測試改為註冊 `redisPlugin`。實際需要改的是 3 個優惠券的 feature 測試（`coupon-inbox-routes`、`coupon-realtime`、`coupon-wallet-device-routes`），其中 2 個原本 import `getBindingStore()`，改用 `app.redis`。unit 測試都以 opts 注入 store 或不經過這些路徑，不需要改。`pnpm test` 與 `pnpm test:feature` 通過

## 4. 文件與完成檢查

- [x] 4.1 AGENTS.md 結構規則 2 寫明：入口從 `fastify.redis` 取得一般用途的 Redis 連線，再傳給 flow；建立連線用 core 的 `createRedisClient()`，依用途選 `'command'` 或 `'queue'`。確認文件中的路徑存在
- [x] 4.2 `CHANGELOG.md` 最新的日期段落加上 Changed 的條目
- [x] 4.3 `pnpm test`、`pnpm test:feature`、`pnpm build` 通過（改到 `packages/core`）
- [x] 4.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 通過。ratchet 的「service 直接 import Redis client」不增加
- [x] 4.5 `node scripts/feature-impact.mjs` 列出受影響的領域（直接影響 contacts、marketing、members、channels）。綁定代碼、email 登記、領券與票券流程由既有的 feature 測試經過真的 Redis；登入鎖定以本機實際啟動的 API 驗證：同一 email 錯 5 次後第 6 次回 429 `ACCOUNT_LOCKED`，SIGTERM 後正常關閉。`node scripts/feature-impact.mjs --check` 通過
- [x] 4.6 `node scripts/validate-openspec.mjs unify-redis-connection-api` 與 `node scripts/validate-openspec.mjs --specs` 通過

## 5. review-loop 的修正

- [x] 5.1 在 `apps/api/tests/unit/tenant-ctx-ratchet.test.ts` 寫 Scenario「service 檔新增建立 Redis 連線的函式的 import」，確認因斷言失敗（腳本以 exit code 0 結束）
- [x] 5.2 `scripts/check-tenant-ctx.mjs` 把 core 的 `createRedisClient` 計入「service 直接 import Redis client」（design.md D7）。5.1 通過，`node scripts/check-tenant-ctx.mjs --strict` 通過，計數不變。AGENTS.md 結構規則 2 的 Check 一併寫明

## Workflow follow-up

- 以 `pnpm exec openspec archive unify-redis-connection-api` 歸檔。新的主規格 `redis-connection` 的 Purpose 已寫好，歸檔後確認沒有「TBD」。
- 合併後更新 `tmp/redis-連線統一-規劃.md` 與 `tmp/337-入口開交易-規劃.md` 的進度，接著做 #337 10.4 的 Redis PR。
