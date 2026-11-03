## 1. 匯出只限可查看所有渠道的成員

- [x] 1.1 測試 `apps/api/tests/feature/modules/data-export/data-export-flow.test.ts`：「沒有 channel.view_all 不能發起匯出」「沒有 channel.view_all 不能查詢或下載別人發起的匯出」，在現有程式上斷言失敗（回 200）
- [x] 1.2 測試同檔：「有 data.export 與 channel.view_all 的成員可以查詢與下載別人發起的匯出」；既有的匯出者角色加上 `channel.view`、`channel.view_all`
- [x] 1.3 `data-export.routes.ts` 三條路由加上 `requirePermission('channel.view_all', { message })`；`requirePermission()` 加上可選的 `message`
- [x] 1.4 `packages/shared/src/rbac/permissions.ts` 的 `data.export` 說明寫明全租戶與需要「檢視所有渠道」
- [x] 1.5 文件：`docs/ref/features/tenant/GOVERNANCE.md`、`docs/ref/modules/OVERVIEW.md`、`.claude/skills/feature-governance/SKILL.md`

## 2. 完成定義

- [x] 2.1 `pnpm test`（api、web unit）
- [x] 2.2 api feature `modules/data-export`、`route-permission-guards` 以獨立測試庫執行
- [x] 2.3 tsc（api、web）與 web build
- [x] 2.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 2.5 `node scripts/validate-openspec.mjs restrict-data-export-to-tenant-wide-roles`
- [x] 2.6 CHANGELOG 與 AUDIT 由使用者另行更新（本 change 只提供建議文字）
