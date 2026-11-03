# Tasks

## 1. 先寫會失敗的測試

- [x] 1.1 `apps/api/tests/feature/modules/agent/agent-management.test.ts`：「主管不能降級管理員」「不能降級最後一位管理員」（重現 RBAC-08）。驗證：改程式前兩者都以 assertion 失敗（回 200）
- [x] 1.2 同檔：「不能重設權限比自己高的成員的密碼」「不能停用權限比自己高的成員」「不能刪除權限比自己高的成員」（重現 RBAC-09）。驗證：改程式前以 assertion 失敗
- [x] 1.3 同檔：「角色列舉是 ADMIN 但沒有 role.manage 的成員不算管理員」（重現 RBAC-03 的最後一位管理員一列）。驗證：改程式前以 assertion 失敗
- [x] 1.4 同檔：「管理員可以降級另一位管理員」。現有程式已允許，寫完即通過；以下方 mutation 驗證其餘測試
- [x] 1.5 `apps/web/tests/unit/components/settings/agent-management.test.tsx`：改角色被拒（`TARGET_OUTRANKS_ACTOR`、`LAST_ADMIN_PROTECTED`、`SELF_LOCK`）時對話框顯示中文原因且不關閉。驗證：改程式前以 assertion 失敗

## 2. 實作

- [x] 2.1 `agent.service.ts`：新增 `assertTargetNotAboveActor()`（403 `TARGET_OUTRANKS_ACTOR`），套用在 `updateAgentRole()`、`resetAgentPassword()`、`deactivateAgent()`、`purgeAgent()`。驗證：1.1、1.2 通過
- [x] 2.2 `agent.service.ts`：`assertNotLastActiveAdmin()` 改依 `selfLock` 權限碼判斷管理員，訊息依動作說明；`updateAgentRole()` 在新角色不含管理權限時呼叫，排在 2.1 的檢查之前。驗證：1.1、1.3 通過
- [x] 2.3 `agent.flow.ts`：把 `actor.roleId` 傳給重設密碼、停用、刪除。驗證：`apps/api/tests/unit/modules/agent/agent.flow.test.ts` 通過
- [x] 2.4 `AgentManagement.tsx` 的 `resolveApiError()` 對三個錯誤碼顯示中文原因。驗證：1.5 通過

## 3. Mutation 驗證

- [x] 3.1 移除 `updateAgentRole()` 的 `assertTargetNotAboveActor()`：「主管不能降級管理員」失敗
- [x] 3.2 移除 `updateAgentRole()` 的 `assertNotLastActiveAdmin()`：「不能降級最後一位管理員」失敗（改回 403）
- [x] 3.3 啟用中管理員的計數加回 `role: 'ADMIN'`：「角色列舉是 ADMIN 但沒有 role.manage 的成員不算管理員」失敗
- [x] 3.4 移除重設密碼、停用、刪除的 `assertTargetNotAboveActor()`：三個對應測試失敗

## 4. 完成的定義

- [x] 4.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test` 通過
- [x] 4.2 `pnpm --filter @open333crm/api test:feature modules/agent modules/role` 通過
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有新增違規
- [x] 4.4 `CHANGELOG.md` 的 `Fixed` 條目：本次由使用者另行加入（回報附建議文字）
- [x] 4.5 更新 `docs/ref/features/tenant/MEMBERS.md`、`docs/ref/modules/PERMISSIONS.md`、`docs/ref/features/health/MEMBERS.md`、`.claude/skills/feature-members/SKILL.md`；`docs/ref/system/AUDIT.md`（RBAC-08、RBAC-09、RBAC-03）與 `AUDIT-REVIEWS.md` 由使用者另行更新（回報附建議文字）
- [x] 4.6 `node scripts/validate-openspec.mjs guard-agent-target-rank-last-admin` 通過
