# Design

## Context

#337 階段 4 第五批。盤點與選擇的理由見 `tmp/337-入口開交易-規劃.md` 附錄 A「階段 4 第五批」（本機檔案，不在 git）。動機見 proposal.md 的「Why」。

搬遷前的結構：

- `embedding/embedding.service.ts` 的函式都收 `TenantDb`：
  - `generateEmbedding()` 讀設定與遮罩政策，再呼叫 2md 與 Ollama。
  - `embedArticle()` 讀文章、呼叫 `generateEmbedding()`、再讀一次設定、寫入向量。查詢與 UPDATE 都沒有帶 `tenantId`，只靠 RLS。
  - `bulkReembed()` 逐篇做同樣的事。
  - `searchSimilarArticles()` 呼叫端已經傳 `topK`、`threshold`，函式仍再讀一次設定。
  - `checkOllamaHealth()` 呼叫 Ollama 的 `/api/tags`。
- `settings/embedding-settings.service.ts`：
  - `getEmbeddingSettings()` 沒有設定列就建立一列。
  - `updateEmbeddingSettings()` 先呼叫 `getEmbeddingSettings()`，再 `update`。
  - 另有一個同名的 `checkOllamaHealth()` 與 `listOllamaModels()`，也是呼叫 `/api/tags`。
  - settings 的 3 條 embedding 路由以 `request.tenantPrisma` 呼叫這些函式，`PUT` 以 `writeTenantAudit()` 寫稽核。
- 第三批 `knowledge` 的過渡寫法：
  - `knowledge-effects.ts` 以 `tenantScopedClient()` 呼叫 `embedArticle()`。
  - `knowledge.flow.ts` 的搜尋、批次重新向量化與服務狀態也傳 `tenantScopedClient()`。
- `ai` 還沒搬，有兩個呼叫端：
  - `kb-autoreply.service.ts` 以 automation worker 的 `prismaAdmin` 呼叫 `generateEmbedding()`、`getEmbeddingSettings()`、`searchSimilarArticles()`。這樣一則訊息會讀 3 次設定。
  - `ai.service.ts` 的建議回覆以 `request.tenantPrisma` 呼叫。

## Goals / Non-Goals

**Goals:**

- `embedding` 模組與 `settings/embedding-settings.service.ts` 只收 `TenantCtx`。只有不碰資料庫的用戶端檔會呼叫 Ollama。
- 拿掉 `knowledge` 的 `tenantScopedClient()` 過渡寫法。
- 向量化的保證寫在 spec：交易外呼叫服務；文章在向量化期間被修改就不寫入。
- 路由的路徑、權限、回應格式與錯誤碼不變，proposal 列出的差異除外。

**Non-Goals:**

- 搬 `ai` 模組。`ai` 的兩個呼叫端只改呼叫方式（D5）。
- `chat-settings.service.ts` 讀取時建立設定列的寫法。這一批不改，留到搬 `ai` 時處理。
- 向量化改成至少一次。使用者打算換掉 Ollama（AUDIT LLM-04），換的時候再評估。
- 批次重新向量化的並行控制與進度回報。
- 在文章記下產生向量的文字雜湊（`embeddingSourceHash`），用來找出過期的向量、略過文字沒變的向量化。等 AUDIT LLM-04 換 embedding 模型時一起做，理由寫在 LLM-04。

**審查基準：** 向量化達到 Laravel `DB::afterCommit()` 加 queued job 的「最多一次」水準：處理程序中斷時遺失，由管理員重新向量化補上。寫回結果時，以樂觀鎖的方式比對版本（同 Laravel 以 `updated_at` 判斷資料是否被改過）。Laravel 專案也會有的情況，記錄在「Risks / Trade-offs」，不另外處理。

## Decisions

### D1. Ollama 的 HTTP 呼叫集中在一個不碰資料庫的檔案

新增 `embedding/embedding-client.ts`，只放外部呼叫：

- `embedText(target: { baseUrl, model }, policy: AiPrivacyPolicy, text)`：遮罩，然後呼叫 `/api/embed`。逾時與重試沿用搬遷前的值（25 秒，重試 1 次）。
- `probeEmbeddingService(baseUrl, model)`：呼叫 `/api/tags`，回傳連線狀態、模型是否存在與模型清單。

兩個 `checkOllamaHealth()` 與 `listOllamaModels()` 移除，改成由 flow 呼叫 `probeEmbeddingService()`，再各自轉成原本的回應格式：`settings/embedding-settings.flow.ts` 轉成設定頁的 `health` 與 `models`，`embedding/embedding.flow.ts` 轉成 `embedding-status` 的 `{ ok, model?, error? }`。這樣 `GET /settings/embedding` 只呼叫一次 `/api/tags`，原本會呼叫兩次。

不放在 service 檔：結構規則 2 規定 service 不呼叫外部服務。用戶端檔不收 `TenantCtx`，所以呼叫端在交易內呼叫 `embedText()` 時，型別檢查擋不住。這一點由 code review 與規劃檔 5.2 的檢查清單把關。

### D2. 向量化拆成三段，寫入前比對向量化的文字

`embedding.flow.ts` 的 `embedArticleFlow(deps, tenantId, articleId)` 依序執行：

1. 交易 1（`inTenant`）：讀向量化設定、遮罩政策與文章，以 `prepareArticleText()` 組成向量化的文字。文章不存在時回 `not_found`。
2. 交易外：以交易 1 的文字呼叫 `embedText()`。
3. 交易 2：以 `SELECT ... FOR UPDATE` 鎖住文章，再讀一次文章、重組文字。文字和交易 1 相同時，才 `UPDATE km_articles SET embedding, "embeddingModel" WHERE id AND "tenantId"`。文章不存在或文字不同時回 `skipped`，並寫 warn log。

只比對進入向量化文字的欄位（標題、分類、標籤、規格、摘要、內容、附件檔名），所以瀏覽次數、狀態這類欄位的寫入不影響結果。比對文字由 `prepareArticleText()` 決定，之後文字多用一個欄位，比對自動跟著改。兩段文字都在記憶體內，直接比較字串，不另算雜湊。鎖住文章之後才比對，比對與寫入之間其他交易改不了這篇文章；交易 2 沒有外部呼叫，鎖只持有幾毫秒。模型名稱用交易 1 讀到的設定，與實際產生向量的模型相同。搬遷前的程式在向量化之後才讀設定：設定在向量化期間被修改時，記下的模型名稱會與實際產生向量的模型不同。

不用 `externalVer`：`externalVer` 是合作方系統的版本號，只有合作方推送會寫入，後台編輯不會遞增。

不用 `updatedAt`（review-loop 第 1 輪）：最初的實作比對 `updatedAt`。`getArticle()` 以 Prisma 的 `update` 累加瀏覽次數，`@updatedAt` 跟著改變。後台按「編輯」會先讀文章，所以建立文章後馬上點編輯，這次的向量就被略過；沒有存檔時，文章一直沒有向量。只讓瀏覽次數不改 `updatedAt` 也不夠：之後新增的統計欄位以 Prisma 寫入時，會再撞到同樣的問題。

不比對狀態（review-loop 第 2 輪）：第 1 輪改成比對「文字 + 狀態」。一篇已有舊向量的草稿改了內容、向量化還沒完成就被發布時，這次的結果因為狀態改變被略過，而 `publishArticle()` 看到文章已有向量，不再開始向量化，已發布的文章就留著舊內容的向量。向量只取決於文字；要不要被檢索是查詢時依 `status = 'PUBLISHED'` 判斷（spec「Archived Articles Excluded from Retrieval」），所以封存期間寫入的向量不會被檢索到。

第 1、2 輪的共同原因：拿不是向量輸入的欄位（`updatedAt`、狀態）判斷向量還能不能用。之後要加比對條件時，先確認那個欄位是不是 `prepareArticleText()` 的輸入。

不用內容版本欄位：
- 由程式遞增：文章與附件有 8 個寫入點，新增的寫入路徑忘了遞增不會報錯。
- 由資料庫 trigger 遞增：要 migration，repo 目前沒有 trigger；附件在另一張表，要另外加 trigger；`prepareArticleText()` 多用一個欄位時，trigger 的欄位清單也要記得改。

不用悲觀鎖：

- 以 `SELECT ... FOR UPDATE` 鎖住文章時，鎖到交易結束才放開，所以 Ollama 的呼叫要留在交易內。這違反結構規則 2，交易逾時要放寬到 60 秒以上，每次向量化佔住一條連線，後台存檔最多等 51 秒。
- 改用租約欄位時，每個寫入文章的路徑都要先檢查租約，漏掉一處不會報錯。處理程序中斷時，租約要等到期才釋放。`pg_advisory_lock` 綁在連線上，Prisma 的連線池不保證前後兩次查詢用同一條連線。
- 悲觀鎖只把編輯與向量化排成先後，最後的結果與樂觀鎖相同。「最後是最新內容的向量」靠的是每次寫入都開始自己的向量化。只改分類或標籤的限制也還在（見「Risks / Trade-offs」）。悲觀鎖只省下偶爾白做的一次向量化，而向量化可以重做，結果相同。

### D3. 每個步驟失敗時的狀態與保證

| 入口 | 失敗的步驟 | 資料留下的狀態 | 誰重做 | 保證 |
| --- | --- | --- | --- | --- |
| 文章寫入後（`startEmbedAfterCommit`） | 交易 1、向量化服務、交易 2 | 文章保留原本的向量，失敗寫 error log | 管理員重新向量化 | 每次寫入最多開始一次，不等結果（主規格「文章寫入在 commit 之後才開始向量化」） |
| 同上 | 交易 2 比對失敗 | 文章保留原本的向量，寫 warn log | 較新的寫入自己開始的向量化 | 不寫入舊內容的向量 |
| `POST /:id/embed` | 交易 1 找不到文章 | 不變 | 呼叫端 | 回 404（行為不變） |
| 同上 | 向量化服務 | 不變 | 呼叫端 | 回原本的錯誤（行為不變） |
| 同上 | 交易 2 比對失敗 | 不變 | 呼叫端 | 回 409 `ARTICLE_CHANGED` |
| `POST /bulk-embed` | 任一篇的任一步驟 | 那篇保留原本的向量，計入 `failed` 或 `skipped`，寫 log；繼續下一篇 | 管理員再按一次 | 背景執行，不等結果；處理程序結束時，剩下的文章不處理（行為不變） |

`bulk-embed` 先在一個交易內讀出已發布文章的 id 清單，再逐篇呼叫 `embedArticleFlow()`。每篇文章各自讀設定與政策：處理期間設定被修改時，之後的文章用新的設定。

### D4. 向量化設定的讀取不建立設定列

- `getEmbeddingSettings(ctx)` 以 `findUnique` 讀取，沒有設定列就回 `DEFAULT_EMBEDDING_SETTINGS`。讀取不寫資料庫，所以可以在任何交易內呼叫，兩個請求同時讀取也不會違反 unique 限制。
- `updateEmbeddingSettings(ctx, patch)` 以 `upsert` 寫入。`create` 用「預設值加上 patch」，`update` 只寫 patch 裡的欄位。回傳 `modelChanged` 與 `previousModel` 的方式不變。
- `PUT /settings/embedding` 的 flow 在同一個交易內呼叫 `recordTenantAudit()`。原本用 `writeTenantAudit()` 在交易外寫，寫入失敗只寫 log。

### D5. `ai` 的兩個呼叫端以自己的連線組成 `TenantCtx`

`ai` 還沒搬，`kb-autoreply` 與建議回覆不在交易內。這兩個呼叫端依序呼叫三個函式，與階段 3 `csat` 的 `ratingCtx` 做法相同：

```ts
const ctx = { tx: prisma as TenantCtx['tx'], tenantId };
const { settings, policy } = await readEmbeddingInputs(ctx);
const vector = await embedText(settings, policy, text);
const results = await searchSimilarArticles(ctx, vector, { topK: settings.topK, threshold: settings.threshold });
```

`kb-autoreply` 的連線是 `prismaAdmin`，沒有 RLS。所以 `searchSimilarArticles()` 與設定的查詢都明確帶 `tenantId`。搬遷前的程式已經帶 `tenantId`。搬 `ai` 時，這三步改成「交易 → 外部呼叫 → 交易」。

`searchSimilarArticles(ctx, vector, { topK, threshold })` 的兩個參數改成必填，函式不再讀設定。

### D6. `knowledge` 的效果函式回傳結果

`KnowledgeEffects.embed` 的型別改成 `(tenantId, articleId) => Promise<'written' | 'skipped' | 'not_found'>`。`startEmbedAfterCommit()` 不看回傳值。`embedArticleNowFlow()` 遇到 `skipped` 時丟出 409 `ARTICLE_CHANGED`，遇到 `not_found` 時丟出 404：文章可能在交易 1 之前被刪除。

## Risks / Trade-offs

- 向量化進行中只改分類或標籤時，那次結果被略過，而這種修改不會開始新的向量化，文章保留舊向量。要碰到秒級的巧合才會發生，管理員可以重新向量化補上。Laravel 以 `updated_at` 做樂觀鎖時也有同樣的情況。
- 附件的寫入不會鎖住文章列。向量化的交易 2 比對時，另一個交易正在新增附件、還沒 commit，比對看不到這個附件，這次照樣寫入。新增附件的那次寫入之後，文章保留不含這個附件檔名的向量，直到下次重新向量化。合作方推送寫入附件時會先鎖住文章，不受影響。
- 交易 1 與交易 2 之間最久約 51 秒（Ollama 逾時與重試）。期間沒有任何鎖，所以不會擋住後台編輯。代價是被修改的那次向量化白做。
- `embedText()` 不收 `TenantCtx`，型別檢查擋不住「在交易內呼叫」（D1）。`check-tenant-ctx.mjs` 也不計算這種呼叫，和其他外部呼叫一樣接受為已知限制（規劃檔 5.1）。
- 主規格 `km-ingestion` 改寫「Automated Vectorization and Indexing」：原本的需求描述的是沒有實作的 LanceDB 與分段，這次改成實際的 pgvector 做法。沒有程式依賴原本的描述。
