# Tasks

## 1. 搬遷前補測試

- [ ] 1.1 確認現有測試涵蓋搬遷前的行為：`tests/unit/modules/embedding/embedding-timeout.test.ts`（逾時與重試）、`tests/feature/modules/knowledge/knowledge-routes.test.ts`（搜尋、重新向量化、服務狀態）、`tests/unit/modules/ai/ai.service-tenant-scope.test.ts`。缺的部分在這一節補上，並在搬遷前的程式上通過。
- [ ] 1.2 `tests/feature/modules/settings/embedding-settings.test.ts`：「有設定列時回已存的值」「只讀到本租戶的設定」「換模型」。這三個 Scenario 的行為現在已經存在，以突變驗證（例如讓讀取忽略 `tenantId`、讓 `modelChanged` 永遠是 false），突變記在 8.x。
- [ ] 1.3 `tests/unit/modules/embedding/embedding-client.test.ts`：「向量化的健康檢查」三個 Scenario 對兩個端點的回應格式，在搬遷前的兩個 `checkOllamaHealth()` 上通過。

## 2. 向量化服務的用戶端（design D1）

- [ ] 2.1 新增 `embedding/embedding-client.ts`：`embedText()` 與 `probeEmbeddingService()`，逾時與重試沿用現在的值。`embedding-timeout.test.ts` 改成測 `embedText()`，仍然通過。
- [ ] 2.2 兩個 `checkOllamaHealth()` 與 `listOllamaModels()` 改成呼叫 `probeEmbeddingService()`。1.3 的測試仍然通過。

## 3. 向量化設定（design D4）

- [ ] 3.1 寫測試「沒有設定列時回預設值」（`embedding-settings.test.ts`）：斷言回應是預設值，而且沒有建立設定列。確認在現在的程式上因為建立了設定列而失敗。
- [ ] 3.2 寫測試「沒有設定列時建立」「稽核寫入失敗時設定不變」。確認後者在現在的程式上失敗（`writeTenantAudit()` 吞掉錯誤）。
- [ ] 3.3 `getEmbeddingSettings(ctx)` 只讀；`updateEmbeddingSettings(ctx, patch)` 改用 upsert；`getEmbeddingStats(ctx)` 收 `TenantCtx`。讓 3.1、3.2 通過。
- [ ] 3.4 settings 的 3 條 embedding 路由改呼叫 flow；`PUT` 的 flow 在交易內呼叫 `recordTenantAudit()`。1.2、3.1、3.2 通過。

## 4. 文章向量化（design D2、D3、D6）

- [ ] 4.1 寫測試（`tests/feature/modules/embedding/embed-article.test.ts`）：「Successful vectorization」「向量化服務失敗時不改向量」「向量化期間文章沒有被修改」。以假的向量化服務回傳固定向量。
- [ ] 4.2 寫測試「向量化期間文章被修改」「向量化期間文章被封存」：假的向量化服務在回傳前修改或封存文章。確認在現在的程式上因為寫入了舊的向量而失敗。
- [ ] 4.3 新增 `embedding.flow.ts` 的 `embedArticleFlow()`；`embedding.service.ts` 改成收 `TenantCtx` 的查詢：讀文章、條件寫入向量、列出已發布文章的 id、相似度搜尋（`topK`、`threshold` 必填）。讓 4.1、4.2 通過。
- [ ] 4.4 寫測試「重新向量化成功」「重新向量化期間文章被修改」（`knowledge-routes.test.ts`）。確認後者在現在的程式上失敗（回 200）。
- [ ] 4.5 `KnowledgeEffects.embed` 改成回傳結果；`createKnowledgeEffects()` 呼叫 `embedArticleFlow()`；`embedArticleNowFlow()` 遇到 `skipped` 丟 409 `ARTICLE_CHANGED`、遇到 `not_found` 丟 404。讓 4.4 通過。
- [ ] 4.6 `bulkEmbedFlow()` 先在交易內讀 id 清單，再逐篇呼叫 `embedArticleFlow()`。主規格「ARCHIVED article is skipped by bulk re-embed」的測試仍然通過。

## 5. 搜尋與 `ai` 的呼叫端（design D5）

- [ ] 5.1 `semanticSearchFlow()`：交易內讀設定與政策 → 交易外 `embedText()` → 交易內 `searchSimilarArticles()`。拿掉 `knowledge.flow.ts` 與 `knowledge-effects.ts` 的 `tenantScopedClient()`。`knowledge-routes.test.ts` 的搜尋測試仍然通過。
- [ ] 5.2 `kb-autoreply.service.ts` 與 `ai.service.ts` 以自己的連線組成 `TenantCtx`，依序呼叫 `readEmbeddingInputs()`、`embedText()`、`searchSimilarArticles()`，一次處理只讀一次設定。`kb-clarify-handoff.test.ts`、`kb-model-guard.test.ts`、`ai.service-tenant-scope.test.ts` 仍然通過。

## 6. 主規格

- [ ] 6.1 確認 `km-ingestion` 的 MODIFIED「Automated Vectorization and Indexing」沒有和其他需求矛盾（「Archived Articles Excluded from Retrieval」「文章寫入在 commit 之後才開始向量化」）。

## 7. 文件

- [ ] 7.1 更新 `docs/ref/features/tenant/KNOWLEDGE.md` 與 `feature-knowledge` skill 中描述向量化流程與 embedding 設定的段落。新增的檔案路徑加進 `docs/ref/features/feature-map.json`，`node scripts/feature-impact.mjs --check` 通過。

## 8. 完成檢查

- [ ] 8.1 在本檔記下 1.2 的突變與結果。
- [ ] 8.2 `pnpm test` 通過。
- [ ] 8.3 `pnpm test:feature` 通過。
- [ ] 8.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，執行 `--update-baseline`；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規。
- [ ] 8.5 `node scripts/feature-impact.mjs` 列出的直接受影響領域，逐項走過回歸清單。
- [ ] 8.6 `CHANGELOG.md` 的 `Changed` 寫明可觀察的差異：`POST /:id/embed` 的 409、讀設定不建立設定列、設定與稽核一起寫入。
- [ ] 8.7 `node scripts/validate-openspec.mjs migrate-embedding-tenant-ctx` 與 `--specs` 通過。
- [ ] 8.8 部署到 UAT 後重跑規劃檔 6.2 的腳本，`bench.mjs` 加上 `GET /settings/embedding` 與 `POST /knowledge/search`。
