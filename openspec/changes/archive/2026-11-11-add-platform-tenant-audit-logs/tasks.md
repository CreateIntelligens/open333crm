## 1. API：依租戶查詢稽核紀錄

- [x] 1.1 先寫失敗測試 `apps/api/tests/feature/modules/platform/platform-tenant-audit-logs.test.ts`：「回傳租戶、成員與方案申請的紀錄，不含其他租戶」「租戶不存在」「紀錄超過上限」「紀錄未超過上限」「limit 超出範圍」
- [x] 1.2 「未登入平台後台」：`apps/api/tests/unit/modules/platform/platform-auth-guard.test.ts` 以 onRoute 收集所有平台路由並檢查沒有憑證時被拒，新路由自動納入。以突變驗證：新路由拿掉 `guard` 後該測試必須失敗（已驗證：4 項失敗，還原後通過）
- [x] 1.3 實作 `listTenantPlatformAuditLogs()`（`platform-audit.service.ts`，收 executor 參數）與 `GET /tenants/:id/audit-logs` 路由（Zod 驗證 `limit`）

## 2. API：操作者與對象名稱

- [x] 2.1 先寫失敗測試 `apps/api/tests/unit/modules/platform/platform-audit.service.test.ts`：「解析各類型對象的名稱」「成員已被刪除」「方案已不存在」「系統排程寫入的紀錄」
- [x] 2.2 先寫失敗測試（同 1.1 的 feature 檔）：「帳號稽核記錄附上對象名稱」（`GET /platform-users/:id/audit-logs`）
- [x] 2.3 實作 `describePlatformAuditLogs()`，租戶與平台帳號兩個查詢共用

## 3. Web：共用翻譯表與表格

- [x] 3.1 測試 `apps/web/tests/unit/app/admin/audit-log.test.ts`：「已知動作顯示中文」（逐一檢查規格列出的動作都有中文名稱）「未知動作顯示代碼」「對象連到租戶頁」「查不到名稱時退回代碼」。翻譯表先於測試寫成，改以突變驗證：刪掉 `tenant.enable` 的中文名稱，「已知動作顯示中文」失敗；讓 `auditTargetText` 忽略 `targetLabel`，「對象連到租戶頁」失敗；還原後通過
- [x] 3.2 實作 `apps/web/src/app/admin/lib/audit-log.ts` 與 `AuditLogTable.tsx`
- [x] 3.3 先寫失敗測試 `apps/web/tests/unit/app/admin/tenant-detail-audit-logs.test.tsx`：「顯示租戶操作紀錄」「系統排程紀錄與更多紀錄提示」
- [x] 3.4 租戶詳細頁加「操作紀錄」區塊；平台帳號詳細頁改用共用表格（移除頁內 `ACTION_LABELS`）

## 4. 完成定義

- [x] 4.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test` 通過
- [x] 4.2 `pnpm test:feature` 通過（至少新增的 feature 檔）
- [x] 4.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有本 change 新增的違規
- [x] 4.4 `CHANGELOG.md` 新增條目
- [x] 4.5 `node scripts/validate-openspec.mjs add-platform-tenant-audit-logs` 通過
