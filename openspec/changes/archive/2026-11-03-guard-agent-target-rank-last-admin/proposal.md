# Proposal

## Why

改成員角色時，系統只檢查「新角色」有沒有超出操作者的權限，不檢查「對方目前的角色」，也沒有最後一位管理員保護。`supervisor` 系統角色預設有 `agent.role.assign`，所以主管可以把管理員降級；租戶只有一位管理員時，之後沒有人持有 `role.manage`，也沒有人能把他改回來，只能改資料庫（AUDIT RBAC-08，P1，issue #413）。

重設他人密碼、停用、刪除成員同樣不比較目標的權限：持 `agent.password.reset` 的自訂角色可以重設管理員的密碼，再以管理員身分登入（AUDIT RBAC-09）。

「最後一位管理員」的判斷看舊的角色列舉 `role`：列舉是 `ADMIN`、角色已改成低權限自訂角色的成員也被算成管理員，讓真正的最後一位管理員可以被停用或刪除（AUDIT RBAC-03 的一列）。

## What Changes

- 改角色、重設他人密碼、停用、刪除成員時，目標成員目前角色的有效權限（含 `implies`）含操作者沒有的權限碼，系統回 HTTP 403 `TARGET_OUTRANKS_ACTOR`，`error.details.exceededPermissions` 是多出的權限碼。操作者是租戶 `admin` 系統角色時不受限，與 `ROLE_ESCALATION` 相同。
- 改角色：新角色不含管理權限、目標是租戶最後一位啟用中的管理員時，系統回 HTTP 422 `LAST_ADMIN_PROTECTED`。這個檢查排在 `TARGET_OUTRANKS_ACTOR` 之前。
- 「管理員」改為依權限判斷：角色的有效權限含標記 `selfLock` 的權限碼（`role.manage`）。不再看角色列舉 `role`。停用與刪除的最後一位管理員保護也改用這個判斷。
- `LAST_ADMIN_PROTECTED` 的訊息依動作說明（停用、刪除、改角色）。
- 人員管理頁的編輯對話框對 `TARGET_OUTRANKS_ACTOR`、`LAST_ADMIN_PROTECTED`、`SELF_LOCK` 顯示中文原因。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `role-management`：「指派角色給成員的越權防護」加上比對目標目前的權限；新增「對其他成員的操作不能用在權限比自己高的成員」。
- `agent-lifecycle`：「停用成員」「永久刪除成員」的管理員改依權限判斷並加上目標權限檢查；新增「改角色的最後一位管理員保護」。
- `agent-management`：「重設其他成員的密碼」加上目標權限檢查。

## Impact

- API：`apps/api/src/modules/agent/agent.service.ts`、`agent.flow.ts`。
- Web：`apps/web/src/components/settings/AgentManagement.tsx`。
- 測試：`apps/api/tests/feature/modules/agent/agent-management.test.ts`、`apps/web/tests/unit/components/settings/agent-management.test.tsx`。
- 文件：`docs/ref/features/tenant/MEMBERS.md`、`docs/ref/modules/PERMISSIONS.md`、`docs/ref/features/health/MEMBERS.md`、`.claude/skills/feature-members/SKILL.md`。
- 行為改變：持 `agent.password.reset`、`agent.deactivate`、`agent.purge` 的非管理員角色不能再對權限比自己高的成員操作。持 `role.manage` 的自訂角色成員現在算管理員；角色列舉是 `ADMIN`、角色沒有 `role.manage` 的成員不再算管理員。
