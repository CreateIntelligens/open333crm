# Tasks

## 1. 搬遷前補測試

- [ ] 1.1 確認現有測試涵蓋搬遷前的行為：`tests/unit/modules/ai/usage-quota.test.ts`（用量紀錄、金鑰來源、月額度、告警條件）、`tests/feature/modules/trial/token-quota-alert.test.ts`、`tests/unit/modules/ai/pricing.test.ts`、`llm-system-prompt.test.ts`、`ai.service-tenant-scope.test.ts`、`auto-classify-new-case.test.ts`、`tests/unit/modules/automation/sentiment-llm-fallback.test.ts`、`tests/unit/modules/platform/plan-change.test.ts`。列出搬遷時要改寫注入方式的測試（`usage-quota.test.ts` 以 `vi.mock('@open333crm/core')` 換掉 `redis`，改成注入假的 Redis），改寫後在搬遷後的程式上斷言不變。
- [ ] 1.2 新增 `tests/feature/modules/settings/chat-settings.test.ts`（路由走真實的 `requirePermission` 與 app_tenant 連線，provider 換成假的 fetch）：「有設定列時回已存的值」「只讀到本租戶的設定」「換 provider」「清除金鑰」「Gemini 以租戶的金鑰檢查」「服務連不到」。搬遷前的程式已經有這些行為，以突變驗證，突變記在 9.1。

## 2. LLM 的用戶端（design D1）

- [ ] 2.1 新增 `ai/llm-client.ts`：`callChatModel()`、`listChatModels()`、`checkChatHealth()`。`chat-settings.service.ts` 不再引用 `ai/providers/`。`deidentification.test.ts` 的 Chat 遮罩測試與 `llm-system-prompt.test.ts` 仍然通過。

## 3. Chat 設定與 Gemini 金鑰（design D5、D8）

- [ ] 3.1 寫測試「沒有設定列時回預設值」「呼叫 LLM 不建立設定列」（`chat-settings.test.ts`）：斷言回應是預設值（temperature 0.2），而且沒有建立設定列。確認在搬遷前的程式上因為建立了設定列而失敗。
- [ ] 3.2 寫測試「沒有設定列時建立」「稽核寫入失敗時設定不變」「設定金鑰」「稽核寫入失敗時金鑰不變」。確認兩個稽核失敗的測試在搬遷前的程式上失敗（`writeTenantAudit()` 吞掉錯誤），「沒有設定列時建立」因為 temperature 是 0.3 而失敗。
- [ ] 3.3 寫單元測試 `tests/unit/modules/settings/chat-settings-defaults.test.ts`：`DEFAULT_CHAT_SETTINGS` 與 `schema.prisma` 的 `TenantSettings` chat 欄位預設值相同。確認在搬遷前的 schema 上因為 `chatTemperature` 是 0.3 而失敗。
- [ ] 3.4 migration：`chatTemperature` 的預設值改成 0.2，不更新既有的列（design Migration Plan）。`pnpm db:generate` 之後 3.3 通過。
- [ ] 3.5 `getChatSettings(ctx)` 只讀；`updateChatSettings(ctx, patch)` 改用 upsert；`ai-key.service.ts` 的函式收 `TenantCtx`。新增 `settings/chat-settings.flow.ts`，settings 的 Chat 與 Gemini key 5 條路由改呼叫 flow，`PUT` 在交易內呼叫 `recordTenantAudit()`。讓 1.2、3.1、3.2 通過。

## 4. 月額度與 Redis（design D3）

- [ ] 4.1 `token-quota.service.ts` 改成：讀資料庫的函式收 `TenantCtx`，讀寫 Redis 的函式收 `redis` 參數，不再 import core 的 `redis`。`plan-change.service.ts` 的 `approveRequest()` 傳入已有的 `redis`。`token-quota-alert.test.ts` 改成傳入 Redis 後通過；`plan-change.test.ts` 通過。
- [ ] 4.2 `usage-quota.test.ts` 的 token-quota 主規格 Scenario（「成功的呼叫累加用量」「自備金鑰與失敗的呼叫不累加」「計數器不存在時從 AiUsage 建立」「Redis 無法使用時改用資料庫的加總」「每個月重新計數」，以及「呼叫 LLM 之前檢查月額度」的 4 個 Scenario）改成注入假的 Redis，在 5.3 完成後通過。

## 5. LLM 呼叫的三段與用量紀錄（design D2、D4）

- [ ] 5.1 寫測試「呼叫端收到回覆時紀錄已寫入」（`tests/feature/modules/ai/ai-routes.test.ts`，`POST /api/v1/ai/rewrite`，provider 換成假的 fetch）：回應之後立即查 `AiUsage`。在搬遷前的程式上執行，記下結果：寫入不 await，若因時序而偶爾通過，改以讓假的價目查詢延遲來重現，確認因為還沒寫入而失敗。
- [ ] 5.2 寫測試「告警事件寫進 outbox」「告警事件寫入失敗」（`usage-quota.test.ts` 或新的 feature 測試）。確認前者在搬遷前的程式上因為事件走 `eventBus.publish`、outbox 沒有資料列而失敗。
- [ ] 5.3 `llm.service.ts` 改成收 `TenantCtx` 的查詢：`readLlmInputs()`、`writeAiUsage()`；`pricing.service.ts` 的 `getPricing()` 收 `TenantCtx`。新增 `ai/llm.flow.ts`：`prepareLlmCall()`、`runLlmCall()`、`generateReply(deps, …)`，`usage.quota.threshold` 以 `publishEvent()` 寫 outbox。讓 4.2、5.1、5.2 與 `ai-usage-recording` 的既有 Scenario 測試（`usage-quota.test.ts`）通過。

## 6. `ai` 的路由與 flow（design D7）

- [ ] 6.1 寫測試（`ai-routes.test.ts`）：`POST /ai/suggest-reply` 在月額度已滿時每篇建議都改用文章內容；`POST /ai/summarize` 在 LLM 失敗時回固定格式的摘要；`POST /ai/classify`、`/analyze-sentiment` 在 LLM 失敗時回關鍵字的結果；`GET /ai/privacy/status` 只讀本租戶的政策。搬遷前的程式已經有這些行為，以突變驗證，突變記在 9.1。
- [ ] 6.2 新增 `ai/ai.flow.ts`：`suggestReplyFlow`（一次請求只呼叫一次 `prepareLlmCall()`）、`summarizeConversationFlow`、`analyzeSentimentFlow`、`classifyIssueFlow`、`rewriteTextFlow`、`autoClassifyNewCaseFlow`。`ai.service.ts`、`classify.service.ts`、`sentiment.service.ts`、`flex-ai.service.ts` 的 `rewriteText` 只留收 `TenantCtx` 的查詢與純函式。`ai.routes.ts` 的 6 條路由改呼叫 flow。讓 6.1、`ai-routes-channel-scope.test.ts`、`ai.service-tenant-scope.test.ts`、`auto-classify-new-case.test.ts` 通過。
- [ ] 6.3 `model-registry.service.ts` 收 `TenantCtx`；`knowledge.flow.ts` 改傳 `scope`。`kb-model-guard.test.ts` 與 knowledge 的 feature 測試通過。

## 7. 還沒搬的呼叫端（design D6）

- [ ] 7.1 `attemptKbAutoReply()`、`runAgentReply()`、`generateFlexFromPrompt()` 多收 `LlmDeps`；`automation.worker.ts` 的 `setupAutomationWorker()` 多收 `redis`，`index.ts` 傳 `app.redis`；`material.routes.ts`、`ai.routes.ts` 的 `/agent/run`、`a2a-bridge.worker.ts` 傳 `fastify.prisma`、`fastify.redis` 與 outbox publisher。`kb-clarify-handoff.test.ts`、`kb-model-guard.test.ts`、`kb-autoreply-history.test.ts`、`agent-quota.test.ts`、`agent-*.test.ts`、`sentiment-llm-fallback.test.ts`、`ai-failure-handoff.test.ts` 通過。
- [ ] 7.2 Agent 的月額度與用量紀錄（主規格 `token-quota`「Agent 回覆達到上限」）改用 `prepareLlmCall()` 的資料與 `writeAiUsage()`。`agent-quota.test.ts` 通過。

## 8. 文件

- [ ] 8.1 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 與 `feature-knowledge` skill 中描述 LLM 呼叫、用量紀錄、月額度與 Chat 設定的段落；`docs/ref/modules/EVENTS.md` 的 `usage.quota.threshold` 改成 outbox。新增的檔案路徑加進 `docs/ref/features/feature-map.json`，`node scripts/feature-impact.mjs --check` 通過。

## 9. 完成檢查

- [ ] 9.1 在本檔記下 1.2 與 6.1 的突變與結果。
- [ ] 9.2 `pnpm test` 通過。
- [ ] 9.3 `pnpm test:feature` 通過。
- [ ] 9.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，執行 `--update-baseline`；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規。
- [ ] 9.5 `node scripts/feature-impact.mjs` 列出的直接受影響領域，逐項走過回歸清單。
- [ ] 9.6 `CHANGELOG.md` 的 `Changed` 寫明可觀察的差異：預設 temperature 改成 0.2、讀 Chat 設定不建立設定列、設定與金鑰的稽核一起寫入、用量紀錄寫完才回傳、用量告警改走 outbox。
- [ ] 9.7 `node scripts/validate-openspec.mjs migrate-ai-llm-tenant-ctx` 與 `--specs` 通過。
- [ ] 9.8 部署到 UAT 後重跑規劃檔 6.2 的腳本，`bench.mjs` 加上 `GET /settings/chat`、`GET /settings/gemini-key`、`GET /ai/privacy/status`。
