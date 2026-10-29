## Why

#337 階段 3 把 `data-erasure` 模組改成入口開交易（AGENTS.md 結構規則 2）。搬遷前，發起刪除有兩個問題：

- 請求、稽核與刪除工作分開寫入。稽核由 `writeTenantAudit()` 寫入，失敗時只記 log，請求照樣成立，沒有稽核紀錄。
- 刪除工作以 `queue.add()` 直接送進 Redis。Redis 無法使用時，系統把請求改成 `failed`，回 HTTP 503 `ENQUEUE_FAILED`；行程在送出前結束時，請求一直是 `pending`，沒有程式會再送一次。

## What Changes

- 請求、稽核與刪除工作在同一個交易寫入。其中一項寫不進去時，三項都不留下，系統回錯誤。
- 刪除工作寫進 outbox，commit 之後送進 `data-erasure` 佇列，至少送出一次（主規格 `event-delivery`）。commit 之後送不出時，系統仍回成功，請求維持 `pending`，由 outbox-relay 補送。系統不再回 HTTP 503 `ENQUEUE_FAILED`。
- 同一個刪除工作可能送出兩次。主規格的「worker 不重新處理已結束的刪除請求」已經要求同一個請求的刪除最多 commit 一次，所以重複的工作不會刪兩次。
- `data-erasure` 佇列的 job id 改成 outbox id，保留期限改成完成 24 小時、失敗 7 天，與其他以 outbox id 當 job id 的佇列相同。原本是完成 100 筆、失敗 50 筆。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：新增「發起刪除的寫入一起成立」（ADDED）。

## Impact

- 後端：`apps/api/src/modules/data-erasure/`（新增 `data-erasure.flow.ts`）。`apps/workers` 不變。
- 測試：`tests/feature/modules/data-erasure/data-erasure-flow.test.ts`、`tests/unit/modules/data-erasure/data-erasure.test.ts`。
- API：Redis 無法使用時，`POST /api/v1/tenant/data-erasure` 改回 HTTP 200，不再回 503。其他回應不變。前端沒有呼叫這個 API。
- 資料庫：沒有 migration。
