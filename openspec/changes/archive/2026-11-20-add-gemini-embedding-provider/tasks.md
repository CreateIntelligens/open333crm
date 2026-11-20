## 1. 資料庫

- [x] 1.1 schema：`TenantSettings` 新增 `embeddingProvider String @default("ollama")`。
- [x] 1.2 migration `20261119120000_add_embedding_provider`（每一段都可以重複執行）：步驟 0 把不是 1024 維的 `km_articles.embedding` 清空後改成 `vector(1024)`（design D7）；新增欄位；`embedding` 不是空值、`embeddingModel` 是空值或空字串的文章，補上該租戶 `tenant_settings.embeddingModel`（沒有設定列時用 `bge-m3`）；`model_pricings` 新增 `gemini-embedding-001`（輸入 0.15、輸出 0、cached 0），已存在時不重複新增。
- [x] 1.3 `seed.ts` 的 `seedModelPricing` 加入 `gemini-embedding-001`。
- [x] 1.4 `pnpm db:generate`。feature 測試資料庫套用 migration 後，`km_articles.embedding` 是 `vector(1024)`，價格列存在。`apps/api/tests/support/fake-ollama.ts` 的假向量改成 1024 維。

## 2. 設定：服務欄位與驗證

- [x] 2.1 測試先寫（`apps/api/tests/feature/modules/settings/embedding-settings.test.ts`）：「沒有設定列時回預設值」改為也檢查 `settings.provider` 是 `ollama`；新增「改成 Gemini」「Gemini 搭配不支援的模型」。修改前 5 個測試失敗在斷言上。
- [x] 2.2 實作：`EmbeddingSettings` 新增 `provider`；`DEFAULT_EMBEDDING_SETTINGS.provider = 'ollama'`；`updateEmbeddingSettings()` 寫入 `embeddingProvider`，`modelChanged` 在服務或模型改變時是 true；合併目前設定與這次的修改後檢查，Gemini 只能搭配 `gemini-embedding-001`，否則丟 400 `VALIDATION_ERROR`；route 的 Zod schema 新增 `provider`。
- [x] 2.3 既有情境「有設定列時回已存的值」「只讀到本租戶的設定」「換模型」「沒有設定列時建立」「稽核寫入失敗時設定不變」的測試不改斷言，仍然通過。

## 3. Gemini 向量化 client

- [x] 3.1 測試先寫（`apps/api/tests/unit/modules/embedding/embedding-gemini.test.ts`，以假 `fetch` 為邊界）：「文章以 Gemini 向量化」「搜尋以 Gemini 向量化查詢文字」「長文章只送前 2000 字」、HTTP 400 丟錯而且不重試、HTTP 429 重試 1 次、向量長度不是 1024 時丟錯、沒有金鑰時不呼叫 Gemini、Ollama 照舊呼叫 `/api/embed`。修改前 7 個測試失敗在斷言上。
- [x] 3.2 實作：`EmbeddingTarget` 新增 `provider`、`apiKey?`、`purpose`；`embedText()` 依 `provider` 分流；Gemini 呼叫沿用 `gemini.provider.ts` 的 `GEMINI_BASE`（改成 export）。
- [x] 3.3 既有 `embedding-timeout.test.ts` 不改斷言，仍然通過。

## 4. 金鑰、額度與用量

- [x] 4.1 測試先寫（`apps/api/tests/feature/modules/embedding/embedding-gemini.test.ts`，`app_tenant` 連線、真的 Redis、假的 Gemini fetch）：「文章以 Gemini 向量化」「搜尋以 Gemini 向量化查詢文字」「使用租戶的自備金鑰」「Gemini 回錯誤時文章的向量不變」「Gemini 向量化寫入用量」「Gemini 向量化的用量標記」「額度已滿時不呼叫 Gemini」「Gemini 向量化達到上限」「Ollama 向量化不寫用量」。原本計畫寫成單元測試，改成 feature 測試：用量紀錄與額度檢查要經過 `inTenant`、RLS 與 Redis 計數器，mock 會藏住這些層的問題。修改前 8 個測試失敗在斷言上（回 500）。
- [x] 4.2 實作：`AiFeature` 新增 `embedding`；`readLlmInputs()` 讀金鑰與月額度上限的部分抽成 `readModelKeyInputs()`；`prepareLlmCall()` 的額度檢查抽成 `assertMonthlyQuota()`；`recordLlmUsage()` 的參數型別放寬；`readEmbeddingInputs()` 在 Gemini 時讀金鑰與上限；`embedding.flow.ts` 新增 `embedWithUsage()`。
- [x] 4.3 向量化 flow 的 `deps` 改成 `EmbeddingDeps`（`LlmDeps`），更新呼叫端：`knowledge-effects.ts`、`knowledge.flow.ts`、`knowledge.routes.ts`、`ai.flow.ts`、`kb-autoreply.flow.ts`（AI 自動回覆改用 `embedWithUsage()`，`purpose: 'query'`）。測試的 knowledge app 與 `embed-article.test.ts` 跟著傳入 Redis 與 outbox。
- [x] 4.4 4.1 的 feature 測試已以 `app_tenant` 連線寫入 `AiUsage`，`keySource` 正確。

## 5. 搜尋只比對目前模型

- [x] 5.1 測試先寫：「換服務後舊向量不進搜尋結果」「不比對其他租戶的文章」（`knowledge-embedding-routes.test.ts`）、「換服務後統計顯示要重新嵌入」（`embedding-settings.test.ts`）。修改前前兩個新情境中的「換服務後舊向量不進搜尋結果」與統計情境失敗在斷言上。
- [x] 5.2 實作：`searchSimilarArticles()` 與 `getEmbeddingStats()` 加上 `"embeddingModel" = 目前模型`；語意搜尋與 `kb-autoreply` 的 `searchKbArticles()` 帶入目前模型。原本把模型名稱寫成 `'seed'` 的測試資料（`knowledge-embedding-routes.test.ts`、`ai-routes.test.ts`）依新規格改成租戶目前的模型 `bge-m3`。
- [x] 5.3 migration 補值測試（`apps/api/tests/feature/migrations/backfill-embedding-model.test.ts`）：讀出 migration 的 `-- @backfill` 區段，在會回滾的交易內執行並檢查。

- [x] 5.4 PR 審查修正：測試先寫（`embed-article.test.ts`「舊模型的向量不覆蓋目前模型的向量」），修改前失敗在斷言上（文章的向量被 `bge-m3` 的結果覆蓋）。實作：`writeArticleEmbedding()` 鎖住文章後比對目前模型，舊模型的結果不覆蓋目前模型的向量。

突變驗證（測試寫好時已經通過的情境）：

- 「不比對其他租戶的文章」：既有行為。拿掉 `searchSimilarArticles()` 的 `"tenantId"` 條件時測試仍然通過，因為 `app_tenant` 連線的 RLS 也擋住其他租戶的列。兩層隔離給同一個結果，這是 AGENTS.md 要求的兩層設計，不是測試的缺陷。
- migration 補值：把補值條件改成只補 `IS NULL`（漏掉空字串）時，測試失敗；還原後通過。

## 6. 健康檢查

- [x] 6.1 測試先寫（`embedding-settings.test.ts`）：「Gemini 沒有金鑰」（斷言沒有呼叫 Gemini）「Gemini 正常」。修改前 2 個測試失敗在斷言上。既有三個 Ollama 情境不改斷言。
- [x] 6.2 實作：`probeEmbeddingService()` 改收 `EmbeddingProbeTarget`，依服務分流；`embedding.service.ts` 新增 `readEmbeddingProbeTarget()`，Gemini 時讀金鑰；兩個端點的回應格式不變。

## 7. 前端

- [x] 7.1 測試先寫（`apps/web/tests/unit/components/knowledge/embedding-provider.test.tsx`，jsdom）：選 Gemini 時隱藏網址欄位、模型顯示 `gemini-embedding-001`、顯示用量說明；換成 Gemini 儲存時確認後送出 `provider: 'gemini'`；目前是 Gemini 時狀態卡片不寫 Ollama。修改前 3 個測試失敗（找不到「向量化服務」選單）。
- [x] 7.2 實作 `EmbeddingSettings.tsx`：「向量化服務」選單、Gemini 說明文字、狀態卡片標題、換服務時的確認視窗標題。沒有 emoji。

## 8. 文件

- [x] 8.1 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 與 `.claude/skills/feature-knowledge/SKILL.md`。
- [x] 8.2 `docs/ref/system/AUDIT.md` 的 LLM-04、DB-01 改成「部分修正」，`docs/ref/system/AUDIT-REVIEWS.md` 新增紀錄。`feature-map.json` 的路徑與資料表沒有改變。

## 9. 完成定義

- [x] 9.1 `pnpm test`：這個 change 的測試全部通過。另有 3 個失敗在 main 上就存在，與這個 change 無關：`case-ui-source.test.ts`、`portal/datetime-timezone.test.ts`、`url-scheme-validation.test.ts` 讀的 `apps/web` 檔案（例如 `components/shortlink/LinkFormDialog.tsx`）已被前端改版刪除。`storage-presign-purpose.test.ts` 在整批執行時 `beforeAll` 逾時，單獨執行通過。
- [x] 9.2 `pnpm test:feature`：1898 個通過。1 個失敗在 main 上就存在，與這個 change 無關：`scripts/dedupe-sla-events.test.ts` 讀 `SLA.md` 的「### 還原」段落，找不到 SQL 區塊。
- [x] 9.3 `pnpm build` 通過（13/13）。
- [x] 9.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 都沒有新增違規。
- [x] 9.5 結構規則（`structure-reviewer` 在這個工作環境無法使用，改為逐條自查）：新的 service 函式都收 `TenantCtx`；Gemini 呼叫在交易外（`embedWithUsage()`），用量紀錄在自己的交易內寫入（`recordLlmUsage()`）；service 沒有新增 Redis 或 LLM client 的 import（`check-tenant-ctx` 的計數不變）；route 只組依賴與呼叫 flow。
- [x] 9.6 `node scripts/feature-impact.mjs` 的知識庫區回歸清單：自動化測試已涵蓋文章向量化、語意搜尋、自動回覆與設定頁。2026-11-20 在 UAT 的 Demo 租戶手動檢查：設定頁切換成 Gemini、重新嵌入全部後 206 篇都是 `gemini-embedding-001` 的向量，`ai_usages` 以 `feature: embedding`、`keySource: byok` 記錄；WebChat 15 題中 12 題由知識庫回答並附上文章連結（AI agent 關閉後，change `disable-agent-by-default`）。第一次重新嵌入有 146 篇因去識別化服務拒絕請求而失敗，暫時關閉 Demo 的去識別化後重新嵌入成功；去識別化服務的拒絕不重試，另外處理。
- [x] 9.7 `CHANGELOG.md` 在 `## [2026-11-19]` 新增條目。
- [x] 9.8 `node scripts/validate-openspec.mjs add-gemini-embedding-provider` 與 `node scripts/validate-openspec.mjs --specs` 通過。
- [x] 9.9 `node scripts/check-doc-history.mjs --strict` 通過。
- [x] 9.10 9.6 完成後，以 `pnpm exec openspec archive` 歸檔。
