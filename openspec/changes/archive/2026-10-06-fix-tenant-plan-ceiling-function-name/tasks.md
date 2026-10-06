## 1. 規格

- [x] 1.1 MODIFIED `tenant-plan` 的「功能天花板交集」，函式名稱改成 `getEffectiveTenantPermissions()`，保留 3 個情境的名稱與內容

## 2. 完成檢查

- [x] 2.1 `openspec validate fix-tenant-plan-ceiling-function-name --strict` 通過
- [x] 2.2 以 `openspec archive` 歸檔本 change
- [x] 2.3 `openspec validate --specs --strict` 通過
