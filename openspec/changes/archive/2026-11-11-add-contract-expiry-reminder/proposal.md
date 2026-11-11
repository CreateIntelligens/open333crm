## Why

Issue #494：平台後台的合約期間（`Tenant.contractStartDate`、`contractEndDate`）只有寫入和顯示，沒有程式根據它做事。
合約迄日過了不會提醒，`/admin/tenants` 列表也看不出哪些合約即將到期或已過期。營運人員要自己記每個客戶的到期日，
漏掉的話，合約到期的客戶會繼續使用。試用租戶已有到期前提醒（`trial.scheduler.ts`），正式合約沒有。

## What Changes

- `/admin/tenants` 列表在合約期間旁標示「30 天內到期」與「已過期」（文字標籤加顏色，不用 emoji），並可依合約迄日排序。
- 新排程每小時檢查一次：啟用中的租戶，合約迄日距今天數到達提醒檔位時，寄提醒信給所有啟用中的平台帳號
  （`platform_users.isActive=true`）。
- 提醒檔位存平台設定 `contract.reminderDaysBefore`，預設 `[30, 7, 1]`。`/admin/tenants` 有「合約到期提醒」設定卡，按「儲存」才送出；
  前端與 `PUT /settings/contract.reminderDaysBefore` 都驗證（1–365 的整數、非空），不合法回 400，不改存預設值。
  讀取時遇到沒有設定或舊的不合法值才用預設值。
- `Tenant` 新增 `contractRemindersSent`（JSON 陣列，預設 `[]`），記錄目前迄日已寄過的檔位。同一租戶、同一檔位只寄一次。
- 平台人員修改合約迄日時，`contractRemindersSent` 清空，依新的迄日重新計算。
- **不做**合約到期自動停用。issue 寫明這需要產品決定；規格明訂合約到期仍不停用租戶。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-contract-dates`：「租戶合約日期只是紀錄」改名為「合約到期不自動停用租戶」，並移除「不寄送提醒」的限制；
  新增「合約到期前提醒平台帳號」「修改合約迄日後重新計算提醒」「平台租戶列表標示合約到期狀態」
  「平台人員修改合約到期提醒天數」「租戶管理頁編輯合約到期提醒天數」。

## Impact

- `packages/database/prisma/schema.prisma`、新 migration `20261110100000_add_tenant_contract_reminders_sent`
- `apps/api/src/modules/platform/contract-reminder.scheduler.ts`（新）、`contract-policy.service.ts`（新）、
  `platform-user-emails.ts`（新增提醒信）、`trial-admin.service.ts`（`updateTenantContract()` 清空提醒標記）
- `apps/api/src/index.ts`（註冊排程）
- `apps/api/src/modules/platform/platform.routes.ts`（`PUT /settings/:key` 對這個鍵驗證）
- `apps/web/src/app/admin/tenants/page.tsx`、`contract-reminder-card.tsx`（新）、`apps/web/src/app/admin/lib/contract-status.ts`（新）
- 主規格 `tenant-contract-dates` 的 Purpose 寫著「不觸發提醒」，歸檔後要改寫。
