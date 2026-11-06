## 1. 搬遷前的量測與回歸測試

- [ ] 1.1 在本機量 `GET /api/v1/canvas/:id/analytics` 的回應時間（規劃 6.3）：seed 一個有 5 個節點的流程，產生 1000 筆 execution 與對應的 `flow_logs`，記下 p50、p95，結果寫進 `tmp/337-入口開交易-規劃.md` 6.2
- [ ] 1.2 新增 `apps/api/tests/feature/modules/canvas/canvas-routes.test.ts`（A、B 兩個專用租戶，走真實的 `requirePermission` 與 `app_tenant` 連線），在搬遷前的程式碼上執行。「列出流程」通過；「讀取另一個租戶的流程」的 `GET /:id` 與 `/:id/analytics` 通過，`/:id/executions` 失敗在斷言上（回 200）；「修改另一個租戶的流程」通過；「流程 id 格式錯誤」失敗在斷言上（錯誤碼不是 `VALIDATION_ERROR`）。通過的項目以突變驗證：`updateFlow` 的 `where` 拿掉 `tenantId`、`listFlows` 的 `count` 拿掉 `tenantId`，各讓對應的項目失敗
- [ ] 1.3 新增 `apps/api/tests/feature/modules/canvas/canvas-trigger.test.ts`，以 `vi.spyOn(FlowRunner, 'run')` 取代引擎，在搬遷前的程式碼上執行。「觸發另一個租戶的流程」「觸發不存在的流程」「觸發草稿或封存的流程」「聯絡人屬於另一個租戶」「聯絡人不存在」失敗在斷言上；「觸發啟用中的流程」「沒有權限」通過，以突變驗證：拿掉路由的 `requirePermission('canvas.use')`、建立 execution 時 `status` 寫成 `WAITING`，各讓對應的項目失敗
- [ ] 1.4 新增 `apps/api/tests/feature/modules/contact/merge-suggestion-routes.test.ts`，在搬遷前的程式碼上執行，都通過：列出本租戶的待處理建議、核准後兩位聯絡人合併並推播 `contact.merged`、駁回後建議是 `REJECTED`、核准另一個租戶的建議回 404 而且不合併（主規格 `identity-stitching-engine`「核准他租戶的建議」）、已處理的建議回 409。以突變驗證：路由改用 owner 連線（RLS 不生效），而且 core 的 `claimSuggestionForApproval` 拿掉 `where` 的 `tenantId` 時，「核准他租戶的建議」失敗。只做其中一項時仍通過，因為另一層仍擋住

## 2. canvas 搬遷

- [ ] 2.1 新增 `apps/api/tests/unit/modules/canvas/canvas.flow.test.ts`（`tests/support/flow-harness.ts`），先寫會失敗的測試：「commit 之後開始執行」（`runFlow` 在 `commit` 之後被呼叫一次，參數是 `executionId`）、「rollback 時不開始執行」（建立 execution 之後的步驟丟錯，`runFlow` 沒有被呼叫）、「流程執行失敗不影響回應」（`runFlow` reject 時 flow 仍回傳 `executionId`，log 有錯誤）
- [ ] 2.2 `canvas.service.ts` 的函式改收 `TenantCtx`：`triggerFlow` 改由 `assertFlowTriggerable` 與 `createFlowExecution` 組成（design D1、D6），不再呼叫 `FlowRunner`；`listExecutions` 先查流程（D3）；拿掉 `getFlowAnalytics` 的 `as PrismaClient`。`RESOURCE_LABELS` 加上 `flow`
- [ ] 2.3 新增 `canvas-effects.ts` 的 `startFlowAfterCommit`（D2、D6）與 `canvas.flow.ts`：查詢與 CRUD 用 `flowOf`；`triggerFlowFlow` 呼叫 `startFlowAfterCommit`。2.1 通過
- [ ] 2.4 `canvas.routes.ts` 改呼叫 flow，`:id` 以 Zod 解析（D4），拿掉 `identityRoutes`。1.2、1.3 都通過
- [ ] 2.5 在 `canvas-trigger.test.ts` 新增「commit 之後開始執行」的 feature 版本：spy 以 owner 連線讀 execution，讀得到。突變驗證：`runFlow` 改成在交易內直接呼叫時失敗

## 3. 合併建議的路由搬到 contact

- [ ] 3.1 在 `apps/api/tests/unit/modules/contact/contact.flow.test.ts` 先寫會失敗的測試：核准合併建議時，`contact.merged` 在 `commit` 之後推播，內容與手動合併相同；合併丟錯時 rollback，不推播
- [ ] 3.2 `contact.flow.ts` 新增 `listMergeSuggestionsFlow`、`approveMergeSuggestionFlow`、`rejectMergeSuggestionFlow`，`contact.merged` 的內容抽成兩個合併 flow 共用的函式（D5）。3.1 通過
- [ ] 3.3 新增 `contact/merge-suggestion.routes.ts`，`index.ts` 改註冊它；`contact-merge-same-channel.test.ts` 與 1.4 改從新檔 import。1.4 與 `contact-merge-same-channel.test.ts` 通過

## 4. 完成條件

- [ ] 4.1 `pnpm test` 與 `pnpm test:feature` 通過
- [ ] 4.2 `node scripts/check-tenant-ctx.mjs --strict` 通過，`--update-baseline` 之後 `canvas` 模組的舊寫法是 0；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增的違規
- [ ] 4.3 `node scripts/feature-impact.mjs` 列出受影響的領域，逐項檢查 `feature-automation`、`feature-contacts` 的回歸清單；`feature-map.json` 的 contacts 領域把 `canvas/canvas.routes.ts` 換成 `contact/merge-suggestion.routes.ts`，`--check` 通過
- [ ] 4.4 搬遷後重量 1.1，與搬遷前比較，寫進規劃 6.2
- [ ] 4.5 `CHANGELOG.md` 的 `Changed` 新增一條：手動觸發的 404 與 409 `FLOW_NOT_ACTIVE`、執行紀錄列表的 404、引擎在 commit 之後開始執行、合併建議路由的推播改走 `notifyTenant()`
- [ ] 4.6 更新文件：`docs/ref/modules/CANVAS-FLOW-ENGINE.md`（觸發的檢查與時機）；`docs/ref/system/AUDIT.md` 的 AUTO-11（DRAFT 可觸發與不存在的聯絡人已修正）、RLS-01（改正「不接受外部指定的 ID」，記下外鍵不套用 RLS）、IDENT-01（合併建議核准不寫稽核、不檢查渠道可見範圍），並在 `AUDIT-REVIEWS.md` 加一筆；`.claude/skills/feature-automation/` 中描述 Canvas 觸發的段落
- [ ] 4.7 `node scripts/validate-openspec.mjs migrate-canvas-tenant-ctx` 與 `--specs` 通過

## Workflow follow-up

- 部署到 UAT 之後重跑規劃 6.2 的腳本。
- 歸檔前後比較 `validate-openspec.mjs --specs` 的「略過 N 則」。
