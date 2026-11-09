## 1. 資料刪除的完成稽核（tenant-data-erasure）

- [x] 1.1 先寫失敗的 feature 測試 `apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`：情境「發起的成員已被永久刪除時，完成稽核記下快照、不送通知」：建立成員 X → X 的刪除請求 → `purgeAgentFlow` 永久刪除 X → 執行 worker → 請求 `completed`、稽核 `actorId` 是空值、`actorName`／`actorEmail` 是快照、沒有通知
- [x] 1.2 同檔：情境「發起的成員還在時記下他並通知他」：`actorId` 是發起的成員、快照欄位是空值、一則 `data_erasure_done` 通知（原本就成立，以 mutation 驗證：`recordCompletion` 改成一律不記發起者、不通知，這案失敗）
- [x] 1.3 同檔：「物件刪除失敗時請求仍然完成」在稽核改進交易之後仍通過（稽核與請求的 `affected` 相同）。mutation：補寫失敗筆數時不更新稽核，feature 與單元的同名測試都失敗
- [x] 1.4 先寫失敗的單元測試 `apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`：完成稽核在刪除交易內寫入；稽核寫不進去時請求是 `failed`、不送通知；完成通知送不進佇列時工作不失敗；工作內容沒有 `requestedBy` 時不拿同租戶其他成員當操作者（mutation：拿掉 `requesterExists` 的空值防護，這案失敗）
- [x] 1.5 `data-erasure.handler.ts`：完成稽核移進刪除交易，同一個交易以 `tenantId` 查發起的成員，查不到時 `actorId` 寫空值、帶入請求的快照；物件刪除失敗時請求與稽核的 `affected` 一起補寫；發起的成員不在時不送通知並寫 log；通知送不進佇列時只寫 log

## 2. 資料匯出的通知（tenant-data-export）

- [x] 2.1 先寫失敗的 feature 測試 `apps/api/tests/feature/modules/data-export/data-export-flow.test.ts`：情境「發起的成員已被永久刪除時完成匯出、不送通知」與「發起的成員已被永久刪除時匯出失敗、不送通知」
- [x] 2.2 同情境的單元測試 `apps/workers/tests/unit/handlers/data-export.handler.test.ts`（mutation：拿掉發起者檢查，單元與 feature 都失敗）
- [x] 2.3 `data-export.handler.ts`：送完成與失敗通知前以 `tenantId` 查發起的成員，查不到時不送通知並寫 log

## 3. 永久刪除成員的快照順序（agent-lifecycle）

- [x] 3.1 先寫失敗的單元測試 `apps/api/tests/unit/modules/agent/agent-purge.test.ts`：刪除請求與匯出請求的快照在稽核快照之前寫入
- [x] 3.2 `purgeAgent`：先寫請求快照、再寫稽核快照

## 4. 完成條件

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 feature 全套通過
- [x] 4.3 `check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 沒有新增違規
- [x] 4.4 `CHANGELOG.md`（`## [2026-11-09]`）；`docs/ref/system/AUDIT.md` AUD-03 與其他引用更新、`AUDIT-REVIEWS.md` 加紀錄
- [x] 4.5 `node scripts/validate-openspec.mjs keep-completion-audit-for-purged-requester` 與 `--specs` 通過，以 `pnpm exec openspec archive` 歸檔
