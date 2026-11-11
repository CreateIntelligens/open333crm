## Why

#337 階段 3 把 `data-export` 模組改成入口開交易（AGENTS.md 結構規則 2）。搬遷前，發起匯出有兩個問題：

- 請求、稽核與匯出工作分開寫入。稽核由 `writeTenantAudit()` 寫入，失敗時只記 log，請求照樣成立，沒有稽核紀錄。
- 匯出工作以 `queue.add()` 直接送進 Redis。Redis 無法使用時，系統把請求改成 `failed`，回 HTTP 503 `ENQUEUE_FAILED`。行程在送出前結束時，請求一直是 `pending`，沒有程式會再送一次。

## What Changes

- 請求、稽核與匯出工作在同一個交易寫入。其中一項寫不進去時，三項都不留下，系統回錯誤。
- 匯出工作寫進 outbox，commit 之後送進 `data-export` 佇列，至少送出一次（主規格 `event-delivery`）。commit 之後送不出時，系統仍回成功，請求維持 `pending`，由 outbox-relay 補送。系統不再回 HTTP 503 `ENQUEUE_FAILED`。
- 同一個匯出工作可能送出兩次。主規格的「worker 不重新處理已結束的匯出請求」已經規定重複執行的結果，所以重複的工作不會產生第二份檔案或第二則完成通知。
- `data-export` 佇列的保留期限不變（完成 24 小時、失敗 7 天）。保留期限改由每個匯出工作的選項指定，不再由自建 `Queue` 的預設值指定。
- 查詢與下載不變。下載連結以固定憑證在本機簽章，不連網路，所以留在交易內。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-export`：新增「發起匯出的寫入一起成立」（ADDED）。

## Impact

- 後端：`apps/api/src/modules/data-export/`（新增 `data-export.flow.ts`）。`apps/workers` 不變。
- 測試：
  - `tests/feature/modules/data-export/data-export-flow.test.ts`：新增發起匯出的情境。
  - `tests/feature/modules/data-export/data-export.test.ts` 移到 `tests/unit/modules/data-export/data-export.test.ts`。搬遷後不需要 Redis。
  - 刪除 `tests/unit/modules/data-export/data-export-queue-options.test.ts`。保留期限改由單元測試檢查匯出工作的選項。
- API：Redis 無法使用時，`POST /api/v1/tenant/data-export` 改回 HTTP 200，不再回 503。其他回應不變。前端沒有呼叫這個 API。
- 資料庫：沒有 migration。
