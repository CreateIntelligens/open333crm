## Why

#337 決定把所有 service 搬成收 `TenantCtx`（方向 3）。階段 1 與 1b 已建立 `TenantCtx`、`inTenant()`、`tenantHandler()` 與 outbox。本 change 是階段 2：以 `role`、`agent` 兩個模組試點，確認寫法、測試與檢查清單可以套用到之後的模組。

搬遷前的盤點顯示，各模組的骨架相同（route → service → Prisma），差別在 service 寫資料庫之外的副作用。推播、事件、佇列 job 已在 `TenantCtx` 的契約內，但有兩種副作用不在契約內，而且橫跨多個模組：

- **快取失效**：`role.service.ts` 在交易內清除權限快取。commit 之前清除的快取，可能被另一個請求以舊資料寫回，舊權限最多留 10 分鐘。`TenantCtx` 沒有「commit 之後、回應之前」執行動作的方法；用 `tenantHandler()` 的 route 也沒有辦法在 commit 之後再執行程式。
- **稽核**：`writeTenantAudit()` 接住寫入錯誤後繼續執行。在交易內接住資料庫錯誤，交易就失效，之後的查詢全部失敗，COMMIT 也會變成 rollback。所以稽核搬進交易之後，不能再接住錯誤。

## What Changes

- `TenantCtx` 新增 `afterCommit(label, fn)`：commit 之後、`inTenant()` 回傳之前執行，依登記順序執行並等待完成。失敗只記 log；rollback 時丟棄。用在快取失效這類「最多一次、要在回應之前完成」的動作。
- 新增 `recordTenantAudit(ctx, input)`：在交易內寫稽核，`tenantId` 由 ctx 填入。寫入失敗時丟出錯誤，主操作一起 rollback。還沒搬的呼叫端繼續用 `writeTenantAudit()`，行為不變。
- `role.service.ts`、`agent.service.ts` 的函式改收 `TenantCtx`。`role.routes.ts`、`agent.routes.ts` 改用 `tenantHandler()`，稽核改用 `recordTenantAudit()`。
- `services/channel-team-access.ts` 的 `setAgentChannels()`、`listChannelsForAgent()` 改收 `TenantCtx`。`setAgentChannels()` 不再自己開交易。
- bcrypt 雜湊移到交易之外：route 先算好新密碼的雜湊，再傳給 service。

**可觀察的差異：**

- 角色、成員的寫入與稽核一起 commit。稽核寫入失敗時，請求回錯誤，資料不變更。原本是資料照常變更、稽核遺失。
- 角色權限快取在 commit 之後才清除，仍在回應之前完成。
- 同一個請求內的寫入一律原子。例如建立成員與寫稽核，原本分兩個交易。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-transaction-context`：新增「commit 之後、回傳之前執行的動作」。
- `tenant-audit-log`：「稽核寫入失敗不影響主操作」只適用於交易外的 `writeTenantAudit()`；新增交易內稽核與主操作一起 commit 的需求。

`permission-check` 不修改：「在修改的請求回應之前清除快取」維持不變，`afterCommit` 在回應之前完成。

## Impact

- 程式：`apps/api/src/lib/tenant-ctx.ts`、`apps/api/tests/support/mock-tenant-ctx.ts`、`apps/api/src/modules/tenant-audit/tenant-audit.service.ts`、`apps/api/src/modules/role/*`、`apps/api/src/modules/agent/*`、`apps/api/src/services/channel-team-access.ts`。
- ratchet 基準檔：`role`、`agent` 的舊寫法減少。
- 文件：`AGENTS.md`（結構規則 2 加入 `afterCommit` 與交易內稽核）、`CHANGELOG.md`。
- 沒有 schema 變更，也沒有新的相依套件。
