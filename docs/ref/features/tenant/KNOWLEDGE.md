# 知識庫與 AI

知識庫是租戶整理的問答與文件。機器人回答客人時先查知識庫，找到相關文章才讓 LLM 依文章內容回答；找不到就追問，追問幾次仍不清楚就轉給真人。AI 的模型、位址與提示詞由租戶自己設定。

- **資料來源**：`apps/api/src/modules/knowledge/*`、`apps/api/src/modules/embedding/*`、`apps/api/src/modules/ai/*`、`apps/api/src/modules/settings/chat-settings.service.ts`、`apps/api/src/modules/settings/embedding-settings.service.ts`、`apps/api/src/modules/trial/token-quota.service.ts`、`apps/api/src/config/env.ts`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `knowledge` | 文章的 CRUD、發布與封存、檔案匯入、批次產生向量、語意搜尋、型號白名單、客人回報、夥伴系統匯入 |
| `embedding` | 產生向量與 pgvector 相似度檢索。沒有路由 |
| `ai` 的 `kb-autoreply.service.ts` | 機器人依知識庫回覆 |
| `ai` 的 `agent/` | AI agent：可以呼叫工具（搜尋網頁、讀網頁、OCR、解析文件、查天氣、發布 Wiki）的多輪回覆 |
| `ai` 的 `llm.service.ts`、`providers/` | 呼叫 LLM。支援 Ollama 與 Gemini；組織不部署 Ollama，因此只能用 Gemini |
| `ai` 的 `ai-key.service.ts` | 決定用平台的 Gemini 金鑰還是租戶自備的金鑰 |
| `settings` 的 chat、embedding、gemini-key 部分 | 租戶的 Chat 設定、Embedding 設定與自備金鑰 |
| `trial` 的 `token-quota.service.ts` | AI 月額度的計數與告警 |

側欄「知識庫」底下有文章管理、語義搜尋、回報調教，以及「AI 設定」的 Embedding 與 Chat & Prompt 兩頁。

## 文章

文章（`KmArticle`）有三種狀態：

| 狀態 | 機器人會檢索 | 怎麼進入 |
| --- | --- | --- |
| `DRAFT` | 否 | 新建立的文章 |
| `PUBLISHED` | 是 | `POST /knowledge/:id/publish` |
| `ARCHIVED` | 否 | `POST /knowledge/:id/archive`，或夥伴系統送來刪除指令 |

`DELETE /knowledge/:id` 是硬刪除。

**向量什麼時候產生。** 建立文章、以及改了標題、內容或摘要時，系統在背景重新產生向量；發布時若還沒有向量，也會在背景補產生。這三個時機都不等待結果，失敗只記 log。因此文章可能顯示為已發布，卻因為沒有向量而檢索不到。`GET /knowledge/embedding-status` 列出向量的狀態，`POST /knowledge/bulk-embed` 與 `POST /knowledge/:id/embed` 可以補產生。

向量的維度有已知落差：程式與 schema 用 1024 維，部分環境的資料庫欄位是 1536 維，寫入會被拒絕，見 `../../system/AUDIT.md` 的 DB-01。

## 匯入

| 方式 | 端點 | 說明 |
| --- | --- | --- |
| 上傳檔案 | `POST /knowledge/upload` | 支援 PDF、Word、Excel、CSV、HTML、Markdown 與純文字。`file-parser.service.ts` 轉成 Markdown；Excel 與 CSV 會嘗試拆成一列一篇問答 |
| 批次匯入 | `POST /knowledge/import` | 一次送多篇文章 |
| 夥伴系統推送 | `POST /knowledge/partner-ingest` | 見下方 |

**夥伴系統推送。** 外部系統以 `pk_` 開頭的長效 API 金鑰逐篇推送文件。金鑰在「設定 → API 金鑰」建立。行為由 `partner-ingest.service.ts` 決定：

- 請求的 `cmd` 決定動作：`CREATE`、`UPDATE` 或 `DELETE`。
- 以外部文件 ID（`externalDocId`）對應文章。收到的版本號小於等於現有版本時略過，避免亂序重送把新版蓋成舊版。
- `DELETE` 只把文章改成 `ARCHIVED`，附件保留。

## 機器人怎麼用知識庫回答

對話由機器人負責、而且渠道的 `botMode` 是 `llm` 或 `keyword_then_llm` 時，`attemptKbAutoReply()` 依序處理客人的文字訊息：

1. **檢查開關**。環境變數 `KB_AUTO_REPLY_ENABLED` 為 `false` 時整個功能關閉。這是整個部署共用的開關。
2. **讓步給關鍵字**。訊息會命中關鍵字規則時不回覆。
3. **讀取對話紀錄**。取最近的訊息作為上下文，讓追問不會重複已經回答過的內容。
4. **檢索**。產生訊息的向量，找出相似度達到門檻的前幾篇文章。篇數與門檻是 Embedding 設定的 `topK` 與 `threshold`。
5. **型號守門**。客人提到的型號不在型號白名單、相似度又不夠高時，不硬答，改列出相近型號請客人確認。型號白名單從文章中抽出，快取一段時間；`POST /knowledge/models/refresh` 可以立即重建。
6. **決定回覆方式**：

| 最高相似度 | 回覆 |
| --- | --- |
| 0.80 以上 | 以文章內容為依據，由 LLM 回答 |
| `clarifyThreshold` 到 0.80 之間 | 同樣回答，並在後面附上轉接客服的提示 |
| 低於 `clarifyThreshold`，或沒有文章 | 追問一個問題。追問次數達到 `clarifyMaxAttempts` 後轉真人 |

`0.80` 是 `kb-autoreply.service.ts` 裡的常數；`clarifyThreshold` 與 `clarifyMaxAttempts` 是 Chat 設定的欄位。追問次數記在對話的 `metadata`，成功回答一次就歸零。

依文章回答的訊息會附上「👎 沒幫到我」快速回覆按鈕；追問與型號守門的回覆沒有這個按鈕。客人按下後，進站攔截器把回饋記到 `KbArticleFeedback`，並回一則感謝訊息。管理員在「知識庫 → 回報調教」查看各文章的回報，並標記為已處理。

**AI agent 優先。** 環境變數 `AGENTIC_LLM_ENABLED` 為 `true` 時，機器人先交給 AI agent 回覆；AI agent 沒有處理時，才走上面的知識庫流程。AI agent 可以呼叫外部工具，執行紀錄存在 `AgentRun`，可以用 `GET /ai/agent/runs/:id` 查看。

## AI 設定

Chat 與 Embedding 的設定都是租戶層級，存在 `TenantSettings`。第一次讀取時，若該租戶還沒有這一列，會以預設值建立。

| 設定 | 欄位 | 預設值的位置 |
| --- | --- | --- |
| Chat（Chat & Prompt 頁） | 供應商（Ollama 或 Gemini）、模型、位址、溫度、最大 token、系統提示詞、追問門檻與次數 | `chat-settings.service.ts` 的 `DEFAULT_CHAT_SETTINGS` |
| Embedding（Embedding 頁） | 位址、模型、`topK`、`threshold` | `embedding-settings.service.ts` 的 `DEFAULT_EMBEDDING_SETTINGS` |

兩頁都有健康檢查（`/settings/chat/health`、`/settings/embedding/health`），用來確認模型位址連得上。

兩頁的預設值都指向 Ollama，但組織不部署 Ollama。Chat 可以把供應商改成 Gemini；Embedding 沒有供應商可選，只會呼叫 Ollama。見 `../../system/AUDIT.md` 的 LLM-01 與 LLM-04。

**自備金鑰（BYOK）。** 租戶可以在設定頁填入自己的 Gemini 金鑰（`PUT /settings/gemini-key`），金鑰加密後存在 `TenantSettings.geminiApiKeyEnc`。有自備金鑰時，AI 呼叫用租戶的金鑰，成本記 0，也不受月額度限制。解密失敗時會靜默改用平台金鑰，見 `../../system/AUDIT.md` 的 AI-01。

**兩個部署層級的開關。** `KB_AUTO_REPLY_ENABLED` 與 `AGENTIC_LLM_ENABLED` 是環境變數，所有租戶共用，租戶不能各自開關。租戶要關掉機器人，只能把各渠道的 `botMode` 設成 `off` 或 `keyword`。

## 額度

使用平台金鑰時，每次成功的 AI 呼叫把 token 數累加到該租戶當月的計數器。Ollama 的成本記 0，但同樣會累加。`llm.service.ts` 與 AI agent 在呼叫前以 `isMonthlyTokenExceeded()` 檢查，超過月額度就不呼叫 LLM。用量達 80% 與 100% 時通知租戶的 `ADMIN` 並寄信，見[通知](./NOTIFICATIONS.md)。

額度的上限怎麼算、加購怎麼影響額度，見平台後台的[方案與上限](../platform/PLANS.md)；成本怎麼算，見[用量統計](../platform/USAGE.md)。

## 權限

| 路由 | 權限 |
| --- | --- |
| 文章清單、單篇、分類、來源、語意搜尋、向量狀態、型號清單、回報清單 | 只驗登入 |
| 建立、修改、刪除、發布、封存、上傳、批次匯入、產生向量 | `knowledge.manage` |
| 夥伴系統推送、重建型號白名單、標記回報已處理 | `knowledge.admin` |
| Chat、Embedding、自備金鑰的設定 | `settings.manage` |

側欄的「知識庫」要求 `knowledge.view`，但讀取類的路由只驗登入，沒有檢查這個權限碼，也不受方案的功能天花板限制。見 `../../system/AUDIT.md` 的 RBAC-01。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 向量在背景產生，失敗不會通知 | 已發布的文章可能檢索不到，要從向量狀態自行檢查 |
| 向量維度不一致 | 詳見 `../../system/AUDIT.md` 的 DB-01 |
| Embedding 只能呼叫 Ollama，組織不部署 Ollama | 產生向量、檢索、自動回覆、AI 建議回覆都會失敗。自動回覆失敗時不回覆客人，也不轉真人。詳見 `../../system/AUDIT.md` 的 LLM-04 |
| Chat 的預設供應商是 Ollama | 新租戶要先把 Chat 供應商改成 Gemini。詳見 `../../system/AUDIT.md` 的 LLM-01 |
| 自備金鑰解密失敗時靜默改用平台金鑰 | 詳見 `../../system/AUDIT.md` 的 AI-01 |
| AI 不在方案的功能天花板內 | 詳見 `../../system/AUDIT.md` 的 PLAN-12 |
| 讀取類路由沒有權限碼 | 側欄要求 `knowledge.view`，API 不檢查。詳見 `../../system/AUDIT.md` 的 RBAC-01 |
| 網頁登入的成員呼叫夥伴推送端點一律 403 | 詳見 `../../system/AUDIT.md` 的 AUTH-06 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
