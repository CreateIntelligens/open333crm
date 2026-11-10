## 1. 資料欄位

- [x] 1.1 `schema.prisma` 的 `Tenant` 加 `contractRemindersSent Json @default("[]")`；手寫 migration `20261110100000_add_tenant_contract_reminders_sent`；`pnpm db:generate`（本機開發庫沒有套用；feature 測試以獨立測試庫 `open333crm_contract_test` 套用全部 migration）

## 2. 合約到期前提醒平台帳號

- [x] 2.1 測試 `apps/api/tests/unit/modules/platform/contract-reminder.scheduler.test.ts`（mock executor、mock 寄信）：「到達檔位時寄給所有啟用中的平台帳號」「同一檔位只寄一次」「跳過的檔位不補寄」「未到檔位、已過期或停用不寄」「檔位依平台設定」，在沒有實作時斷言失敗
- [x] 2.2 測試 `apps/api/tests/unit/lib/schedule-registrations.test.ts`：合約提醒排程每小時、`withoutOverlapping` 30 分鐘
- [x] 2.3 實作 `contract-policy.service.ts`、`contract-reminder.scheduler.ts`、`platform-user-emails.ts` 的提醒信；在 `apps/api/src/index.ts` 註冊排程（design D1、D2、D3、D5、D6）
- [x] 2.4 測試 `apps/api/tests/feature/modules/platform/tenant-contract-dates.test.ts`：「合約到期不觸發任何自動行為」加上合約提醒排程與「不寄提醒信」的斷言；突變驗證：提醒查詢的 `contractEndDate: { gte: today }` 改成 `{ not: null }` 時失敗（已驗證，已還原）

## 3. 修改合約迄日後重新計算提醒

- [x] 3.1 測試 `tenant-contract-dates.test.ts`：「延長迄日後重新提醒」在現有程式上斷言失敗（已確認）；「只改起日不重寄」是既有行為，寫好就通過，3.2 加的條件是 `endChanged`，拿掉條件改成一律清空時這個情境失敗（已驗證，已還原）
- [x] 3.2 `updateTenantContract()` 在迄日改變時清空 `contractRemindersSent`（design D4）

## 4. 平台租戶列表標示合約到期狀態

- [x] 4.1 測試 `apps/web/tests/unit/app/admin/tenants-page.test.tsx`：「列表標示已過期與 30 天內到期」「依合約迄日排序」，在現有程式上斷言失敗
- [x] 4.2 新增 `apps/web/src/app/admin/lib/contract-status.ts`；`apps/web/src/app/admin/tenants/page.tsx` 顯示標籤與排序

## 5. 完成定義

- [x] 5.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test`
- [x] 5.2 `pnpm --filter @open333crm/api test:feature`（測試庫）
- [x] 5.3 api 與 web 的 tsc
- [x] 5.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`
- [x] 5.5 `node scripts/validate-openspec.mjs add-contract-expiry-reminder`
- [x] 5.6 `CHANGELOG.md` 的 `## [2026-11-10]` Added 加條目；`docs/ref/` 描述合約日期的文件同步
- [ ] 5.7 歸檔後把主規格 `tenant-contract-dates` 的 Purpose 改成「合約日期用於到期提醒，不自動停用」
