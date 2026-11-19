---
name: feature-members
description: >
  open333CRM「成員、角色與權限」功能顧問：人員管理、自訂角色與權限矩陣、有效權限與方案天花板、權限快取、團隊。改到 agent／role／auth 模組、requirePermission、permissions.ts，或新增權限碼、新增路由之前使用。
---

# 成員、角色與權限

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。成員、角色與權限的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

人員管理：新增成員、初始密碼、改角色、重設密碼、停用、重新啟用、永久刪除、已停用的人員、email 全域唯一、改自己的密碼。
角色與權限：自訂角色、權限矩陣、前置權限 `dependsOn`、隱含權限 `implies`、`adminLock`、`selfLock`、越權防護 `ROLE_ESCALATION`／`PRIVILEGE_ESCALATION`、最後一位管理員保護。
有效權限與方案天花板、權限快取（Redis `perms:*`、60 秒的租戶方案快取）、成員直綁的渠道（`AgentChannelAccess`）、團隊、登入與 Passkey。
相關的程式與資料：`/dashboard/settings/agents`、`/dashboard/settings/roles`、`/dashboard/settings/general`、agent／role／auth 模組、`requirePermission`、`permission.service`、`permissions.ts`、`Agent`、`Role`、`RolePermission`。
新增權限碼、新增路由、改通知收件人或自動指派、改方案的功能模組之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/MEMBERS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `MEMBERS.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、稽核動作 | 程式的入口 |
| 新增成員、email、初始密碼 | 新增 |
| 改角色、停用、重新啟用、永久刪除、對他人的操作 | 停用與永久刪除 |
| 改自己的密碼、重設他人密碼 | 密碼 |
| `role` 與 `roleId` | 兩套角色欄位 |
| 角色的權限碼、註冊表、角色名稱 | 系統角色與自訂角色、權限碼 |
| 有效權限、快取、新增權限碼的步驟 | 有效權限怎麼算；`docs/ref/modules/PERMISSIONS.md` |
| 成員可用的渠道、團隊 | 渠道與團隊 |
| 登入、token、防暴力破解 | 登入 |
| 權限碼與預設角色 | 權限一覽 |
| 前端頁面、送出的值、沒有畫面入口的功能 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/agent/`、`apps/api/tests/unit/modules/role/`、`apps/api/tests/unit/modules/auth/`、`apps/api/tests/feature/modules/agent/`、`apps/api/tests/feature/modules/role/`、`packages/core/tests/unit/rbac/`、`apps/web/tests/unit/components/settings/`，寫法可以照著參考。

`MEMBERS.md` 裡標 `HC-MEMBERS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/MEMBERS.md`
- 規格：`openspec/specs/agent-lifecycle/spec.md`、`openspec/specs/agent-management/spec.md`、`openspec/specs/role-management/spec.md`、`openspec/specs/role-settings-page/spec.md`、`openspec/specs/permission-model/spec.md`、`openspec/specs/permission-check/spec.md`、`openspec/specs/rbac/spec.md`
- 權限碼註冊表：`packages/shared/src/rbac/permissions.ts`；系統角色的預設權限：`packages/shared/src/rbac/default-roles.ts`
- 影響分析：`node scripts/feature-impact.mjs --domain members`。依賴與被依賴的領域、完整的規格清單，以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `MEMBERS.md` 括號內的章節。

- 權限碼只有一個來源：`packages/shared/src/rbac/permissions.ts`。新增權限碼照四個步驟做，部署後用 `scripts/grant-new-role-permissions.mjs` 補給既有租戶並清 `perms:*`。不要跑 reconcile 腳本（RBAC-05）。（有效權限怎麼算）
- `dependsOn` 只能一層。同一個碼不能同時在 `dependsOn` 與 `implies`。至少要有一個 `selfLock` 碼，否則 API 不啟動（`validatePermissionRegistry`）。（權限碼）
- 有效權限 =（角色權限 ＋ implies）∩（方案功能模組 − deny）。越權防護用角色原始權限 `loadRolePermissions`，路由檢查用 `getEffectiveTenantPermissions`。兩者不要混用。（有效權限怎麼算）
- 改角色權限要經 `role.flow.ts`。快取在 commit 之後才清（`scope.afterCommit`）。（權限碼）
- 租戶的方案在 API 行程記憶體快取 60 秒（`tenant-plan.cache.ts`），Redis `FLUSHDB` 清不到。（有效權限怎麼算）
- email 在全系統唯一。停用不釋放 email，只有永久刪除才釋放。新增一張以 RESTRICT 參照 `agents` 的表，必須同步加進 `purgeAgent`。（新增、停用與永久刪除）
- `Agent` 有兩個角色欄位。路由權限只看 `roleId`；自動指派、通知收件人、試用到期信看 `role`（RBAC-03）。最後一位管理員保護看權限（`roleIsAdmin`、`listAdminRoleIds`）。（兩套角色欄位、停用與永久刪除）
- 對他人的操作不能用在權限比自己高的成員（`TARGET_OUTRANKS_ACTOR`）。新增這類操作時也要呼叫 `assertTargetNotAboveActor()`。（停用與永久刪除）
- 自我保護：不能停用、刪除自己（`SELF_ACTION_FORBIDDEN`）；不能讓自己失去 `selfLock` 碼（`SELF_LOCK`）；`admin` 的 `adminLock` 碼不能移除（`ADMIN_LOCK`）。（停用與永久刪除、權限碼）
- 渠道可見範圍是 fail-closed。新增成員一定要決定渠道。（新增、渠道與團隊）
- 停用與改角色都不會立刻踢人：access token 有效到過期，socket 直到斷線。（停用與永久刪除）
- 新路由一律 `requirePermission()`，不要用 `requireRole()`／`requireAdmin()`。（有效權限怎麼算）
- 錯誤用 `AppError(訊息, code, status)`。

## 回歸清單

改到本領域時，至少重走：

1. admin 新增成員（自訂角色、只勾一個渠道）。新成員登入後只看得到那個渠道。重複的 email 回 409。
2. 改角色：
   - 對方換發 token 後權限改變。
   - 改成權限比自己高的角色：403 `ROLE_ESCALATION`。
   - 把自己改成沒有 `role.manage` 的角色：422 `SELF_LOCK`。
   - 主管改管理員：403 `TARGET_OUTRANKS_ACTOR`。
   - 唯一的管理員被降級：422 `LAST_ADMIN_PROTECTED`。
   - 對話框顯示中文原因。
3. 停用 → 登入回 `ACCOUNT_DISABLED`，同 email 建立回 409 → 在已停用的人員區塊重新啟用 → 原密碼可登入 → 永久刪除 → 同 email 可再建立。
4. 角色頁：
   - 勾選時帶出前置權限，儲存後重新整理一致。
   - 授予自己沒有的碼回 403。
   - `admin` 的鎖定碼勾不掉。
   - 刪除使用中的角色回 409，列出姓名。
5. 用 supervisor、agent 與只有部分權限的自訂角色重走 1–4，確認按鈕隱藏與後端 403（`error.details.requiredPermission`）。

自動測試：

- `pnpm --filter @open333crm/api test -- modules/agent modules/role modules/auth`
- `pnpm --filter @open333crm/core test -- rbac`
- `pnpm --filter @open333crm/web test -- agent-management role-permission-matrix auth-provider`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/agent modules/role guards/permission-check route-permission-guards modules/auth`
- E2E：`apps/web/tests/e2e-uat/tenant-rbac.spec.ts`、`apps/web/tests/e2e-uat/tenant-settings-team.spec.ts`

## 常見 bug 從哪裡查

- 「新功能所有人都 403」：新權限碼沒補給既有租戶的角色。看 `error.details.requiredPermission`，跑 `scripts/grant-new-role-permissions.mjs` 並清 `perms:*`。
- 「改了權限沒生效」：
  - 改角色權限立即生效。
  - 改成員的角色，要等對方換發 token。
  - 換方案要等 60 秒的行程快取（`apps/api/src/services/tenant-plan.cache.ts`）。
  - 前端側欄要重新載入頁面。
- 「勾了權限還是 403」：方案天花板扣掉了，角色頁不顯示天花板（PLAN-08）。用 `GET /auth/me/permissions` 看實際的有效權限。
- 「成員什麼對話都看不到」：沒有直綁渠道（`agent_channel_accesses`），角色也沒有 `channel.view_all`。邏輯在 `apps/api/src/services/channel-visibility.ts`。
- 「同一個 email 不能再開帳號」：停用不釋放 email，要永久刪除。也可能被其他租戶用掉：RLS 下查不到對方，由唯一約束擋成 409。
- 「同一個自訂角色的兩個人，一個收得到主管通知、一個會被自動派案」：兩人的舊角色列舉 `role` 不同（RBAC-03），查 `agents.role`。
- 「讀取或回覆的渠道權限被升成完整」：編輯對話框存檔時，`PUT /agents/:id/channels` 一律寫 `full`（HC-MEMBERS-04）。
- 「刪不掉角色」：還有成員（含停用的）使用，錯誤訊息列出姓名。看 `apps/api/src/modules/role/role.service.ts` 的 `deleteRole`。
- 「權限錯誤訊息是英文碼」：越權與自鎖的訊息在 `apps/api/src/modules/agent/agent.service.ts` 與 `role.service.ts`，前端的對照在 `apps/web/src/components/settings/AgentManagement.tsx` 的 `resolveApiError`。
