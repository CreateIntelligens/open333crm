## Context

`embedText()`（`apps/api/src/modules/embedding/embedding-client.ts`）只呼叫 Ollama 的 `/api/embed`。設定（`EmbeddingSettings`）只有網址、模型、topK、門檻。四個地方會呼叫向量化：

- 文章向量化：`embedArticleFlow()`。匯入、新增、修改文章後，`knowledge-effects.ts` 在背景呼叫它。
- 全部重新向量化：`reembedPublishedArticlesFlow()`。
- 語意搜尋：`searchArticlesByTextFlow()`。知識庫搜尋頁與 AI 建議回覆會呼叫它。
- AI 自動回覆：`kb-autoreply.flow.ts` 直接呼叫 `embedText()`。

AI 對話已有 Gemini 的金鑰規則（`resolveGeminiKey()`），也已有用量與額度機制（`prepareLlmCall()`、`recordLlmUsage()`，在 `llm.flow.ts`）。

## Goals / Non-Goals

**Goals：**
- 每個租戶可以選 Ollama 或 Gemini 向量化。
- Gemini 向量化遵守 AI 呼叫的平台規則：記錄用量、檢查月額度、套用隱私政策、有價格。
- 換服務後，搜尋結果不會混入舊模型的向量。

**Non-Goals：**
- 不改向量欄位的維度（維持 `vector(1024)`）。
- 不限制匯入時同時向量化的篇數，另外處理。
- 不新增 Gemini 以外的雲端服務。

## Decisions

### D1：設定新增 `embeddingProvider` 欄位

`tenant_settings` 新增 `embeddingProvider`（`ollama` | `gemini`，預設 `ollama`）。`EmbeddingSettings` 新增 `provider`。

- 選 `gemini` 時，模型只能是 `gemini-embedding-001`。API 用 Zod 檢查。服務和模型不搭配時回 400。
- 選 `gemini` 時，網址欄位不使用，但保留原值。改回 Ollama 時，租戶不需要重填網址。
- 回應的 `modelChanged`：服務或模型有一項改變時是 true。

替代方案：從模型名稱推斷服務（模型名稱以 `gemini-` 開頭就是 Gemini）。不採用的原因：Ollama 的模型名稱可以任意命名，推斷結果不可靠。

### D2：`embedText()` 依服務分流，Gemini 輸出 1024 維

`EmbeddingTarget` 新增 `provider`、`apiKey?`、`purpose`（`document` | `query`）。

Gemini 呼叫 `POST {GEMINI_BASE}/models/gemini-embedding-001:embedContent`，body 帶：
- `outputDimensionality: 1024`，和資料庫欄位一致。
- `taskType`：文章用 `RETRIEVAL_DOCUMENT`，搜尋與自動回覆的客人訊息用 `RETRIEVAL_QUERY`。

搜尋用 cosine 距離（`<=>`），和向量長度無關，所以不需要正規化 1024 維的向量。

`gemini-embedding-001` 的輸入上限是 2048 token。`embedText()` 在呼叫 Gemini 前把文字截到 2000 字。截斷只發生在 client 內，`prepareArticleText()` 的結果不變。所以 `writeArticleEmbedding()` 比對的文字（`sourceText`）不受影響。

逾時與重試：Gemini 沒有模型載入的冷啟動。逾時設 25 秒，HTTP 429 與 5xx 重試 1 次，和 Ollama 的最壞耗時預算相同（51 秒）。

### D3：金鑰、額度與用量沿用 LLM 的機制

新增 `prepareEmbeddingCall(deps, tenantId)`，放在 `embedding.flow.ts`：

1. 交易內讀向量化設定、隱私政策。服務是 Gemini 時，也讀金鑰（`resolveGeminiKey()`）和月額度上限（沿用 `readLlmInputs()` 讀上限的方式）。
2. 交易外：服務是 Gemini 且用平台金鑰時，用 `isMonthlyTokenExceeded()` 檢查額度。額度已滿時丟 403 `PLAN_LIMIT_EXCEEDED`，不呼叫 Gemini。
3. 呼叫 Gemini 後，用 `recordLlmUsage()` 寫 `AiUsage`：`provider: 'gemini'`、`model: 'gemini-embedding-001'`、`feature: 'embedding'`。

Gemini 的 `embedContent` 回應沒有 token 數。系統用輸入字數估算 `promptTokens`（1 字算 1 token，中文的估算偏高，不會少算）。`outputTokens` 是 0。

服務是 Ollama 時不讀金鑰、不檢查額度、不寫 `AiUsage`。這和現在的行為相同。

向量化 flow 的 `deps` 從 `{ prisma }` 改成 `LlmDeps`（`prisma`、`redis`、`events`）。呼叫端（`knowledge-effects.ts`、`knowledge.flow.ts`、`ai.flow.ts`、`kb-autoreply.flow.ts`）已經有這三項依賴，只是沒有傳下去。

額度已滿時的行為：
- 背景向量化（匯入、修改文章）失敗。系統記 log，文章沒有向量。這和現在向量化失敗的處理相同。
- AI 自動回覆的向量化失敗時，`kb-autoreply.flow.ts` 已經會轉真人，不另外改。
- 搜尋頁收到 403，顯示錯誤訊息。

### D4：搜尋只比對目前模型的向量

`searchSimilarArticles()` 新增條件 `"embeddingModel" = $model`。`getEmbeddingStats()` 的「已向量化」也只計目前模型的向量。

換服務後，頁面顯示「未向量化」的篇數等於全部文章數。租戶按「重新嵌入全部」後，搜尋才找得到文章。在重新嵌入完成之前，搜尋只找得到已用新模型嵌入的文章。這比混入不同模型的向量好：不同模型的向量維度相同，但相似度沒有意義，搜尋會找到不相關的文章，而且不顯示錯誤。

migration 補資料：`embedding` 不是空值、`embeddingModel` 是空值或空字串的文章，`embeddingModel` 改成該租戶 `tenant_settings.embeddingModel`。沒有設定列時，用 `bge-m3`。這些文章都是在只有 Ollama 時嵌入的，所以這樣補是對的。補完後，D4 的過濾條件不會丟掉既有的向量。

### D5：健康檢查

`probeEmbeddingService()` 依服務分流：
- Ollama：維持 `/api/tags` 的判斷。
- Gemini：沒有金鑰時回「未設定 Gemini 金鑰」，不送請求。有金鑰時呼叫 `GET {GEMINI_BASE}/models/gemini-embedding-001`。回 200 算正常，其他狀態算連不到，訊息帶上 HTTP 狀態碼。

兩個健康檢查端點的回應格式不變。

### D6：前端

`EmbeddingSettings.tsx` 新增「向量化服務」下拉選單：
- 選 Gemini 時，隱藏網址欄位，模型固定顯示 `gemini-embedding-001`，並顯示說明：Gemini 會用到 AI 額度；沒有自備金鑰時使用平台金鑰。
- 儲存後 `modelChanged` 是 true 時，沿用現有的提示，請使用者重新嵌入全部文章。

## Risks / Trade-offs

- [估算的 token 數不準] → 1 字算 1 token，估算偏高，平台不會少收。`gemini-embedding-001` 每 1M token 0.15 美元，誤差的金額很小。
- [換服務後到重新嵌入完成前，AI 自動回覆找不到文章，會轉真人] → 設定頁提示要重新嵌入。1000 篇文章用 Gemini 重新嵌入約 5 到 10 分鐘。
- [Gemini 有每分鐘請求數限制] → 重新嵌入是逐篇處理。遇到 429 時重試 1 次。仍失敗時，該篇記 log，繼續下一篇。租戶可以再按一次「重新嵌入全部」。
- [UAT 沒有設定平台的 Gemini 金鑰] → 租戶沒有 BYOK 時，健康檢查會顯示「未設定 Gemini 金鑰」。租戶要先填自備金鑰，或由平台設定 `GEMINI_API_KEY`。

## Migration Plan

1. migration：新增欄位（預設 `ollama`）、補空值的模型名稱、新增價格列。這三項都可以重複執行。
2. 部署後，所有租戶仍用 Ollama，行為不變。
3. 租戶在設定頁改成 Gemini，再按「重新嵌入全部」。

回復方式：設定改回 Ollama，再重新嵌入。欄位保留，不需要回復 migration。
