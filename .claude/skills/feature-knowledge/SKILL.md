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
  - 注意：其中「追問次數達到上限後轉真人」與實際不符，程式只回一句轉接文字、不改對話狀態，見健檢 HC-KNOWLEDGE-01。
  - 注意：其中與 AUDIT LLM-04「Embedding 一律失敗」與 UAT 現況不符，UAT Demo 租戶靠 Compose 的 Ollama 正常產生向量。
- 健檢結果與已知問題：`docs/ref/features/health/KNOWLEDGE.md`
- 規格：`openspec/specs/km-ingestion/spec.md`（前兩條需求已與程式脫節）、`openspec/specs/knowledge-base-information-architecture/spec.md`、`openspec/specs/token-quota/spec.md`、`openspec/specs/usage-quota-alerts/spec.md`、`openspec/specs/ai-usage-recording/spec.md`、`openspec/specs/agentic-llm-orchestration/spec.md`、`openspec/specs/bot-handoff-config/spec.md`。**KB 自動回覆分流、型號守門、KB 回報、問答表拆分都沒有主規格**
- 手冊：`apps/web/public/manual/ch06-knowledge.html`、`apps/web/public/manual/ch07-ai-settings.html`
- 影響分析：`node scripts/feature-impact.mjs --domain knowledge`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 文章列表、篩選 | `/dashboard/knowledge/articles`（舊網址 `/dashboard/knowledge?tab=` 仍相容） | `GET /knowledge?status&category&source&tag&q&page&limit=50`、`/knowledge/categories`、`/knowledge/sources` → `knowledge.service.ts` `listArticles` | 以 raw SQL 補 `hasEmbedding`（標題前綠色圖示） | 只驗登入（RBAC-01）；側欄依 `knowledge.view` 隱藏 |
| 2 | 新增、編輯文章 | 「新增文章」、列上鉛筆 → `ArticleFormDialog` | `POST /knowledge`、`GET /knowledge/:id`（`viewCount+1`）、`PATCH /knowledge/:id` | 新建一律 `DRAFT`；改標題/內容/摘要時背景重新向量化，失敗只記 log | `knowledge.manage` / **不隱藏** |
| 3 | 發布、封存、刪除 | 列上地球、箱子、垃圾桶 | `POST /knowledge/:id/publish`、`/archive`、`DELETE /knowledge/:id` | 發布時沒有向量就背景補；刪除是**硬刪除** | `knowledge.manage` / **不隱藏** |
| 4 | 匯入 | 「匯入文章」→ `ImportDialog` | 非 JSON：`POST /knowledge/upload`（multipart，內容偵測 `upload-content-detector.ts`）；JSON：前端 `JSON.parse` 後送 `POST /knowledge/import {articles}` | CSV/xlsx 有問答欄 → 一列一篇、**直接 `PUBLISHED`**；其他檔案一篇草稿；JSON 依 `status` | `knowledge.manage` / **不隱藏** |
| 5 | 語義搜尋 | `/dashboard/knowledge/search` | `POST /knowledge/search {query}` → `semanticSearch` → `generateEmbedding` + `searchSimilarArticles` | 只搜 `PUBLISHED` 且有向量；用 Embedding 設定的 `topK`、`threshold` | 只驗登入 |
| 6 | 回報調教 | `/dashboard/knowledge/feedback` | `GET /knowledge/feedback?status=open`、`PATCH /knowledge/feedback/:id/resolve` | 標記 `resolved` 後從清單消失，不能復原 | resolve 要 `knowledge.admin` / 有隱藏 |
| 7 | Embedding 設定 | `/dashboard/knowledge/embedding` | `GET/PUT /settings/embedding`、`POST /settings/embedding/health`、`POST /knowledge/bulk-embed` | 寫 `TenantSettings`、租戶稽核；bulk-embed 背景跑 | `settings.manage`（整個 settings 模組）/ 側欄隱藏、直開顯示「沒有權限」 |
| 8 | Chat & Prompt、自備金鑰 | `/dashboard/knowledge/chat-prompt` | `GET/PUT /settings/chat`、`GET /settings/chat/models`、`POST /settings/chat/health`、`GET/PUT /settings/gemini-key`、`POST /knowledge/models/refresh` | 寫 `TenantSettings`、稽核；金鑰加密存 `geminiApiKeyEnc` | `settings.manage`；refresh 要 `knowledge.admin` |
| 9 | KB 自動回覆（系統） | 客人在 `botMode` 為 `llm`/`keyword_then_llm` 的渠道傳文字 | `automation.worker.ts`：`checkAutoHandoff` → 讓步關鍵字規則 → Agent（`AGENTIC_LLM_ENABLED`）→ `kb-autoreply.service.ts` `attemptKbAutoReply` | 寫 BOT 訊息（與 `bot_reply` 認領同交易）、`botRepliesCount+1`、socket `message.new`、`deliverToChannel`；命中文章附「👎 沒幫到我」postback | 無 |
| 10 | 客人回報（系統） | 客人點「👎 沒幫到我」 | 進站攔截 `inbound-postback-interceptors.ts` `handleKbFeedback` → `recordKbFeedback` | 寫 `KbArticleFeedback`，回「感謝您的回報」 | 無 |
| 11 | AI 工具（收件匣、素材） | 收件匣 AI 建議/摘要、素材潤稿 | `/ai/suggest-reply`、`/ai/summarize`、`/ai/rewrite`、`/ai/privacy/status` | 計入月額度、寫 `AiUsage` | 只驗登入（PLAN-12）；建議與摘要檢查渠道可見範圍 |

**有後端、沒有前端入口**：`POST /knowledge/:id/embed`、`GET /knowledge/embedding-status`、`GET /knowledge/models`（只有重建鈕）、`GET /knowledge/feedback/counts`（hook `useKbFeedbackCounts` 沒人用）、`/ai/classify`、`/ai/analyze-sentiment`、`/ai/agent/run`、`/ai/agent/runs/:id`、`POST /knowledge/partner-ingest`（給夥伴系統，網頁 JWT 一律 403，AUTH-06）。

**前端實際送出的值**：文章 `category || '一般'`、`tags` 以逗號切開；JSON 匯入 `{articles: 陣列}`（外層不是陣列時前端擋下「JSON 最外層必須是陣列」）；滑桿 temperature 0–1、maxTokens 50–2000、topK 1–20、threshold 0–1、clarifyThreshold 0–1、clarifyMaxAttempts 0–5；Provider `ollama|gemini`；金鑰 `{apiKey: string|null}`。

## 不可破壞的規則
- 回覆分流（`kb-autoreply.service.ts`）：最高相似度 ≥ 0.80 直接答；`clarifyThreshold`～0.80 答＋依 botConfig 附轉接提示；低於 `clarifyThreshold` 或沒文章就追問，次數記在 `conversation.metadata.clarifyAttempts`，成功回答歸零。
- **追問用完的 `clarify_handoff` 只送文字，不轉接**（HC-KNOWLEDGE-01）；真正轉接只有 `checkAutoHandoff`（`maxBotReplies`、轉接關鍵字、客人傳圖檔）與 `handoff_request` postback。改轉接邏輯時兩邊要一致。
- 型號守門對**所有租戶**生效，白名單由 `model-registry.service.ts` 從 `PUBLISHED` 文章**標題**抽出、程序內快取 10 分鐘；正規式在 `model-matcher.ts`，會誤判 `Wi-Fi`、`e-mail`（HC-KNOWLEDGE-02）。相似度 ≥ 0.85 豁免。
- 每則入站訊息最多一則機器人回覆：寫入要包在 `BotReplyGuard.persist()` 交易裡，不要繞過。
- 檢索只能取 `status = 'PUBLISHED'`（規格 `km-ingestion`「Archived Articles Excluded」）；夥伴 DELETE 是軟刪 `ARCHIVED`，網頁刪除是硬刪除。
- 向量維度：程式寫 1024，部分環境欄位是 1536（DB-01）；Embedding 只會呼叫 Ollama 格式的 `/api/embed`（LLM-04）。換模型前先決定維度。
- 額度：只有 `keySource === 'platform'` 計入與檢查 `monthlyTokens`；BYOK 不計不擋。`generateReply` 超額丟 403 `PLAN_LIMIT_EXCEEDED`，呼叫端的 fallback 會改送文章原文或假轉接（HC-KNOWLEDGE-01、04）。
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
2. 匯入：BOM 與無 BOM 的中文 CSV、xlsx 問答表、`.md`、JSON 陣列與一筆壞資料；確認問答表是直接發布。
3. KB 自動回覆（需要 LLM 與 embedding）：高相似度、追問兩次後的第三則、提到不存在型號、提到 `Wi-Fi`；確認對話狀態與客服是否收到轉接。
4. 「👎 沒幫到我」→ 回報調教出現 → 編輯文章 → 標為已處理。
5. 用 agent 與只有 `knowledge.view` 的自訂角色重走 1、2、4，確認 403 與按鈕顯示；直開 `/dashboard/knowledge/chat-prompt` 顯示「沒有權限」。
- 自動測試：`pnpm --filter @open333crm/api test -- modules/ai modules/knowledge modules/embedding`；`pnpm --filter @open333crm/web test -- knowledge`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial/token-quota-alert modules/ai`。
- E2E：`apps/web/tests/e2e-uat/tenant-knowledge.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-knowledge-automation.spec.ts`。

## 常見 bug 從哪裡查
- 「AI 都不回」：依序查 `KB_AUTO_REPLY_ENABLED`、對話是否 `BOT_HANDLED`、渠道 `botMode`、是否命中關鍵字規則（`apps/api/src/modules/automation/keyword-yield.ts`）、embedding 是否連得上（`generateEmbedding` 失敗時直接不回、不轉接，只有 error log）、`PLAN_LIMIT_EXCEEDED`。
- 「AI 說已轉接但沒人接」：`clarify_handoff`，看訊息 `metadata.replyKind`；對話仍是 `BOT_HANDLED`（HC-KNOWLEDGE-01）。
- 「AI 說型號查不到」：訊息 `metadata.modelGuard.unknownModel`；`GET /knowledge/models` 看白名單；`apps/api/src/modules/ai/model-matcher.ts`。
- 「文章發布了卻搜不到」：`hasEmbedding`、Embedding 頁「未嵌入」數、`POST /knowledge/bulk-embed`；維度不符見 DB-01。
- 「匯入後中文亂碼」：CSV 沒有 UTF-8 BOM（`apps/api/src/modules/knowledge/file-parser.service.ts` 的 `XLSX.read`）。
- 「上傳被拒、英文錯誤」：內容偵測 `apps/api/src/modules/upload/upload-content-detector.ts` 的 `extensionMatches`。
- 「額度用完／用量對不上」：`apps/api/src/modules/trial/token-quota.service.ts`（Redis `aiquota:{tenantId}:{YYYY-MM}`，失敗退回 DB 加總）、`apps/api/src/modules/ai/llm.service.ts` 的 `recordAiUsage`；BYOK 解密失敗退回平台金鑰見 AI-01。
- 「設定頁顯示假資料或 403」：缺 `settings.manage`；`apps/web/src/components/knowledge/SettingsLoadError.tsx`。
