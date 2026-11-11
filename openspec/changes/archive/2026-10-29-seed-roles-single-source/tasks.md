## 1. 會失敗的測試

- [x] 1.1 新增 `packages/core/tests/unit/rbac/demo-seed-roles.test.ts`，覆蓋 `role-management` 的「demo seed 讓 Demo Tenant 的系統角色與預設權限相同」：以假的 prisma 執行 `seedDemoRoles()`，斷言三個系統角色的權限碼等於 `DEFAULT_ROLE_PERMISSIONS`、名稱等於 `SYSTEM_ROLE_NAMES`。修正前失敗在斷言上（`admin` 的權限碼不同）

## 2. 共用同一份預設權限

- [x] 2.1 `permissions.ts`、`default-roles.ts` 以 `git mv` 搬到 `packages/shared/src/rbac/`，`packages/shared/src/index.ts` 匯出；`packages/core/src/rbac/` 的兩個檔改成具名轉出，`@open333crm/core` 的 export 不變
- [x] 2.2 `seed-data/rbac-roles.ts` 改用 `@open333crm/shared` 的 `DEFAULT_ROLE_PERMISSIONS`、`SYSTEM_ROLE_NAMES`、`SYSTEM_ROLE_SLUGS`，刪除手抄的副本；`packages/database/package.json` 加上 `@open333crm/shared`，讓 1.1 通過
- [x] 2.3 以 `docker build -f apps/api/Dockerfile` 建 API image，在容器的 `/app/packages/database` 以 `tsx` import `seed-data/rbac-roles.ts`，確認找得到 `@open333crm/shared`

## 3. 完成定義

- [x] 3.1 `pnpm test`、`pnpm build`（含 `apps/web`）、`check-workspace-esm.mjs --strict` 通過
- [x] 3.2 `CHANGELOG.md` 加 Fixed 條目；RBAC-06 從 `docs/ref/system/AUDIT.md` 移除，`docs/ref/system/AUDIT-REVIEWS.md` 加紀錄；更新 `docs/ref/modules/PERMISSIONS.md`、`docs/ref/features/tenant/MEMBERS.md`、`AGENTS.md` 的註冊表路徑
- [x] 3.3 `node scripts/validate-openspec.mjs seed-roles-single-source` 與 `--specs` 通過
