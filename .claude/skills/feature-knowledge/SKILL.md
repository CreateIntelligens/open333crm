---
name: feature-knowledge
description: >
  open333CRM「知識庫與 AI 回覆」功能顧問：文章與匯入、embedding 搜尋、機器人自動回覆、型號守門、AI 設定、AI 月額度。改到 knowledge／embedding／ai 模組、kb-autoreply、/dashboard/knowledge，或改 botConfig、方案 token 額度之前使用。
---

# 知識庫與 AI 回覆

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。知識庫與 AI 回覆的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

知識庫文章的 CRUD、發布與封存、匯入（PDF、Word、Excel、CSV、Markdown、JSON）、向量化 embedding 與語義搜尋、
機器人依知識庫自動回覆（kb-autoreply、追問 clarify、轉真人）、型號守門 model guard 與型號白名單、「沒幫到我」回報調教、
AI 設定頁（Embedding、Chat & Prompt、系統提示詞、自備 Gemini 金鑰 BYOK）、AI 月額度 `monthlyTokens` 與用量 `AiUsage`、
AI agent、夥伴系統推送 partner-ingest、個資遮罩對模型輸入的影響。
相關的程式：`/dashboard/knowledge`、knowledge、embedding、ai 模組、`llm.service`、`llm.flow`、`kb-autoreply.flow`、`model-matcher`、chat-settings、embedding-settings、token-quota。
問題像「AI 亂回、不回」「AI 說轉接了但沒人接」「匯入變亂碼」「搜不到文章」「型號查不到」時使用。
改渠道 `botConfig`、自動轉接、收件匣 AI 建議回覆、方案 token 額度之前也使用，確認不破壞 AI 回覆。

## 先讀

先讀功能文件 `docs/ref/features/tenant/KNOWLEDGE.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `KNOWLEDGE.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 模型輸入、向量化的個資遮罩 | 模型輸入的個資遮罩 |
| 文章狀態、向量什麼時候產生、向量維度 | 文章 |
| 檔案匯入、CSV 編碼、夥伴系統推送 | 匯入 |
| 機器人回覆的分流、型號守門、追問與轉真人、回報、AI agent | 機器人怎麼用知識庫回答 |
| Chat、Embedding 設定、自備金鑰、部署開關 | AI 設定 |
| 月額度、用量紀錄、LLM 呼叫的交易切分 | 額度 |
| 權限碼與按鈕顯示 | 權限 |
| 前端頁面與元件 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/knowledge/`、`apps/api/tests/unit/modules/ai/`、`apps/api/tests/unit/modules/embedding/`、`apps/api/tests/feature/modules/ai/`、`apps/web/tests/unit/components/knowledge/`，寫法可以照著參考。

`KNOWLEDGE.md` 裡標 `HC-KNOWLEDGE-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/KNOWLEDGE.md`
- 規格：`openspec/specs/km-ingestion/spec.md`、`openspec/specs/embedding-settings/spec.md`、`openspec/specs/chat-settings/spec.md`、`openspec/specs/knowledge-base-information-architecture/spec.md`、`openspec/specs/token-quota/spec.md`、`openspec/specs/usage-quota-alerts/spec.md`、`openspec/specs/ai-usage-recording/spec.md`、`openspec/specs/agentic-llm-orchestration/spec.md`、`openspec/specs/bot-handoff-config/spec.md`
  - 注意：`km-ingestion` 的第一條「Multi-modal Ingestion via Markitdown」與程式不符。
  - KB 自動回覆的分流、型號守門、KB 回報、問答表拆分都沒有主規格。
- 手冊：`apps/web/public/manual/ch06-knowledge.html`、`apps/web/public/manual/ch07-ai-settings.html`
- 影響分析：`node scripts/feature-impact.mjs --domain knowledge`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `KNOWLEDGE.md` 括號內的章節。

- 回覆分流：最高相似度 0.80 以上直接答；`clarifyThreshold` 到 0.80 之間答並附轉接提示；更低或沒有文章就追問。改分流時同時看 `kb-autoreply.flow.ts` 的 `decideReply()` 與 `kb-autoreply.service.ts` 的常數。（機器人怎麼用知識庫回答）
- 追問用完或追問的 LLM 呼叫失敗時，在 `bot_reply` 認領的同一個交易呼叫 `handOffConversation()`（`apps/api/src/modules/automation/handoff.flow.ts`）真的轉接。改轉接邏輯時改 `handoff.flow.ts`，不要在各路徑各寫一份。（機器人怎麼用知識庫回答）
- 型號守門只攔截前綴在白名單的型號（`hasKnownPrefix()`），白名單空時不守門，相似度 0.85 以上豁免。守門回覆計入 `clarifyAttempts`，用完時走同一個轉接，不要另寫轉接。改停用詞時，同步 `packages/kb-ingest` 的複本。（機器人怎麼用知識庫回答）
- 每則入站訊息最多一則機器人回覆。寫入要包在 `BotReplyGuard.persist()` 的交易裡，不要繞過。（機器人怎麼用知識庫回答）
- 檢索只取 `status = 'PUBLISHED'` 的文章（規格 `km-ingestion`「Archived Articles Excluded」）。夥伴的 `DELETE` 是改成 `ARCHIVED`，網頁的刪除是硬刪除。（文章、匯入）
- 向量化與刪除附件檔案都在 commit 之後開始，最多一次（`startEmbedAfterCommit()`、`removeFilesAfterCommit()`）。不要在交易內呼叫 `embedText()` 或物件儲存。（文章）
- 向量化是「交易 → 交易外呼叫向量化服務 → 交易」（`embedArticleFlow`）。寫入前比對 `prepareArticleText()` 組成的文字。不要改成比對 `updatedAt` 或狀態。（文章）
- 夥伴推送分三段（`ingestPartnerDocFlow`），交易 2 鎖住文章後用同一個 `decidePartnerWrite()` 重新判斷。保留「確定沒有寫入才刪檔案」的規則。（匯入）
- 向量欄位是 1024 維。Ollama 的模型必須輸出 1024 維，Gemini 以 `outputDimensionality: 1024` 呼叫。（文章、AI 設定）
- 搜尋與統計只比對 `embeddingModel` 等於目前模型的向量。寫入向量時一定要同時寫 `embeddingModel`，否則這篇文章搜不到。（文章、AI 設定）
- Gemini 向量化一定經過 `embedWithUsage()`：先檢查月額度，呼叫後寫 `AiUsage`（`feature: 'embedding'`）。不要直接呼叫 `embedText()` 繞過它。（AI 設定、AI 月額度）
- 只有 `keySource === 'platform'` 計入與檢查月額度，BYOK 不計不擋。（額度）
- LLM 呼叫是「交易 1 → 交易外呼叫 LLM → 交易 2」（`llm.flow.ts`）。不要在交易內呼叫 `llm-client.ts` 或 `generateReply()`。一次請求呼叫多次 LLM 時，`prepareLlmCall()` 一次、`runLlmCall()` 多次。（額度）
- 不要在 Agent 加上知識庫搜尋工具之前打開 `AGENTIC_LLM_ENABLED`：Agent 會先回覆每則客人訊息，知識庫回覆不執行（KB-07）。預設是 `false`，`deploy.yml` 也把 UAT 設成 `false`。（機器人怎麼用知識庫回答）
- 不要把 Agent（`runAgentReplyFlow()`）包進 `withTenant()` 或 `inTenant()`：交易 5 秒逾時，Agent 最長 120 秒。每次工具呼叫後先 commit 工具紀錄。（機器人怎麼用知識庫回答）
- 讀 Chat 設定不建立設定列。`DEFAULT_CHAT_SETTINGS` 要與 schema 的欄位預設值相同（`chat-settings-defaults.test.ts`）。（AI 設定）
- 個資遮罩啟用時，所有模型輸入與 `embedText()` 都先經 2md 去識別化。失敗就停止，不可用原文當 fallback。（模型輸入的個資遮罩）
- 新增讀訊息內容送模型的地方，都要經 `readModelMessageContent()`、`toAiHistory()`，或先檢查 `isUnmaskedInbound()`，不可讀 `content` 原文。（模型輸入的個資遮罩）
- 設定路由整個模組掛 `requirePermission('settings.manage')`。`baseUrl` 用 `httpUrlSchema`，要允許內網位址。（程式的入口）
- 本機不要為了測試把共用租戶的 Chat、Embedding 改指向外部付費服務。UAT 不可觸發 AI 回覆。
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。

## 回歸清單

改到本領域時，至少重走：

1. 新增文章 → 發布 → 確認列表的綠色圖示（有 embedding 服務的環境）→ 語義搜尋找得到 → 封存後搜不到。
2. 匯入（單元測試 `tests/unit/modules/knowledge/knowledge-file-parser-encoding.test.ts`、`knowledge-upload-encoding.test.ts`）：
   - 有 BOM 與沒有 BOM 的 UTF-8 中文 CSV、台灣版 Excel 存的 Big5 CSV（中英文表頭各一）、xlsx 問答表、`.md`、JSON 陣列與一筆壞資料。
   - 確認問答表直接發布，中文不是亂碼。
   - 上傳一份編碼認不出的 CSV（例如 GBK，或混入非法位元組），該檔顯示「無法辨識這個 CSV 檔案的文字編碼…」，一篇都沒寫入。
3. KB 自動回覆（需要 LLM 與 embedding；單元測試 `tests/unit/modules/ai/kb-model-guard.test.ts`、`model-matcher.test.ts`）。確認對話狀態與客服是否收到轉接：
   - 高相似度的問題。
   - 追問兩次後的第三則。
   - 提到不存在的型號 `TAC-11P`，應列出相近型號。小寫的 `tac-11p` 也一樣。
   - 提到 `Wi-Fi`、`e-mail`、訂單編號 `AB-12345`，不應回「型號查不到」。
   - 連續三則提到不存在的型號，第三則轉真人。
   - 沒有型號文章的租戶提到型號，不守門。
4. AI 失敗轉接（單元測試 `tests/unit/modules/automation/ai-failure-handoff.test.ts`）：讓 embedding 服務或去識別化服務暫時失敗，客人傳文字。確認：
   - 對話變 `AGENT_HANDLED`，`handoffReason` 是「AI 暫時無法回覆（…）」。
   - 客人收到 `handoffMessage`，客服收到轉接通知。
   - 命中關鍵字、`botMode: off` 的訊息不轉接。
5. 「👎 沒幫到我」→ 回報調教出現 → 編輯文章 → 標為已處理。
6. 用 agent 與只有 `knowledge.view` 的自訂角色重走 1、2、5，確認 403 與按鈕顯示。直開 `/dashboard/knowledge/chat-prompt` 顯示「沒有權限」。

自動測試：

- `pnpm --filter @open333crm/api test -- modules/ai modules/knowledge modules/embedding`
- `pnpm --filter @open333crm/web test -- knowledge`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial/token-quota-alert modules/ai`
- E2E：`apps/web/tests/e2e-uat/tenant-knowledge.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-knowledge-automation.spec.ts`

## 常見 bug 從哪裡查

- 「AI 都不回」，依序查：
  1. `KB_AUTO_REPLY_ENABLED`。
  2. 對話是不是 `BOT_HANDLED`。
  3. 渠道的 `botMode`。
  4. 是否命中關鍵字規則（`apps/api/src/modules/automation/keyword-yield.ts`）。
  5. embedding 連不連得上。向量化失敗、agent 也沒回覆時會轉真人，原因「AI 暫時無法回覆（…）」。`KB_AUTO_REPLY_ENABLED` 關閉時，agent 失敗仍不回、不轉接（KB-06）。
  6. `PLAN_LIMIT_EXCEEDED`。
- 「AI 說已轉接但沒人接」：
  - 轉接後對話應為 `AGENT_HANDLED`，有 `handoffReason` 與 `auto_handoff` 系統訊息。未指派的對話會通知看得到該渠道的主管與管理員（`conversation_handoff`）。
  - 仍是 `BOT_HANDLED` 時，查 job 是否失敗。轉接交易失敗時整則回覆不送出，由佇列重試。
- 「AI 說型號查不到」：看訊息的 `metadata.modelGuard.unknownModel`；以 `GET /knowledge/models` 看白名單（白名單沒有該前綴就不會守門）；程式在 `apps/api/src/modules/ai/model-matcher.ts`。
- 「文章發布了卻搜不到」：看 `hasEmbedding`、Embedding 頁的「未嵌入」數，用 `POST /knowledge/bulk-embed` 補。剛換過向量化服務或模型時，舊向量不算數，要重新嵌入全部。Gemini 健康檢查失敗時，先確認 Chat & Prompt 頁有沒有自備金鑰，或平台有沒有設定 `GEMINI_API_KEY`。
- 「匯入後中文亂碼」或「CSV 被拒：無法辨識文字編碼」：
  - CSV 由 `apps/api/src/modules/knowledge/file-parser.service.ts` 的 `decodeCsvText()` 解碼：UTF-8 去 BOM → 嚴格 UTF-8 → Big5。都不行或含 U+FFFD 就回 `CSV_ENCODING_UNREADABLE`。
  - GBK、Shift-JIS 等其他編碼不支援，請使用者另存成「CSV UTF-8」。
  - Big5 偶爾能把其他編碼「解成功」但字不對，這種情形不會被擋。
- 「上傳被拒、英文錯誤」：內容偵測 `apps/api/src/modules/upload/upload-content-detector.ts` 的 `extensionMatches`（HC-KNOWLEDGE-11）。
- 「額度用完、用量對不上」：
  - `apps/api/src/modules/trial/token-quota.service.ts`：Redis `aiquota:{tenantId}:{YYYY-MM}:tpe`，台灣月份，失敗退回 DB 加總。
  - `apps/api/src/modules/ai/llm.flow.ts` 的 `recordLlmUsage()`。
  - BYOK 解密失敗退回平台金鑰，見 AI-01。
- 「設定頁顯示假資料或 403」：缺 `settings.manage`；看 `apps/web/src/components/knowledge/SettingsLoadError.tsx`。
