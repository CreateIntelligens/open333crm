# Tasks

## 1. 搬遷前確認測試

- [x] 1.1 確認下列現有測試涵蓋搬遷前的行為，列出搬遷時要改寫注入方式的測試：`tests/unit/modules/ai/kb-autoreply-history.test.ts`、`kb-clarify-handoff.test.ts`、`kb-model-guard.test.ts`、`other-channel-context-wiring.test.ts`、`tests/unit/modules/automation/ai-failure-handoff.test.ts`、`auto-handoff.test.ts`、`automation.worker.test.ts`、`bot-reply-claim.test.ts`、`keyword-suppresses-ai.test.ts`、`non-text-no-ai-reply.test.ts`、`sentiment-claim.test.ts`、`sentiment-llm-fallback.test.ts`、`automation-harness.ts`、`tests/feature/modules/platform/platform-usage.test.ts`。改寫時只改注入方式，不改斷言。讀原始碼找函式名稱的測試（例如 `keyword-suppresses-ai.test.ts`），改成新的函式名稱，保證不變。

## 2. 寫入回覆時確認對話狀態（design D3）

- [x] 2.1 寫測試「知識庫產生回覆期間客服接手」（新檔 `tests/feature/modules/ai/kb-autoreply-flow.test.ts`，app_tenant 連線）。provider 換成假的：回覆之前，以 owner 連線把對話改成 `AGENT_HANDLED`。embedding 服務換成假的。斷言對話沒有這次的機器人訊息、`botRepliesCount` 不變、沒有送到渠道。測試先以搬遷前的 `attemptKbAutoReply()` 執行，確認因為斷言失敗（寫入了機器人訊息）。
  - 2026-11-11：搬遷前的程式寫入一則 `replyKind: clarify` 的機器人訊息，斷言失敗；搬遷後通過。
- [x] 2.2 `writeKbReply()` 以條件更新確認 `BOT_HANDLED`，在交易內讀最新的 `metadata` 再合併。條件不成立時回 `null`，結果是 `already_handled`。讓 2.1 通過。

## 3. 知識庫自動回覆的 flow（design D1、D2、D4、D5）

- [x] 3.1 寫測試「呼叫外部服務之前交易已經結束」（新檔 `tests/unit/modules/ai/kb-autoreply-flow.test.ts`）。交易換成記錄「目前有幾個交易還沒結束」的 mock（比照 `tests/unit/modules/ai/agent/agent-flow.test.ts`），embedding、LLM、去識別化服務被呼叫時記下當時還沒結束的交易數，斷言都是 0。搬遷前的程式不開交易，這個測試無法先失敗，改以突變驗證：把向量化移進交易 A。突變記在 6.1。
- [x] 3.2 寫測試「對話屬於其他租戶」（`tests/feature/modules/ai/kb-autoreply-flow.test.ts`）。以租戶 A 執行，對話 id 是租戶 B 的 `BOT_HANDLED` 對話；斷言結果是 `not_bot_handled`，租戶 B 的對話沒有新的訊息。程式層的 `tenantId` 條件已經擋下，這個測試會直接通過，改以突變驗證：刪除讀對話查詢的 `tenantId` 條件，搬遷後仍由 RLS 擋下（測試通過）；同一個突變在搬遷前的 `prismaAdmin` 寫法下測試失敗。突變記在 6.1。
- [x] 3.3 `kb-autoreply.service.ts` 改成收 `TenantCtx` 的函式：`readKbReplyContext`、`searchKbArticles`、`loadKbHistory`、`writeKbReply`。新增 `ai/kb-autoreply.flow.ts` 的 `attemptKbAutoReplyFlow`：步驟 1、3 各一個交易，綁定代碼檢查是交易 C，embedding、LLM、遮罩在交易外；遮罩沿用步驟 1 的政策，刪除 `readAiPrivacyPolicy()` 的呼叫；推播改用 `notifyChannel()`；`deliverToChannel()` 以 `deps.deliverDb` 呼叫。讓 3.1、3.2 與 1.1 列出的測試通過。

- [x] 3.4 review-loop 第 1、2 輪（design D7）：寫測試「條件資料讀取失敗，訊息也命中其他渠道素材的無條件規則」（`tests/feature/modules/ai/kb-autoreply-flow.test.ts`，對應主規格 `automation-engine`「條件資料讀取失敗」）。有條件的關鍵字規則讀取條件資料時以 SQL 錯誤失敗，另一條無條件規則送其他渠道的素材；斷言知識庫照常回覆。知識庫在交易內判斷關鍵字讓步時，這個測試以 `25P02 current transaction is aborted` 失敗。
- [x] 3.5 寫測試「命中關鍵字規則的訊息：知識庫讓步，不呼叫 LLM、不回覆，也不算追問」（`tests/unit/modules/ai/kb-clarify-handoff.test.ts`，經由 worker，知識庫是真的）。知識庫刪除自己的讓步判斷，worker 在 `keywordWillHandle` 為 true 時不呼叫知識庫。`keyword-suppresses-ai.test.ts` 的原始碼斷言改成檢查 worker 的條件。讓 3.4、3.5 通過。突變記在 6.1。

## 4. 呼叫端（design D6）

- [x] 4.1 `automation.worker.ts` 改呼叫 `attemptKbAutoReplyFlow()`：`prisma` 傳 `tenantDeps.tenantPrisma`，`deliverDb` 傳 `prismaAdmin`。`ClaimTransactionError` 與其他錯誤的處理不變。1.1 列出的 automation 測試通過。

## 5. 文件

- [x] 5.1 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 的知識庫自動回覆一節與 `feature-knowledge` skill：讀寫在短交易內，寫入回覆時確認對話仍是 `BOT_HANDLED`。新檔 `kb-autoreply.flow.ts` 加進 `docs/ref/features/feature-map.json`，`node scripts/feature-impact.mjs --check` 通過。

## 6. 完成檢查

- [x] 6.1 在本檔記下 3.1、3.2 的突變與結果。
- [x] 6.2 `pnpm test` 通過。
  - 2026-11-11：17 個套件，api 1759 個測試。
- [x] 6.3 `pnpm test:feature` 通過。
  - 2026-11-11：151 檔、1504 個測試。
- [x] 6.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，執行 `--update-baseline`；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規。
- [x] 6.5 `node scripts/feature-impact.mjs` 列出的直接受影響領域（knowledge、automation、inbox），逐項走過回歸清單。要瀏覽器的手動步驟交給負責 UAT 手動測試的人。
  - 與這次改動有關的項目：knowledge 的 3「KB 自動回覆」與 3a「AI 失敗轉接」、inbox 的 6「AI 與知識庫回覆都失敗」、automation 的「同一則訊息回兩次」。由 `kb-model-guard.test.ts`、`kb-clarify-handoff.test.ts`、`ai-failure-handoff.test.ts`、`bot-reply-claim.test.ts`、`keyword-suppresses-ai.test.ts` 涵蓋，通過。其他項目是畫面、權限與渠道的流程，這次沒有改到。
- [x] 6.6 `CHANGELOG.md` 的 `Fixed` 寫明：知識庫產生回覆期間客服接手時，不再送出這則回覆。`Changed` 寫明：知識庫自動回覆改用 app_tenant 連線。
- [x] 6.7 `node scripts/validate-openspec.mjs migrate-ai-kb-autoreply-tenant-ctx` 與 `--specs` 通過。
- [ ] 6.8 部署到 UAT 之後，不重跑規劃檔 6.2 的量測（沒有改 GET 端點），在規劃檔的變更紀錄寫明原因。

## 6.1 突變紀錄

3.1、3.2 的測試在搬遷前的程式上無法先失敗，所以以突變驗證。每個突變都在執行後還原。

| 突變 | 測試 | 結果 |
| --- | --- | --- |
| `attemptKbAutoReplyFlow()` 把 `embedText()` 移進交易 A | 3.1「呼叫外部服務之前交易已經結束」 | 失敗：向量化時 `openTransactions: 1` |
| `readKbReplyContext()` 讀對話的查詢刪除 `tenantId` 條件，連線是 app_tenant | 3.2「對話屬於其他租戶」 | 通過：RLS 擋下租戶 B 的對話 |
| 同上，flow 的連線改成沒有 RLS 的 owner 連線（等同搬遷前的 `prismaAdmin`） | 3.2「對話屬於其他租戶」 | 失敗：租戶 B 的對話被讀到並回覆 |
| worker 呼叫知識庫的條件刪除 `!keywordWillHandle` | 3.5「命中關鍵字規則的訊息：知識庫讓步」 | 失敗：知識庫呼叫了 LLM 並回覆 |
