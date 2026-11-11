## Why

平台的異動操作都寫進 `platform_audit_logs`，但只能依「操作者」查（`GET /platform-users/:id/audit-logs`）。客戶反映「我們怎麼被停用了」「方案怎麼變了」時，平台方必須逐一點開每個平台帳號比對對象代碼，才查得出是誰、什麼時候做的（issue #496）。

另外，平台帳號詳細頁的動作翻譯表只有 6 個 `platform_user.*` 動作，其他平台動作（`tenant.ai_privacy.update`、`tenant.agent.resend_welcome` 等）直接顯示英文代碼；「對象」欄只顯示 `tenant / 5f723a0b…`，看不出是哪個租戶。

## What Changes

- 新增平台 API `GET /api/v1/platform/tenants/:id/audit-logs`：回傳與該租戶有關的平台稽核紀錄，依時間新到舊，預設 100 筆、最多 200 筆，回傳 `hasMore` 告知是否還有更舊的紀錄。範圍：
  - 對象是該租戶的紀錄（`targetType='tenant'`，含系統排程寫入的試用到期、資料清除）。
  - 對象是該租戶成員的紀錄（`targetType='agent'`，以 `payload.tenantId` 判定）。
  - 對象是該租戶方案申請的紀錄（`targetType='plan_change_request'`）。
- 稽核紀錄回應附上操作者（平台帳號 id、名稱、Email；系統排程為 `null`）、對象的可讀名稱（租戶名稱、成員 Email、方案名稱、平台帳號名稱、試用申請 Email），以及對象所屬租戶 id（供前端連結）。`GET /platform-users/:id/audit-logs` 也回傳相同欄位。
- 租戶詳細頁（`/admin/tenants/:id`）新增「操作紀錄」區塊。
- 動作翻譯表搬到 `apps/web/src/app/admin/lib/audit-log.ts`，補齊所有平台動作，租戶詳細頁與平台帳號詳細頁共用同一個表格元件。「對象」欄顯示可讀名稱並連到對應頁面；查不到時退回「類型 / 代碼前 8 碼」。

不處理 SEC-02（平台登入與密碼重設沒有寫入稽核）：本 change 只處理「查得到、看得懂」，不改哪些事件要寫入。

## Capabilities

### New Capabilities

- `platform-audit-log`：平台稽核紀錄的查詢與顯示（依租戶查詢、操作者與對象名稱、動作中文名稱）。

### Modified Capabilities

- `platform-user-management`：「平台帳號詳細頁可查詢該帳號相關的稽核記錄」的回應附上操作者與對象名稱，並以共用的動作中文名稱顯示。

## Impact

- API：`apps/api/src/modules/platform/platform-audit.service.ts`（新增查詢與名稱解析）、`platform-user.service.ts`、`platform.routes.ts`（新增一條路由）。
- Web：`apps/web/src/app/admin/lib/audit-log.ts`、`apps/web/src/app/admin/lib/AuditLogTable.tsx`（新檔）、`admin/tenants/[id]/page.tsx`、`admin/platform-users/[id]/page.tsx`。
- 資料庫：無 schema 變更。平台層表格以 `prismaAdmin` 查詢（平台控制台在白名單內）。
