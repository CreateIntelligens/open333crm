## Why

#337 階段 4 的第三批：把 `knowledge` 模組改成入口開交易（AGENTS.md 結構規則 2）。只有 webhook 收訊會呼叫這個模組，而且只呼叫 `recordKbFeedback`，所以可以先搬。

搬遷前有下列問題：

- 文章的建立、修改、發布、批次匯入、檔案上傳與合作方推送，寫入之後馬上呼叫 `embedArticle()`，不等結果。`embedArticle()` 會讀文章、呼叫向量化服務、再寫回向量。搬進交易之後，它會在 commit 之前讀文章，讀不到；它的外部呼叫也不能放在交易內。
- 合作方推送（`POST /api/v1/knowledge/partner-ingest`）覆蓋文章時，刪掉附件的資料列，但 S3 上的舊檔案留著。後台刪除文章（`DELETE /api/v1/knowledge/:id`）也一樣：附件資料列跟著 cascade 刪掉，檔案留著。
- 合作方推送在寫入的過程中上傳附件。搬進交易之後，上傳不能放在交易內。
- 批次匯入在同一個連線上接住每篇文章的錯誤，再寫下一篇。放進同一個交易，第一個錯誤之後的寫入都會失敗（規劃 6.1）。
- `POST /api/v1/knowledge/:id/embed` 收到不存在或另一個租戶的文章 id 時，`embedArticle()` 拋出一般的 `Error`，回 500。
- 9 條讀取路由只檢查登入，不檢查 `knowledge.view`（AUDIT 的權限碼表）。角色沒有勾選「檢視知識庫」，或方案不含知識庫功能時，成員仍然讀得到文章。

## What Changes

- 知識庫的路由改成呼叫 flow，`knowledge.service.ts`、`partner-ingest.service.ts`、`kb-feedback.service.ts` 改收 `TenantCtx`。除了下面列出的差異，路由的路徑、權限、回應格式與錯誤碼不變。`feat/claude-design-skin` 正在改知識庫的前端，依賴現在的回應格式。
- 向量化：
  - 文章寫入之後，在 commit 之後才開始向量化。每次寫入最多開始一次，不等結果（使用者 2026-11-06 決定）。rollback 時不開始。
  - 向量化失敗或處理程序中途結束時，文章沒有向量。文章列表的 `hasEmbedding` 會顯示，管理員可以用現有的「重新嵌入」補上。行為和搬遷前相同。
  - `embedArticle()` 與它呼叫的 `embedding` 模組不搬，flow 在交易外以 `tenantScopedClient()` 呼叫，寫法同 `coupon-claim.flow.ts` 呼叫 `deliverToChannel()`。
  - `POST /:id/embed` 先在交易內確認文章屬於本租戶，不存在時回 404 `NOT_FOUND`，不再回 500。確認之後在交易外向量化，等結果再回應（行為不變）。
  - 語意搜尋與 embedding 狀態檢查會呼叫向量化服務，這兩條路由也在交易外呼叫。
- 合作方推送的附件：
  - 附件在交易外先上傳 S3，再開交易寫入文章與附件資料列。交易失敗時，已上傳的檔案留在 S3，不刪（孤兒檔案，使用者 2026-11-06 決定）。
  - 單一附件的內容偵測或上傳失敗時，只略過這個附件，文章照樣寫入。行為和搬遷前相同。
  - 覆蓋文章時，舊附件的 S3 檔案在 commit 之後刪除（使用者決定一起處理）。每個檔案最多刪一次；刪除失敗只記 log，檔案留下。rollback 時不刪。
  - 寫入的交易再檢查一次 `Ver`。上傳附件的期間有另一個推送寫入更新的版本時，這次回 `skipped`，剛上傳的檔案留下。
- 後台刪除文章時，附件的 S3 檔案在 commit 之後刪除，規則同上（使用者決定一起處理）。
- 批次匯入（`POST /import`，以及上傳 QA 表時自動拆篇）每篇文章各自一個交易。一篇失敗不影響其他篇，回應的 `imported`、`failed`、`errors` 不變（使用者決定）。
- 輸入驗證（AGENTS.md「Validation」）：
  - 文章與回報的 `:id` 以 `z.string().uuid()` 驗證。不是 UUID 時回 400 `VALIDATION_ERROR`。搬遷前 Prisma 拒絕這個值，回 400 `DATABASE_ERROR`。前端只送真實的 id，不受影響。
  - `GET /api/v1/knowledge` 的 `page`、`limit` 用 `paginationSchema`，`limit` 預設維持 50。`page` 小於 1 或 `limit` 超過 100 時回 400 `VALIDATION_ERROR`。前端每頁 50 筆，不受影響。
  - `GET /api/v1/knowledge/feedback` 的 `articleId` 驗證 UUID，`status` 只收 `open`、`resolved`。
- 9 條讀取路由加上 `requirePermission('knowledge.view')`：文章列表、單篇、來源、分類、搜尋、embedding 狀態、型號、回報數、回報列表。系統預設的三個角色都有這個權限；2026-11-06 查 UAT，沒有這個權限的自訂角色都沒有啟用中的成員，不含知識庫的方案沒有租戶使用。前端的側邊欄本來就以 `knowledge.view` 決定是否顯示知識庫。
- webhook 收訊記錄回報時，改呼叫 `recordKbFeedbackFlow()`，寫法同 webhook 呼叫 `addTagToTargetFlow()`。
- 不在範圍：
  - 換掉 Ollama、改向量欄位的維度（AUDIT LLM-04、DB-01）。LLM-04 選定新的向量化服務時，再評估向量化要不要改成至少一次（design D2）。
  - `embedding` 模組、`ai/model-registry.service.ts` 改收 `TenantCtx`（隨 `ai` 一起搬）。
  - 合作方刪除（`cmd=DELETE`）是軟刪除，附件與檔案依主規格保留，行為不變。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `km-ingestion`：
  - 新增「知識庫管理只作用在本租戶的資料」（ADDED）。
  - 新增「文章寫入在 commit 之後才開始向量化」（ADDED）。
  - 新增「合作方推送的附件在交易外上傳」（ADDED）。
  - 新增「刪除附件資料列之後刪除 S3 上的檔案」（ADDED）。
  - 新增「批次匯入的每篇文章各自寫入」（ADDED）。
  - 新增「知識庫路由驗證查詢參數與路徑參數」（ADDED）。
  - 新增「讀取知識庫需要檢視權限」（ADDED）。

「Partner Doc Mutation Command」的行為不變，沒有 MODIFIED。

## Impact

- 後端：
  - `apps/api/src/modules/knowledge/`：新增 `knowledge.flow.ts`、`knowledge-effects.ts`。`knowledge.service.ts`、`partner-ingest.service.ts`、`kb-feedback.service.ts` 改收 `TenantCtx`。`knowledge.routes.ts` 改成呼叫 flow。
  - `apps/api/src/modules/webhook/inbound-postback-interceptors.ts`：改呼叫 `recordKbFeedbackFlow()`。
  - `embedding`、`storage` 模組不改。
- API：
  - `POST /api/v1/knowledge/:id/embed`：文章不存在或屬於另一個租戶時，從 500 改成 404。
  - `:id` 不是 UUID、分頁參數超出範圍、回報的篩選值不合法時，回 400 `VALIDATION_ERROR`。
  - 9 條讀取路由：沒有 `knowledge.view` 的成員，從 200 改成 403。
  - 其他路由的路徑、權限、回應格式與錯誤碼不變。
- 儲存：覆蓋或刪除文章之後，舊附件的 S3 檔案會刪除。
- 測試：新增 `tests/feature/modules/knowledge/`、`tests/unit/modules/knowledge/` 的 flow 測試。既有的 `knowledge-partner-key-auth.test.ts`、`knowledge-upload-encoding.test.ts` 要繼續通過。
- 文件：`docs/ref/features/feature-map.json`（若路徑改變）、`.claude/skills/feature-knowledge/SKILL.md`、`scripts/check-tenant-ctx.baseline.json`、`CHANGELOG.md`。
