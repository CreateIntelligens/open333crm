# Proposal

## Why

#337 階段 4 第五批。`embedding` 模組的函式收舊的 `TenantDb`，每個函式都混了資料庫讀寫與外部呼叫：

- `generateEmbedding()` 先讀設定與遮罩政策，再呼叫 2md 與 Ollama。Ollama 逾時 25 秒、重試 1 次，最久 51 秒。
- `embedArticle()` 讀文章、向量化、寫回向量，中間沒有任何檢查。

所以 flow 沒辦法把向量化拆成「交易 → 外部呼叫 → 交易」。第三批 `knowledge` 只能用 `tenantScopedClient()` 呼叫這些函式，作為過渡寫法。

盤點時另外發現三個問題：

- 文章連改兩次時，第一次的向量化可能比較晚完成，用舊內容的向量蓋掉新內容的向量。之後沒有程式會修正。
- 讀向量化設定時，沒有設定列就建立一列：讀取路徑會寫資料庫，兩個請求同時第一次讀會撞 unique。
- 健康檢查有兩個同名函式 `checkOllamaHealth`，做同一件事。

## What Changes

- 向量化拆成三段：
  1. 交易 1 讀設定、遮罩政策、文章內容，以及文章的 `updatedAt`。
  2. 交易外遮罩並呼叫 Ollama。
  3. 交易 2 只在文章的 `updatedAt` 沒變時，寫入向量與模型名稱；有變就略過並記 log。
- `POST /api/v1/knowledge/:id/embed` 在向量化期間文章被修改或刪除時，回 409 `ARTICLE_CHANGED`，不寫入向量。原本會寫入舊內容的向量。
- 批次重新向量化（`POST /api/v1/knowledge/bulk-embed`）的每篇文章各自走這三段。回應不變，仍在背景執行、不等結果。
- 讀向量化設定時，沒有設定列就回預設值，不建立設定列。`PUT /api/v1/settings/embedding` 改用 upsert，在同一個交易內寫稽核。
- settings 的 3 條 embedding 路由（`GET`、`PUT /settings/embedding`、`POST /settings/embedding/health`）改成呼叫 flow。
- 兩個 `checkOllamaHealth` 合成一個。`GET /api/v1/knowledge/embedding-status` 的回應格式不變。
- 語意搜尋（`POST /api/v1/knowledge/search`）、知識庫自動回覆與建議回覆，在交易外向量化查詢文字，再開交易搜尋。一次處理只讀一次向量化設定。回應不變。
- 主規格 `km-ingestion` 的「Automated Vectorization and Indexing」改成實際的做法：pgvector、一篇文章一個向量。原本寫的是 LanceDB 與分段。

## Capabilities

### New Capabilities

- `embedding-settings`：租戶的向量化設定（服務網址、模型、topK、相似度門檻）的讀取、修改與健康檢查。

### Modified Capabilities

- `km-ingestion`：「Automated Vectorization and Indexing」改成現況，並加上寫入向量時的條件（文章在向量化期間被修改就不寫入），以及單篇重新向量化回 409 的情況。

## Impact

- 程式：`apps/api/src/modules/embedding/`、`settings/embedding-settings.service.ts`、`settings/settings.routes.ts` 的 embedding 路由、`knowledge/knowledge-effects.ts`、`knowledge/knowledge.flow.ts`、`ai/kb-autoreply.service.ts`、`ai/ai.service.ts`。
- API：`POST /api/v1/knowledge/:id/embed` 新增 409 `ARTICLE_CHANGED`。其他端點的回應不變。
- 資料庫：沒有 migration。`GET /settings/embedding` 不再建立 `tenant_settings` 列。
- `ai` 模組還沒搬。這一批中，`ai` 的兩個呼叫端以自己的連線組成 `TenantCtx` 傳入。
