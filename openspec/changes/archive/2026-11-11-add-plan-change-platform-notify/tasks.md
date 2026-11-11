## 1. 新申請寄信通知平台帳號

- [x] 1.1 測試 `apps/api/tests/unit/modules/platform/plan-change-platform-notify.test.ts`：「送出加購申請後寄信給啟用中的平台帳號」「升級申請的信寫出目標方案名稱」在現有程式上斷言失敗；寄信以 `vi.mock()` 取代
- [x] 1.2 測試同檔：「申請被拒絕時不寄信」是既有行為，寫好就通過；突變驗證：`submitPlanChangeRequest()` 在 `createPlanChangeRequest()` 之前先開始通知時失敗
- [x] 1.3 測試同檔：「一封信寄送失敗時申請仍成功」「沒有啟用中的平台帳號」，以及查詢收件人失敗時稽核記下原因，在現有程式上斷言失敗
- [x] 1.4 `plan-change.service.ts` 新增 `getPlanChangeNotifyContext()`；`platform-user-emails.ts` 新增 `sendPlanChangeRequestedEmail()`；`platform-audit.service.ts` 允許 null 的 `platformUserId`（design D2、D3、D4）
- [x] 1.5 新增 `plan-change.flow.ts` 的 `submitPlanChangeRequest()` 與 `notifyPlatformOfPlanChange()`，路由改呼叫 flow、不等寄信（design D1）

## 2. 平台側欄顯示待審數量

- [x] 2.1 測試 `apps/web/tests/unit/app/admin/admin-layout-pending-badge.test.tsx`：「有待審申請時顯示數量」「沒有待審申請時不顯示數量」「審核後數量更新」，在現有程式上斷言失敗
- [x] 2.2 `apps/web/src/app/admin/lib/pending-plan-changes.ts` 載入數量；`apps/web/src/app/admin/layout.tsx` 顯示數量；`apps/web/src/app/admin/plan-changes/page.tsx` 審核後送出更新事件（design D5）

## 3. 完成定義

- [x] 3.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test`、api 與 web 的 `tsc --noEmit`
- [x] 3.2 `pnpm test:feature`
- [x] 3.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict`
- [x] 3.4 `node scripts/validate-openspec.mjs add-plan-change-platform-notify`
- [x] 3.5 `CHANGELOG.md` 加條目；`docs/ref/features/platform/PLAN-CHANGES.md` 更新
- [x] 3.6 部署後在 UAT 送一筆申請，確認平台帳號收到信、`platform_audit_logs` 有 `plan_change.notify_platform`，之後歸檔本 change
