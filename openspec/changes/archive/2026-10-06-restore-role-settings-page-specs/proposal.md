## Why

change `rbac-granular-permissions` 有 7 條需求描述前端畫面：角色權限設定頁的版面、勾選連動、隱含權限的說明、鎖定的勾選格、暫存後儲存、唯讀模式，以及 `usePermission` 的選單控制。這個 change 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。#232 補回了權限的後端規格，但沒有納入這 7 條，因為 `apps/web` 的單元測試不渲染元件，這些情境寫不了測試。

對照現行程式時發現 3 個 bug：

- 對 admin 系統角色的「人員與權限」群組按「全關」，會移除 `agent.manage` 與 `role.manage`，儲存時後端回 422 `ADMIN_LOCK`。單獨取消 `role.view` 也一樣，因為 `role.manage` 以 `role.view` 為前置權限。
- 群組的「全關」不取消其他群組的相依權限。例如「聯絡人」全關後，`identity.review` 與 `data.erase` 仍然勾選，儲存時後端回 422 `DEPENDENCY_UNMET`。
- `loginWithPasskey()` 登入後沒有載入權限。以 Passkey 登入後，側邊選單隱藏所有需要權限的項目，重新載入頁面才恢復。

前兩個 bug 讓成員能做出一份永遠存不進去的草稿，但不會寫入錯誤的資料，因為後端會拒絕。

另外，「↳ 自動開啟」標籤顯示在相依權限上：只要相依權限的前置權限已勾選，標籤就出現，與「系統自動勾選了哪個前置權限」無關。歸檔規格的原意是標示被自動勾選的前置權限。

## What Changes

- 新增主規格 `role-settings-page`，6 條需求：依群組顯示角色的權限、勾選時處理前置權限、隱含權限只顯示說明、admin 角色的內建鎖定、變更暫存到按下儲存、沒有 `role.manage` 時唯讀。
- `permission-check` 新增「前端依權限顯示選單」。
- 歸檔規格的寫法與決定：
  - 越權與自我鎖定不在頁面上預先停用，由後端拒絕後顯示錯誤。這是現行行為，寫進「admin 角色的內建鎖定」。
  - 不納入「版面」需求（左右兩欄、沒有水平捲動）。這是視覺呈現，元件測試驗證不了。
  - 「自動開啟」標籤改為標示這次編輯中被自動勾選的前置權限，並說明是哪個權限需要它。
  - 「後端仍然把關」不另寫情境，由 `permission-check` 的「權限檢查 guard」規定。
- 修正上述 3 個 bug：
  - admin 角色鎖定 `adminLock` 權限與它們的前置權限，群組的「全關」略過這些權限。
  - 群組的「全關」一併取消其他群組的相依權限，並先要求確認。
  - Passkey 登入後載入權限。
- `apps/web` 加上元件測試：`@testing-library/react`、`@testing-library/dom`、`jsdom`。元件測試的檔名是 `*.test.tsx`，第一行宣告 `// @vitest-environment jsdom`。

## Capabilities

### New Capabilities

- `role-settings-page`：角色權限設定頁的顯示、勾選連動、內建鎖定、暫存與儲存，以及唯讀模式。

### Modified Capabilities

- `permission-check`：新增前端依權限顯示選單。

## Impact

- `apps/web/src/components/settings/RolePermissionMatrix.tsx`：群組全開、全關與勾選的連動；admin 內建鎖定；「自動開啟」標籤。
- `apps/web/src/providers/AuthProvider.tsx`：Passkey 登入後載入權限。
- `apps/web/vitest.config.ts`、`apps/web/tests/setup/jsdom.ts`：元件測試的設定。jsdom 沒有實作 `<dialog>` 的 `showModal()` 與 `close()`，setup 檔補上。
- `docs/ref/modules/PERMISSIONS.md`：「前端的顯示」補上 Passkey 登入與角色權限頁的行為。
- 歸檔後，新主規格 `role-settings-page` 的 Purpose 是 CLI 產生的佔位文字，`permission-check` 的 Purpose 也要加上前端，兩份都要手動改寫。
