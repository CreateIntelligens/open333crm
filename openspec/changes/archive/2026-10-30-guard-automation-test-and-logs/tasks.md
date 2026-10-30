## 1. 權限檢查

- [x] 1.1 測試 `apps/api/tests/feature/modules/automation/automation-routes.test.ts`：「沒有檢視權限時試跑規則」「沒有檢視權限時讀取執行紀錄」，在現有程式上斷言失敗（回 200）
- [x] 1.2 測試同一檔：「只有檢視權限時試跑規則與讀取執行紀錄」。行為已存在，寫好就通過；突變驗證：兩條路由改成要求 `automation.manage` 時失敗
- [x] 1.3 `automation.routes.ts` 的兩條路由加上 `requirePermission('automation.view')`

## 2. 文件

- [x] 2.1 `docs/ref/features/tenant/AUTOMATION.md` 的權限表：兩條路由改為 `automation.view`
- [x] 2.2 `CHANGELOG.md` 的 `## [2026-10-30]` Fixed 加條目

## 3. 完成定義

- [x] 3.1 `pnpm test`；api feature 測試
- [x] 3.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 3.3 `node scripts/validate-openspec.mjs guard-automation-test-and-logs`
- [x] 3.4 歸檔：`pnpm exec openspec archive guard-automation-test-and-logs`，之後 `node scripts/validate-openspec.mjs --specs`
