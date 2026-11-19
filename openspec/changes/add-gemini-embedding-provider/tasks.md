## 1. 資料庫

- [ ] 1.1 schema：`TenantSettings` 新增 `embeddingProvider String @default("ollama")`。
- [ ] 1.2 migration（可重複執行）：新增欄位；`embedding` 不是空值、`embeddingModel` 是空值或空字串的文章，補上該租戶 `tenant_settings.embeddingModel`（沒有設定列時用 `bge-m3`）；`model_pricings` 新增 `gemini-embedding-001`（輸入 0.15、輸出 0、cached 0），已存在時不重複新增。
- [ ] 1.3 `seed.ts` 的 `seedModelPricing` 加入 `gemini-embedding-001`。
- [ ] 1.4 `pnpm db:generate`，本機套用 migration。

## 2. 設定：服務欄位與驗證

- [ ] 2.1 測試先寫（`apps/api/tests/feature/modules/settings/embedding-settings.test.ts`）：「沒有設定列時回預設值」改為也檢查 `settings.provider` 是 `ollama`；新增「改成 Gemini」「Gemini 搭配不支援的模型」。確認新測試在斷言失敗。
- [ ] 2.2 實作：`EmbeddingSettings` 新增 `provider`；`DEFAULT_EMBEDDING_SETTINGS.provider = 'ollama'`；`updateEmbeddingSettings()` 寫入 `embeddingProvider`，`modelChanged` 在服務或模型改變時是 true；route 的 Zod schema 新增 `provider` 並以 `superRefine` 檢查 Gemini 只能搭配 `gemini-embedding-001`。
- [ ] 2.3 既有情境「有設定列時回已存的值」「只讀到本租戶的設定」「換模型」「沒有設定列時建立」「稽核寫入失敗時設定不變」的測試不改斷言，仍然通過。

## 3. Gemini 向量化 client

- [ ] 3.1 測試先寫（`apps/api/tests/unit/modules/embedding/embedding-gemini.test.ts`，以假 `fetch` 為邊界）：「文章以 Gemini 向量化」（請求帶 `outputDimensionality: 1024`、`taskType: RETRIEVAL_DOCUMENT`）、「搜尋以 Gemini 向量化查詢文字」（`RETRIEVAL_QUERY`）、「長文章只送前 2000 字」、「Gemini 回錯誤時文章的向量不變」的 client 部分（HTTP 400 丟錯、不重試）、HTTP 429 重試 1 次。
- [ ] 3.2 實作：`EmbeddingTarget` 新增 `provider`、`apiKey?`、`purpose`；`embedText()` 依 `provider` 分流；新增 Gemini 呼叫（沿用 `gemini.provider.ts` 的 `GEMINI_BASE`，不另寫一份網址）；回傳向量長度不是 1024 時丟錯。
- [ ] 3.3 既有 `embedding-timeout.test.ts` 不改斷言仍通過（Ollama 行為不變）。

## 4. 金鑰、額度與用量

- [ ] 4.1 測試先寫（`apps/api/tests/unit/modules/embedding/embedding-usage.test.ts`，mock executor + 假 Redis + 假 `fetch`）：「使用租戶的自備金鑰」「Gemini 向量化寫入用量」「額度已滿時不呼叫 Gemini」「Ollama 向量化不寫用量」「Gemini 向量化的用量標記」「Gemini 向量化達到上限」。
- [ ] 4.2 實作：`AiFeature` 新增 `embedding`；`embedding.flow.ts` 新增 `prepareEmbeddingCall()`（交易內讀設定、政策；服務是 Gemini 時讀金鑰與月額度上限，沿用 `resolveGeminiKey()` 與 `readLlmInputs()` 讀上限的邏輯，不另寫一份）；交易外檢查額度；呼叫後以 `recordLlmUsage()` 寫用量。
- [ ] 4.3 向量化 flow 的 `deps` 改成 `LlmDeps`，更新呼叫端：`knowledge-effects.ts`、`knowledge.flow.ts`、`ai.flow.ts`、`kb-autoreply.flow.ts`（AI 自動回覆改用同一個 prepare/record 流程，`purpose: 'query'`）。
- [ ] 4.4 feature 測試（`apps/api/tests/feature/modules/embedding/embed-article.test.ts`）：以 `app_tenant` 連線跑一次 Gemini 向量化（假 `fetch`），確認 `AiUsage` 在 RLS 下寫得進去，`keySource` 正確。

## 5. 搜尋只比對目前模型

- [ ] 5.1 測試先寫（`apps/api/tests/feature/modules/knowledge/knowledge-embedding-routes.test.ts`）：「換服務後舊向量不進搜尋結果」「換服務後統計顯示要重新嵌入」「不比對其他租戶的文章」。
- [ ] 5.2 實作：`searchSimilarArticles()` 與 `getEmbeddingStats()` 加上 `"embeddingModel" = $model`；`kb-autoreply` 的 `searchKbArticles` 也帶目前模型。
- [ ] 5.3 feature 測試確認 migration 補值：`embeddingModel` 是空值的既有向量，補值後仍出現在搜尋結果。

## 6. 健康檢查

- [ ] 6.1 測試先寫（`apps/api/tests/feature/modules/settings/embedding-settings.test.ts` 與 `knowledge-embedding-routes.test.ts`）：「Gemini 沒有金鑰」（斷言沒有呼叫 `fetch`）「Gemini 正常」。既有三個 Ollama 情境不改斷言。
- [ ] 6.2 實作：`probeEmbeddingService()` 依服務分流；兩個端點的回應格式不變。

## 7. 前端

- [ ] 7.1 測試先寫（`apps/web/tests/unit/components/knowledge/embedding-settings.test.tsx`，jsdom）：選 Gemini 時隱藏網址欄位、模型顯示 `gemini-embedding-001`、儲存送出 `provider: 'gemini'`；儲存回 `modelChanged: true` 時顯示重新嵌入提示。
- [ ] 7.2 實作 `EmbeddingSettings.tsx`：「向量化服務」下拉選單與 Gemini 說明文字（照 `open333crm-ui` 規範，不用 emoji）。

## 8. 文件

- [ ] 8.1 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 的向量化設定說明，與 `.claude/skills/feature-knowledge/SKILL.md` 的相關段落。
- [ ] 8.2 `docs/ref/features/feature-map.json` 若路徑或資料表有變，更新它，`node scripts/feature-impact.mjs --check` 通過。

## 9. 完成定義

- [ ] 9.1 `pnpm test` 通過。
- [ ] 9.2 `pnpm test:feature` 通過（改了資料庫與 Redis 相關程式）。
- [ ] 9.3 `pnpm build` 通過（改了 `apps/web` 與 `packages/database`）。
- [ ] 9.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有新增違規。
- [ ] 9.5 `structure-reviewer` 沒有新的問題，或 PR 說明為什麼不適用。
- [ ] 9.6 `node scripts/feature-impact.mjs` 的知識庫區回歸清單逐項檢查。
- [ ] 9.7 `CHANGELOG.md` 在 `## [2026-11-19]`（或實作當天的日期）新增 `Added` 條目。
- [ ] 9.8 `node scripts/validate-openspec.mjs add-gemini-embedding-provider` 與 `node scripts/validate-openspec.mjs --specs` 通過。
- [ ] 9.9 `node scripts/check-doc-history.mjs --strict` 通過（改了 `docs/ref/features/` 與 feature skill）。
- [ ] 9.10 所有任務打勾後，以 `pnpm exec openspec archive` 歸檔。
