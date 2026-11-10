# Design

## Context

#337 階段 4 第六批（6a）。盤點與決定見 `tmp/337-入口開交易-規劃.md` 附錄 A「階段 4 第六批」（本機檔案，不在 git）。動機見 proposal.md 的「Why」。

搬遷前的結構：

- `ai/llm.service.ts`：
  - `generateReply(db, tenantId, userMessage, kbContext, options)` 依序讀 Chat 設定、BYOK 金鑰、月額度（`isMonthlyTokenExceeded()`）與遮罩政策。接著以 `getPrivacyAwareChatProvider()` 包住 provider 並呼叫 LLM。最後呼叫 `recordAiUsage()`，不 await。
  - `recordAiUsage(db, input)` 查價目（`getPricing()`）、寫 `AiUsage`，再呼叫 `incrMonthlyTokens()`，也不 await。累加後用量跨過門檻時，該函式以 `eventBus.publish` 發出 `usage.quota.threshold`。
- `trial/token-quota.service.ts` 的函式收 `TenantDb`，直接用 core 的 `redis`。`platform/plan-change.service.ts` 的 `approveRequest()` 呼叫 `clearTokenQuotaCache()` 與 `clearQuotaAlertFlags()`。`approveRequest()` 已經收 `redis` 參數。
- `settings/chat-settings.service.ts`：`getChatSettings()` 沒有設定列就建立一列；`updateChatSettings()` 先呼叫它再 `update`。`listChatModels()`、`checkChatHealth()` 呼叫 provider。
- `ai/ai-key.service.ts`、`ai/pricing.service.ts`、`ai/model-registry.service.ts` 收 `TenantDb`。
- 呼叫 `generateReply()` 的 service：`ai.service.ts`（建議回覆、摘要）、`classify.service.ts`、`sentiment.service.ts`、`flex-ai.service.ts`，以及 6b 的 `kb-autoreply.service.ts`。`agent/agent.service.ts` 自己讀設定、金鑰與額度，以 `recordAiUsage()` 記用量（await）。
- 入口：
  - `ai.routes.ts` 的路由以 `request.tenantPrisma` 呼叫 service。
  - settings 的 Chat 與 Gemini key 路由以 `request.tenantPrisma` 呼叫 service，`PUT` 以 `writeTenantAudit()` 寫稽核。
  - `automation.worker.ts` 以 `prismaAdmin` 在交易外呼叫 `analyzeSentiment()`、`autoClassifyNewCase()`、`summarizeConversation()`、`attemptKbAutoReply()`、`runAgentReply()`。
  - `material.routes.ts` 以 `request.tenantPrisma` 呼叫 `generateFlexFromPrompt()`。
  - `settings/a2a-bridge.worker.ts` 在 `withTenant()` 交易內呼叫 `runAgentReply()`。

## Goals / Non-Goals

**Goals:**

- `llm.service.ts`、`chat-settings.service.ts`、`ai-key.service.ts`、`pricing.service.ts`、`model-registry.service.ts`、`token-quota.service.ts` 與 `ai.service.ts`、`classify.service.ts`、`sentiment.service.ts` 的資料存取只收 `TenantCtx`。只有不碰資料庫的用戶端檔會呼叫 LLM provider。
- token-quota 的 Redis 由呼叫端傳入。
- `ai.routes.ts` 的 6 條路由與 settings 的 Chat、Gemini key 5 條路由呼叫 flow，不再使用 `request.tenantPrisma`。
- 用量紀錄與告警的保證寫在 spec（`ai-usage-recording`、`usage-quota-alerts`）。
- 路由的路徑、權限、回應格式與錯誤碼不變，proposal 列出的差異除外。

**Non-Goals:**

- 搬 `kb-autoreply.service.ts` 與 `agent/`（6b）。這一批只改它們呼叫 LLM 核心的方式（D6）。`a2a-bridge.worker.ts` 在交易內呼叫 Agent 的寫法留到 6b。
- `generateFlexFromPrompt()` 的 LINE 驗證（`validateLineFlexDraft()`）與 `material.routes.ts`，搬 `marketing` 時處理。
- 月額度改成「呼叫前預扣」。並行的呼叫可以同時通過檢查，用量會稍微超過上限；這是原本就有的行為，主規格 `token-quota` 接受。
- 更新既有設定列的 `chatTemperature`（D5）。

**審查基準：** LLM 呼叫達到 Laravel 在 controller 內呼叫外部 API、再以 Eloquent 寫一筆用量紀錄的水準：用量紀錄最多一次，處理程序在 LLM 回應之後、寫入之前中斷時遺失，不補寫。月額度以 Redis 計數器檢查，並行的呼叫可能稍微超過上限（同 Laravel 以 `RateLimiter` 計數的行為）。Laravel 專案也會有的情況，記錄在「Risks / Trade-offs」，不另外處理。

## Decisions

### D1. LLM 的 provider 呼叫集中在一個不碰資料庫的檔案

新增 `ai/llm-client.ts`：

- `callChatModel(target, request)`：`target` 含 Chat 設定、金鑰與遮罩政策；`request` 含系統提示詞、使用者訊息與歷史訊息。以 `getPrivacyAwareChatProvider()` 包住 provider 後呼叫 `generate()`，回傳 `{ text, usage? }`。
- `listChatModels()`、`checkChatHealth()` 從 `chat-settings.service.ts` 移過來。移過來之後，`chat-settings.service.ts` 不再引用 provider。

系統提示詞的組裝（`buildSystemPrompt()`、`withOtherChannelContext()`、各段預設提示詞）是純函式，留在 `llm.service.ts`。

provider 呼叫不放在 service 檔，原因有兩個：結構規則 2 規定 service 不呼叫外部服務；`check-tenant-ctx.mjs` 也計算 service 引用 LLM 入口的處數。

用戶端檔不收 `TenantCtx`，所以有人在交易內呼叫用戶端時，型別檢查擋不住。第五批的 `embedding-client.ts` 有同樣的限制（規劃檔「下一步」第 7 項）。

### D2. `generateReply()` 改成 flow，分成準備與呼叫兩步

新增 `ai/llm.flow.ts`。flow 的依賴是 `LlmDeps = { prisma: PrismaClient; redis: Redis; events: EventPublisher }`：

- `prisma`：`inTenant()` 的基礎連線（app_tenant）。
- `redis`：API 行程的 `fastify.redis`。
- `events`：outbox publisher。

- `prepareLlmCall(deps, tenantId)`：
  1. 交易 1：`readLlmInputs(scope)` 讀 Chat 設定、金鑰與來源、遮罩政策、有效 `monthlyTokens`。
  2. 交易外：金鑰來源是 `platform` 而且有上限時，讀 Redis 計數器檢查月額度（D3）。超過時丟出 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 LLM。
  3. 回傳呼叫 LLM 需要的資料。
- `runLlmCall(deps, prepared, prompt, meta)`：
  1. 交易外：`callChatModel()`。
  2. 交易 2：`writeAiUsage(scope, …)` 查價目並寫 `AiUsage`。provider 失敗時寫 `success=false` 的紀錄，再丟出原本的錯誤。
  3. commit 之後：累加 Redis 計數器，檢查門檻（D4）。
  4. 回傳文字。
- `generateReply(deps, tenantId, userMessage, kbContext, options)`：`prepareLlmCall()` 加上 `runLlmCall()`。參數除了第一個，與原本相同，所以主規格中以 `generateReply()` 描述的需求不必改名。

分成兩步是為了建議回覆。原本每篇搜尋結果各呼叫一次 `generateReply()`，所以每篇結果各讀一次設定與額度。現在一次請求只呼叫一次 `prepareLlmCall()`，每篇結果各呼叫一次 `runLlmCall()`。

準備時月額度已經超過的話，每篇結果都改用文章內容。原本的程式也得到同樣的結果：每次 `generateReply()` 丟出 403，呼叫端 catch 之後改用文章內容。

`runLlmCall()` 等交易 2 寫完才回傳（使用者決定）。寫入失敗時，`runLlmCall()` catch 錯誤、寫 error log，照樣回傳文字（`ai-usage-recording`「AiUsage 寫入失敗不影響回覆」）。

不保留原本「呼叫後不等結果」的寫法，原因有兩個：測試要等待一段時間才查得到紀錄；部署重啟時，正在寫的紀錄會遺失。

### D3. 月額度與 Redis

`token-quota.service.ts` 拆成兩類函式：

- 讀資料庫的函式收 `TenantCtx`：`readMonthlyTokensFromDb(ctx)`（本月平台金鑰的成功用量加總）。有效上限沿用 `getEffectiveLimit()`，在交易 1 內以 `scope.tx` 呼叫。
- 讀寫 Redis 的函式收 `redis` 參數：`readMonthlyTokens(redis, tenantId, readDbTotal)`、`incrMonthlyTokens(redis, tenantId, tokens, readDbTotal)`、`claimCrossedThresholds(redis, tenantId, limit, tokensAdded, after)`、`clearTokenQuotaCache(redis, tenantId)`、`clearQuotaAlertFlags(redis, tenantId)`。
- `readDbTotal` 是 flow 傳入的函式。計數器不存在時，token-quota 才呼叫 `readDbTotal`。`readDbTotal` 另開一個短交易讀加總。

Redis 指令都在交易外執行。`fastify.redis` 以 `'command'` 建立，Redis 沒有回應時，每個指令最多 1 秒就失敗。token-quota 的函式在第一個指令失敗時就停止，所以 Redis 沒有回應時：

- 額度檢查最多讓回覆多等 1 秒（搬遷前也是如此）。
- 累加最多讓回覆多等 1 秒。累加失敗時，`runLlmCall()` 不認領門檻（D4），所以告警不再增加等待。

Redis 無法使用時的降級不變：額度檢查改用資料庫的加總，系統跳過累加與告警（`token-quota`、`usage-quota-alerts`）。

`SET NX` 回填計數器、補做 `incrby` 的併發處理不變，只換掉 Redis 的來源。

### D4. 用量告警改走 outbox

`runLlmCall()` 在交易 2 commit 之後：

1. `incrMonthlyTokens()` 累加計數器。只累加成功、用平台金鑰、token 大於 0 的呼叫（不變）。累加在 commit 之後執行。因此計數器不存在、改以資料庫加總回填時，加總已經包含這次的用量。原本的程式先 await 寫入再累加，順序相同。
2. `USAGE_QUOTA_ALERTS_ENABLED` 是 1、而且第 1 步累加成功時，`claimCrossedThresholds()` 以 `SET NX` 認領剛跨過的門檻。上限沿用交易 1 讀到的值。
3. 有認領到的門檻時，開交易 3 以 `publishEvent()` 寫 `usage.quota.threshold`。

每一步失敗都只寫 log。

| 步驟 | 失敗時資料的狀態 | 誰重做 | 保證 |
| --- | --- | --- | --- |
| 交易 2（寫 `AiUsage`） | 沒有這次的紀錄，計數器不累加 | 不重做 | 用量紀錄最多一次；回覆照樣回傳 |
| 累加計數器 | `AiUsage` 已寫入，計數器少算這次 | 計數器過期或被清掉時，以資料庫加總重建 | 額度檢查可能少算，直到重建 |
| 認領門檻 | 沒有認領 | 下一次跨過同一門檻的累加不會發生（已在門檻之上），所以這個月不告警 | 告警最多一次 |
| 交易 3（寫 outbox） | Redis key 已寫入，沒有事件 | 不重做 | 同上；spec 的「告警事件寫入失敗」 |
| outbox 送出之後 | 事件在 outbox | relay 補送 | 至少一次；告警信以事件 id 去重 |

不在交易 2 內寫 outbox：是否告警取決於 Redis 累加的結果，而累加必須在 `AiUsage` commit 之後執行（理由見第 1 步）。

### D5. Chat 設定的讀取不建立設定列，預設 temperature 改成 0.2

- `getChatSettings(ctx)` 以 `findUnique` 讀取，沒有設定列就回 `DEFAULT_CHAT_SETTINGS`。同第五批的 `getEmbeddingSettings()`。
- `updateChatSettings(ctx, patch)` 以 `upsert` 寫入，`create` 用「預設值加上 patch」，`update` 只寫 patch 裡的欄位。回傳 `providerChanged`、`previousProvider` 的方式不變。
- `DEFAULT_CHAT_SETTINGS.temperature` 是 0.2，資料庫的 `chatTemperature` 預設是 0.3。原本讀取時一定先建立設定列，所以租戶實際用的是 0.3。
- 使用者決定採用 0.2（`bee7bd47` 依測試結果調低）。migration 把欄位預設改成 0.2，讓「回預設值」與「建立設定列」得到同一個值。
- migration 不更新既有的設定列。那些列是租戶第一次使用 AI 時建立的，成員可能改過其中的值，系統無法分辨。
- `setTenantGeminiKey()` 原本就是 upsert，不變。

`chat-settings.service.ts` 加一個單元測試，比對 `DEFAULT_CHAT_SETTINGS` 與 schema 的欄位預設值，之後兩者再分歧時測試失敗。

### D6. 還沒搬的呼叫端改成傳 `LlmDeps`

| 呼叫端 | 改法 |
| --- | --- |
| `kb-autoreply.service.ts` 的 `attemptKbAutoReply()` | 多收 `llm: LlmDeps`，3 處 `generateReply()` 傳 `llm`。讀 Chat 設定以過渡 `TenantCtx` 呼叫 `getChatSettings()`，同第五批的寫法 |
| `agent/agent.service.ts` 的 `runAgentReply()` | 多收 `llm: LlmDeps`。讀設定、金鑰、額度改呼叫 `prepareLlmCall()` 拿到的資料；`recordUsage` 改呼叫 `writeAiUsage()` 加上 D4 的累加。Agent 的工具迴圈不動 |
| `flex-ai.service.ts` 的 `generateFlexFromPrompt()` | 多收 `llm: LlmDeps`；`material.routes.ts` 傳 `fastify.prisma`、`fastify.redis` 與 outbox publisher |
| `automation.worker.ts` | `setupAutomationWorker()` 多收 `redis`，`index.ts` 傳 `app.redis`。`LlmDeps.prisma` 用 `tenantDeps.tenantPrisma`（app_tenant），不用 `prismaAdmin` |
| `a2a-bridge.worker.ts` | 傳 `fastify.prisma`、`fastify.redis` 給 `runAgentReply()`；交易內呼叫 Agent 的寫法不變（6b） |

`flex-ai.service.ts` 呼叫 `llm.flow.ts`，這是 service 呼叫 flow 的過渡寫法。搬 `marketing` 時，`generateFlexFromPrompt()` 改成 flow。

### D7. `ai` 的路由與 flow

新增 `ai/ai.flow.ts`：

- `suggestReplyFlow`：交易 1 讀最近的訊息、向量化與 LLM 的輸入 → 交易外查額度、向量化 → 交易 2 搜尋 → 每篇結果各呼叫一次 `runLlmCall()`。
- `summarizeConversationFlow`：交易 1 讀對話與訊息 → `generateReply()`。LLM 失敗時改用固定格式的摘要（不變）。
- `analyzeSentimentFlow`、`classifyIssueFlow`、`rewriteTextFlow`：只呼叫 `generateReply()`。解析回覆與關鍵字降級留在原本的 service 檔，改成純函式。
- `autoClassifyNewCaseFlow`：交易 1 讀工單分類與最新訊息 → 分類 → 交易 2 以「仍無分類」為條件寫入（主規格「新工單的自動分類不覆蓋既有分類」不變）。
- `GET /ai/privacy/status`：`inTenant()` 內以 `scope.tx` 呼叫 `readAiPrivacyPolicy()`。

路由仍然呼叫 `assertConversationChannelVisible()`：`services/channel-visibility.ts` 留到搬 `channel` 時處理。

### D8. settings 的 Chat 與 Gemini key 路由

新增 `settings/chat-settings.flow.ts`：

- `getChatSettingsPageFlow`：交易內讀設定與金鑰 → 交易外列出模型與檢查健康狀態。
- `checkChatHealthFlow`：同上，只檢查健康狀態。
- `updateChatSettingsFlow`：一個交易內 `updateChatSettings()` 加 `recordTenantAudit()`。
- `getGeminiKeyStatusFlow`、`setGeminiKeyFlow`：`setGeminiKeyFlow` 在一個交易內寫金鑰、寫稽核、讀遮罩後的狀態。

`GET /chat/models` 不讀資料庫，直接呼叫 `llm-client.ts` 的 `listChatModels()`。

## Risks / Trade-offs

- [處理程序在 LLM 回應之後、交易 2 之前中斷時，用量紀錄遺失] → 審查基準接受。計數器也少算這次，額度檢查可能稍微放寬。
- [並行的呼叫可以同時通過額度檢查] → 原本就有，`token-quota` 接受；超過上限的量最多是並行呼叫數乘以單次用量。
- [`callChatModel()` 不收 `TenantCtx`，型別擋不住在交易內呼叫] → 同第五批，由 code review 與規劃檔 5.2 的檢查清單把關，執行期檢查見規劃檔「下一步」第 7 項。
- [6b 之前，`kb-autoreply` 與 `agent` 的資料存取仍在交易外，用自己的連線] → 這一批只改它們呼叫 LLM 核心的方式，行為不變。
- [回覆多等交易 2 與 Redis 累加] → 交易 2 只寫一筆，累加最多等 1 秒。LLM 本身要數秒，所以多等的時間影響很小。spec `usage-quota-alerts` 改成允許這個等待。
- [預設 temperature 改成 0.2] → 只影響還沒有設定列的租戶。既有設定列保留 0.3，要統一時另開 migration 更新資料（需要產品決定）。

## Migration Plan

1. migration：`ALTER TABLE tenant_settings ALTER COLUMN "chatTemperature" SET DEFAULT 0.2`。不更新既有的列，回滾時把預設值改回 0.3 即可。
2. 部署 API。outbox 的事件名稱 `usage.quota.threshold` 已在 `packages/core/src/outbox/events.ts` 與 `queues.ts` 註冊，訂閱者 `notification.worker.ts` 不變。
3. 部署後重跑規劃檔 6.2 的量測，加上 `GET /settings/chat`、`GET /settings/gemini-key`、`GET /ai/privacy/status`。
