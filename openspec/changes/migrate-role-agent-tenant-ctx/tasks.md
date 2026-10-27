## 1. `ctx.afterCommit`

- [x] 1.1 在 `apps/api/tests/unit/lib/tenant-ctx.test.ts` 寫失敗的單元測試，涵蓋 Scenario「commit 之後執行，回傳之前完成」「rollback 時不執行」「動作失敗不影響回傳」「與推播依登記順序執行」。另加一個測試：沒有 `io` 時也能登記 `afterCommit`。執行後確認是斷言失敗（`afterCommit` 不存在），不是 import 錯誤
- [x] 1.2 在 `apps/api/src/lib/tenant-ctx.ts` 實作 `afterCommit(label, fn)`（design 決策 1），讓 1.1 的測試通過
- [x] 1.3 `apps/api/tests/support/mock-tenant-ctx.ts` 加上 `afterCommit`：依呼叫順序記錄 label 與函式，不執行。在 `tenant-ctx.test.ts` 的 mock ctx 測試加上斷言

## 2. 交易內的稽核

- [x] 2.1 寫失敗的單元測試 `apps/api/tests/unit/modules/tenant-audit/record-tenant-audit.test.ts`：寫入時 `tenantId` 是 `ctx.tenantId`；`tx.tenantAuditLog.create` 失敗時，`recordTenantAudit()` 丟出該錯誤
- [x] 2.2 在 `apps/api/src/modules/tenant-audit/tenant-audit.service.ts` 實作 `recordTenantAudit(ctx, input)`（design 決策 2），讓 2.1 的測試通過
- [x] 2.3 寫 feature 測試 `apps/api/tests/feature/modules/tenant-audit/record-tenant-audit.test.ts`，以 `inTenant()` 與 `app_tenant` 連線涵蓋 Scenario「稽核與主操作一起寫入」與「稽核寫入失敗時主操作 rollback」（`actorId` 用不存在的成員 ID）
  - 突變（2026-10-27）：`recordTenantAudit()` 改成接住寫入錯誤（`.catch(() => undefined)`）。「稽核寫入失敗時主操作 rollback」失敗：`inTenant()` 沒有丟出錯誤。另以臨時測試確認：這時 `inTenant()` 回傳成功，但角色沒有寫進資料庫（COMMIT 變成 rollback）。還原後兩個測試都通過
- [x] 2.4 確認 Scenario「稽核寫入失敗不拋錯」的既有測試仍然通過（`writeTenantAudit()` 不變）

## 3. 搬遷 `role`

- [x] 3.1 先跑 `pnpm test:feature -- role-management permission-check tenant-audit-routes`，記下搬遷前全部通過
  - 2026-10-27：整套 `pnpm test:feature` 881 項全部通過（含 2.3 新增的測試）
- [x] 3.2 寫失敗的單元測試 `apps/api/tests/unit/modules/role/role-permission-cache.test.ts`：`setRolePermissions()`、`deleteRole()` 以 `ctx.afterCommit` 登記權限快取的清除，交易內不直接清除（mock ctx 的 `afterCommitted` 有一筆，`invalidateRolePermissions` 在登記的函式執行之前沒有被呼叫）
- [x] 3.3 `role.service.ts` 的函式改收 `TenantCtx`（design 決策 3），快取清除改用 `ctx.afterCommit`；讓 3.2 的測試通過
- [x] 3.4 `role.routes.ts` 改用 `tenantHandler()`，稽核改用 `recordTenantAudit(ctx, …)`，刪除 `withTenant` 的使用
- [x] 3.5 突變驗證 Scenario「修改角色權限後立即生效」（主規格 `permission-check`）：把 `afterCommit` 改成不等待登記的動作完成，確認對應的 feature 測試失敗，再還原。如果測試不失敗，記下原因，並在 `tests/feature/guards/permission-check.test.ts` 補上「回應之後立即以 R 的成員呼叫」的測試。把突變記在本項下方
  - 突變（2026-10-27）：`inTenant()` 改成不等待 commit 之後的動作（`void effect.run()`）。feature 測試連跑 3 次都通過：清除 Redis 快取比下一個請求快，屬於時序競態，feature 測試抓不到。所以改在 `apps/api/tests/unit/lib/tenant-handler.test.ts` 補一個確定性的測試「afterCommit 的動作完成之後才送出回應」（動作延遲 50 毫秒，以 `onSend` 記錄回應時間點）。同一個突變下，這個測試與 `tenant-ctx.test.ts` 的「afterCommit：commit 之後執行，回傳之前完成」都失敗。還原後通過
  - 搬遷後，這個 feature 測試以 400 `DATABASE_ERROR` 失敗：測試的登入成員 `AGENT_ID` 不存在，稽核寫入違反外鍵。原本 `writeTenantAudit()` 接住這個錯誤，只記 log。這是本 change 刻意的行為改變，所以修改測試資料，不修改斷言：`beforeAll` 建立這個成員，`afterAll` 刪除

## 4. 搬遷 `agent`

- [x] 4.1 先跑 `pnpm test:feature -- agent-management`，記下搬遷前全部通過
  - 2026-10-27：見 3.1，整套 feature 測試在搬遷前全部通過
- [x] 4.2 `agent-create-channels.test.ts`、`agent-reactivate.test.ts` 改用 `createMockTenantCtx()`，service 呼叫改成新的簽名。此時測試因簽名不符而失敗
- [x] 4.3 `agent.service.ts` 的函式改收 `TenantCtx`：`purgeAgent` 不再自己開交易；`createAgent`、`resetAgentPassword`、`changeOwnPassword` 改收雜湊好的新密碼（design 決策 4）。讓 4.2 的測試通過
- [x] 4.4 `services/channel-team-access.ts` 的 `setAgentChannels()`、`listChannelsForAgent()` 改收 `TenantCtx`，`setAgentChannels()` 不再自己開交易（design 決策 5）
- [x] 4.5 `agent.routes.ts` 改用 `tenantHandler()`：在交易之前算好新密碼的雜湊，稽核改用 `recordTenantAudit(ctx, …)`
- [x] 4.6 跑 `pnpm test:feature -- agent-management role-management permission-check tenant-audit-routes`，全部通過

## 5. 文件與完成條件

- [x] 5.1 `AGENTS.md` 結構規則 2：加入 `ctx.afterCommit`（快取失效這類最多一次、回應之前要完成的動作）與 `recordTenantAudit()`（交易內的稽核，失敗時整筆 rollback）
- [x] 5.2 `CHANGELOG.md` 在 `Changed` 寫明 proposal 的三項可觀察差異
- [x] 5.3 `pnpm test` 通過
- [x] 5.4 `pnpm test:feature` 通過
- [x] 5.5 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增的違規
- [x] 5.6 `node scripts/check-tenant-ctx.mjs --strict` 通過，以 `--update-baseline` 更新基準檔
- [x] 5.7 `node scripts/validate-openspec.mjs migrate-role-agent-tenant-ctx` 與 `--specs` 通過
- [ ] 5.8 歸檔之後，主規格 `tenant-audit-log` 的 `## Purpose`「寫入失敗不影響主操作」改成符合新的需求
