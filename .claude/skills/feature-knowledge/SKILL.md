---
name: feature-knowledge
description: >
  open333CRM「知識庫與 AI 回覆」功能顧問：知識庫文章 CRUD、發布封存、匯入（PDF/Word/Excel/CSV/Markdown/JSON，
  CSV/Excel 自動拆問答直接發布、JSON 外層須純陣列）、向量化 embedding 與語義搜尋、機器人依知識庫自動回覆
  （kb-autoreply、追問 clarify、轉真人）、型號守門 model guard 與型號白名單、「沒幫到我」KB 回報調教、
  AI 設定頁（Embedding、Chat & Prompt、系統提示詞、自備 Gemini 金鑰 BYOK）、AI 月額度 monthlyTokens 與用量 AiUsage、
  AI agent、夥伴系統推送 partner-ingest、個資遮罩對模型輸入的影響。當需求、bug 或新功能碰到 /dashboard/knowledge、
  knowledge、embedding、ai、llm.service、kb-autoreply、model-matcher、chat-settings、embedding-settings、
  token-quota 模組，或有人說「AI 亂回／不回」「AI 說轉接了但沒人接」「匯入變亂碼」「搜不到文章」「型號查不到」時使用。
  也在改渠道 botConfig、自動轉接、收件匣 AI 建議回覆、方案 token 額度前使用，確認不破壞 AI 回覆。
---

# 知識庫與 AI 回覆

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/KNOWLEDGE.md`
  - 追問次數達到上限、或追問的 LLM 呼叫失敗時，與自動轉真人共用 `handOffConversation()` 真的轉接（#419，HC-KNOWLEDGE-01 已修正）。
  - 注意：其中與 AUDIT LLM-04「Embedding 一律失敗」與 UAT 現況不符，UAT Demo 租戶靠 Compose 的 Ollama 正常產生向量。
- 健檢結果與已知問題：`docs/ref/features/health/KNOWLEDGE.md`
- 規格：`openspec/specs/km-ingestion/spec.md`（前兩條需求已與程式脫節）、`openspec/specs/knowledge-base-information-architecture/spec.md`、`openspec/specs/token-quota/spec.md`、`openspec/specs/usage-quota-alerts/spec.md`、`openspec/specs/ai-usage-recording/spec.md`、`openspec/specs/agentic-llm-orchestration/spec.md`、`openspec/specs/bot-handoff-config/spec.md`。**KB 自動回覆分流、型號守門、KB 回報、問答表拆分都沒有主規格**
- 手冊：`apps/web/public/manual/ch06-knowledge.html`、`apps/web/public/manual/ch07-ai-settings.html`
- 影響分析：`node scripts/feature-impact.mjs --domain knowledge`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 文章列表、篩選 | `/dashboard/knowledge/articles`（舊網址 `/dashboard/knowledge?tab=` 仍相容） | `GET /knowledge?status&category&source&tag&q&page&limit=50`、`/knowledge/categories`、`/knowledge/sources` → `knowledge.service.ts` `listArticles` | 以 raw SQL 補 `hasEmbedding`（標題前綠色圖示）；`page`、`limit`（1～100，預設 50）不合法回 400 | `knowledge.view`；側欄依 `knowledge.view` 隱藏 |
| 2 | 新增、編輯文章 | 「新增文章」、列上鉛筆 → `ArticleFormDialog` | `POST /knowledge`、`GET /knowledge/:id`（`viewCount+1`）、`PATCH /knowledge/:id` | 新建一律 `DRAFT`；改標題/內容/摘要時在 commit 之後開始重新向量化，不等結果，失敗只記 log | 讀取 `knowledge.view`、寫入 `knowledge.manage` / **不隱藏** |
| 3 | 發布、封存、刪除 | 列上地球、箱子、垃圾桶 | `POST /knowledge/:id/publish`、`/archive`、`DELETE /knowledge/:id` | 發布時沒有向量就在 commit 之後補；刪除是**硬刪除**，commit 之後刪掉附件在 S3 上的檔案 | `knowledge.manage` / **不隱藏** |
| 4 | 匯入 | 「匯入文章」→ `ImportDialog` | 非 JSON：`POST /knowledge/upload`（multipart，內容偵測 `upload-content-detector.ts`）；JSON：前端 `JSON.parse` 後送 `POST /knowledge/import {articles}` | CSV/xlsx 有問答欄 → 一列一篇、**直接 `PUBLISHED`**；其他檔案一篇草稿；JSON 只保留 `status: 'PUBLISHED'`，其他值（含 `ARCHIVED`）一律 `DRAFT`。每篇各自一個交易，一篇失敗不影響其他篇 | `knowledge.manage` / **不隱藏** |
| 5 | 語義搜尋 | `/dashboard/knowledge/search` | `POST /knowledge/search {query}` → `semanticSearch` → `generateEmbedding` + `searchSimilarArticles` | 只搜 `PUBLISHED` 且有向量；用 Embedding 設定的 `topK`、`threshold` | `knowledge.view` |
| 6 | 回報調教 | `/dashboard/knowledge/feedback` | `GET /knowledge/feedback?status=open`、`PATCH /knowledge/feedback/:id/resolve` | 標記 `resolved` 後從清單消失，不能復原 | resolve 要 `knowledge.admin` / 有隱藏 |
| 7 | Embedding 設定 | `/dashboard/knowledge/embedding` | `GET/PUT /settings/embedding`、`POST /settings/embedding/health`、`POST /knowledge/bulk-embed` | 寫 `TenantSettings`、租戶稽核；bulk-embed 背景跑 | `settings.manage`（整個 settings 模組）/ 側欄隱藏、直開顯示「沒有權限」 |
| 8 | Chat & Prompt、自備金鑰 | `/dashboard/knowledge/chat-prompt` | `GET/PUT /settings/chat`、`GET /settings/chat/models`、`POST /settings/chat/health`、`GET/PUT /settings/gemini-key`、`POST /knowledge/models/refresh` | 寫 `TenantSettings`、稽核；金鑰加密存 `geminiApiKeyEnc` | `settings.manage`；refresh 要 `knowledge.admin` |
| 9 | KB 自動回覆（系統） | 客人在 `botMode` 為 `llm`/`keyword_then_llm` 的渠道傳文字 | `automation.worker.ts`：`checkAutoHandoff` → 讓步關鍵字規則 → Agent（`AGENTIC_LLM_ENABLED`）→ `kb-autoreply.service.ts` `attemptKbAutoReply` | 寫 BOT 訊息（與 `bot_reply` 認領同交易）、`botRepliesCount+1`、socket `message.new`、`deliverToChannel`；命中文章附「👎 沒幫到我」postback | 無 |
| 10 | 客人回報（系統） | 客人點「👎 沒幫到我」 | 進站攔截 `inbound-postback-interceptors.ts` `handleKbFeedback` → `recordKbFeedbackFlow` | 寫 `KbArticleFeedback`，回「感謝您的回報」 | 無 |
| 11 | AI 工具（收件匣、素材） | 收件匣 AI 建議/摘要、素材潤稿 | `/ai/suggest-reply`、`/ai/summarize`、`/ai/rewrite`、`/ai/privacy/status` | 計入月額度、寫 `AiUsage` | 只驗登入（PLAN-12）；建議與摘要檢查渠道可見範圍 |

**有後端、沒有前端入口**：`POST /knowledge/:id/embed`、`GET /knowledge/embedding-status`、`GET /knowledge/models`（只有重建鈕）、`GET /knowledge/feedback/counts`（hook `useKbFeedbackCounts` 沒人用）、`/ai/classify`、`/ai/analyze-sentiment`、`/ai/agent/run`、`/ai/agent/runs/:id`、`POST /knowledge/partner-ingest`（給夥伴系統，網頁 JWT 一律 403，AUTH-06）。

**前端實際送出的值**：文章 `category || '一般'`、`tags` 以逗號切開；JSON 匯入 `{articles: 陣列}`（外層不是陣列時前端擋下「JSON 最外層必須是陣列」）；滑桿 temperature 0–1、maxTokens 50–2000、topK 1–20、threshold 0–1、clarifyThreshold 0–1、clarifyMaxAttempts 0–5；Provider `ollama|gemini`；金鑰 `{apiKey: string|null}`。

## 不可破壞的規則
- 回覆分流（`kb-autoreply.service.ts`）：最高相似度 ≥ 0.80 直接答；`clarifyThreshold`～0.80 答＋依 botConfig 附轉接提示；低於 `clarifyThreshold` 或沒文章就追問，次數記在 `conversation.metadata.clarifyAttempts`，成功回答歸零。
- **`clarify_handoff` 會真的轉接**（#419）：追問用完或追問的 LLM 呼叫失敗時，`persistAndDeliver` 在 bot_reply 認領的同一個交易呼叫 `apps/api/src/modules/automation/handoff.flow.ts` 的 `handOffConversation()`（與 `checkAutoHandoff` 共用）：條件更新 `BOT_HANDLED→AGENT_HANDLED`、`handoffReason`、系統訊息、`conversation.handoff`（通知客服）、`notifyChannel` 推播；追問次數歸零。條件不成立時整筆 rollback，不送「已為您轉接」。`handoff_request` postback 仍是自己的程式（`inbound-postback-interceptors.ts`）。改轉接邏輯時改 `handoff.flow.ts`，不要在各路徑各寫一份。轉接後關鍵字規則照樣回覆（workers 不看對話狀態），KB 與 agent 不回 `AGENT_HANDLED` 的對話。
- 型號守門（#420）：白名單由 `model-registry.service.ts` 從 `PUBLISHED` 文章**標題**抽出、程序內快取 10 分鐘，偵測用 `model-matcher.ts` 的 `detectModels()`（不分大小寫、結果轉大寫，排除 `WI-FI`、`E-MAIL`、`T-SHIRT` 等常見英文詞）。只攔截前綴在白名單的型號（`hasKnownPrefix()`），白名單空的租戶等於不守門。相似度 ≥ 0.85 豁免。守門回覆計入 `clarifyAttempts`，用完時走 `clarify_handoff` 轉接，不要另寫轉接。`packages/kb-ingest` 有一份複本（語音逐字稿用），停用詞要兩邊同步。
- 每則入站訊息最多一則機器人回覆：寫入要包在 `BotReplyGuard.persist()` 交易裡，不要繞過。
- 檢索只能取 `status = 'PUBLISHED'`（規格 `km-ingestion`「Archived Articles Excluded」）；夥伴 DELETE 是軟刪 `ARCHIVED`，網頁刪除是硬刪除。
- 向量化與刪除附件檔案都在 commit 之後開始，最多一次，不等結果（`knowledge-effects.ts` 的 `startEmbedAfterCommit`、`removeFilesAfterCommit`，change `migrate-knowledge-tenant-ctx`）。不要在交易內呼叫 `embedArticle()` 或儲存服務：向量化服務與 S3 都是外部呼叫。處理程序中途結束時文章沒有向量，由重新向量化補上。
- 夥伴推送分三段（`knowledge.flow.ts` 的 `ingestPartnerDocFlow`）：交易 1 判斷 `cmd` 與 `Ver` → 交易外上傳附件 → 交易 2 以 `FOR UPDATE` 鎖住文章，用同一個 `decidePartnerWrite()` 重新判斷再寫入。確定沒有寫入時（`skipped`、寫入途中丟錯）刪除這次上傳的檔案；寫入都做完而 commit 回錯誤時保留檔案，因為資料庫可能已經寫入。UAT 在這個改動之前已有約 46 個這樣的檔案（`media/kb/` 比 `km_article_attachments` 多出的數量，推測，2026-11-06）。
- 向量維度：程式寫 1024，部分環境欄位是 1536（DB-01）；Embedding 只會呼叫 Ollama 格式的 `/api/embed`（LLM-04）。換模型前先決定維度。
- 額度：只有 `keySource === 'platform'` 計入與檢查 `monthlyTokens`；BYOK 不計不擋。`generateReply` 超額丟 403 `PLAN_LIMIT_EXCEEDED`，呼叫端的 fallback：依文章回答的路徑改送文章原文（HC-KNOWLEDGE-04），追問路徑回「已為您轉接」並真的轉接（`handoffReason`「AI 月額度已用完，無法自動回覆」）。
- 個資遮罩啟用時，所有模型輸入與 `generateEmbedding` 都先經 2md 去識別化；失敗就停止，不可用原文當 fallback。
- 設定路由在 `settings.routes.ts`，整個模組掛 `requirePermission('settings.manage')`；`baseUrl` 用 `httpUrlSchema`（只許 http/https，但內網要放行，Ollama 就在內網）。
- 本機不要為了測試把共用租戶的 Chat/Embedding 改指向外部付費服務；UAT 不可觸發 AI 回覆。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain knowledge` 看最新版本。重點：
- **依賴**：渠道（`botConfig.botMode`、轉接提示、`maxBotReplies`）、自動化（`automation.worker.ts` 決定何時呼叫 AI）、收件匣（寫訊息、投遞）、聯絡人（其他渠道上下文）、設定（AI 設定 API、Partner 金鑰）、平台方案（`monthlyTokens`）、平台租戶（個資遮罩）、通知（額度告警）、治理（稽核）。
- **被依賴**：收件匣（AI 建議、摘要、機器人回覆與回報按鈕）、自動化（轉接摘要、AI 動作、情緒分析）、工單（自動分類）、行銷（Flex AI 生成、潤稿）、平台用量（`AiUsage` 成本）、聯絡人（合併搬 `KbArticleFeedback`）。

## 回歸清單
改到本領域時，至少重走：
1. 新增文章 → 發布 → 確認列表綠色圖示（有 embedding 服務的環境）→ 語義搜尋找得到 → 封存後搜不到。
2. 匯入：BOM 與無 BOM 的 UTF-8 中文 CSV、台灣版 Excel 存的 Big5 CSV（中英文表頭各一）、xlsx 問答表、`.md`、JSON 陣列與一筆壞資料；確認問答表是直接發布、中文不是亂碼。再上傳一份編碼認不出的 CSV（例如 GBK 或混入非法位元組），該檔顯示「無法辨識這個 CSV 檔案的文字編碼…」且一篇都沒寫入（#421）。單元測試 `tests/unit/modules/knowledge/knowledge-file-parser-encoding.test.ts`、`knowledge-upload-encoding.test.ts`。
3. KB 自動回覆（需要 LLM 與 embedding）：高相似度、追問兩次後的第三則、提到不存在型號（`TAC-11P`，應列相近型號）、提到 `Wi-Fi`／`e-mail`／訂單編號 `AB-12345`（不應回「型號查不到」）、小寫的不存在型號 `tac-11p`（應列相近型號）、連續三則提到不存在型號（第三則轉真人）、沒有型號文章的租戶提到型號（不守門）；確認對話狀態與客服是否收到轉接。單元測試 `tests/unit/modules/ai/kb-model-guard.test.ts`、`model-matcher.test.ts`。
3a. AI 失敗轉接（#445）：讓 embedding 服務或去識別化服務暫時失敗（或停掉 embedding 服務），客人傳文字 → 對話變 `AGENT_HANDLED`、`handoffReason` 是「AI 暫時無法回覆（…）」、客人收到 `handoffMessage`、客服收到轉接通知；命中關鍵字、`botMode: off` 的訊息不轉接。單元測試 `tests/unit/modules/automation/ai-failure-handoff.test.ts`。
4. 「👎 沒幫到我」→ 回報調教出現 → 編輯文章 → 標為已處理。
5. 用 agent 與只有 `knowledge.view` 的自訂角色重走 1、2、4，確認 403 與按鈕顯示；直開 `/dashboard/knowledge/chat-prompt` 顯示「沒有權限」。
- 自動測試：`pnpm --filter @open333crm/api test -- modules/ai modules/knowledge modules/embedding`；`pnpm --filter @open333crm/web test -- knowledge`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial/token-quota-alert modules/ai`。
- E2E：`apps/web/tests/e2e-uat/tenant-knowledge.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-knowledge-automation.spec.ts`。

## 常見 bug 從哪裡查
- 「AI 都不回」：依序查 `KB_AUTO_REPLY_ENABLED`、對話是否 `BOT_HANDLED`、渠道 `botMode`、是否命中關鍵字規則（`apps/api/src/modules/automation/keyword-yield.ts`）、embedding 是否連得上（`generateEmbedding` 失敗、agent 也沒回覆時會轉真人，原因「AI 暫時無法回覆（…）」，#445；`KB_AUTO_REPLY_ENABLED` 關閉時 agent 失敗仍不回、不轉接，見 KB-06）、`PLAN_LIMIT_EXCEEDED`。
- 「AI 說已轉接但沒人接」：`clarify_handoff` 後對話應為 `AGENT_HANDLED` 且有 `handoffReason` 與 `auto_handoff` 系統訊息（#419）；未指派的對話會通知看得到該渠道的主管與管理員（`conversation_handoff`）。若仍是 `BOT_HANDLED`，查 job 是否失敗（轉接交易失敗時整則回覆不送出、由佇列重試）。
- 「AI 說型號查不到」：訊息 `metadata.modelGuard.unknownModel`；`GET /knowledge/models` 看白名單（白名單沒有該前綴就不會守門）；`apps/api/src/modules/ai/model-matcher.ts`。
- 「文章發布了卻搜不到」：`hasEmbedding`、Embedding 頁「未嵌入」數、`POST /knowledge/bulk-embed`；維度不符見 DB-01。
- 「匯入後中文亂碼」或「CSV 被拒：無法辨識文字編碼」：CSV 由 `apps/api/src/modules/knowledge/file-parser.service.ts` 的 `decodeCsvText()` 解碼（UTF-8 去 BOM → 嚴格 UTF-8 → Big5，都不行或含 U+FFFD 就回 `CSV_ENCODING_UNREADABLE`，#421）。GBK、Shift-JIS 等其他編碼不支援，請使用者另存成「CSV UTF-8」；Big5 偶爾能把其他編碼「解成功」但字不對，這種情形不會被擋。
- 「上傳被拒、英文錯誤」：內容偵測 `apps/api/src/modules/upload/upload-content-detector.ts` 的 `extensionMatches`。
- 「額度用完／用量對不上」：`apps/api/src/modules/trial/token-quota.service.ts`（Redis `aiquota:{tenantId}:{YYYY-MM}`，失敗退回 DB 加總）、`apps/api/src/modules/ai/llm.service.ts` 的 `recordAiUsage`；BYOK 解密失敗退回平台金鑰見 AI-01。
- 「設定頁顯示假資料或 403」：缺 `settings.manage`；`apps/web/src/components/knowledge/SettingsLoadError.tsx`。
