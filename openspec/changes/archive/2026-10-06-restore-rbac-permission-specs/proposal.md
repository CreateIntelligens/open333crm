## Why

權限系統以權限碼授權：路由以 `requirePermission()` 檢查成員的有效權限集合，租戶可以自訂角色的權限。主規格 `rbac` 仍然描述舊的角色白名單：`requireRole()`、`requireAdmin()`，以及「SUPERVISOR 才能看渠道」這類以角色列舉決定的存取規則。

描述權限碼的規格在 change `rbac-granular-permissions`。這個 change 在 `aa274cf0`（2026-09-15）以改名的方式搬進 `archive/`，沒有經過 `openspec archive`，它的 4 份 delta spec 從來沒有套用到主規格（issue #228）。`add-tenant-audit-gdpr` 對 `rbac` 的 1 條需求也一樣。這些 delta spec 不能直接套用：

- `rbac` 的 MODIFIED 改掉了所有情境的名稱，`openspec archive` 會中止。
- 403 的回應格式、有效權限集合的算法（少了方案天花板）、`DELETE /agents/:id` 要求的權限碼都已經和程式不同。
- delta spec 之間互相矛盾：自訂角色建立時「帶權限」與「空白」；移除前置權限時「連帶移除」與「回 422」。

issue #217 已經決定這次的寫法（comment 6008555780）。

## What Changes

- 改寫主規格 `rbac`：
  - 以 REMOVED 刪除舊的 10 條需求。舊的情境名稱都以角色列舉命名，不能以 MODIFIED 保留。
  - 新增「路由以權限碼授權」：一條通則，不逐條列出各模組的權限碼（#217 決定 2）。各路由用哪個權限碼，以程式為準。
  - 新增「Partner API 金鑰只通過白名單權限碼」。
  - 新增「CLI token 的授權」：scope 與成員的有效權限集合都要符合，`requirePermission()` 不能直接放行 CLI token（#217 的 CLI 選項 A）。
- 新增主規格 `permission-check`：權限檢查的 guard 與 403 的回應格式、任一權限碼即可通過、依請求內容追加權限碼、有效權限集合（含方案天花板，沒有角色時為空）、快取、登入成員的權限端點。
- 新增主規格 `permission-model`：
  - 權限註冊表與權限碼的命名規則。命名放寬為兩段以上、可含 `-` 與 `_`（#217 決定 3），現有的權限碼都不改名。
  - 前置權限與隱含權限。
  - 啟動時的驗證。
  - 稽核與合規的 3 個權限碼。
- 新增主規格 `role-management`：
  - 系統角色與自訂角色。
  - 角色管理需要的權限碼。
  - 租戶隔離。
  - 安全鎖。
  - 兩種越權防護：設定角色權限、指派角色給成員。
  - 刪除使用中的角色。
  - 角色列表與權限矩陣。
- 「系統角色權限可以調整，但有安全鎖」加上情境「權限註冊表更新後，租戶對系統角色的修改仍然保留」（#217 決定 4）。
- 歸檔 delta spec 的兩處矛盾以程式的行為為準：自訂角色建立時沒有權限；缺少前置權限時回 422，系統不自動補上或移除。

## Capabilities

### New Capabilities

- `permission-check`：權限檢查的 guard、有效權限集合的計算與快取、登入成員的權限端點。
- `permission-model`：權限註冊表、命名規則、前置與隱含權限、啟動時的驗證。
- `role-management`：系統角色與自訂角色的管理、安全鎖與越權防護。

### Modified Capabilities

- `rbac`：改以權限碼授權，加上 Partner API 金鑰與 CLI token 的授權規則。

## Impact

- 這個 change 只補規格與測試，不修改程式的行為。`packages/core/src/rbac/permissions.ts` 只改了命名規則的註解。
- 現況違反兩條規格，兩者都在 `docs/ref/system/AUDIT.md`，這次補上規格依據：
  - `rbac` 的「CLI token 的授權」：CLI 路由與 MCP 工具只檢查 scope，`requirePermission()` 對 CLI token 直接放行。見 RBAC-02。
  - `role-management` 的「權限註冊表更新後，租戶對系統角色的修改仍然保留」：reconcile 腳本會覆蓋租戶的修改。見 RBAC-05。
- 主規格 `agent-management` 的「Create Agent」與「Assign Agent Role」仍然以角色列舉描述，例如「SUPERVISOR 不能指派 ADMIN」，與 `role-management` 的「指派角色給成員的越權防護」不一致。這兩條需求留給另一個 change 改寫。
- 歸檔 delta spec 中描述前端畫面的需求，這個 change 不納入：角色權限設定頁的版面、勾選連動、隱含權限的說明、鎖定的勾選格、暫存後明確儲存、依自己的權限唯讀，以及 `usePermission` 的選單控制。`apps/web` 的單元測試不渲染元件，這些情境目前寫不了測試。這些需求另開 change 處理，由 issue #228 追蹤。
- 歸檔後，新增的 3 份主規格的 Purpose 是 CLI 產生的佔位文字，`rbac` 原有的 Purpose 也已經過時。4 份都要手動改寫。
