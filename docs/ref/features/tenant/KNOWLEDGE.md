# 知識庫與 AI

知識庫是租戶整理的問答與文件。機器人回答客人時先查知識庫，找到相關文章才讓 LLM 依文章內容回答；找不到就追問，追問幾次仍不清楚就轉給真人。AI 的模型、位址與提示詞由租戶自己設定。

- **資料來源**：`apps/api/src/modules/knowledge/*`、`apps/api/src/modules/embedding/*`、`apps/api/src/modules/ai/*`、`apps/api/src/modules/settings/chat-settings.service.ts`、`apps/api/src/modules/settings/embedding-settings.service.ts`、`apps/api/src/modules/trial/token-quota.service.ts`、`apps/api/src/config/env.ts`
- **核對日期**：2026-11-19

## 模型輸入的個資遮罩

功能預設關閉，由平台後台逐租戶強制啟用，租戶的模型與提示詞設定無法覆寫。平台操作與 API 見[租戶管理](../platform/TENANTS.md#平台控制個資遮罩)。

啟用後，所有新寫入的對話訊息都會先產生遮罩副本。渠道進站訊息保留原文，供有權限的客服處理客戶需求；遮罩副本存在訊息 metadata，供模型、摘要、跨渠道脈絡與向量化使用。客服在收件匣輸入回覆時預設「個資遮罩」，遮罩版會儲存並送往渠道；按一下切成「保留原文」時，該則訊息會儲存並送出原文，但仍保存遮罩副本且模型只讀遮罩副本。Bot、Agent、自動化、營業時間、交接、CSAT、Canvas 與系統訊息同樣建立遮罩副本。其中 AI 產生（KB 自動回覆、AI Agent）、自動化摘要、座席自填轉接訊息送出與儲存遮罩版；租戶預先寫好、由系統自動發給顧客的文字（營業時間外回覆、首次歡迎詞含帶入的顧客姓名／電話／email、Canvas 訊息節點）送出與儲存原文，`privacy.mode` 為 `tenant_template`，帶入的顧客資料只送給該顧客本人，模型只讀遮罩副本；程式內固定的系統文案（email／手機登記連結、跨渠道綁定代碼與整合通知、CSAT 問卷與感謝訊息、預設轉接訊息、交回 Bot 與綁定失敗等內部提示）送出與儲存原文，含系統插入的連結與名稱，metadata 的 `privacy.mode` 為 `system_template`，遮罩副本照樣保存給模型讀。原因是規則遮罩會把一般詞誤判成人名（2026-10-27 UAT：「請點選下方連結」被改成「請點選下[姓名]」）。這兩類訊息仍會呼叫 2md 建立遮罩副本，2md 失敗時該則訊息不寫入也不送出，與其他訊息一致。素材存檔的遮罩規則不變。

素材庫新增與編輯也會遮罩 `Material.body`，並在每筆 `MaterialVersion` 保存遮罩版。預設遮罩版同時作為素材儲存與發送內容；編輯者可按「保留原文」讓單筆素材仍以原文儲存和發送，遮罩版仍保留。既有素材不會自動回溯處理，啟用後重新儲存正文時才建立遮罩副本。平台政策由伺服器強制套用；前端按鈕只決定該筆內容是否使用明確的原文模式。

啟用後，下列文字會先送至 2md 的 `/api/deid`，再把完整類別標記遮罩（`mode=label`、`retentionMode=none`）的結果送往模型：

- 一般 AI 回覆、摘要、分類、情緒分析、文字改寫與 Flex 產生所經過的 `generateReply()`（`ai/llm.flow.ts`）：包含最終組裝的系統提示、知識庫／跨渠道上下文、本次訊息及歷史。
- Agent 每輪送往模型的訊息、工具結果與巢狀工具參數的文字值。保留角色、工具名稱、呼叫 ID 與非文字參數。OCR／文件擷取結果在進入後續模型時亦套用。
- 向量化（`embedding-client.ts` 的 `embedText()`）的文字輸入，涵蓋客戶查詢及新產生的知識庫向量。既有向量保留，啟用可能影響檢索排序。

傳輸憑證不會送給去識別化服務。2md 回傳的 mapping、CSV 與隱私分數會被丟棄；此功能只消費遮罩文字，並不提供還原。每批處理最多並行 4 個請求，每次嘗試 6 秒逾時；逾時、連線或 DNS 錯誤、5xx 時等 300 毫秒重試一次（4xx、格式不符、回應過大不重試），每段文字最多 100,000 字元、每個回應最多 1 MiB，不跟隨重新導向，也不使用跨租戶或跨作業的文字快取。

政策讀取失敗或資料損壞回 `AI_PRIVACY_POLICY_UNAVAILABLE`；去識別化處理失敗回 `AI_DEIDENTIFICATION_UNAVAILABLE`。兩者皆停止該次模型派送。若 Agent 已建立執行紀錄，工具 trace 或最終輸出的遮罩失敗會將紀錄標為 `FAILED`，只寫入固定停止原因，不保存未處理文字。Agent 的既有安全回覆／KB fallback 維持各自的錯誤處理，後續每個模型入口仍須通過相同政策，原文不作為繞過政策的 fallback。

**進站訊息在去識別化服務無法使用時照常保存。** 重試後仍無法遮罩的進站訊息存原文，`metadata.privacy` 記 `{ mode: 'inbound_unmasked', reason }`，沒有遮罩副本；`reason` 是 `timeout`、`network`、`upstream_5xx`、`upstream_rejected`、`invalid_response` 或 `too_large`。這種訊息不交給模型：`message.received` 帶 `privacyUnmasked: true`，原本會跑 AI agent 或知識庫自動回覆時改轉真人（見[收件匣的轉真人](./INBOX.md#轉真人)），情緒分析只用關鍵字；`readModelMessageContent()`、`toAiHistory()` 與工單自動分類略過它，之後的 AI 回覆、建議回覆與摘要都讀不到原文。降級時發維運告警（合併鍵 `deidentification-unavailable`）。服務恢復後不補做遮罩。程式固定、不含顧客輸入的系統文字（按鈕轉接、綁定失敗提示、滿意度調查與評分回覆、預設轉接訊息、AI 失敗轉接）不呼叫 2md，遮罩副本就是原文（`system_fixed`）。

原始客服訊息、明確選擇保留原文的素材與媒體檔依既有保存規則保留。本功能處理新寫入的訊息文字、素材正文與模型輸入；影像像素、既有資料的回溯處理及資料刪除使用各自流程。規則遮罩可能漏判或誤判，與完整匿名化的效果有所區別。

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `knowledge` | 文章的 CRUD、發布與封存、檔案匯入、批次產生向量、語意搜尋、型號白名單、客人回報、夥伴系統匯入 |
| `embedding` | 產生向量與 pgvector 相似度檢索。沒有路由。`embedding-client.ts` 呼叫 Ollama，不碰資料庫；`embedding.flow.ts` 把向量化拆成「交易 → 交易外呼叫 Ollama → 交易」 |
| `ai` 的 `kb-autoreply.flow.ts`、`kb-autoreply.service.ts` | 機器人依知識庫回覆 |
| `ai` 的 `agent/` | AI agent：可以呼叫工具（搜尋網頁、讀網頁、OCR、解析文件、查天氣、發布 Wiki）的多輪回覆 |
| `ai` 的 `llm.flow.ts`、`llm.service.ts`、`llm-client.ts`、`providers/` | 呼叫 LLM。`llm.flow.ts` 把一次呼叫拆成「交易 1 讀設定、金鑰、遮罩政策與月額度上限 → 交易外檢查月額度並呼叫 LLM → 交易 2 寫用量紀錄」；`llm.service.ts` 是兩個交易內的查詢與提示詞的組裝；`llm-client.ts` 呼叫 provider，不碰資料庫。支援 Ollama 與 Gemini；組織不部署 Ollama，因此只能用 Gemini |
| `ai` 的 `ai-key.service.ts` | 決定用平台的 Gemini 金鑰還是租戶自備的金鑰 |
| `settings` 的 chat、embedding、gemini-key 部分 | 租戶的 Chat 設定、Embedding 設定與自備金鑰。讀設定時，沒有設定列就回預設值，不建立設定列；修改時設定與稽核在同一個交易寫入 |
| `trial` 的 `token-quota.service.ts` | AI 月額度的計數與告警 |

側欄「知識庫」底下有文章管理、語義搜尋、回報調教，以及「AI 設定」的 Embedding 與 Chat & Prompt 兩頁。

## 程式的入口

知識庫的路由在 `knowledge.routes.ts`，前綴是 `/api/v1/knowledge`。AI 設定的路由在 `settings.routes.ts` 底下的子 plugin，前綴是 `/api/v1/settings`。AI 輔助的路由在 `ai.routes.ts`，前綴是 `/api/v1/ai`。下表的知識庫路徑省略前綴。

| 操作 | 端點 | flow 或 service 函式 |
| --- | --- | --- |
| 文章列表、分類、來源 | `GET /`、`GET /categories`、`GET /sources` | `knowledge.service.ts` 的 `listArticles()`。列表以 raw SQL 補上 `hasEmbedding`。`limit` 是 1～100，預設 50；`page`、`limit` 不合法時回 400 |
| 單篇 | `GET /:id` | 每次讀取把 `viewCount` 加一（HC-KNOWLEDGE-13） |
| 建立、修改、發布、封存、刪除 | `POST /`、`PATCH /:id`、`POST /:id/publish`、`POST /:id/archive`、`DELETE /:id` | `knowledge.flow.ts`。向量化與刪除附件檔案用 `knowledge-effects.ts` 的 `startEmbedAfterCommit()`、`removeFilesAfterCommit()`，在 commit 之後開始 |
| 上傳檔案、批次匯入 | `POST /upload`、`POST /import` | 上傳的內容先經 `upload/upload-content-detector.ts` 偵測，再由 `file-parser.service.ts` 轉成 Markdown；兩者都呼叫 `importArticlesFlow`，每篇文章各自一個交易 |
| 語意搜尋 | `POST /search` | `semanticSearchFlow`：交易內 `readEmbeddingInputs()` → 交易外 `embedText()` → 交易內 `searchSimilarArticles()` |
| 產生向量 | `POST /:id/embed`、`POST /bulk-embed`、`GET /embedding-status` | `embedding.flow.ts` 的 `embedArticleFlow`。`bulk-embed` 立刻回應，在背景重新向量化所有已發布的文章 |
| 型號白名單 | `GET /models`、`POST /models/refresh` | `ai/model-registry.service.ts` |
| 客人回報 | `GET /feedback`、`GET /feedback/counts`、`PATCH /feedback/:id/resolve` | 寫入在進站攔截器 `inbound-postback-interceptors.ts` 的 `handleKbFeedback()` → `recordKbFeedbackFlow` |
| 夥伴系統推送 | `POST /partner-ingest` | `ingestPartnerDocFlow`，見[匯入](#匯入) |
| Chat 設定 | `GET`、`PUT /settings/chat`、`GET /settings/chat/models`、`POST /settings/chat/health` | `chat-settings.service.ts` 的 `getChatSettings()` |
| Embedding 設定 | `GET`、`PUT /settings/embedding`、`POST /settings/embedding/health` | `embedding-settings.service.ts` |
| 自備金鑰 | `GET`、`PUT /settings/gemini-key` | `ai-key.service.ts` |
| 機器人依知識庫回覆 | `automation.worker.ts` 呼叫 | `kb-autoreply.flow.ts` 的 `attemptKbAutoReplyFlow()`：`decideReply()` 決定回覆方式，`persistAndDeliver()` 寫入並送出 |
| AI agent | `automation.worker.ts`、`POST /ai/agent/run`、A2A（`settings/a2a-bridge.worker.ts` 的 `handleA2ATask()`） | `ai/agent/agent.flow.ts` 的 `runAgentReplyFlow()` |
| 一般 LLM 呼叫 | 各功能 | `llm.flow.ts` 的 `generateReply()`、`prepareLlmCall()`、`runLlmCall()` |

設定路由的 `baseUrl` 用 `httpUrlSchema`：只接受 http 與 https，但允許內網位址，因為 Ollama 部署在內網。

## 文章

文章（`KmArticle`）有三種狀態：

| 狀態 | 機器人會檢索 | 怎麼進入 |
| --- | --- | --- |
| `DRAFT` | 否 | 新建立的文章 |
| `PUBLISHED` | 是 | `POST /knowledge/:id/publish` |
| `ARCHIVED` | 否 | `POST /knowledge/:id/archive`，或夥伴系統送來刪除指令 |

`DELETE /knowledge/:id` 是硬刪除。

**向量什麼時候產生。** 新建的文章一律是 `DRAFT`。`DELETE /knowledge/:id` 在 commit 之後刪除附件在物件儲存上的檔案。

建立文章、以及改了標題、內容或摘要時，系統在背景重新產生向量；發布時若還沒有向量，也會在背景補產生。這三個時機都在 commit 之後開始，最多一次，不等待結果，失敗只記 log。處理程序中途結束時，文章沒有向量，要重新向量化補上。`embedText()`（`embedding/embedding-client.ts`）與物件儲存都是外部呼叫，不在交易內呼叫。因此文章可能顯示為已發布，卻因為沒有向量而檢索不到。`GET /knowledge/embedding-status` 列出向量的狀態，`POST /knowledge/bulk-embed` 與 `POST /knowledge/:id/embed` 可以補產生。

**向量化期間文章被修改時不寫入。** 系統讀文章時組成向量化的文字，呼叫 Ollama 之後鎖住文章、重組文字，文字沒變時才寫入向量。向量化的文字由 `embedding.service.ts` 的 `prepareArticleText()` 組成，比對也用它。發布、封存與瀏覽文章都不算修改：向量只取決於文字，檢索時才依狀態過濾。所以比對不看 `updatedAt` 與狀態，瀏覽次數會改 `updatedAt`，發布會改狀態。文章的向量化文字在這段期間被修改，或文章被刪除時，這次的向量不寫入，只記 warn log；改了內容的那次寫入會自己再產生向量。`POST /knowledge/:id/embed` 碰到這種情況回 409 `ARTICLE_CHANGED`。只改分類或標籤時不會重新產生向量，所以那篇文章保留舊向量，要手動重新向量化。

向量的維度有已知落差：程式、schema 與 UAT 用 1024 維；由 migration 建立的資料庫（本機、feature 測試）是 1536 維，寫入會被拒絕，見 `../../system/AUDIT.md` 的 DB-01。換 embedding 模型之前，先決定維度。

檢索只取 `PUBLISHED`、而且有向量的文章。語意搜尋頁用 Embedding 設定的 `topK` 與 `threshold`。embedding 服務連不上時，語意搜尋回 500 `INTERNAL_ERROR`，畫面看不出是向量服務的問題（HC-KNOWLEDGE-08）。

## 匯入

| 方式 | 端點 | 說明 |
| --- | --- | --- |
| 上傳檔案 | `POST /knowledge/upload` | 支援 PDF、Word、Excel、CSV、HTML、Markdown 與純文字。`file-parser.service.ts` 轉成 Markdown；Excel 與 CSV 會嘗試拆成一列一篇問答，拆出的問答**直接發布**，其他檔案存成草稿。每個檔案各自回報成功或失敗。很短的 Markdown 會被內容偵測判成純文字而被拒，錯誤是英文（HC-KNOWLEDGE-11） |
| 批次匯入 | `POST /knowledge/import` | 一次送多篇文章。JSON 內容上限高於全域：最多 50,000 篇、陣列元素與物件欄位合計 500,000，超過回 400 `PAYLOAD_*`。`status` 只有 `PUBLISHED` 會保留，其他值（含 `ARCHIVED`）一律存成 `DRAFT` |
| 夥伴系統推送 | `POST /knowledge/partner-ingest` | 見下方 |

**CSV 的文字編碼。** `decodeCsvText()` 先解碼再交給試算表解析：開頭有 UTF-8 BOM 時去掉 BOM 以 UTF-8 解；沒有 BOM 時先以嚴格 UTF-8 解（Google 試算表、Numbers、程式匯出），失敗再試 Big5（台灣版 Excel 的「CSV（逗號分隔）」）。兩種都解不出，或解出的文字含替代字元 U+FFFD 時，這個檔案一篇都不寫入，結果標成失敗，`code` 是 `CSV_ENCODING_UNREADABLE`，原因請使用者另存成「CSV UTF-8」；同批其他檔案照常匯入。xlsx 依 zip 檔頭辨識，不經過這段解碼。

**夥伴系統推送。** 外部系統以 `pk_` 開頭的長效 API 金鑰逐篇推送文件。金鑰在「設定 → API 金鑰」建立。行為由 `partner-ingest.service.ts` 決定：

- 請求的 `cmd` 決定動作：`CREATE`、`UPDATE` 或 `DELETE`。
- 以外部文件 ID（`externalDocId`）對應文章。收到的版本號小於等於現有版本時略過，避免亂序重送把新版蓋成舊版。
- `DELETE` 只把文章改成 `ARCHIVED`，附件保留。
- `ingestPartnerDocFlow` 分三段：交易 1 判斷 `cmd` 與版本 → 交易外上傳附件 → 交易 2 以 `FOR UPDATE` 鎖住文章，用同一個 `decidePartnerWrite()` 重新判斷，再寫入。
- 確定沒有寫入時（`skipped`、寫入途中丟錯），刪除這次上傳的檔案。寫入都做完、commit 卻回錯誤時保留檔案，因為資料庫可能已經寫入。
- 2026-11-06 時，UAT 的 `media/kb/` 比 `km_article_attachments` 多出約 46 個檔案（推測是沒有寫入的推送留下的）。
- 成員以 JWT 呼叫這個端點時，依 `knowledge.admin` 判斷。

## 機器人怎麼用知識庫回答

對話由機器人負責、而且渠道的 `botMode` 是 `llm` 或 `keyword_then_llm` 時，`attemptKbAutoReplyFlow()`（`kb-autoreply.flow.ts`）依序處理客人的文字訊息：

1. **檢查開關**。環境變數 `KB_AUTO_REPLY_ENABLED` 為 `false` 時整個功能關閉。這是整個部署共用的開關。
2. **讓步給關鍵字**。訊息會命中關鍵字規則、而且規則能在這個渠道回覆時不回覆。automation worker 在呼叫 AI agent 與知識庫回覆之前判斷一次，兩者共用這個結果。
3. **讀取對話紀錄**。取最近的訊息作為上下文，讓追問不會重複已經回答過的內容。
4. **檢索**。產生訊息的向量，找出相似度達到門檻的前幾篇文章。篇數與門檻是 Embedding 設定的 `topK` 與 `threshold`。
5. **型號守門**。客人提到的型號不在型號白名單、相似度又低於 0.85 時，不硬答，改列出相近型號請客人確認。型號白名單由 `ai/model-registry.service.ts` 從已發布文章的**標題**抽出，在行程記憶體快取 10 分鐘；`POST /knowledge/models/refresh` 可以立即重建。
   - 偵測用 `ai/model-matcher.ts` 的 `detectModels()`，前綴的檢查是 `hasKnownPrefix()`。`packages/kb-ingest` 有一份複本給語音逐字稿用，停用詞要兩邊同步。
   - 型號是英文前綴加 `-` 與英數，例如 `TAC-11P`、`TAC-06L-MCW`，不分大小寫（`tac-11p` 視同 `TAC-11P`）。`Wi-Fi`、`e-mail`、`T-shirt`、`USB-C`、`Type-C`、`HDMI-2`、`CD-R`、`DVD-R` 這類常見英文詞不論大小寫都不算型號，文章標題裡的也不會進白名單。
   - 只攔截前綴出現在白名單的型號：知識庫沒有型號文章（白名單空）時不守門；訂單編號 `AB-12345` 這類前綴不在白名單的編號也不攔截。
   - 守門回覆和追問共用追問次數；次數已達 `clarifyMaxAttempts` 時不再引導型號，改回「已為您轉接客服人員」並轉真人。
   - 守門命中後，`modelGuard`（含 `unknownModel`）寫進對話的 `metadata`，之後不會清掉，後來的回覆沿用舊值（HC-KNOWLEDGE-06）。
6. **決定回覆方式**：

| 最高相似度 | 回覆 |
| --- | --- |
| 0.80 以上 | 以文章內容為依據，由 LLM 回答 |
| `clarifyThreshold` 到 0.80 之間 | 同樣回答，並在後面附上轉接客服的提示 |
| 低於 `clarifyThreshold`，或沒有文章 | 追問一個問題。追問次數達到 `clarifyMaxAttempts` 後轉真人 |

`0.80` 是 `kb-autoreply.service.ts` 裡的常數；`clarifyThreshold` 與 `clarifyMaxAttempts` 是 Chat 設定的欄位。追問次數記在對話的 `metadata.clarifyAttempts`，型號守門的回覆也算一次，成功回答一次就歸零。

依文章回答時 LLM 呼叫失敗，包含月額度用完的 `PLAN_LIMIT_EXCEEDED`，機器人改送文章原文（`content`）給客人，長度不限，文章裡的內部備註也會送出（HC-KNOWLEDGE-04）。

追問次數用完，或追問的 LLM 呼叫失敗（包含月額度用完的 `PLAN_LIMIT_EXCEEDED`）時，機器人回「不好意思我這邊還沒辦法判斷您的需求，已為您轉接客服人員，請稍候。」（回覆類型 `clarify_handoff`），並在 `bot_reply` 認領的同一個交易真的轉真人：對話改成 `AGENT_HANDLED`、`handoffReason` 寫原因（追問次數已達上限、AI 月額度已用完、AI 回覆失敗）、寫一則系統訊息、發出 `conversation.handoff`（客服收到「轉接真人」通知），追問次數歸零。轉接用的是與自動轉真人相同的 `handOffConversation()`（`apps/api/src/modules/automation/handoff.flow.ts`），見[收件匣的轉真人](./INBOX.md#轉真人)。轉接的條件不成立時，整筆 rollback，不送「已為您轉接」。月額度用完時，`handoffReason` 是「AI 月額度已用完，無法自動回覆」。之後客人的訊息不再由知識庫或 agent 回覆；命中關鍵字規則的訊息照樣由關鍵字規則回覆。命中關鍵字規則的訊息本來就由關鍵字規則處理，不算追問，也不會觸發這個轉接。

依文章回答的訊息會附上「👎 沒幫到我」快速回覆按鈕；追問與型號守門的回覆沒有這個按鈕。客人按下後，按鈕送出 `kb_feedback:*` postback，進站攔截器把回饋記到 `KbArticleFeedback`，並回「感謝您的回報」。回報不去重，也不檢查 `messageId` 與文章的關係（HC-KNOWLEDGE-07）。管理員在「知識庫 → 回報調教」查看各文章的回報，並標記為已處理。標記之後回報從清單消失，不能復原。

**知識庫回覆因錯誤失敗時轉真人。** 產生訊息向量失敗（去識別化服務、embedding 服務故障），或讀設定、檢索、寫入前的遮罩丟出錯誤，而 AI agent 也沒有回覆時，`attemptKbAutoReplyFlow()` 回傳 `failed`，系統轉真人，原因寫「AI 暫時無法回覆（…）」（見[收件匣的轉真人](./INBOX.md#轉真人)）。結果分三種：`replied`（已回覆，含 LLM 失敗時的備援內容）、`skipped`（正常不回覆：停用、對話不是 `BOT_HANDLED`、`botMode`、已有回覆、產生回覆期間客服接手；命中關鍵字規則時 worker 不呼叫知識庫）與 `failed`。

**交易與外部呼叫。** 知識庫回覆的讀寫都在綁定租戶的短交易內，受 RLS 約束；embedding 服務、LLM 與去識別化服務在交易外呼叫。寫入回覆時，系統在同一個交易內以條件更新確認對話仍是 `BOT_HANDLED`：產生回覆期間客服接手時，不寫入、也不送出這則回覆，結果是 `skipped`（`already_handled`）。寫入回覆包在 `BotReplyGuard.persist()` 的交易裡，與 `bot_reply` 認領一起 commit。追問次數在寫入的交易內讀最新的值再合併。回覆寫入之後，`botRepliesCount` 加一，推播 `message.new`，再以 `deliverToChannel()` 送到渠道。

**AI agent 優先。** 環境變數 `AGENTIC_LLM_ENABLED` 為 `true` 時，機器人先交給 AI agent 回覆；AI agent 沒有處理時，才走上面的知識庫流程。AI agent 可以呼叫外部工具，執行紀錄存在 `AgentRun`，可以用 `GET /ai/agent/runs/:id` 查看；紀錄關聯的對話所在渠道看不到時回 404。Agent 的資料庫寫入各自在短交易內，LLM 與工具在交易外呼叫：每次工具呼叫之後，系統先寫入工具紀錄，再進行下一次呼叫。執行到一半失敗時，執行紀錄標成 `FAILED`，之前的工具紀錄保留。Agent 最長可以執行 120 秒（`agent/runner.ts` 的 `AGENT_DEFAULT_TIMEOUT_MS`），交易的逾時是 5 秒，所以 Agent 不包在 `withTenant()` 或 `inTenant()` 裡。送到渠道的 `deliverToChannel()` 屬於還沒搬到 `TenantCtx` 的 conversation 模組，仍用舊的連線型別。

## AI 設定

Chat 與 Embedding 的設定都是租戶層級，存在 `TenantSettings`。該租戶還沒有這一列時，讀 Chat 設定（`getChatSettings()`）與 Embedding 設定都只回預設值、不建立設定列；修改設定時以 upsert 建立。修改設定與稽核紀錄在同一個交易寫入。`DEFAULT_CHAT_SETTINGS` 要與 schema 的欄位預設值相同（`chat-settings-defaults.test.ts` 檢查）。所以新租戶在設定列建立之前沒有 `inactivityCloseHours`，閒置自動關閉不會開始（CONV-01）。

| 設定 | 欄位 | 預設值的位置 |
| --- | --- | --- |
| Chat（Chat & Prompt 頁） | 供應商（Ollama 或 Gemini）、模型、位址、溫度、最大 token、系統提示詞、追問門檻與次數 | `chat-settings.service.ts` 的 `DEFAULT_CHAT_SETTINGS` |
| Embedding（Embedding 頁） | 位址、模型、`topK`、`threshold` | `embedding-settings.service.ts` 的 `DEFAULT_EMBEDDING_SETTINGS` |

兩頁都有健康檢查（`/settings/chat/health`、`/settings/embedding/health`），用來確認模型位址連得上。

兩頁的預設值都指向 Ollama。Chat 可以把供應商改成 Gemini；Embedding 沒有供應商可選，只會呼叫 Ollama。見 `../../system/AUDIT.md` 的 LLM-01 與 LLM-04。

**自備金鑰（BYOK）。** 租戶可以在設定頁填入自己的 Gemini 金鑰（`PUT /settings/gemini-key`，body `{ apiKey: 字串或 null }`），金鑰加密後存在 `TenantSettings.geminiApiKeyEnc`。有自備金鑰時，AI 呼叫用租戶的金鑰，成本記 0，也不受月額度限制。解密失敗時會靜默改用平台金鑰，見 `../../system/AUDIT.md` 的 AI-01。

**兩個部署層級的開關。** `KB_AUTO_REPLY_ENABLED` 與 `AGENTIC_LLM_ENABLED` 是環境變數，所有租戶共用，租戶不能各自開關。租戶要關掉機器人，只能把各渠道的 `botMode` 設成 `off` 或 `keyword`。

## 額度

只有使用平台金鑰（`keySource === 'platform'`）時，系統才累加並檢查月額度（`monthlyTokens`）。每次成功的 AI 呼叫把 token 數累加到該租戶當月的計數器：Redis key 是 `aiquota:{tenantId}:{YYYY-MM}:tpe`，月份依台灣時間；Redis 失敗時改用資料庫加總（`token-quota.service.ts`）。Ollama 的成本記 0，但同樣會累加。一般 AI 呼叫與 AI agent 都經由 `llm.flow.ts` 的 `prepareLlmCall()`，在呼叫前檢查月額度，超過就丟 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 LLM。

一次 LLM 呼叫分三段：交易 1 的 `readLlmInputs()` 讀 Chat 設定、金鑰、遮罩政策與月額度上限；交易外以 Redis 計數器檢查月額度，`llm-client.ts` 呼叫 provider；交易 2 的 `writeAiUsage()` 寫用量。一次請求要呼叫多次 LLM 時（例如建議回覆），呼叫一次 `prepareLlmCall()`，每次呼叫 `runLlmCall()`。

每次呼叫 LLM 之後，系統寫一筆 `AiUsage`，寫完才把回覆交給呼叫端；寫入失敗只寫 log，回覆照常。寫入 commit 之後才累加計數器。用量跨越 80% 與 100% 時，系統把 `usage.quota.threshold` 寫進 outbox，通知租戶的 `ADMIN` 並寄信，見[通知](./NOTIFICATIONS.md)。Redis 的 client 由呼叫端傳入（API 行程用 `fastify.redis`）。

額度的上限怎麼算、加購怎麼影響額度，見平台後台的[方案與上限](../platform/PLANS.md)；成本怎麼算，見[用量統計](../platform/USAGE.md)。

## 權限

| 路由 | 權限 |
| --- | --- |
| 文章清單、單篇、分類、來源、語意搜尋、向量狀態、型號清單、回報清單 | `knowledge.view` |
| 建立、修改、刪除、發布、封存、上傳、批次匯入、產生向量 | `knowledge.manage` |
| 夥伴系統推送、重建型號白名單、標記回報已處理 | `knowledge.admin` |
| Chat、Embedding、自備金鑰的設定 | `settings.manage` |

側欄的「知識庫」依 `knowledge.view` 隱藏。「AI 設定」兩頁沒有 `settings.manage` 時，側欄隱藏；直接開網址時，頁面顯示「沒有權限」（`SettingsLoadError.tsx`）。文章的寫入按鈕不依 `knowledge.manage` 隱藏，按下才收到「權限不足」（HC-KNOWLEDGE-05）；只有「標為已處理」依 `knowledge.admin` 隱藏。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 文章管理 `/dashboard/knowledge/articles`：狀態分頁、分類、來源、標籤、搜尋 | `GET /knowledge?status&category&source&tag&q&page&limit=50`、`GET /knowledge/categories`、`GET /knowledge/sources` | 有向量的文章，標題前有綠色圖示。舊網址 `/dashboard/knowledge?tab=` 仍然可用 |
| 「新增文章」、列上的鉛筆（`ArticleFormDialog`） | `POST /knowledge`；`GET /knowledge/:id`、`PATCH /knowledge/:id` | 分類空白時送 `一般`，標籤以逗號切開。錯誤只顯示「輸入內容有誤，請檢查後重新送出」，不顯示 `details.issues`（HC-KNOWLEDGE-12） |
| 列上的地球、箱子、垃圾桶 | `POST /knowledge/:id/publish`、`POST /knowledge/:id/archive`、`DELETE /knowledge/:id` | 刪除是硬刪除 |
| 「匯入文章」（`ImportDialog`） | JSON 以外的檔案：`POST /knowledge/upload`（multipart）；JSON：前端 `JSON.parse` 之後送 `POST /knowledge/import`，body `{ articles }` | JSON 的最外層不是陣列時，前端顯示「JSON 最外層必須是陣列」，不送出 |
| 語義搜尋 `/dashboard/knowledge/search` | `POST /knowledge/search`，body `{ query }` | 一輸入文字、還沒按搜尋，就顯示「沒有找到相關文章」（HC-KNOWLEDGE-14） |
| 回報調教 `/dashboard/knowledge/feedback` | `GET /knowledge/feedback?status=open`、`PATCH /knowledge/feedback/:id/resolve` | |
| Embedding `/dashboard/knowledge/embedding` | `GET`、`PUT /settings/embedding`、`POST /settings/embedding/health`、`POST /knowledge/bulk-embed` | 滑桿：`topK` 1～20，`threshold` 0～1 |
| Chat & Prompt `/dashboard/knowledge/chat-prompt`（舊網址 `?tab=chat`） | `GET`、`PUT /settings/chat`、`GET /settings/chat/models`、`POST /settings/chat/health`、`GET`、`PUT /settings/gemini-key`、`POST /knowledge/models/refresh` | 滑桿：temperature 0～1，maxTokens 50～2000，`clarifyThreshold` 0～1，`clarifyMaxAttempts` 0～5。供應商送 `ollama` 或 `gemini` |
| 收件匣的 AI 建議回覆與摘要、素材的潤稿 | `POST /ai/suggest-reply`、`POST /ai/summarize`、`POST /ai/rewrite`、`GET /ai/privacy/status` | 見[收件匣的 AI 輔助](./INBOX.md#ai-輔助) |

下列 API 沒有畫面入口：

- `POST /knowledge/:id/embed`、`GET /knowledge/embedding-status`。
- `GET /knowledge/models`。畫面只有重建白名單的按鈕。
- `GET /knowledge/feedback/counts`。hook `useKbFeedbackCounts` 沒有元件使用。
- `/ai/classify`、`/ai/analyze-sentiment`、`/ai/agent/run`、`/ai/agent/runs/:id`。
- `POST /knowledge/partner-ingest`，給夥伴系統呼叫。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 向量在背景產生，失敗不會通知 | 已發布的文章可能檢索不到，要從向量狀態自行檢查 |
| 向量維度不一致 | 詳見 `../../system/AUDIT.md` 的 DB-01 |
| Embedding 只能呼叫 Ollama | UAT 目前靠 Compose 裡的 Ollama 運作。部署拿掉 Ollama 後，產生向量、檢索、自動回覆與 AI 建議回覆都會失敗；自動回覆失敗時系統轉真人（見上方「知識庫回覆因錯誤失敗時轉真人」）。詳見 `../../system/AUDIT.md` 的 LLM-04 |
| Chat 的預設供應商是 Ollama | 新租戶要先把 Chat 供應商改成 Gemini。詳見 `../../system/AUDIT.md` 的 LLM-01 |
| 自備金鑰解密失敗時靜默改用平台金鑰 | 詳見 `../../system/AUDIT.md` 的 AI-01 |
| AI 不在方案的功能天花板內 | 詳見 `../../system/AUDIT.md` 的 PLAN-12 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
