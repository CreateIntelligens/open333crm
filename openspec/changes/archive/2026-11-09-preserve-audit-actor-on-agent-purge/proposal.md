## Why

成員被永久刪除（釋放 email 的標準做法）之後，`tenant_audit_logs.actorId`、`data_export_requests.requestedBy`、`data_erasure_requests.requestedBy` 的外鍵都是 `onDelete: SetNull`，他做過的操作全部變成沒有操作者，和系統排程寫的紀錄分不出來。`agent.purge` 的稽核又只記 `targetId`。結果是「誰匯出了全租戶資料」在這位成員被刪除後查不到（issue #414、AUDIT AUD-03、健檢 HC-GOVERNANCE-01）。UAT 已有 52 筆 `agent.purge`。

## What Changes

- 永久刪除成員時，在同一個交易、刪除成員之前，把他的名稱與 email 寫進：
  - 他當操作者的稽核紀錄（`tenant_audit_logs.actorName`、`actorEmail`，新欄位）；
  - 他發起的資料匯出與資料刪除請求（`requestedByName`、`requestedByEmail`，新欄位）。
- `agent.purge` 稽核的 `payload` 記下被刪成員的名稱（`{ name }`），不記 email。
- `GET /api/v1/tenant/audit-logs` 每筆多回 `actorSnapshot: { name, email } | null`。`actor` 的格式不變：成員還在時是 `{ id, name, email }`，被刪除後是 `null`。
- 新欄位都可為空值，不回填。已經被清成空值的舊紀錄救不回來。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `agent-lifecycle`：「永久刪除成員」加一個步驟：刪除前保留操作者快照；`agent.purge` 稽核記下名稱（MODIFIED）。
- `tenant-audit-log`：「查詢租戶稽核」回傳 `actorSnapshot`（MODIFIED）。

`tenant-data-export`、`tenant-data-erasure` 的規格不改：請求的快照欄位只在永久刪除成員時寫入，行為寫在 `agent-lifecycle`；兩個模組沒有回傳 `requestedBy` 的 API。

## 範圍外

- 工單時間軸 `CaseEvent.actorId`、訊息 `senderId` 不處理（issue #414 決定）。
- 刪除請求排隊中時發起人被永久刪除，worker 寫 `data.erasure.complete` 稽核會違反外鍵、錯誤被吞掉，完成通知也會失敗。要改 `apps/workers/src/handlers/data-erasure.handler.ts`，#329 正在改同一個檔案，等 #329 合併後另補（issue #414 決定）。AUD-03 保留為「部分修正」記錄這一段。

## Impact

- 資料庫：migration 在 `tenant_audit_logs` 加 `actorName`、`actorEmail`，在 `data_export_requests`、`data_erasure_requests` 加 `requestedByName`、`requestedByEmail`，都是 `TEXT NULL`。舊表已經對 `app_tenant` 有表級授權，新欄位不需另外授權。
- 後端：`agent.service.ts`（`purgeAgent`）、`agent.flow.ts`（`purgeAgentFlow`）、`tenant-audit.service.ts`（新增 `preserveAuditActor`，`listTenantAudit` 回 `actorSnapshot`）、`data-export.service.ts`、`data-erasure.service.ts`（各新增 `preserveRequester`）。
- API：`GET /api/v1/tenant/audit-logs` 多一個欄位，向後相容。前端沒有稽核頁面。
- 測試：`apps/api/tests/unit/modules/agent/agent-purge.test.ts`、`agent.flow.test.ts`、`apps/api/tests/feature/modules/agent/agent-management.test.ts`。
- 文件：`CHANGELOG.md`、`docs/ref/system/AUDIT.md`（AUD-03）、`AUDIT-REVIEWS.md`、`docs/ref/features/health/README.md`、`docs/ref/features/health/GOVERNANCE.md`（HC-GOVERNANCE-01）、`docs/ref/features/tenant/GOVERNANCE.md`、`docs/ref/features/tenant/MEMBERS.md`、`docs/ref/features/feature-map.json`、`feature-governance` 與 `feature-members` skill。
