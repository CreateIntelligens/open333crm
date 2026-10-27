## Why

#337 決定把所有 service 搬成收 `TenantCtx`（方向 3）。階段 1 與 1b 已建立 `TenantCtx`、`inTenant()`、`tenantHandler()` 與 outbox。本 change 是階段 2：以 `role`、`agent` 兩個模組試點，確認寫法、測試與檢查清單可以套用到之後的模組。

搬遷前的盤點顯示，各模組的骨架相同（route → service → Prisma），差別在 service 寫資料庫之外的副作用。推播、事件、佇列 job 已在 `TenantCtx` 的契約內，但有兩種副作用不在契約內，而且橫跨多個模組：

- **快取失效**：`role.service.ts` 在交易內清除權限快取。commit 之前清除的快取，可能被另一個請求以舊資料寫回，舊權限最多留 10 分鐘。`TenantCtx` 沒有「commit 之後、回應之前」執行動作的方法；用 `tenantHandler()` 的 route 也沒有辦法在 commit 之後再執行程式。
- **稽核**：`writeTenantAudit()` 接住寫入錯誤後繼續執行。在交易內接住資料庫錯誤，交易就失效，之後的查詢全部失敗，COMMIT 也會變成 rollback。所以稽核搬進交易之後，不能再接住錯誤。

## What Changes

試點的檢討（2026-10-27）發現 `TenantCtx` 把資料存取、業務事件、推播、佇列與 commit 之後的動作都放在同一個物件上。service 拿得到這些方法，就會在 service 裡決定所有副作用；每多一種副作用，物件就多一個方法。本 change 一併修正：

- **`TenantCtx` 只剩資料存取**：`{ tx, tenantId }`。service 只收這個型別，拿不到任何副作用的能力。
- **`inTenant()` 給入口的 `TenantScope`**：`TenantCtx` 加上 `afterCommit(label, fn)`。`afterCommit` 是唯一需要 `inTenant()` 才做得到的原語：commit 之後、`inTenant()` 回傳之前執行，依登記順序執行並等待完成；失敗只記 log；rollback 時丟棄。
- **其他副作用改成收 scope 的獨立函式**，依賴由呼叫端傳入：
  - `publishEvent(scope, publisher, …)`、`enqueueJob(scope, publisher, …)`（`events/outbox-publisher.ts`）：交易內寫 outbox，再以 `afterCommit` 登記快路徑。
  - `notifyTenant(scope, io, …)`、`notifyAgent(scope, io, …)`（`events/socket-push.ts`）：以 `afterCommit` 登記推播。
  - `recordTenantAudit(scope, input)`（`modules/tenant-audit/tenant-audit.service.ts`）：在交易內寫稽核，`tenantId` 由 scope 填入。寫入失敗時丟出錯誤，主操作一起 rollback。還沒搬的呼叫端繼續用 `writeTenantAudit()`，行為不變。
- **use case 層沿用既有的 `<name>.flow.ts`**：flow 開啟 `inTenant()`，呼叫 service，再決定稽核、推播、事件、快取。讀寫租戶資料的 route 一律呼叫 flow，查詢也一樣。`tenantHandler()` 成為舊寫法，ratchet 只減不增；其他模組的 route 在階段 2 的第二個 PR 搬完後刪除。
- `role`、`agent` 的 service 改收 `TenantCtx`；新增 `role.flow.ts`、`agent.flow.ts`，兩個模組的 route 都改成呼叫 flow。角色的建立與改名補上稽核（`role.create`、`role.rename`）。
- 已用 `TenantCtx` 的模組（`coupon`、`marketing`、`member-binding`、`store`、`automation`）改成新的契約：service 回傳結果，推播與事件移到 flow 或入口。
- `services/channel-team-access.ts` 的 `setAgentChannels()`、`listChannelsForAgent()` 改收 `TenantCtx`。`setAgentChannels()` 不再自己開交易。
- bcrypt 雜湊移到交易之外：flow 先算好新密碼的雜湊，再開交易。
- `scripts/check-tenant-ctx.mjs` 另外計算 service 檔直接 import Redis client 與 LLM 入口的次數，只減不增（design 決策 9）。

**可觀察的差異：**

- 角色、成員的寫入與稽核一起 commit。稽核寫入失敗時，請求回錯誤，資料不變更。原本是資料照常變更、稽核遺失。
- 角色權限快取在 commit 之後才清除，仍在回應之前完成。
- 同一個請求內的寫入一律原子。例如建立成員與寫稽核，原本分兩個交易。
- 建立角色、角色改名時寫租戶稽核（`role.create`、`role.rename`），原本不寫。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-transaction-context`：新增「commit 之後、回傳之前執行的動作」。主規格其他需求以「交易內登記」描述行為，不指定由哪個物件登記，所以不修改。另新增「service 直接使用 Redis 與 LLM 的數量不得增加」。
- `tenant-audit-log`：「稽核寫入失敗不影響主操作」只適用於交易外的 `writeTenantAudit()`；新增交易內稽核與主操作一起 commit 的需求；「記錄租戶內的敏感操作」加上角色的建立與改名。

`permission-check` 不修改：「在修改的請求回應之前清除快取」維持不變，`afterCommit` 在回應之前完成。

## Impact

- 程式：`apps/api/src/lib/tenant-ctx.ts`、`apps/api/src/events/outbox-publisher.ts`、`apps/api/src/events/socket-push.ts`、`apps/api/src/modules/tenant-audit/tenant-audit.service.ts`、`apps/api/src/modules/{role,agent,coupon,marketing,member-binding,store,automation}/*`、`apps/api/src/services/channel-team-access.ts`，以及測試輔助 `apps/api/tests/support/{mock-tenant-ctx,tenant-run}.ts`。
- ratchet 基準檔：`role`、`agent` 的舊寫法減少。
- 文件：`AGENTS.md`（後綴表加入 `.flow.ts`；結構規則 2 改寫 service、flow 與副作用函式的分工）、`docs/ref/modules/EVENTS.md`、`CHANGELOG.md`。
- 沒有 schema 變更，也沒有新的相依套件。
