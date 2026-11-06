## 1. 測試

- [x] 1.1 `apps/api/tests/feature/modules/knowledge/partner-ingest-jwt.test.ts`：「有知識庫進階權限的成員推送文件」，走真實的 `auth.plugin` 與 `requirePermission`。修正前應回 403
- [x] 1.2 同一檔：「沒有知識庫進階權限的成員推送文件」。修正前就通過，以 mutation 驗證：把 `knowledge.routes.ts` 合作方推送的 `requirePermission('knowledge.admin')` 改成 `knowledge.view`，測試應失敗（2026-11-06 驗證：測試失敗，程式已還原）

## 2. 實作

- [x] 2.1 `auth.plugin.ts`：三個認證函式的 JWT 路徑改成呼叫同一個函式組出 `request.agent`，帶 `roleId`（AUDIT AUTH-06 的修正方向）

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；knowledge 與 auth 的 feature 測試通過
- [x] 3.2 `node scripts/check-tenant-ctx.mjs --strict`、`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 3.3 `CHANGELOG.md` 加上 Fixed 條目；AUDIT AUTH-06 改成已修正，RBAC-02 的段落、AUDIT-REVIEWS、`AUTHENTICATION.md`、`PERMISSIONS.md`、`feature-knowledge` skill 一起更新
- [x] 3.4 `node scripts/validate-openspec.mjs fix-partner-ingest-jwt-role` 通過
