## 1. inTenant() 與 TenantCtx

- [ ] 1.1 寫失敗的單元測試 `apps/api/tests/unit/lib/tenant-ctx.test.ts`，以 mock 的 `prisma.$transaction` 與 `tx.$executeRaw` 驅動 `inTenant()`，涵蓋這些 Scenario：「不合法的租戶 ID」、「commit 之前不送出」、「commit 之後依登記順序送出」、「rollback 時全部丟棄」、「一項送出失敗不影響其他項」、「事件不重複送出」。另加兩個設計上的測試：`publish` 送出的事件帶交易綁定的 `tenantId`；沒有 `io` 時呼叫 `emit` 會在交易內丟錯。執行後確認是斷言失敗，不是 import 錯誤
- [ ] 1.2 實作 `apps/api/src/lib/tenant-ctx.ts` 的 `TenantCtx` 與 `inTenant()`（design 決策 1），讓 1.1 的測試通過
- [ ] 1.3 寫 feature 測試 `apps/api/tests/feature/lib/tenant-ctx.test.ts`，以 `app_tenant` 連線涵蓋 Scenario「第二筆寫入失敗時第一筆也不留下」與「交易內只看得到綁定租戶的資料」。這兩個 Scenario 的行為來自既有的 `withTenant()`，測試寫好就會通過，所以用突變驗證：把 `inTenant()` 改成不經 `withTenant()`、直接用 `deps.prisma` 執行 `fn`，確認兩個測試都失敗，再還原。「只看得到綁定租戶」的測試要同時斷言租戶 A 的資料有查到，否則 fail-closed 回空時也會通過。把突變記在本項下方

## 2. tenantHandler()

- [ ] 2.1 寫失敗的單元測試 `apps/api/tests/unit/lib/tenant-handler.test.ts`，用 Fastify `inject()` 與 mock 的 prisma，涵蓋這些 Scenario：「成功時回應交易內程式的結果」（狀態碼 201 與內容）、「交易內程式丟出錯誤」（409，登記的推播沒有送出）、「請求沒有租戶身分」（401，交易內程式沒有執行）。另加一個測試：commit 失敗（mock 的 `$transaction` 在 callback 完成後 reject）時，回應是錯誤，不是成功
- [ ] 2.2 實作 `tenantHandler()`（design 決策 2），交易內程式拿到的 `reply` 型別只有 `code()`、`status()`、`header()`。讓 2.1 的測試通過，並以 `pnpm --filter @open333crm/api exec tsc --noEmit` 確認型別檢查通過
- [ ] 2.3 在 2.1 的測試檔加一個型別測試：交易內呼叫 `reply.send()` 要被 TypeScript 拒絕（`// @ts-expect-error`）。確認拿掉型別限制時，`tsc --noEmit` 會因為 `@ts-expect-error` 沒有用到而失敗，再還原

## 3. 測試用的 mock ctx

- [ ] 3.1 新增 `apps/api/tests/support/mock-tenant-ctx.ts` 的 `createMockTenantCtx()`（design 決策 3），並在 `apps/api/tests/unit/lib/tenant-ctx.test.ts` 加一個測試，確認 `emitted`、`published` 依呼叫順序記錄

## 4. ratchet 檢查腳本

- [ ] 4.1 寫失敗的單元測試 `apps/api/tests/unit/tenant-ctx-ratchet.test.ts`，用暫存目錄與暫存基準檔執行腳本，涵蓋這些 Scenario：「新增一處舊寫法」（exit 1，輸出含 `TenantDb` 與檔案路徑）、「舊寫法減少」（exit 0，提示更新基準檔）、「不帶 strict 只輸出報告」（exit 0）。另加兩個測試：一個檔案減少、另一個檔案增加時仍然失敗；service 檔內出現 `inTenant(` 時失敗
- [ ] 4.2 實作 `scripts/check-tenant-ctx.mjs`（design 決策 4，含 `--scan-dir`、`--baseline`、`--update-baseline`），讓 4.1 的測試通過
- [ ] 4.3 以 `--update-baseline` 產生 `scripts/check-tenant-ctx.baseline.json`，並在 4.1 的測試檔加一個測試，對 repo 本身執行 `--strict` 要通過。突變驗證：在任一 service 檔加一行 `TenantDb`，確認這個測試失敗，再還原

## 5. 文件

- [ ] 5.1 修改 `AGENTS.md`：
  - 結構規則 2 改成「service 收 `TenantCtx`」，並寫明 service 不開交易、不在交易內呼叫外部服務、推播與事件用 `ctx.emit`、`ctx.publish`。
  - 「Which Prisma client to use」表加入 `tenantHandler()`、`inTenant()`，`request.tenantPrisma` 與 `TenantDb` 標成搬遷中的舊寫法。
  - Socket 推播一節的路徑 A 改成 `ctx.emit`。
  - Step 4 的檢查清單加入 `node scripts/check-tenant-ctx.mjs --strict`。
  - 確認文中出現的路徑與指令都存在、可以執行。
- [ ] 5.2 在 `docs/ref/system/AUDIT.md` 新增 RLS-08：「service 收到的 client 決定了它的 RLS 與交易保證」，P2，處理狀態「已定方向」，內文引用 #337 與本 change，並寫明搬遷進度看 ratchet 基準檔。在 `AUDIT-REVIEWS.md` 加一筆紀錄
- [ ] 5.3 `CHANGELOG.md` 最新日期段落的 `Added` 加一筆：新增 `inTenant()`、`tenantHandler()` 與 ratchet 檢查腳本，既有程式行為不變

## 6. 完成條件

- [ ] 6.1 `pnpm test` 通過
- [ ] 6.2 `pnpm test:feature` 通過（1.3 新增了 feature 測試）
- [ ] 6.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有本 change 新增的違規
- [ ] 6.4 `node scripts/validate-openspec.mjs tenant-transaction-context` 與 `node scripts/validate-openspec.mjs --specs` 通過

## Workflow follow-up

- 合併後以 `pnpm exec openspec archive tenant-transaction-context` 歸檔，把新主規格的 `## Purpose` 改成正式說明，再執行 `node scripts/validate-openspec.mjs --specs`，確認「略過 N 則」沒有變多。
- 接著做 #337 規劃的階段 2：試做 tag、role。
