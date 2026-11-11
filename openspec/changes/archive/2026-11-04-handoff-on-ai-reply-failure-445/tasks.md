## 1. 測試先行

- [x] 1.1 測試 `apps/api/tests/unit/modules/automation/ai-failure-handoff.test.ts`（經過 `setupAutomationWorker`，真的 `runAgentReply`、`attemptKbAutoReply`、去識別化服務；只換掉 HTTP（`fetch`）、模型供應商、LLM、向量檢索與送出）：「去識別化服務失敗」「其他錯誤」「同一則訊息處理兩次」「寫入系統訊息失敗」，在現有程式上以 assertion 失敗（4 項）
- [x] 1.2 同一檔：「agent 失敗但知識庫回覆成功」「關鍵字規則讓步」「botMode 關閉」「知識庫自動回覆停用」「這則訊息已有機器人回覆」。現有程式本來就不轉接，以 mutation 驗證（見 3.1）

## 2. 實作

- [x] 2.1 `kb-autoreply.service.ts`：`attemptKbAutoReply()` 回傳 `KbAutoReplyResult`（`replied`／`skipped` 與原因／`failed` 與錯誤），第 6 步 embedding 失敗回 `failed`；`aiReplyFailedReason()` 與 `clarifyLlmFailedReason()` 共用錯誤種類判斷
- [x] 2.2 `deidentification.service.ts`：`fixedSystemMessageContent()`，固定系統文字不呼叫 2md
- [x] 2.3 `automation/ai-failure-handoff.flow.ts`：`handOffAfterAiFailure()`（沿用 `createBotReplyGuard()` 的 `bot_reply` 認領 + `handOffConversation()`，commit 之後送出 `handoffMessage`）
- [x] 2.4 `automation.worker.ts`：知識庫結果為 `failed`（含丟出的非認領錯誤）時呼叫 `handOffAfterAiFailure()`；轉接失敗往外丟，由佇列重試

## 3. Mutation 驗證

- [x] 3.1 mutation 與失敗的測試（每次都已還原）：
  - M1：worker 的條件 `kbResult?.status === 'failed'` 改成 `!== 'replied'` → 「關鍵字規則讓步」「botMode 關閉」「知識庫自動回覆停用」失敗
  - M2：拿掉 worker 呼叫 LLM 前的 `alreadyReplied()` 檢查 → 「這則訊息已有機器人回覆」失敗（又呼叫了 AI；轉接仍被認領擋下）。再加上讓 `handOffAfterAiFailure()` 不認領（`inboundMessageId` 傳 `undefined`）→ 同一項也斷言轉接失敗。只拿掉認領時預查擋住，測試通過
  - M3：worker 的條件改成一律轉接，並讓 `handOffAfterAiFailure()` 不認領 → 「agent 失敗但知識庫回覆成功」與 M1 的三項失敗。只改條件時，知識庫回覆已認領 `bot_reply`，轉接認領不到，測試仍通過

## 4. 完成定義

- [x] 4.1 `pnpm test`（17 個 task）、api feature 測試（122 檔 1211 項，`TEST_DATABASE_NAME=open333crm_test_p3_445`）通過；`check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs handoff-on-ai-reply-failure-445` 與 `--specs` 通過
- [x] 4.3 CHANGELOG、AUDIT.md（新增 KB-06、更新 LLM-04）、AUDIT-REVIEWS.md、`docs/ref/features/tenant/INBOX.md`、`KNOWLEDGE.md`、健檢 `INBOX.md`、`KNOWLEDGE.md`、`docs/ref/modules/EVENTS.md`、feature-knowledge 與 feature-inbox skill 回歸清單更新
