## Why

系統角色的預設權限有兩份：`packages/core/src/rbac/default-roles.ts` 給平台開通，`packages/database/prisma/seed-data/rbac-roles.ts` 給 demo seed。`database` 不能 import `core`（`core` 依賴 `database`，會循環依賴），所以第二份是手抄的，之後新增的權限碼沒有同步（AUDIT RBAC-06）。

API 容器每次啟動都執行 demo seed（`apps/api/docker-entrypoint.sh`），seed 依手抄的副本重建 Demo Tenant 的系統角色。2026-10-29 在 UAT 發現：每次部署之後，`admin` 少 9 個權限碼，稽核、優惠券、門市、資料匯出與刪除的頁面回 403；手動以 grant 腳本補上的碼，下一次部署又消失。

## What Changes

- 權限註冊表（`permissions.ts`）與預設角色表（`default-roles.ts`）搬到 `packages/shared/src/rbac/`。`shared` 沒有相依的套件，`core` 與 `database` 都能 import。`core` 原本的兩個檔改成轉出同一份，`@open333crm/core` 的 export 不變。
- demo seed 改用 `@open333crm/shared` 的 `DEFAULT_ROLE_PERMISSIONS`，刪除手抄的副本。修正後 demo seed 的 `supervisor` 沒有 `channel.view_all`，與 2026-09-30 定案的方向相同。
- demo seed 維持「先刪除 Demo Tenant 系統角色的權限碼，再依預設值重建」：seed 的工作是讓 Demo Tenant 與預設值同步（2026-10-29 使用者決定）。主規格 `role-management` 的「租戶對系統角色的修改要保留」改成寫明 Demo Tenant 是例外。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `permission-model`：修改「權限註冊表是權限點的唯一來源」與「啟動時驗證註冊表」（註冊表的位置）。
- `role-management`：修改「系統角色權限可以調整，但有安全鎖」（指向 Demo Tenant 的例外）；新增「demo seed 讓 Demo Tenant 與預設權限同步」。

## Impact

- 套件：`packages/shared/src/rbac/`（新增）、`packages/core/src/rbac/permissions.ts` 與 `default-roles.ts`（改成轉出）、`packages/database/prisma/seed-data/rbac-roles.ts`、`packages/database/package.json`（加上 `@open333crm/shared`）。
- 測試：`packages/core/tests/unit/rbac/demo-seed-roles.test.ts`。
- 部署：沒有 migration，沒有新的環境變數。部署之後，UAT 的 Demo Tenant 系統角色重設成與平台開通相同的預設值。
- 其他租戶、API 回應、前端：不變。
