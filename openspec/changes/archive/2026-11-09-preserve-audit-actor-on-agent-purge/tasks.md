## 1. 資料庫

- [x] 1.1 `schema.prisma`：`TenantAuditLog` 加 `actorName`、`actorEmail`；`DataExportRequest`、`DataErasureRequest` 加 `requestedByName`、`requestedByEmail`（都可為空值）。以 `prisma migrate diff` 產生 migration，時間戳晚於 `20261105100000`

## 2. 刪除保留操作者快照（agent-lifecycle「永久刪除成員」）

- [x] 2.1 先寫失敗的測試 `apps/api/tests/unit/modules/agent/agent-purge.test.ts`：情境「刪除保留操作者快照」：`purgeAgent` 在 `agent.delete` 之前，以 tenantId 與成員 ID 更新稽核、匯出請求與刪除請求的快照欄位；回傳成員的名稱
- [x] 2.2 同檔：情境「刪除被拒時不寫快照」：成員不存在（404）、最後一位管理員（422）、權限比操作者高（403）時不呼叫任何快照更新。這三種拒絕原本就成立，以 mutation 驗證：把快照移到最後一位管理員與權限比較之前，這兩案失敗；在 404 判斷之前寫快照，四案都失敗
- [x] 2.3 先寫失敗的測試 `apps/api/tests/unit/modules/agent/agent.flow.test.ts`：情境「刪除稽核記下被刪成員的名稱」：`agent.purge` 稽核的 `payload` 是 `{ name }`
- [x] 2.4 `tenant-audit.service.ts` 新增 `preserveAuditActor(ctx, …)`；`data-export.service.ts`、`data-erasure.service.ts` 各新增 `preserveRequester(ctx, …)`；`purgeAgent` 驗證之後、刪除之前呼叫，回傳 `{ name }`；`purgeAgentFlow` 把名稱寫進 `agent.purge` 的 `payload`

## 3. 查詢回傳快照（tenant-audit-log「查詢租戶稽核」）

- [x] 3.1 先寫失敗的 feature 測試 `apps/api/tests/feature/modules/agent/agent-management.test.ts`：情境「刪除保留操作者快照」與「操作者被永久刪除後回傳快照」：X 的 `data.export.request` 稽核、匯出請求、刪除請求在 X 被刪除後 `actor` 是 `null`、`actorSnapshot` 與快照欄位是 X 的名稱與 email；其他成員的稽核不受影響；`agent.purge` 稽核的 `payload` 有名稱、沒有 email
- [x] 3.2 同檔：情境「操作者還在時沒有快照」：`actor` 有值、`actorSnapshot` 是 `null`
- [x] 3.3 `listTenantAudit` 每筆回傳 `actorSnapshot`，`actor` 的格式不變

## 4. 完成條件

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 相關 feature 測試通過：`agent-management`、`tenant-audit`、`record-tenant-audit`（含「稽核寫入失敗時主操作 rollback」）、`data-export`、`data-erasure`
- [x] 4.3 `check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 沒有新增違規
- [x] 4.4 `CHANGELOG.md`（`## [2026-11-09]`）；`docs/ref/system/AUDIT.md` AUD-03 改為部分修正、`AUDIT-REVIEWS.md` 加紀錄；`docs/ref/features/health/README.md`、`GOVERNANCE.md` 的 HC-GOVERNANCE-01 更新
- [x] 4.5 `node scripts/validate-openspec.mjs preserve-audit-actor-on-agent-purge` 與 `--specs` 通過，以 `pnpm exec openspec archive` 歸檔
