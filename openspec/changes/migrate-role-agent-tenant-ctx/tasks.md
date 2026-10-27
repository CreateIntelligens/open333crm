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

## 6. 試點檢討：`TenantCtx` 只留資料存取，加上 flow 層（design 決策 6～8）

- [x] 6.1 改寫 `apps/api/tests/unit/lib/tenant-ctx.test.ts`：`inTenant(prisma, tenantId, fn)` 給的 scope 只有 `tx`、`tenantId`、`afterCommit`；推播、事件、job 改用 `notifyTenant`、`notifyAgent`、`publishEvent`、`enqueueJob`。主規格「推播、事件與佇列 job 在 commit 之後才送出」「推播的房間由系統決定」與本 change 的 Scenario 都要有對應的測試。執行後確認是斷言或型別失敗，不是 import 錯誤
- [x] 6.2 實作 `TenantCtx`、`TenantScope`、`inTenant()` 與四個副作用函式，讓 6.1 通過。`tenantHandler()` 的 handler 改收 `TenantCtx`
  - `tenantHandler()` 的 handler 拿不到 `afterCommit`，所以 3.5 補在 `tenant-handler.test.ts` 的「afterCommit 的動作完成之後才送出回應」移除。route 等 flow 回傳，flow 等 `inTenant()` 回傳，所以「回應在動作完成之後」由 `tenant-ctx.test.ts` 的「afterCommit：commit 之後執行，回傳之前完成」涵蓋；3.5 的突變（`void effect.run()`）仍使它失敗。型別測試 `tests/types/tenant-handler.types.ts` 以 `@ts-expect-error` 確認 handler 的 ctx 與 service 的 `TenantCtx` 不能登記副作用
- [x] 6.3 `tests/support/mock-tenant-ctx.ts`、`tests/support/tenant-run.ts` 改成新的契約
- [x] 6.4 `role`：寫失敗的單元測試 `role.flow` 以 `afterCommit` 登記權限快取的清除，並寫稽核；新增 `role.flow.ts`，`role.service.ts` 不再登記 `afterCommit`，`role.routes.ts` 的寫入改呼叫 flow
- [x] 6.5 `agent`：寫失敗的單元測試 `agent.flow`：建立成員在開啟交易之前雜湊密碼，並寫稽核；新增 `agent.flow.ts`，`agent.routes.ts` 的寫入改呼叫 flow，移除 `tenantHandler(fastify, …)(request, reply)` 的寫法
- [x] 6.6 `coupon`、`marketing`、`member-binding`、`store`、`automation` 改成新的契約：service 回傳結果，推播與事件移到 flow 或入口（design 決策 8）
- [x] 6.7 `pnpm test`、`pnpm test:feature` 通過；`coupon-realtime`、`coupon-export`、`broadcast-coupon` 等檢查推播與事件的 feature 測試不修改斷言
  - 2026-10-27：api 1365、web 787、workers 117、core 86 項單元測試通過；feature 881 項通過。feature 測試只改呼叫方式（`inTenant(prisma, …)`、`publishEvent()` 等），沒有修改斷言
- [x] 6.8 突變驗證：把 `redeemCoupon` 4 個入口之一的推播移除，確認 `coupon-realtime.test.ts` 失敗，再還原。把突變記在本項下方
  - 突變（2026-10-27）：`coupon-redeem.flow.ts` 的推播條件改成 `false && result.ok`，「券被核銷後推送：後台」失敗；`store-console.flow.ts` 的推播條件改成 `false && outcome.redeemed`，「券被核銷後推送：核銷台」失敗。還原後都通過
- [x] 6.9 `AGENTS.md`：後綴表加入 `.flow.ts`；結構規則 2 改寫 service、flow 與副作用函式的分工；「Which Prisma client to use」與 Socket Event Routing 的範例改成新的寫法。`docs/ref/modules/EVENTS.md` 同步更新
- [x] 6.10 `CHANGELOG.md` 更新 Changed 的條目；規劃檔第 10 節記錄決策 6～8

## 7. service 直接使用 Redis 與 LLM 的檢查（design 決策 9）

- [x] 7.1 在 `apps/api/tests/unit/tenant-ctx-ratchet.test.ts` 寫失敗的測試，涵蓋 Scenario「service 檔新增 Redis client 的 import」「service 檔新增 LLM 入口的 import」「只引入型別，或在 flow 檔引入」。執行後確認前兩個以斷言失敗（exit code 是 0，不是 1）
- [x] 7.2 `scripts/check-tenant-ctx.mjs` 加上兩種寫法，讓 7.1 通過；以 `--update-baseline` 記下現況（2026-10-27：Redis client 5 個檔案、LLM 入口 8 個檔案）
- [x] 7.3 `AGENTS.md` 結構規則 2 的 Check 寫明這兩種寫法

## 8. 讀寫租戶資料的 route 一律走 flow（design 決策 7，2026-10-27 修改）

- [x] 8.1 寫失敗的測試：`role.flow.test.ts` 的 createRoleFlow、renameRoleFlow、deleteRoleFlow 稽核與資料一起 commit；`tenant-audit-routes.test.ts` 涵蓋 Scenario「建立角色時寫稽核」「角色改名時寫稽核」「刪除角色時寫稽核」。執行後確認以斷言失敗（稽核筆數 0，應為 1）
- [x] 8.2 `role.flow.ts` 新增查詢、建立、改名的 flow，刪除也寫稽核；`role.routes.ts`、`agent.routes.ts` 讀寫租戶資料的 route 都改成呼叫 flow，不再使用 `tenantHandler()`
- [x] 8.3 `actorOf()` 在沒有租戶身分時回 401：`tests/unit/lib/request-actor.test.ts`
  - 先寫程式才補測試，所以以突變驗證（2026-10-27）：檢查改成 `if (false)`，「請求沒有租戶身分：丟出 401」失敗；還原後通過
- [x] 8.4 寫失敗的測試，涵蓋 Scenario「route 檔新增 tenantHandler」；`check-tenant-ctx.mjs` 加上「模組內的 tenantHandler(」，以 `--update-baseline` 記下現況（2026-10-27：13 處）
- [x] 8.5 `AGENTS.md`、`CHANGELOG.md` 更新：route 一律呼叫 flow，`tenantHandler()` 是舊寫法

## 9. ratchet 改以語法樹計數（review-loop 第 2 輪，design 決策 9）

- [x] 9.1 寫失敗的測試，涵蓋 Scenario「import 內含註解、前置空白，或以動態 import 引用」「改名之後呼叫 tenantHandler」，另含多行 import、re-export、`require()`、namespace 呼叫。執行後確認兩個測試以斷言失敗（exit code 是 0，不是 1）；Scenario「註解裡的 import 不算」在改寫前已通過，留著防止改寫後退步
- [x] 9.2 `check-tenant-ctx.mjs` 的 Redis、LLM、tenantHandler 三種計數改用 TypeScript 語法樹，讓 9.1 通過；以 `--update-baseline` 記下現況（多記 `chatbox.service.ts` 的動態 import；tenantHandler 13 → 11）
- [x] 9.3 `AGENTS.md` 結構規則 2 的 Check、`CHANGELOG.md` 同步更新
- [x] 9.4 review-loop 第 3 輪：`tenantHandler` 經過變數轉手的呼叫，使用者決定不追（design 決策 9）。spec 只承諾直接呼叫、`as` 改名與 namespace 呼叫，並移除只做了一半的變數別名追蹤，讓實作與 spec 一致

## 5. 文件與完成條件

- [x] 5.1 `AGENTS.md` 結構規則 2：加入 `ctx.afterCommit`（快取失效這類最多一次、回應之前要完成的動作）與 `recordTenantAudit()`（交易內的稽核，失敗時整筆 rollback）
- [x] 5.2 `CHANGELOG.md` 在 `Changed` 寫明 proposal 的三項可觀察差異
- [x] 5.3 `pnpm test` 通過
- [x] 5.4 `pnpm test:feature` 通過
- [x] 5.5 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增的違規
- [x] 5.6 `node scripts/check-tenant-ctx.mjs --strict` 通過，以 `--update-baseline` 更新基準檔
- [x] 5.7 `node scripts/validate-openspec.mjs migrate-role-agent-tenant-ctx` 與 `--specs` 通過
- [ ] 5.8 歸檔之後，主規格 `tenant-audit-log` 的 `## Purpose`「寫入失敗不影響主操作」改成符合新的需求
