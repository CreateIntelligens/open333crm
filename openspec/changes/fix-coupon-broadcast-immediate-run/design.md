## Context

- `queueCouponBroadcast()` 以條件更新把附券廣播設成 `scheduled`、`scheduledAt = now`，路由回 202。批次發券
  `createBatchIssue()` 也呼叫它。
- `broadcast.scheduler.ts` 每 60 秒找 `scheduled` 且時間已到的廣播；附券廣播交給 `runCouponBroadcast()`。
- `runCouponBroadcast()` 先以 `claimCouponBroadcast()` 條件更新 `scheduled → sending` 並寫入執行代次 `sentAt`，
  搶不到回 `not_claimed`。之後的保留、進度與結果都比對代次（PR #364 第三輪審查）。
- `runCouponBroadcast()` 需要 `fastify.io` 推播與 `app_tenant` 基底連線，所以在 API 行程執行（AGENTS.md「Scheduled Jobs in the API Process」）。

## Decisions

### D1 用 outbox job 馬上執行，不在請求內 fire-and-forget

| 選項 | 問題 |
| ---- | ---- |
| 路由回應後 `void runCouponBroadcast()` | 不經過交易：commit 失敗或程式中途結束時沒有人補做；違反 AGENTS.md 規則 2「以 `ctx.enqueue` 送 job」 |
| 縮短排程間隔 | 仍要等；每幾秒全租戶掃一次資料表 |
| `ctx.enqueue()` 寫 outbox job（採用） | job 與狀態更新一起 commit；commit 後快路徑馬上送進佇列，Redis 沒回應時由 outbox-relay 補送（至少一次） |

`queueCouponBroadcast()` 在條件更新成功後 `await ctx.enqueue('coupon-broadcast', 'run', { tenantId, broadcastId })`。
API 行程的 `startQueueWorkers()` 註冊 `coupon-broadcast` 的 processor（`broadcast-coupon.worker.ts`），收到後呼叫
`runCouponBroadcast()`。HTTP 請求只等交易 commit，不等發送。

### D2 重複執行由既有的搶占擋下

job 至少送一次，可能送兩次；排程也可能同時掃到。`claimCouponBroadcast()` 的條件更新只讓一個執行搶到，
其他回 `not_claimed`、不做事。已發出的券與訊息由收件紀錄與執行代次保護（既有行為）。

### D3 搶占要求排程時間已到

job 晚到時（例如 Redis 斷線後由 relay 補送），廣播可能已被改成未來的排程時間。`claimCouponBroadcast()` 加上
`scheduledAt <= now`，時間未到的不搶。排程原本就只撈時間已到的廣播，行為不變。

### D4 job 的重試

| 步驟 | 失敗時資料在哪裡 | 誰補做 | 保證 |
| ---- | ---------------- | ------ | ---- |
| 寫 outbox（交易內） | 交易回滾，廣播狀態不變，API 回錯誤 | 使用者再按一次 | 不會排入一半 |
| 送進佇列（commit 後） | outbox 列未標送出 | outbox-relay 補送；排程也會在一分鐘內發送 | 至少一次 |
| 搶占前（例如資料庫斷線） | 廣播仍是 `scheduled` | 佇列重試（attempts 3，指數退避）；排程 | 發送最多一次（搶占） |
| 搶占後的錯誤 | `runCouponBroadcast()` 已把原因寫進廣播（`failed`） | 使用者看原因後重新發送 | 重試時搶不到，不重複發送 |

processor 不吞錯誤（AGENTS.md 規則 2 對 job handler 的要求）。

### D5 前端以輪詢更新，不加 Socket 事件

券詳情的發放紀錄已用 SWR `refreshInterval` 在排入發送與發送中時每 5 秒重新載入。廣播列表沿用同一種做法：
有 `sending`，或 `scheduled` 且排程時間已到時每 5 秒重新載入，結束後停止。附券廣播的進度每 20 人才寫一次
（`PROGRESS_EVERY`），Socket 事件沒有更即時；輪詢不用改後端推播，也不會因為 Socket 斷線而停在舊狀態。
排程在未來的廣播不輪詢，免得等待期間一直重新載入。

## Risks / Trade-offs

- 新佇列要在 API 行程啟動時註冊；`monitored-queues.test.ts` 核對 API 的 Worker 都在監控清單內。
- 多個 API 實例都會消費這個佇列，同一個 job 只會給一個 Worker；就算重複，搶占也只讓一個發送。
