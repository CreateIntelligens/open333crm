---
name: feature-members
description: >
  open333CRM「成員、角色與權限」功能顧問：人員管理（新增成員、開帳號、初始密碼、改角色、重設密碼、
  停用／重新啟用／永久刪除成員、已停用的人員、email 全域唯一、停用不釋放 email）、改自己的密碼、
  角色與權限頁（自訂角色、權限矩陣、前置權限 dependsOn、隱含權限 implies、內建鎖定 adminLock、防自鎖 selfLock、
  越權防護 ROLE_ESCALATION／PRIVILEGE_ESCALATION）、有效權限與方案天花板、權限快取（Redis perms:*、60 秒租戶方案快取）、
  最後一位管理員保護、成員可用渠道（AgentChannelAccess 直綁）、團隊、登入與 Passkey。當需求、bug 或新功能碰到
  /dashboard/settings/agents、/dashboard/settings/roles、/dashboard/settings/general、agent 模組、role 模組、auth 模組、
  requirePermission、permission.service、permissions.ts 權限碼註冊表、Agent、Role、RolePermission 時使用。
  也在新增權限碼、新增路由、改通知收件人或自動指派、改方案功能模組之前使用，確認不破壞權限。
---

# 成員、角色與權限

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/MEMBERS.md`
  - 注意：它沒有寫「改角色沒有最後一位管理員保護、也不檢查對方比自己高」，見健檢 HC-MEMBERS-01。
- 權限怎麼算、快取多久生效：`docs/ref/modules/PERMISSIONS.md`
- 健檢結果與已知問題：`docs/ref/features/health/MEMBERS.md`
- 規格：`openspec/specs/agent-lifecycle/spec.md`、`openspec/specs/agent-management/spec.md`、`openspec/specs/role-management/spec.md`、`openspec/specs/role-settings-page/spec.md`、`openspec/specs/permission-model/spec.md`、`openspec/specs/permission-check/spec.md`、`openspec/specs/rbac/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 權限碼註冊表：`packages/shared/src/rbac/permissions.ts`（`packages/core/src/rbac/permissions.ts` 只是轉出）；系統角色預設權限：`packages/shared/src/rbac/default-roles.ts`
- 影響分析：`node scripts/feature-impact.mjs --domain members`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 成員列表 | `/dashboard/settings/agents`（側欄「人員管理」不看權限，所有人都看得到） | `GET /agents` → `agent.flow.ts` `listAgentsFlow` → `listAgents(isActive=true)` | 無。上方分頁「全部／ADMIN／SUPERVISOR／AGENT」依**舊角色列舉** `role` 篩選，自訂角色的成員算進原本的列舉 | `agent.view`（三個系統角色都有）/ 無權限時列表空白 |
| 2 | 新增成員 | 右上「新增人員」 | `POST /agents` → `createAgentFlow` → `createAgent`：查 email → 方案 `maxAgents` → `resolveNewAgentChannels` → `resolveRoleAssignment`（越權防護）→ 建立 → `insertAgentChannelAccess` | 稽核 `agent.create`。**不寄任何信**，密碼由建立者轉交（AUTH-01）。可見渠道 fail-closed：沒勾的渠道看不到 | `agent.manage` / 按鈕隱藏。主管預設有，只能給不超過自己的角色 |
| 3 | 改角色 | 列表「編輯」→ 角色下拉 → 儲存（角色沒變就不送） | `PATCH /agents/:id/role` → `updateAgentRole` | 稽核 `agent.role.assign`。對方要換發 token 才生效（最長 15 分鐘）。**不檢查對方目前比自己高、沒有最後一位管理員保護**（HC-MEMBERS-01） | `agent.role.assign` / 下拉停用 |
| 4 | 重設他人密碼 | 編輯對話框「重設密碼」 | `PATCH /agents/:id/password` → `resetAgentPassword` | 稽核 `agent.password.reset`。已發出的 refresh token 仍可換發（AUTH-08）。可以重設管理員的密碼（HC-MEMBERS-02） | `agent.password.reset`（預設只有 admin）/ 欄位隱藏 |
| 5 | 可使用的渠道 | 編輯對話框勾選清單（`/channels/assignable` 全量） | `GET`、`PUT /agents/:id/channels` → `channel-team-access.ts` `setAgentChannels`（整組替換） | 稽核 `agent.channels.set`。**一律寫 `full`**，原本的 `read_only`／`reply_only` 被升成 `full`（HC-MEMBERS-04） | `channel.assign_team`（預設只有 admin）/ 區塊隱藏 |
| 6 | 停用 | 編輯對話框左下「停用」（自己看不到） | `POST /agents/:id/deactivate` → `deactivateAgentFlow`：自己 422 `SELF_ACTION_FORBIDDEN` → `assertNotLastActiveAdmin` 422 `LAST_ADMIN_PROTECTED` | 稽核。email 仍佔用。登入回 `ACCOUNT_DISABLED`、換發被擋，但**手上的 access token 與 socket 仍有效** | `agent.deactivate` / 按鈕隱藏 |
| 7 | 已停用的人員、重新啟用 | 列表下方「已停用的人員」區塊 | `GET /agents/inactive`、`POST /agents/:id/reactivate` → `reactivateAgent`（套 `maxAgents`） | 稽核 `agent.reactivate`；角色維持停用前 | `agent.deactivate` / 區塊隱藏 |
| 8 | 永久刪除 | 編輯對話框「刪除」（停用的人也可從區塊的「編輯」進） | `DELETE /agents/:id` → `purgeAgent`：先刪通知、CLI session、Passkey，再刪成員 | 釋放 email；工單、對話、訊息、稽核的成員欄位設為空值；團隊成員與渠道綁定 cascade | `agent.purge`（預設只有 admin）/ 按鈕隱藏 |
| 9 | 改自己的密碼 | 人員頁右上「修改密碼」（無確認欄）或 `/dashboard/settings/general`（有確認欄） | `PATCH /agents/me/password` → `changeOwnPassword`（比對目前密碼） | **不寫稽核**（HC-MEMBERS-09）；不登出其他裝置（AUTH-08） | 只驗登入 |
| 10 | 角色列表與權限矩陣 | `/dashboard/settings/roles` | `GET /roles`、`GET /roles/matrix`、`GET /roles/:id/permissions` | 無。顯示角色本身的權限碼，不套方案天花板（PLAN-08） | `role.view` / 分頁與側欄隱藏；`agent.role.assign` 隱含 `role.view`，所以主管看得到唯讀頁 |
| 11 | 設定角色權限 | 勾選 → 底部「儲存變更」 | `PUT /roles/:id/permissions` → `role.flow.ts` `setRolePermissionsFlow` → `setRolePermissions`：未知碼 422 → `DEPENDENCY_UNMET` 422 → `PRIVILEGE_ESCALATION` 403 → `ADMIN_LOCK` 422 → `SELF_LOCK` 422 | 稽核 `role.permission.update`；commit 後清 Redis `perms:role:<id>` 與 `perms:tenant:<id>:*`，**立即生效** | `role.manage` / 勾選框停用、無「新增角色」 |
| 12 | 自訂角色建立、改名、刪除 | 左欄「＋ 新增角色」、自訂角色的鉛筆與垃圾桶 | `POST /roles`、`PATCH /roles/:id`、`DELETE /roles/:id` | 名稱 1–20 字、租戶內唯一（`DUPLICATE` 422）；刪除被使用中的角色 409 `ROLE_IN_USE` 並列出姓名（含停用的人）；系統角色刪除 403 | `role.manage` / 圖示隱藏 |
| 13 | 登入 | `/login`（密碼、Passkey） | `POST /auth/login`、`/auth/passkeys/authentication/*`、`/auth/refresh`、`GET /auth/me/permissions` | 前端把有效權限存在 `AuthProvider.tsx`，重新載入才更新 | 公開；IP 每分鐘 10 次、email 15 分鐘 5 次鎖定 |

**有後端、沒有前端入口**：系統角色改名（`PATCH /roles/:id`，頁面只對自訂角色顯示鉛筆）；直綁渠道的層級（後端只在建立成員時依建立者層級寫入，`PUT /agents/:id/channels` 不收層級）；團隊的建立與成員管理（API 也沒有，TEAM-01）；成員改姓名與 email（租戶端沒有端點，只有平台後台能改 email）。

**前端實際送出的值**：
- 新增：`{name, email, password}` 加上系統角色時 `{role: 'ADMIN'|'SUPERVISOR'|'AGENT'}`、自訂角色時 `{role: 'AGENT', roleId}`；`channelIds` 只有動過勾選清單才送（沒送＝建立者能指派的全部渠道）。
- 改角色：系統角色送 `{role}`；自訂角色送 `{role: <成員目前的列舉>, roleId}`，所以舊列舉不會跟著變（RBAC-03）。
- 渠道：`{channelIds: [...]}` 整組替換。角色權限：`{permissions: [...]}` 整組替換。角色名稱前端 `trim()` 後送，`maxLength=20`。
- 後端 `createAgentSchema` 的 `email` 不轉小寫、不去空白（AUTH-10）；密碼只有下限 8、沒有上限（bcrypt 只看前 72 bytes，HC-MEMBERS-05）。

## 不可破壞的規則
- **權限碼只有一個來源**：`packages/shared/src/rbac/permissions.ts`。新增權限碼要：加進註冊表（`feature`、需要時 `dependsOn`／`implies`）→ `default-roles.ts` 決定預設角色 → 路由掛 `requirePermission()` → 需要時 `Sidebar.tsx` 的 `perm` → 部署後跑 `node scripts/grant-new-role-permissions.mjs <碼...>` 並清 Redis `perms:*`。**不要跑 reconcile 腳本**，它會覆蓋租戶對系統角色的修改（RBAC-05）。
- `dependsOn` 只能一層（`rbac-registry.test.ts` 檢查）；同一個碼不能同時出現在 `dependsOn` 與 `implies`；至少要有一個 `selfLock` 碼，否則 API 不啟動（`validatePermissionRegistry`），`agent.service.ts` 載入時也會丟錯。
- 有效權限 = （角色權限 ＋ implies）∩（方案功能模組 − deny）。**越權防護用的是角色原始權限 `getEffectivePermissions`，路由檢查用的是 `getEffectiveTenantPermissions`**，兩者不要混用。
- 改角色權限要經 `role.flow.ts`：快取在 commit **之後**才清（`scope.afterCommit`），提早清會被另一個請求以舊資料寫回。
- 租戶的方案在 API 行程記憶體快取 60 秒（`tenant-plan.cache.ts`），Redis `FLUSHDB` 清不到；換方案後短時間的 403 多半是這個。
- email 在**全系統**唯一（登入靠 email 找租戶）。停用不釋放 email，只有永久刪除才釋放；刪除前要先清 RESTRICT 外鍵（通知、CLI session、Passkey）。新增一張以 RESTRICT 參照 `agents` 的表，必須同步加進 `purgeAgent`。
- `Agent` 有兩個角色欄位：`role`（舊列舉）與 `roleId`。路由權限只看 `roleId`；自動指派、通知收件人、試用到期信、最後一位管理員保護仍看 `role`（RBAC-03）。指派自訂角色時 `role` 沿用舊值。
- 自我保護：不能停用、刪除自己（`SELF_ACTION_FORBIDDEN`）；不能把自己改成沒有 `selfLock` 碼的角色、不能從自己的角色移除 `role.manage`（`SELF_LOCK`）；`admin` 系統角色的 `adminLock` 碼不能移除（`ADMIN_LOCK`）。
- 渠道可見範圍是 fail-closed：沒有直綁、團隊也沒授權、角色又沒有 `channel.view_all` 的成員什麼都看不到。新增成員一定要決定渠道。
- 停用與改角色都不會立刻踢人：access token 有效到過期（預設 15 分鐘），socket 直到斷線。要立即生效只能等這些憑證過期。
- 不要用 `requireRole()`／`requireAdmin()`，新路由一律 `requirePermission()`。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain members` 看最新版本。重點：
- **被依賴**：每個掛 `requirePermission()` 的模組（收件匣、工單、聯絡人、行銷、知識庫、報表、SLA、設定、渠道）；工單負責人下拉與自動指派、通知收件人、自動化「通知主管」、試用到期信讀成員與舊角色列舉。
- **依賴**：渠道（可見範圍與可指派渠道）、方案（功能天花板、`maxAgents`）、平台開通（建立系統角色與第一位 ADMIN）、治理（稽核）。

## 回歸清單
改到本領域時，至少重走：
1. admin 新增成員（自訂角色、只勾一個渠道）→ 新成員登入只看得到那個渠道 → 重複 email 409。
2. 改角色 → 對方換發 token 後權限改變；改成權限比自己高的角色 403 `ROLE_ESCALATION`；把自己改成沒有 `role.manage` 的角色 422 `SELF_LOCK`。
3. 停用 → 登入 `ACCOUNT_DISABLED`、同 email 建立 409 → 已停用的人員區塊重新啟用 → 原密碼可登入 → 永久刪除 → 同 email 可再建立。
4. 角色頁：勾選帶出前置權限、儲存後重新整理一致、授予自己沒有的碼 403、`admin` 的鎖定碼勾不掉、刪除使用中的角色 409 列出姓名。
5. 用 supervisor、agent 與只有部分權限的自訂角色重走 1–4，確認按鈕隱藏與後端 403（`error.details.requiredPermission`）。
- 自動測試：`pnpm --filter @open333crm/api test -- modules/agent modules/role modules/auth`；`pnpm --filter @open333crm/core test -- rbac`；`pnpm --filter @open333crm/web test -- agent-management role-permission-matrix auth-provider`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/agent modules/role guards/permission-check route-permission-guards modules/auth`。
- E2E：`apps/web/tests/e2e-uat/tenant-rbac.spec.ts`、`apps/web/tests/e2e-uat/tenant-settings-team.spec.ts`。

## 常見 bug 從哪裡查
- 「新功能所有人都 403」：新權限碼沒補給既有租戶的角色。看 `error.details.requiredPermission`，跑 `scripts/grant-new-role-permissions.mjs` 並清 `perms:*`。
- 「改了權限沒生效」：改角色權限是立即的；改成員的角色要等對方換發 token；換方案要等 60 秒行程快取（`apps/api/src/services/tenant-plan.cache.ts`）。前端側欄要重新載入頁面。
- 「勾了權限還是 403」：方案天花板扣掉了（角色頁不顯示天花板，PLAN-08）。用 `GET /auth/me/permissions` 看實際有效權限。
- 「成員什麼對話都看不到」：沒有直綁渠道（`agent_channel_accesses`），角色也沒有 `channel.view_all`。邏輯在 `apps/api/src/services/channel-visibility.ts`。
- 「同一個 email 不能再開帳號」：停用不釋放 email，要永久刪除；或被其他租戶用掉（RLS 下查不到對方，由唯一約束擋成 409）。
- 「同一個自訂角色的兩個人，一個收得到主管通知、一個會被自動派案」：舊角色列舉 `role` 不同（RBAC-03），查 `agents.role`。
- 「刪不掉角色」：還有成員（含停用的）使用，錯誤訊息會列姓名；`apps/api/src/modules/role/role.service.ts` 的 `deleteRole`。
- 「權限錯誤訊息是英文碼」：越權與自鎖的訊息在 `apps/api/src/modules/agent/agent.service.ts` 與 `role.service.ts`，前端對照在 `apps/web/src/components/settings/AgentManagement.tsx` 的 `resolveApiError`。
