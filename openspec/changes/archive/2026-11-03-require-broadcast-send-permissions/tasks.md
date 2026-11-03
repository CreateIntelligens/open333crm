## 1. 建立與送出時的權限（MKT-02、MKT-03）

- [x] 1.1 測試 `apps/api/tests/feature/modules/marketing/broadcast-send-permissions.test.ts`：「Schedule without the broadcast permission」「沒有發券權限建立附券廣播」「沒有發券權限立即發送附券廣播」「沒有檢視優惠券權限預覽附券廣播」，在現有程式上斷言失敗
- [x] 1.2 同檔：「Draft without the broadcast permission」「Schedule with the broadcast permission」「有發券權限建立附券廣播」「不附券的預覽」（既有行為，寫好就通過；突變驗證見 4.1）
- [x] 1.3 `marketing.routes.ts`：建立群發加上 `requirePermissionWhen('marketing.broadcast')`（排程）與 `requirePermissionWhen('coupon.issue')`（附券）；`audience-preview` 加上 `requirePermissionWhen('coupon.view')`；`/send` 附券群發以 `assertPermission(request, 'coupon.issue')` 檢查（design D6）
- [x] 1.4 `rbac.guard.ts`：`requirePermissionWhen` 可帶錯誤訊息；新增 `assertPermission()`

## 2. 排程器重新檢查（MKT-02、MKT-03）

- [x] 2.1 同檔測試：「Creator lost the broadcast permission」「Creator deactivated」「Coupon broadcast and the creator lost the coupon permission」「Coupon broadcast sent now by another member」，在現有程式上斷言失敗
- [x] 2.2 同檔：「Member with the permissions」「Batch issue needs only the coupon permission」（拿掉檢查前就通過；突變驗證見 4.1）
- [x] 2.3 migration：`broadcasts.scheduledById`；`createBroadcast()` 排程時寫入建立者，`queueCouponBroadcast()` 寫入按下發送的人（design D3）
- [x] 2.4 新檔 `broadcast-send-authority.ts`：需要的權限（design D4）與檢查；`broadcast.scheduler.ts` 送出前檢查，不過時以條件更新標 `failed`（design D5）
- [x] 2.5 既有測試 `broadcast-coupon.test.ts` 的測試成員改為綁定角色並有 `coupon.view`、`coupon.issue`（排程器現在會檢查建立者）

## 3. 前端

- [x] 3.1 測試 `apps/web/tests/unit/app/dashboard/marketing/broadcast-tab.test.tsx`：「表單停用附券欄位」「Create form without the broadcast permission」，在現有程式上斷言失敗
- [x] 3.2 `BroadcastCouponField` 接受 `disabledReason`；`BroadcastTab` 依 `usePermission()` 停用排程與附券欄位並說明

## 4. 完成定義

- [x] 4.1 突變驗證：「Creator lost…」「沒有發券權限建立附券廣播」等 8 個情境在修正前斷言失敗（1.1、2.1）；`schedulingMemberId()` 改成只看建立者時「Coupon broadcast sent now by another member」失敗；`requiredSendPermissions()` 拿掉批次發券的例外時「Batch issue needs only the coupon permission」失敗
- [x] 4.2 `pnpm test`（api、workers、web unit）
- [x] 4.3 api feature：marketing、coupon 相關檔案以獨立測試庫執行
- [x] 4.4 tsc（api、web、workers）
- [x] 4.5 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 4.6 `node scripts/validate-openspec.mjs require-broadcast-send-permissions`
- [x] 4.7 `docs/ref/features/tenant/MARKETING.md`、`docs/ref/features/health/MARKETING.md`、`docs/ref/DATABASE-ERD.md`、`docs/ref/features/feature-map.json`、`.claude/skills/feature-marketing/SKILL.md` 更新；CHANGELOG、AUDIT、AUDIT-REVIEWS 由維護者處理（本次不改）
