## Why

資料刪除或資料匯出的請求還在排隊時，發起的成員被永久刪除（issue #414 後續、AUDIT AUD-03 未修的部分）。`purgeAgent` 會先把名稱與 email 寫進請求的 `requestedByName`、`requestedByEmail`，再刪成員，`requestedBy` 變成空值。之後 worker 執行：

- `data-erasure.handler.ts` 用工作內容的 `requestedBy` 寫 `data.erasure.complete` 稽核，`actorId` 違反外鍵。這筆稽核在刪除交易 commit 之後才寫，錯誤被 `.catch` 只寫 log，完成稽核無聲遺失。
- 兩個 handler 的完成與失敗通知都送給 `requestedBy`，通知 worker 寫 `notifications` 時違反外鍵，通知佇列重試三次後失敗。

## What Changes

- 刪除的 `data.erasure.complete` 稽核改在刪除的同一個交易寫入，與請求的 `completed` 一起 commit。稽核寫不進去時刪除 rollback，請求改為 `failed`，不再無聲遺失。
- 寫稽核前，在同一個交易以 `tenantId` 查發起的成員：
  - 成員還在：`actorId` 是他，照常通知，行為不變。
  - 成員已被永久刪除：`actorId` 是空值，`actorName`、`actorEmail` 是請求的 `requestedByName`、`requestedByEmail`；不送通知，寫一行 log。
- 交易 commit 之後物件儲存刪除失敗時，請求與稽核的 `affected` 在同一個交易一起補寫，兩者仍然相同。
- 匯出 worker 送完成或失敗通知之前，以 `tenantId` 查發起的成員；已被永久刪除時不送通知，寫一行 log，請求狀態不受影響。匯出 worker 不寫稽核，這點不變。
- 刪除的完成通知在請求 commit 之後才送，送不進佇列時只寫 log，工作不失敗（AGENTS.md 結構規則 2：claim commit 之後的副作用可以只寫 log）。
- `purgeAgent` 改成先寫請求的快照、再寫稽核的快照。刪除交易先鎖住請求列，永久刪除會在更新請求快照時等刪除交易 commit，之後寫稽核快照時看得到剛寫入的完成稽核，這筆稽核也會有快照。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：「刪除完成時記錄結果」稽核與請求一起 commit、發起的成員已被永久刪除時的稽核與通知（MODIFIED）。
- `tenant-data-export`：「產生匯出檔」發起的成員已被永久刪除時不送通知（MODIFIED）。

## 範圍外

- 稽核查詢依 `actorId` 篩選時查不到已被永久刪除的成員：快照只存名稱與 email，`GET /tenant/audit-logs?actorId=` 不會比對快照。AUD-03 記錄這一段。
- 通知 worker 本身沒有檢查收件成員是否存在。其他送通知的地方（工單指派、SLA 等）遇到同樣情況仍會在通知佇列重試後失敗。

## Impact

- 後端：`apps/workers/src/handlers/data-erasure.handler.ts`、`apps/workers/src/handlers/data-export.handler.ts`、`apps/api/src/modules/agent/agent.service.ts`（`purgeAgent` 快照順序）。
- 測試：`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`、`apps/api/tests/feature/modules/data-export/data-export-flow.test.ts`、`apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`、`apps/workers/tests/unit/handlers/data-export.handler.test.ts`、`apps/api/tests/unit/modules/agent/agent-purge.test.ts`。
- 文件：`CHANGELOG.md`、`docs/ref/system/AUDIT.md`（AUD-03）、`AUDIT-REVIEWS.md`、健檢與功能文件中引用 AUD-03 的段落。
