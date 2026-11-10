# Proposal

## Why

#337 階段 4 第六批（6a）。`ai` 模組的 LLM 入口 `generateReply()` 收舊的 `TenantDb`，在一個函式內做了五件事：

1. 讀 Chat 設定。
2. 讀租戶自備的 Gemini 金鑰（BYOK）。
3. 查月額度：讀 Redis 計數器，計數器不存在時加總資料庫。
4. 讀遮罩政策，遮罩後呼叫 LLM。
5. 記用量：寫 `AiUsage`，累加 Redis 計數器，跨過門檻時發出告警事件。

因此 flow 無法把 LLM 呼叫拆成「交易 → 外部呼叫 → 交易」。呼叫 `generateReply()` 的 service 也只能收 `TenantDb`。

盤點時另外發現這些問題：

- `generateReply()` 回傳之後才寫用量紀錄，而且不等寫入結果。部署重啟時，正在寫的紀錄會遺失。測試也要等待一段時間，才查得到紀錄。
- 用量告警事件 `usage.quota.threshold` 以 `eventBus.publish` 發出，不寫 outbox。行程在送出之前結束時，告警遺失。
- `token-quota.service.ts` 直接 import core 的 `redis`（結構規則 2 的 ratchet 有記）。
- 讀 Chat 設定時，租戶沒有設定列就建立一列，所以讀取也會寫資料庫。兩個請求同時第一次讀取時，其中一個請求會違反 unique 限制。第五批已在 `embedding-settings` 修正同樣的寫法。
- `PUT /settings/chat` 與 `PUT /settings/gemini-key` 以 `writeTenantAudit()` 寫稽核。稽核寫入失敗時，系統照樣寫入設定，請求也回成功。

`ai` 的前置（第四批遮罩函式、第五批 `embedding`）都已搬完。`kb-autoreply.service.ts` 與 `agent/` 規模大，留到 6b。

## What Changes

- LLM 呼叫拆成三段：
  1. 交易 1 讀 Chat 設定、BYOK 金鑰、遮罩政策與月額度上限。
  2. 交易外讀 Redis 計數器、檢查月額度，然後遮罩並呼叫 LLM。
  3. 交易 2 寫 `AiUsage`，寫完才回傳。commit 之後累加 Redis 計數器；跨過門檻時，另開交易把 `usage.quota.threshold` 寫進 outbox。
- 用量紀錄寫入失敗時，AI 回覆照樣回傳，系統只寫 log。這一點不變。
- `usage.quota.threshold` 改走 outbox：至少送出一次。告警信已經以事件 id 去重（主規格 `usage-quota-alerts`「事件重送時不重複寄出告警信」）。
- `token-quota.service.ts` 不再 import core 的 `redis`，由呼叫端傳入。API 行程用 `fastify.redis`。
- 讀 Chat 設定時，沒有設定列就回預設值，不建立設定列。`PUT /api/v1/settings/chat` 改用 upsert。
- Chat 的預設 temperature 改成 0.2（使用者決定）：
  - commit `bee7bd47` 為了減少編造的回答，把程式常數改成 0.2。資料庫欄位的預設值仍是 0.3。
  - 讀設定時，系統會先建立設定列，所以新租戶實際用的是 0.3。
  - 這次以 migration 把欄位的預設值改成 0.2。已經存了設定列的租戶保留原本的值。
- `PUT /api/v1/settings/chat` 與 `PUT /api/v1/settings/gemini-key` 改在同一個交易內以 `recordTenantAudit()` 寫稽核。稽核寫入失敗時，請求失敗、設定不變。
- `ai.routes.ts` 的 6 條路由（`GET /ai/privacy/status`、`POST /ai/suggest-reply`、`/summarize`、`/analyze-sentiment`、`/classify`、`/rewrite`）與 settings 的 5 條路由（`GET`、`PUT /settings/chat`、`POST /settings/chat/health`、`GET`、`PUT /settings/gemini-key`）改成呼叫 flow。回應不變。
- 建議回覆（`POST /ai/suggest-reply`）一次請求只讀一次 Chat 設定與月額度。原本每篇搜尋結果各讀一次。
- 還沒搬的呼叫端改成呼叫新的函式，並傳入 Redis：`kb-autoreply`、`agent`、`flex-ai` 的 `generateFlexFromPrompt`、automation worker 的情緒分析與自動分類。

## Capabilities

### New Capabilities

- `chat-settings`：租戶的 Chat 設定（provider、模型、生成參數、系統提示詞）與自備 Gemini 金鑰的讀取、修改與健康檢查。

### Modified Capabilities

- `ai-usage-recording`：「每次 LLM 呼叫寫入 AiUsage 記錄」原本規定寫入是 fire-and-forget、不增加回覆延遲，改成寫完才回傳；寫入失敗時只寫 log、回覆照常，這一點不變。
- `usage-quota-alerts`：「告警不影響 AI 回覆」原本規定告警 MUST NOT 延遲 AI 回覆，改成告警的失敗不影響 AI 回覆，回覆最多等 Redis 指令的逾時。另外寫明告警事件經 outbox 送出，至少一次。

`token-quota` 的計數與檢查規則不變，不改主規格。

## Impact

- 程式：`apps/api/src/modules/ai/`（`llm.service.ts`、`ai.service.ts`、`classify.service.ts`、`sentiment.service.ts`、`flex-ai.service.ts`、`ai-key.service.ts`、`pricing.service.ts`、`model-registry.service.ts`、`ai.routes.ts`）、`settings/chat-settings.service.ts`、`settings/settings.routes.ts` 的 Chat 與 Gemini key 路由、`trial/token-quota.service.ts`、`platform/plan-change.service.ts`（傳入 Redis）、`automation/automation.worker.ts` 與 `apps/api/src/index.ts`（傳入 Redis 與 app_tenant 連線）。`kb-autoreply.service.ts`、`agent/agent.service.ts` 只改呼叫方式。
- API：回應格式與錯誤碼不變。`PUT /settings/chat`、`PUT /settings/gemini-key` 在稽核寫入失敗時回錯誤（原本回成功）。
- 資料庫：一個 migration，把 `tenant_settings.chatTemperature` 的預設值從 0.3 改成 0.2，不更新既有的列。`GET /settings/chat` 與 LLM 呼叫不再建立 `tenant_settings` 列。
- 行為：還沒有設定列的租戶，AI 回覆的 temperature 從 0.3 變成 0.2。
- 不在範圍：`kb-autoreply` 與 `agent` 的搬遷（6b）；`generateFlexFromPrompt()` 的 LINE 驗證與 `material.routes.ts`（搬 `marketing` 時處理）；`POST /ai/agent/run`、`GET /ai/agent/runs/:id`（6b）。
