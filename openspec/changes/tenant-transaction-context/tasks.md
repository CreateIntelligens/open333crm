## 1. inTenant() 與 TenantCtx

- [x] 1.1 寫失敗的單元測試 `apps/api/tests/unit/lib/tenant-ctx.test.ts`，以 mock 的 `prisma.$transaction` 與 `tx.$executeRaw` 驅動 `inTenant()`，涵蓋這些 Scenario：「不合法的租戶 ID」、「commit 之前不送出」、「commit 之後依登記順序送出」、「rollback 時全部丟棄」、「一項送出失敗不影響其他項」、「事件不重複送出」。另加兩個設計上的測試：`publish` 送出的事件帶交易綁定的 `tenantId`；沒有 `io` 時呼叫 `emit` 會在交易內丟錯。執行後確認是斷言失敗，不是 import 錯誤
- [x] 1.2 實作 `apps/api/src/lib/tenant-ctx.ts` 的 `TenantCtx` 與 `inTenant()`（design 決策 1），讓 1.1 的測試通過
- [x] 1.3 寫 feature 測試 `apps/api/tests/feature/lib/tenant-ctx.test.ts`，以 `app_tenant` 連線涵蓋 Scenario「第二筆寫入失敗時第一筆也不留下」與「交易內只看得到綁定租戶的資料」。這兩個 Scenario 的行為來自既有的 `withTenant()`，測試寫好就會通過，所以用突變驗證：把 `inTenant()` 改成不經 `withTenant()`、直接用 `deps.prisma` 執行 `fn`，確認兩個測試都失敗，再還原。「只看得到綁定租戶」的測試要同時斷言租戶 A 的資料有查到，否則 fail-closed 回空時也會通過。把突變記在本項下方
  - 突變（2026-10-20）：`inTenant()` 改成 `fn` 直接拿 `deps.prisma` 當 `tx`。兩個測試都失敗：rollback 測試收到 RLS 的寫入錯誤而不是預期的錯誤，可見性測試查到空陣列。還原後兩個都通過

## 2. tenantHandler()

- [x] 2.1 寫失敗的單元測試 `apps/api/tests/unit/lib/tenant-handler.test.ts`，用 Fastify `inject()` 與 mock 的 prisma，涵蓋這些 Scenario：「成功時回應交易內程式的結果」（狀態碼 201 與內容）、「交易內程式丟出錯誤」（409，登記的推播沒有送出）、「請求沒有租戶身分」（401，交易內程式沒有執行）。另加一個測試：commit 失敗（mock 的 `$transaction` 在 callback 完成後 reject）時，回應是錯誤，不是成功
- [x] 2.2 實作 `tenantHandler()`（design 決策 2），交易內程式拿到的 `reply` 型別只有 `code()`、`status()`、`header()`。讓 2.1 的測試通過，並以 `pnpm --filter @open333crm/api exec tsc --noEmit` 確認型別檢查通過
- [x] 2.3 型別測試：`apps/api/tsconfig.json` 只包含 `src/`，不檢查 `tests/`，所以新增 `apps/api/tests/types/tsconfig.json` 與 `tenant-handler.types.ts`，以 `// @ts-expect-error` 標出交易內呼叫 `reply.send()`、`reply.code(201).send()`。`tenant-handler.test.ts` 加一個測試，以 tsc 檢查這個設定（約 11 秒）
  - 突變（2026-10-20）：`TenantReply` 加上 `send()`，測試失敗，tsc 回報兩個 TS2578「Unused '@ts-expect-error' directive」。還原後通過

## 3. 測試用的 mock ctx

- [x] 3.1 新增 `apps/api/tests/support/mock-tenant-ctx.ts` 的 `createMockTenantCtx()`（design 決策 3），並在 `apps/api/tests/unit/lib/tenant-ctx.test.ts` 加一個測試，確認 `emitted`、`published` 依呼叫順序記錄

## 4. ratchet 檢查腳本

- [x] 4.1 寫失敗的單元測試 `apps/api/tests/unit/tenant-ctx-ratchet.test.ts`，用暫存目錄與暫存基準檔執行腳本，涵蓋這些 Scenario：「新增一處舊寫法」（exit 1，輸出含 `TenantDb` 與檔案路徑）、「舊寫法減少」（exit 0，提示更新基準檔）、「不帶 strict 只輸出報告」（exit 0）。另加兩個測試：一個檔案減少、另一個檔案增加時仍然失敗；service 檔內出現 `inTenant(` 時失敗
- [x] 4.2 實作 `scripts/check-tenant-ctx.mjs`（design 決策 4，含 `--scan-dir`、`--baseline`、`--update-baseline`），讓 4.1 的測試通過
- [x] 4.3 以 `--update-baseline` 產生 `scripts/check-tenant-ctx.baseline.json`，並在 4.1 的測試檔加一個測試，對 repo 本身執行 `--strict` 要通過。突變驗證：在任一 service 檔加一行 `TenantDb`，確認這個測試失敗，再還原
  - 突變（2026-10-20）：`modules/tag/tagging.service.ts` 加一行含 `TenantDb` 的註解，測試失敗並列出「`TenantDb`：modules/tag/tagging.service.ts 3 → 4」。還原後通過

## 5. 文件

- [x] 5.1 修改 `AGENTS.md`：
  - 結構規則 2 改成「service 收 `TenantCtx`」，並寫明 service 不開交易、不在交易內呼叫外部服務、推播與事件用 `ctx.emit`、`ctx.publish`。
  - 「Which Prisma client to use」表加入 `tenantHandler()`、`inTenant()`，`request.tenantPrisma` 與 `TenantDb` 標成搬遷中的舊寫法。
  - Socket 推播一節的路徑 A 改成 `ctx.emit`。
  - Step 4 的檢查清單加入 `node scripts/check-tenant-ctx.mjs --strict`。
  - 確認文中出現的路徑與指令都存在、可以執行。
- [x] 5.2 在 `docs/ref/system/AUDIT.md` 新增 RLS-08：「service 收到的 client 決定了它的 RLS 與交易保證」，P2，處理狀態「已定方向」，內文引用 #337 與本 change，並寫明搬遷進度看 ratchet 基準檔。在 `AUDIT-REVIEWS.md` 加一筆紀錄
- [x] 5.3 `CHANGELOG.md` 最新日期段落的 `Added` 加一筆：新增 `inTenant()`、`tenantHandler()` 與 ratchet 檢查腳本，既有程式行為不變

## 6. 完成條件

- [x] 6.1 `pnpm test` 通過
- [x] 6.2 `pnpm test:feature` 通過（1.3 新增了 feature 測試）
  - 2026-10-20：58 個檔案、487 個測試全部通過。第一次跑時 `channel-scoped-visibility.test.ts` 的群發測試失敗（`VALIDATION_ERROR`），原因是本機的 Prisma client 在 #338 新增 `broadcasts.skippedCount` 之後沒有重新產生，`prisma.broadcast.update()` 丟出 `PrismaClientValidationError`。執行 `pnpm db:generate` 後通過，不是程式的問題
- [x] 6.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有本 change 新增的違規
- [x] 6.4 `node scripts/validate-openspec.mjs tenant-transaction-context` 與 `node scripts/validate-openspec.mjs --specs` 通過

## 7. PR #341 審查意見

- [x] 7.1 寫失敗的測試：交易內程式設定 `Location` header 後丟錯、commit 失敗時，錯誤回應不帶該 header（「交易失敗時不帶交易內設定的 header」）。修正前兩個測試都失敗（header 仍是 `/created/1`）
- [x] 7.2 `tenantHandler()` 改成先存狀態碼與 header，commit 之後才套用，讓 7.1 通過
- [x] 7.3 寫失敗的測試：交易內推播到別的租戶房間時丟錯，登記的項目不送出（「推播到別的租戶房間」）。修正前失敗（Missing expected rejection）。另加測試確認自己的租戶房間與 `conversation:` 房間照常送出
- [x] 7.4 `inTenant()` 與 `createMockTenantCtx()` 的 `emit` 檢查 `tenant:` 房間，讓 7.3 通過
- [x] 7.5 寫失敗的測試：service 檔內的 `inTenant<string>(`、`withTenant <Row[]>(`、`prisma.$transaction (` 都算增加（Codex 審查，PR #341 實驗）。修正前失敗（exit 0）
- [x] 7.6 `scripts/check-tenant-ctx.mjs` 的三個交易呼叫正規式允許泛型參數與空白，讓 7.5 通過。repo 本身的基準數字不變
- [x] 7.7 PR 審查機器人第二輪的兩條意見不改程式，改在 spec 寫明保證的範圍：`ctx.emit()` 不檢查非 `tenant:` 房間的所屬租戶（另開 #342、AUDIT RLS-09）；ratchet 不涵蓋刻意繞過的寫法

## 8. 階段 1 補做：推播房間、佇列 job、事件注入、共用函式（#337 規劃 2026-10-21 的決定）

- [x] 8.1 改寫 `apps/api/tests/unit/lib/tenant-ctx.test.ts`，先讓測試失敗：`inTenant()` 改由 `deps.events` 接收事件，不再訂閱 `eventBus` 單例。涵蓋這些 Scenario：「全租戶推播」「給客服人員的推播」「commit 之前不送出」「commit 之後依登記順序送出」（P1、E1、J1、P2）「rollback 時全部丟棄」「一項送出失敗不影響其他項」（第一個 job 的 `add()` reject）。另加設計上的測試：沒有 `io` 時呼叫 `notify` 在交易內丟錯。刪除「推播到別的租戶房間」與 `emit` 的測試。執行後確認是斷言或型別造成的失敗，不是 import 錯誤
- [x] 8.2 新增 `apps/api/src/events/socket-push.ts`（design 決策 6）。`TenantCtx` 以 `notify`、`notifyAgent`、`enqueue` 取代 `emit`，`TenantCtxDeps` 加 `events`，`inTenant()` 不再 import `eventBus` 單例，登記的項目依序 `await`（design 決策 1）。讓 8.1 通過
- [x] 8.3 `tenantHandler()` 傳入 `eventBus`。改寫 `tenant-handler.test.ts` 的推播。`createMockTenantCtx()` 改成記錄 `pushed`（含系統決定的房間）、`published`、`enqueued`，並在 `tenant-ctx.test.ts` 加測試。型別測試 `tenant-handler.types.ts` 加兩個 `@ts-expect-error`：`ctx.notify` 收給客服人員的推播名稱、`ctx.notifyAgent` 收全租戶的推播名稱
  - 突變（2026-10-21）：`notify` 的參數型別改成 `TenantPushName | AgentPushName`，型別測試失敗，tsc 回報 TS2578「Unused '@ts-expect-error' directive」。還原後通過
- [x] 8.4 寫失敗的單元測試 `apps/api/tests/unit/lib/db-invariants.test.ts`：`claimOne` 涵蓋「認領成功」「已經被認領」「條件對應多筆資料」；`createOrFindExisting` 涵蓋「沒有衝突」「與已存在的資料衝突」，另加兩個設計上的測試：略過寫入但查不到既有資料時丟錯；`create` 回傳 2 筆時丟錯
- [x] 8.5 實作 `apps/api/src/lib/db-invariants.ts`（design 決策 7），讓 8.4 通過
  - 「已經被認領」在空殼實作下就會通過（空殼回傳 `false`）。突變（2026-10-21）：`claimOne` 改成 `count >= 0` 時回報成功，這個測試失敗。還原後通過
- [x] 8.6 寫 feature 測試 `apps/api/tests/feature/lib/db-invariants.test.ts`，以 `app_tenant` 連線與 `inTenant()` 在 `tags` 表涵蓋 `createOrFindExisting` 的三個 Scenario：「沒有衝突」「與已存在的資料衝突」（之後同一個交易的查詢成功）「兩個交易同時寫入同一個唯一鍵」。這些行為來自 PostgreSQL 與 Prisma，測試寫好就會通過，所以用突變驗證：把測試傳入的 `create` 改成 `tx.tag.create()`（不用 `skipDuplicates`），確認後兩個測試失敗，再還原。把突變記在本項下方
  - 突變（2026-10-21）：測試傳入的 `create` 改成 `tx.tag.create()`，「與已存在的資料衝突」與「兩個交易同時寫入」都失敗（`Unique constraint failed`）。還原後通過。「兩個交易同時寫入」另外斷言第二個交易在第一個交易 commit 之前沒有完成，確認測到的是併發，不是先後執行
- [x] 8.7 文件：
  - `AGENTS.md` 結構規則 2 的範例與規則、Socket Event Routing 的路徑 A，改成 `ctx.notify`；寫明 `ctx.enqueue` 與 `lib/db-invariants.ts` 的用途。
  - `docs/ref/system/AUDIT.md` RLS-09：`ctx.notify` 的 `tenant:` 房間由系統組成；`agent:` 房間仍無法檢查。
  - `CHANGELOG.md` 更新本 change 的 `Added` 條目。
- [x] 8.8 重跑第 6 節的完成條件：`pnpm test`、`pnpm test:feature`、三個檢查腳本、`validate-openspec.mjs`
  - 2026-10-21：`pnpm test` 的 15 個 turbo 任務全部通過（api 177 個檔案、1131 個測試）；`pnpm test:feature` 59 個檔案、490 個測試全部通過；`tsc --noEmit` 通過；三個檢查腳本與兩個 `validate-openspec.mjs` 指令通過

## Workflow follow-up

- 合併後以 `pnpm exec openspec archive tenant-transaction-context` 歸檔，把新主規格的 `## Purpose` 改成正式說明，再執行 `node scripts/validate-openspec.mjs --specs`，確認「略過 N 則」沒有變多。
- 接著做 #337 規劃的階段 2：試做 role、agent。
