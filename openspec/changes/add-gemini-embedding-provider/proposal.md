## Why

向量化目前只能用 Ollama。UAT 的 Ollama 只用 CPU。一次匯入 206 篇文章時，Ollama 逾時，206 篇都沒有向量（2026-11-19 實測）。AI 客服搜不到沒有向量的文章。

租戶要能改用 Gemini 向量化。Gemini 是雲端服務，不佔 UAT 主機的 CPU。

## What Changes

- 「Embedding 設定」頁新增「向量化服務」選項：Ollama 或 Gemini。預設是 Ollama。既有租戶的行為不變。
- 選 Gemini 時，系統用 `gemini-embedding-001` 模型，輸出 1024 維向量。資料庫的向量欄位不變。
- Gemini 的金鑰沿用 AI 對話的規則：先用租戶自備的金鑰（BYOK），沒有時用平台金鑰。
- 健康檢查支援 Gemini：沒有金鑰或連不到時回 `ok: false`，並說明原因。
- 語意搜尋只比對「目前模型」產生的向量。換服務或換模型後，舊向量不會混進搜尋結果。統計數字只計目前模型的向量，所以頁面會顯示要重新嵌入的篇數。
- 一次性 migration：已有向量、但 `embeddingModel` 是空值的文章，補上該租戶目前的模型名稱。補完後，搜尋的過濾條件不會丟掉這些文章。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `embedding-settings`：設定新增服務欄位；健康檢查支援 Gemini；新增 Gemini 向量化、用量與月額度、只比對目前模型三項需求。

## Platform layer

這個 change 呼叫 AI 模型，所以 AGENTS.md 表格的「calls an AI model」這一列適用：

- 每次用平台金鑰或 BYOK 呼叫 Gemini 向量化，系統都用 `recordLlmUsage()` 記一筆用量。`AiFeature` 新增 `embedding`。
- 平台金鑰的呼叫先檢查月額度。額度已滿時不呼叫 Gemini。BYOK 不檢查額度，與 AI 對話相同。
- 呼叫前，文字依租戶的 AI 隱私政策去識別化。現有的 `embedText()` 已經這樣做，這個 change 保留這一步。
- migration 新增 `gemini-embedding-001` 的價格列（輸入每 1M token 0.15 美元，沒有輸出價）。沒有價格列時，用量的成本會記成 0。

表格的其他列不適用：這個 change 不新增權限、功能區、方案上限、渠道類型、平台稽核動作、佇列，也不新增租戶和平台之間的申請。向量化服務是租戶自己的設定，平台不需要另外的頁面控制它。

## Impact

- API：`apps/api/src/modules/embedding/`（client、flow、service）、`apps/api/src/modules/settings/embedding-settings.*`、`apps/api/src/modules/ai/kb-autoreply.flow.ts`、`apps/api/src/modules/ai/llm.service.ts`（`AiFeature`）。
- 呼叫向量化 flow 的地方要多傳 `redis` 與 `events`，用來檢查額度與記錄用量：`knowledge-effects.ts`、`knowledge.flow.ts`、`ai.flow.ts`。
- 資料庫：`tenant_settings` 新增 `embeddingProvider` 欄位（預設 `ollama`）。補空值的模型名稱。新增價格列。
- 前端：`apps/web/src/components/knowledge/EmbeddingSettings.tsx`。
- 不在範圍內：匯入時每篇文章同時向量化，會讓 Ollama 一次收到太多請求。這是另一個問題，另外開 issue。
