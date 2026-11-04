## Why

報表以工單的 `resolvedAt` 判斷「已解決」，但狀態轉換只在轉成 `RESOLVED` 時寫入 `resolvedAt`，其他轉換都不動它（issue #417，AUDIT CASE-04、AUTO-10）：

- 解決後重開（`RESOLVED` → `IN_PROGRESS`、`CLOSED` → `OPEN`）保留舊的 `resolvedAt`，仍在處理中的工單被算成已解決，逾時的還會拉低 SLA 達成率。
- workers 的 `update_case_status` 自動化動作完全不寫 `resolvedAt`／`closedAt`，規則改成「已解決」的工單不進報表。

主規格 `case-management` 只規定狀態轉換要經過共用的轉換規則，沒有寫 `resolvedAt` 的語意；`analytics-reports` 也沒有寫「已解決」怎麼算。

使用者決定（2026-11-04）：直接關閉（沒有經過「已解決」）的工單不算已解決；離開已解決／已關閉回到其他狀態時清除 `resolvedAt`；既有資料不補值。

## What Changes

- `@open333crm/shared` 的 `case-transitions.ts` 新增 `caseTransitionTimestamps(from, to, now)`：轉成 `RESOLVED` 寫入 `resolvedAt`；轉成 `CLOSED` 寫入 `closedAt`，從 `RESOLVED` 關閉保留 `resolvedAt`，直接關閉的 `resolvedAt` 為 null；轉成其他狀態清除 `resolvedAt`；狀態不變不動。
- API 的 `transitionCase()`、`escalateCase()`、`assignCase()`，滿意度評分後結案（`recordCsatScore`）、問卷逾時結案排程，以及 workers 的 `update_case_status` 都用這個函式。
- workers 的 `update_case_status` 改成先讀目前狀態，再以 `tenantId` 與讀到的狀態做條件更新。
- 不改報表查詢；不補既有資料；不處理 `csatSentAt`（#339）；`update_case_status` 仍不檢查轉換是否合法、不寫工單事件（AUTO-10 其餘部分）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `case-management`：「Case Status Transition Validation」加入 `resolvedAt` 的維護規則與情境。
- `analytics-reports`：新增「已解決數以工單的解決時間判斷」。

## Impact

- `packages/shared/src/constants/case-transitions.ts`（web 也會載入，純函式）
- `apps/api/src/modules/case/case.service.ts`、`apps/api/src/modules/csat/csat.service.ts`、`apps/api/src/modules/csat/csat.scheduler.ts`
- `apps/workers/src/lib/automation-actions.ts`
- 不改資料表、不加 migration、不加權限碼、不改既有資料。
