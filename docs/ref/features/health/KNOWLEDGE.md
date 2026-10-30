# 知識庫與 AI 回覆 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只做唯讀 API 查詢）
- 規格：`docs/ref/features/feature-map.json` 的 `knowledge`；功能文件 `docs/ref/features/tenant/KNOWLEDGE.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 7 份 spec、90 個 scenario。以 scenario 名稱比對測試名稱，56 個找不到同名測試（`km-ingestion` 15、`knowledge-base-information-architecture` 9、`ai-usage-recording` 8、`agentic-llm-orchestration` 11、`bot-handoff-config` 13）。確定缺實作 4 個（`km-ingestion` 的 2md、語音、LanceDB 三條需求，規格已與程式脫節）。KB 自動回覆、型號守門、KB 回報三大功能**沒有主規格**，也幾乎沒有測試（只有 `kb-autoreply-history.test.ts`）。缺前端入口 6 項 |
| 自動測試 | unit：api 24 檔 91 通過、web 2 檔 8 通過，無失敗、無 skip。feature：`token-quota-alert`、`other-channel-context`、`platform-usage` 3 檔 19 通過 |
| 實際操作 | 13 條流程。正常 4，異常 6，部分驗證或待真機驗 3 |

**本機沒有 LLM 與 embedding 服務。** 本機 Demo 租戶的 Chat 與 Embedding 都指向 `http://localhost:11434`，連不上。依指示不把設定改指向外部付費服務。KB 自動回覆改用健檢腳本驗證：腳本在本機啟動一個假的 Ollama（`127.0.0.1:11499`，固定回傳的向量與文字），只在腳本內以 Proxy 把 `tenantSettings` 的兩個位址換成假服務，**沒有改動租戶設定**，再直接呼叫 `attemptKbAutoReply()`，訊息寫進本機資料庫的自建對話。這樣驗到的是 `kb-autoreply.service.ts` 的分流邏輯，不含 workers 的佇列、`checkAutoHandoff` 與真實渠道投遞。腳本：`<SCRATCH>/hc-knowledge/kb-harness.ts`（暫存目錄，不進版控）。

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-KNOWLEDGE-01 | P1 | 追問次數用完時，機器人回「已為您轉接客服人員，請稍候」，但**沒有轉接**：對話仍是 `BOT_HANDLED`，沒有 `handoffReason`、沒有系統訊息、客服不會收到。客人再傳訊息，又收到同一句「已為您轉接」。實際轉接要等 `botRepliesCount` 達到渠道的 `maxBotReplies`（預設 5）才由 `checkAutoHandoff` 觸發；`maxBotReplies` 調高的渠道，客人會一直收到假的轉接訊息。LLM 失敗（含月額度用完的 `PLAN_LIMIT_EXCEEDED`）時，追問路徑也走同一句 | **實測**（健檢腳本＋假 LLM）：新對話依序送「你們幾點開門」「還是不懂你們幾點開門」「到底幾點開門」「喂？有人嗎」→ 前兩則 `clarify`，後兩則都是 `clarify_handoff`「…已為您轉接客服人員，請稍候。」，對話狀態一直是 `BOT_HANDLED` | `apps/api/src/modules/ai/kb-autoreply.service.ts:252-255, 270-273`（只寫訊息，不改對話狀態）；轉接本身在 `apps/api/src/modules/automation/automation.worker.ts` 的 `checkAutoHandoff` | 新 |
| HC-KNOWLEDGE-02 | P1 | 型號守門把一般英文詞當成型號：正規式 `\b([A-Z]{1,4})-([0-9A-Z]+…)\b` 不分大小寫，`Wi-Fi`、`e-mail`、`T-shirt`、訂單編號 `AB-12345` 都被當成「查無此型號」，機器人回「這個型號我這邊查不到資料」並請客人確認型號。守門對**所有租戶**生效；沒有任何型號文章的租戶（白名單是空的），只要訊息有這類詞、KB 相似度低於 0.85，就一定走守門。守門路徑也不累加追問次數，客人一直提到這類詞就一直不會轉真人 | **實測**（健檢腳本＋假 LLM）：送「我家 Wi-Fi 連不上怎麼辦」→ `replyKind=model_not_found`、`unknownModel=WI-FI`；送「請問可以寄 e-mail 給你們嗎」→ `unknownModel=E-MAIL`。另以 `detectModels()` 直接驗證 `T-shirt`、`AB-12345` 也命中。本機建立標題含 `hc-knowledge-` 的文章後，`GET /knowledge/models` 出現 `HC-KNOWLEDGE` | `apps/api/src/modules/ai/model-matcher.ts:22`；`kb-autoreply.service.ts:185-237`（守門無條件執行） | 新 |
| HC-KNOWLEDGE-03 | P1 | 上傳 UTF-8 編碼、**沒有 BOM** 的 CSV，中文全部變亂碼：`XLSX.read(buffer, {type:'buffer'})` 沒指定編碼，把 UTF-8 當單位元組讀。表頭「問題,答案」因此認不出，整份變一篇亂碼草稿；表頭是英文 `question,answer` 時會拆成問答，但標題與答案是亂碼，而且**直接發布**，AI 馬上會用。有 BOM 的 CSV 正常。Google 試算表、Numbers、程式匯出的 CSV 都沒有 BOM；台灣版 Excel 的「CSV（逗號分隔）」是 Big5，同樣會亂碼。手冊用的範例檔 `apps/web/tests/fixtures/manual-kb-sample.csv` 就是無 BOM 的 UTF-8 | **實測**（本機 API）：上傳 `問題,答案\nQ1 退貨要幾天,七天內可退貨` → 1 篇草稿，內容為「åé¡ \| ç­æ¡」；上傳英文表頭版本 → 1 篇**已發布**，標題「éè²¨è¦å¹¾å¤©」；加上 `EF BB BF` 後正常拆成「退貨要幾天」。文章管理頁截圖可見亂碼標題 | `apps/api/src/modules/knowledge/file-parser.service.ts:57, 139`；QA 列直接發布在 `knowledge.routes.ts:167` | 新 |
| HC-KNOWLEDGE-04 | P2 | LLM 呼叫失敗時，知識庫回答路徑把**整篇文章原文**（最多不限長度，`topResult.content`）直接送給客人。月額度用完（`PLAN_LIMIT_EXCEEDED`）也走這條：規格要求的「不呼叫 LLM」做到了，但客人收到的是未整理的文章全文，文章裡若有內部備註也會一起送出 | **實測**（健檢腳本）：假 LLM 回 500，客人問「濾網怎麼拆」→ 回覆內容就是文章 content「濾網每兩週清洗一次。」，`replyKind=kb_high_confidence` | `kb-autoreply.service.ts:292-296` | 新 |
| HC-KNOWLEDGE-05 | P2 | 知識庫的寫入按鈕不依權限隱藏：「新增文章」「匯入文章」與每列的編輯、發布、封存、刪除鈕，對沒有 `knowledge.manage` 的成員照樣顯示，按下才跳 alert「權限不足」。只有「標為已處理」有依 `knowledge.admin` 隱藏 | **實測**（本機 UI）：自建角色只有 `knowledge.view, inbox.view` → 文章管理頁有「新增文章」「匯入文章」各 1、刪除鈕 13；按封存跳出「權限不足，無法執行此操作…」 | `apps/web/src/app/dashboard/knowledge/page.tsx:244-257`；`apps/web/src/components/knowledge/ArticleList.tsx:180-216` | 新 |
| HC-KNOWLEDGE-06 | P2 | 型號守門命中後，`modelGuard` 物件寫進 `conversation.metadata` 之後永遠不會清掉；之後的一般回答、追問都沿用舊值，客服或除錯時會誤以為最近一則是守門回覆 | **實測**（健檢腳本）：守門之後的 `clarify`、`kb_high_confidence` 回覆，對話 metadata 仍是 `{"modelGuard":{"unknownModel":"E-MAIL",…}}` | `kb-autoreply.service.ts:436`（`{...existingMeta, ...metadataExtras}`） | 新 |
| RBAC-01 | P3（依 AUDIT） | 知識庫 9 條讀取路由不檢查 `knowledge.view`。**本次重現**：只有 `inbox.view` 的成員，文章列表、單篇、分類、來源、型號、回報清單、回報數都回 200，直接開 `/dashboard/knowledge/articles` 看得到全部文章與寫入鈕 | 本機 API 權限矩陣（見流程 12） | `knowledge.routes.ts:77-84` | RBAC-01（已記錄） |
| AUTH-06 | P3（依 AUDIT） | 網頁登入的 admin 打 `POST /knowledge/partner-ingest` 一律 403 `knowledge.admin`。**本次重現** | 本機：admin token + multipart `cmd=CREATE` | `apps/api/src/plugins/auth.plugin.ts` 的 `authenticateJwtOrPartnerKey` | AUTH-06（已記錄） |
| DB-01 | 依 AUDIT | 本機 `km_articles.embedding` 是 `vector(1536)`，程式與畫面寫 1024 維（Embedding 頁「向量維度固定為 1024」）。真的 `bge-m3`（1024 維）在本機寫不進去 | `psql` 查 `format_type` | `apps/web/src/components/knowledge/EmbeddingSettings.tsx:58`；`embedding-settings.service.ts` 的 `EMBEDDING_VECTOR_DIM` | DB-01（已記錄） |
| HC-KNOWLEDGE-07 | P3 | KB 回報不去重，也不檢查 `messageId` 與文章的關係：同一則回覆按兩次「沒幫到我」記兩筆；`messageId` 不存在也照樣記一筆（問句、回答為空）。WebChat 的訪客直接輸入 `kb_feedback:bad:<文章 id>:<任意 uuid>` 文字也會被攔截器當成回報。不論有沒有記錄，都回「感謝您的回報」 | **實測**（健檢腳本呼叫 `recordKbFeedback`）：同一 messageId 兩次 → 2 筆；不存在的 messageId → 再多 1 筆。文字攔截為讀程式 | `apps/api/src/modules/knowledge/kb-feedback.service.ts:76`；`apps/api/src/modules/webhook/inbound-postback-interceptors.ts:78-93` | 新 |
| HC-KNOWLEDGE-08 | P3 | 語義搜尋在 embedding 服務連不上時回 500 `INTERNAL_ERROR`，畫面顯示「系統發生未預期的錯誤，請稍後重試」，看不出是向量服務的問題。`generateEmbedding` 的逾時訊息寫得很好，但連線失敗（`fetch failed`）沒有轉成可讀訊息 | **實測**（本機 UI 與 API）：`POST /knowledge/search {query:"濾網"}` | `apps/api/src/modules/embedding/embedding.service.ts:102-155` | 新（與 LLM-04 相關） |
| HC-KNOWLEDGE-09 | P3 | 文章列表 `page=0` 回 500 `INTERNAL_ERROR`（`skip` 變負數）；`limit` 沒有上限（`limit=100000` 回 200）；非 UUID 的文章 id 回 400 `DATABASE_ERROR` | **實測**：本機與 UAT 的 `GET /knowledge?page=0` 都回 500；`GET /knowledge/abc` 回 `DATABASE_ERROR` | `knowledge.routes.ts:88-89`（`parseInt` 沒有 Zod） | 新 |
| HC-KNOWLEDGE-10 | P3 | `POST /knowledge/:id/embed` 對不存在的 id 回 500（`embedArticle` 丟一般 `Error`），而且不檢查文章屬於本租戶（`findUnique({ where: { id } })`；正式環境由 RLS 擋下，本機 superuser 不擋） | **實測**：本機對 `00000000-…` 呼叫回 500 | `apps/api/src/modules/embedding/embedding.service.ts:216-236`；`knowledge.routes.ts:472-475` | 新 |
| HC-KNOWLEDGE-11 | P3 | 很短的 Markdown（標題加一行）被內容偵測判成純文字，以「File content type rejected: filename extension does not match text/plain」拒絕；錯誤是英文。一般長度的 Markdown 正常 | **實測**：`# hc-knowledge 說明文件\n\n內容一段。` 存成 `.md` 上傳被拒；20 行的 `.md` 成功 | `apps/api/src/modules/upload/upload-content-detector.ts:230-231` | 新 |
| HC-KNOWLEDGE-12 | P3 | 文章表單錯誤只顯示「輸入內容有誤，請檢查後重新送出」，沒有用 `details.issues`（例如摘要超過 500 字） | **實測**（本機 UI）：摘要填 501 字 → 儲存 | `apps/web/src/components/knowledge/ArticleFormDialog.tsx` 的 `handleSubmit` | 新 |
| HC-KNOWLEDGE-13 | P3 | 在文章管理按鉛筆會呼叫 `GET /knowledge/:id`，每次都 `viewCount +1`；欄位名稱是「瀏覽數」，實際是後台打開編輯的次數（手冊已註明）。AI 回覆不會增加這個數字 | **實測**：同一篇連續 GET 兩次，viewCount 1 → 2 | `apps/api/src/modules/knowledge/knowledge.service.ts:118-121` | 新 |
| HC-KNOWLEDGE-14 | P3 | 語義搜尋頁一輸入文字、還沒按搜尋，就顯示「沒有找到相關文章」（手冊已註明是已知現象） | **實測**（本機 UI） | `apps/web/src/app/dashboard/knowledge/page.tsx:355-358` | 新 |

### AUDIT 項目的現況

| AUDIT | 本次結果 |
| --- | --- |
| RBAC-01 | 仍存在，已重現（見上表） |
| AUTH-06 | 仍存在，已重現 |
| DB-01 | 本機仍是 `vector(1536)` |
| LLM-04 | **描述與 UAT 現況不符**。AUDIT 寫「組織不部署 Ollama，因此所有產生向量的路徑都會失敗」。UAT Demo 租戶 `GET /knowledge/embedding-status` 回 `{ok:true, model:"bge-m3:latest"}`，1180 篇已發布文章抽查前 200 篇全部有向量。程式上「Embedding 只能呼叫 Ollama」仍為真，但 UAT 目前靠 Compose 內的 Ollama（LLM-02）運作。建議 AUDIT 改寫影響描述：拿掉 Ollama 會使上述路徑失敗，而不是現在已經失敗 |
| ARCH-01 | 仍存在：`POST /knowledge/bulk-embed` 在 route 直接 `kmArticle.count` |
| PLAN-12 | 仍存在：只有 `inbox.view` 的成員可呼叫 `/ai/classify`、`/ai/analyze-sentiment`、`/ai/rewrite`（本機 LLM 不在，回 200 降級值或 422 `AI_REWRITE_FAILED`） |
| AI-01、PLAN-02、PLAN-13、USAGE-03、LLM-01、LLM-03 | 只讀程式，未變動 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 文章列表、篩選、搜尋 | 本機、UAT | 正常：關鍵字比對 tag、分類下拉、狀態分頁；UAT Demo 1180 篇、前 200 篇都有向量 | `page=0` 500、`limit` 無上限、非 UUID 400 `DATABASE_ERROR`（HC-KNOWLEDGE-09）；`status=FOO` 400 | 沒有 `knowledge.view` 仍可讀（RBAC-01） | |
| 2 新增、編輯文章 | 本機 | 正常：UI 新增後重新整理仍在；PATCH 摘要與標籤成功 | 空白標題 400「標題不可為空白」；空內容 400；摘要 501 字畫面只顯示通用訊息（HC-KNOWLEDGE-12） | **異常**：按鈕不依 `knowledge.manage` 隱藏（HC-KNOWLEDGE-05）；後端 403 正常 | 開編輯會加瀏覽數（HC-KNOWLEDGE-13） |
| 3 發布、封存、刪除 | 本機 | 正常：發布後狀態變「已發布」；重複發布 400「此文章已發布」 | — | 唯讀角色按封存跳 alert「權限不足」，按鈕仍顯示（HC-KNOWLEDGE-05） | 發布時背景產生向量，本機服務不在所以 `hasEmbedding=false` |
| 4 匯入（上傳檔案、JSON） | 本機 | 部分：BOM CSV 拆成已發布問答；一般長度 `.md`、`.txt` 成草稿；JSON 陣列匯入成功，未知 `status` 存成草稿 | **異常**：無 BOM 的 UTF-8 CSV 亂碼並可能直接發布（HC-KNOWLEDGE-03）；短 `.md` 被拒且錯誤是英文（HC-KNOWLEDGE-11）；ELF 偽裝 `.txt` 被拒；JSON 有一筆空白標題整批 400（手冊已註明） | 寫入需 `knowledge.manage`，後端正常 | 前端擋外層非陣列的 JSON，未另測 |
| 5 語義搜尋 | 本機 | 未驗：本機沒有 embedding 服務 | 空查詢 400；服務不在時 500 通用訊息（HC-KNOWLEDGE-08） | 只驗登入（RBAC-01） | UAT 未呼叫（避免在正式環境觸發搜尋），UAT 的向量資料完整 |
| 6 回報調教 | 本機（UI）、UAT（API） | 正常：腳本產生的回報顯示問句、命中文章；admin 有「標為已處理」，標記後消失；UAT Demo 有 3 筆待處理 | 不存在的回報 id 404「回報記錄不存在」 | agent 與唯讀角色看不到「標為已處理」，後端 403 `knowledge.admin`。正常 | 不去重、偽造 messageId 也記錄（HC-KNOWLEDGE-07） |
| 7 Embedding 設定頁 | 本機 | 部分：admin 頁面載入、狀態顯示「異常／未安裝」與連線錯誤 | `baseUrl: file:///etc/passwd` 400「網址只允許 http 或 https」；`topK:0` 400 | agent、唯讀角色直接開網址顯示「沒有權限…需要『系統設定』權限」，後端 403 `settings.manage`。正常 | 沒有實際儲存（避免改動共用租戶設定）；畫面寫 1024 維、本機欄位 1536（DB-01） |
| 8 Chat & Prompt 設定頁、自備金鑰 | 本機 | 部分：admin 頁面載入、顯示 Ollama 連不上 | `clarifyMaxAttempts: 9` 400「不可大於 5」；前端滑桿範圍都落在後端允許值內 | 同上，正常 | 沒有實際儲存，也沒有設定金鑰；UAT 未開（健康檢查可能呼叫 Gemini） |
| 9 型號白名單 | 本機、UAT | 正常：`GET /knowledge/models` 列出、`POST /models/refresh` 立即重建；UAT Demo 231 個型號 | — | refresh 需 `knowledge.admin`，agent 403。正常 | 正規式誤判（HC-KNOWLEDGE-02） |
| 10 KB 自動回覆 | 本機（健檢腳本＋假 LLM） | 高相似度：`kb_high_confidence`，呼叫 LLM 1 次，`clarifyAttempts` 歸零 | **異常**：追問用完假轉接（HC-KNOWLEDGE-01）；型號誤判（HC-KNOWLEDGE-02）；LLM 失敗送原文（HC-KNOWLEDGE-04）；metadata 殘留（HC-KNOWLEDGE-06） | 無（系統流程） | 未經 workers 佇列、未驗真實渠道投遞與「👎 沒幫到我」按鈕顯示，見待真機驗 |
| 11 AI 月額度與用量 | — | 以 feature 測試為準（`token-quota-alert` 通過） | — | — | 未在本機改 Redis 計數器（共用租戶）。超額時的客人體驗見 HC-KNOWLEDGE-01、04 |
| 12 權限矩陣（API） | 本機 | admin、supervisor 全部 200 | — | agent（有 `knowledge.manage`）：寫入 200、refresh 與 resolve 403、AI 設定 403；唯讀與無知識庫角色：讀取全部 200（RBAC-01）、寫入 403，`requiredPermission` 正確 | |
| 13 夥伴系統推送 | 本機 | 未驗：沒有建立 Partner API 金鑰 | 網頁 JWT 403（AUTH-06） | — | 9 個 cmd scenario 只讀程式核對（`partner-ingest.service.ts:104-147`），與規格一致，沒有行為測試 |

權限測試用的角色：admin、supervisor（有 `knowledge.admin`、`settings.manage`）、seed 的 agent（有 `knowledge.manage`，沒有 `knowledge.admin`、`settings.manage`）、本機自建「hc-knowledge-唯讀」（`knowledge.view, inbox.view`）、「hc-knowledge-無知識庫」（只有 `inbox.view`）。兩個自建帳號與角色已刪除。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試；「找不到同名測試」不等於沒有測試。

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| km-ingestion | 4 | 15 | 15 | 4：「Document ingestion via 2md AnyDoc API」「Audio file ingestion」「Fallback on API unavailability」「Successful vectorization」。程式用本機套件轉檔（`file-parser.service.ts`）、整篇存 pgvector，沒有 2md、語音、chunk、LanceDB。夥伴 cmd 的 9 個 scenario 有實作，只有授權測試 | 夥伴推送無前端（設計如此） |
| knowledge-base-information-architecture | 4 | 9 | 9 | 0（樹狀導覽、canonical 路由、`?tab=` 相容都在；「沒有權限的設定頁不可操作」實測正常） | 有 |
| token-quota | 2 | 10 | 0 | 0 | 租戶端沒有用量頁 |
| usage-quota-alerts | 6 | 18 | 0 | 0 | 通知與 email |
| ai-usage-recording | 5 | 11 | 8 | 未逐條核 | 平台用量頁 |
| agentic-llm-orchestration | 5 | 11 | 11 | 未逐條核（本機 `AGENTIC_LLM_ENABLED` 未開） | `/ai/agent/run`、`/ai/agent/runs/:id` 沒有前端 |
| bot-handoff-config | 6 | 16 | 13 | 未逐條核；「KB auto-reply attaches handoff prompt」的分流在 `buildKbReplyPayload` | 渠道 BotConfig 表單 |

**沒有主規格的行為**：KB 自動回覆的分流（0.80、`clarifyThreshold`、`clarifyMaxAttempts`、追問用完轉接）、型號守門、KB 回報、CSV/Excel 自動拆問答、文章 CRUD 與狀態機。這些只寫在 `docs/ref/features/tenant/KNOWLEDGE.md`。HC-KNOWLEDGE-01、02、03 都落在這一塊，建議補規格時一併寫成可測的 scenario。

**有後端、沒有前端入口**：`POST /knowledge/:id/embed`（單篇重新向量化）、`GET /knowledge/embedding-status`、`GET /knowledge/models`（前端只有重建按鈕，看不到清單）、`GET /knowledge/feedback/counts`（`useKbFeedbackCounts` 有定義但沒有元件使用，文章列表不顯示被回報次數）、`/ai/classify`、`/ai/analyze-sentiment`、`/ai/agent/*`。

**前端送出的值與後端 Zod**：文章表單送 `category || '一般'`、tags 以逗號切開；JSON 匯入送 `{articles: <陣列>}`；設定頁滑桿 temperature 0–1、maxTokens 50–2000、topK 1–20、threshold 0–1、clarifyMaxAttempts 0–5，都在後端範圍內。沒有發現前端送出、後端拒絕的值。

## 待真機驗

- KB 自動回覆走完整路徑：LINE／FB 進站 → workers `message.received` → `checkAutoHandoff` → Agent 或 `attemptKbAutoReply` → 真實渠道投遞。特別是 HC-KNOWLEDGE-01 在真實對話裡，客人收到幾次「已為您轉接」才真正轉接（取決於渠道 `maxBotReplies`）。
- 「👎 沒幫到我」與轉接按鈕在 LINE、FB、IG、WebChat 的顯示與點按（quick reply postback）。
- 真實 LLM（Gemini）下的型號守門文案：「Wi-Fi」被當型號時客人實際看到的內容。
- 月額度用完時客人實際收到的內容（HC-KNOWLEDGE-04）。
- UAT 的 Chat & Prompt、Embedding 設定頁畫面（本次只做 API 唯讀，沒有開頁面，避免觸發 Gemini 健康檢查）。
- 夥伴系統以 `pk_` 金鑰推送 CREATE／UPDATE／DELETE。

## 本機操作紀錄

- 建立的資料：文章 13 篇、聯絡人 2 位與對話 2 段（健檢腳本）、KB 回報 3 筆、`ai_usages` 6 筆（假模型 `mock`，成本 0、無 token 數）、自訂角色 2 個與帳號 2 個。全部以 SQL 刪除，並呼叫 `POST /knowledge/models/refresh` 讓型號快取回到 0。
- 沒有改租戶的 Chat、Embedding 設定，也沒有改 Redis 的額度計數器。

## UAT 操作紀錄

只用 `admin@open333crm.dev` 登入 Demo 租戶，`/auth/me` 確認 tenantId 為 `a0000000-0000-0000-0000-000000000001`。只做 GET：文章列表、型號清單、回報清單、分類、`embedding-status`、`page=0` 與非 UUID 的錯誤案例。沒有建立、修改或刪除任何資料，沒有觸發 AI 回覆或語義搜尋。持鎖約 1 分鐘。

## 建議新增到 AUDIT.md 的項目

- HC-KNOWLEDGE-01：追問次數用完時回覆「已為您轉接」但不轉接。
- HC-KNOWLEDGE-02：型號守門正規式誤判一般英文詞，且對所有租戶生效。
- HC-KNOWLEDGE-03：無 BOM 的 UTF-8 CSV（與 Big5 CSV）匯入變亂碼，問答表會直接發布。
- HC-KNOWLEDGE-04：LLM 失敗或額度用完時把文章原文直接送給客人。
- HC-KNOWLEDGE-05：知識庫寫入按鈕不依權限隱藏（可與 RBAC-01 一起處理）。
- LLM-04 的影響描述改成條件式（UAT 目前靠 Compose 的 Ollama 正常產生向量）。

## 文件過時之處

- `docs/ref/features/tenant/KNOWLEDGE.md`「機器人怎麼用知識庫回答」寫「追問次數達到 `clarifyMaxAttempts` 後轉真人」：程式只回一句轉接文字，不改對話狀態（HC-KNOWLEDGE-01）。
- `docs/ref/features/tenant/KNOWLEDGE.md` 的「目前的限制」與 AUDIT LLM-04 寫 Embedding 在組織內一律失敗：UAT Demo 租戶目前正常。
- `docs/ref/features/tenant/KNOWLEDGE.md`「匯入」沒寫 CSV/Excel 拆出的問答**直接發布**，也沒寫 CSV 要 UTF-8 BOM。
- `docs/ref/features/tenant/KNOWLEDGE.md` 沒提到型號守門對所有租戶生效、以及白名單從「已發布文章標題」抽取。
- 手冊 `apps/web/public/manual/ch06-knowledge.html`「匯入文章」：CSV 沒有提醒要存成「CSV UTF-8」；第 1 節「知識庫裡沒有的，AI 不會亂編，而是請客人轉給真人」與第 8 節「問不清楚再轉真人」與實際行為不符。
- 手冊 `apps/web/public/manual/ch07-ai-settings.html`「多輪追問」寫「最大追問次數：超過就自動轉給真人客服」，同上不符。
- `openspec/specs/km-ingestion/spec.md` 的前兩條需求（2md、語音、LanceDB）與程式不符，應改寫或移除。
- `chat-settings.service.ts` 的 `DEFAULT_CHAT_SETTINGS.temperature` 是 0.2，資料庫預設與手冊是 0.3。
