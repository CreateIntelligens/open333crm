## Context

#337 階段 4 第三批。盤點與選擇的理由見 `tmp/337-入口開交易-規劃.md` 5.3（本機檔案，不在 git）。動機見 proposal.md 的「Why」。

搬遷前的結構：

- `knowledge.routes.ts` 的 21 條路由都以 `request.tenantPrisma` 呼叫 service（共 23 處）。`request.tenantPrisma` 讓每個查詢各自一個交易。
- `knowledge.service.ts` 在寫入之後呼叫 `embedArticle(prisma, id)`，不等結果，共 4 處：建立、修改、發布、批次匯入。`partner-ingest.service.ts` 另有 1 處。
- `embedArticle()`（`embedding/embedding.service.ts`）以收到的 client 讀文章、讀 embedding 設定、讀去識別化政策，呼叫向量化服務，再寫回向量。它收 `TenantDb`，這一批不搬。
- `semanticSearch()` 在 `knowledge.service.ts` 內呼叫 `generateEmbedding()`，那是外部呼叫。
- `ingestPartnerDoc()` 依序寫文章、刪除舊附件的資料列、逐一上傳附件並寫資料列。
- webhook 收訊以 `prismaAdmin` 呼叫 `recordKbFeedback(ctx.prisma, tenantId, input)`。
- `inTenant()` 的 `afterCommit` 依序執行每個動作並等它結束；動作失敗只記 log（`lib/tenant-ctx.ts`）。

## Goals / Non-Goals

**Goals:**

- `knowledge` 模組的 3 個 service 檔只收 `TenantCtx`，不呼叫外部服務。`check-tenant-ctx.baseline.json` 的 `knowledge` 從 45 降到 0。
- 向量化與刪除檔案在 commit 之後才開始，保證寫在 spec。
- 路由的路徑、權限、回應格式與錯誤碼不變，proposal 列出的差異除外。

**Non-Goals:**

- `embedding` 模組與 `ai/model-registry.service.ts` 改收 `TenantCtx`（隨 `ai` 一起搬）。
- 向量化改成至少一次（D2）。
- 清理已經留在 S3 上的孤兒檔案。

**審查基準：** 向量化與刪除檔案達到 Laravel `DB::afterCommit()` 的水準：commit 之後最多開始一次，處理程序中斷時遺失。上傳後交易失敗時，確定沒有寫入才刪檔（D4），其餘留下的孤兒檔案達到 Laravel `Storage` 的水準：Laravel 的檔案也不隨交易 rollback。Laravel 專案也會有的情況，記錄在「Risks / Trade-offs」，不另外處理。

## Decisions

### D1. 向量化與儲存服務以參數注入 flow

flow 的 `deps` 帶兩個函式：

```ts
type KnowledgeEffects = {
  embed: (tenantId: string, articleId: string) => Promise<void>;
  storage: { upload: typeof uploadFile; remove: (key: string) => Promise<void> };
};
```

路由傳入實際的實作：`embed` 以 `tenantScopedClient(fastify.prisma, tenantId)` 呼叫 `embedArticle()`，`storage` 是 `storage.service.ts` 的 `uploadFile`、`deleteFile`。feature 測試傳入記錄呼叫的假函式，所以不需要 Ollama 與 MinIO，也能斷言呼叫的時間點與次數。

`tenantScopedClient()` 是舊寫法（階段 7 刪除），但 `embedArticle()` 收 `TenantDb`，在交易外只能這樣呼叫。`coupon-claim.flow.ts` 呼叫 `deliverToChannel()` 也這樣寫。`embedding` 搬遷時，`embed` 的實作改成三段（交易、外部呼叫、交易），flow 不變。

**替代方案：** 以 `vi.mock` 替換 `embedding.service.js` 與 `storage.service.js`。不採用：feature 測試要用真的資料庫與 RLS，模組層級的 mock 會連同 RLS 之外的程式一起換掉；而且 canvas 的手動觸發已經用注入的 `runFlow`，寫法一致。

### D2. 向量化在 `afterCommit` 開始，不等結果

```ts
// knowledge-effects.ts
export function startEmbedAfterCommit(scope: TenantScope, embed: EmbedArticle, articleId: string): void {
  scope.afterCommit('knowledge.embed', () => {
    embed(scope.tenantId, articleId).catch((err) => logger.error(...));
  });
}
```

寫法同 `canvas-effects.ts` 的 `startFlowAfterCommit()`。`afterCommit` 等動作結束，flow 才 return；動作只開始向量化而不等它，所以回應不等向量化服務。最多開始一次；處理程序在向量化完成之前結束時，這篇文章沒有新的向量。

發布文章時，搬遷前先查文章有沒有向量，沒有才向量化。這個查詢移到 service，在同一個交易內，結果決定 flow 要不要呼叫 `startEmbedAfterCommit()`。

**替代方案：** 經 outbox 送進佇列，由 worker 向量化，至少一次。不採用（使用者 2026-11-06 決定）：

- 現在的向量化服務是 Ollama，失敗多半是服務沒有啟動或模型正在載入。重試的幫助不大。
- 組織決定不部署 Ollama（AUDIT LLM-04）。換成雲端的向量化服務時，失敗多半是暫時性的 429 或 5xx，重試才有用。那時再評估，評估時一起決定重試次數與重複呼叫的成本。
- 失敗是看得到的（列表的 `hasEmbedding`），也有手動補的方式（單篇與批次的重新向量化）。

### D3. 刪除檔案在 `afterCommit` 開始，不等結果

service 在交易內刪除附件資料列之前，先讀出這些列的 `storageKey`，回傳給 flow。flow 呼叫：

```ts
export function removeFilesAfterCommit(scope: TenantScope, remove: RemoveFile, keys: string[]): void {
  if (keys.length === 0) return;
  scope.afterCommit('knowledge.remove-files', () => {
    for (const key of keys) remove(key).catch((err) => logger.error(...));
  });
}
```

合作方覆蓋文章與後台刪除文章共用這個函式（AGENTS.md「When several entry points send the same Socket event」的同一個理由）。不等刪除完成：檔案是否刪除，呼叫端看不到，不應該讓 S3 的延遲或逾時拖慢回應。

`storageKey` 每次上傳都含新的 UUID（`buildStorageKey()`），兩筆附件不會共用一個檔案，所以刪除不會影響其他文章。

**替代方案：** 在交易內先刪檔案。不採用：rollback 時資料列還在，檔案已經不見。

### D4. 合作方推送拆成三段

| 步驟 | 在哪裡 | 做什麼 | 失敗時 |
| --- | --- | --- | --- |
| 1 | 交易 1 | 讀既有的文章，依 `cmd` 與 `Ver` 決定結果。`DELETE`、衝突、找不到、`skipped` 在這裡結束 | 回錯誤，沒有寫入 |
| 2 | 交易外 | 逐一偵測內容並上傳附件，失敗的附件略過 | 只略過那個附件 |
| 3 | 交易 2 | 以 `FOR UPDATE` 鎖住既有的文章再讀一次，以步驟 1 的同一個函式重新決定結果。通過之後寫文章、讀出並刪除舊附件的資料列、寫新附件的資料列；`afterCommit` 刪除舊檔案、開始向量化 | 回 `skipped` 或在寫入途中丟錯 rollback：刪除步驟 2 上傳的檔案。寫入都做完、commit 回錯誤：保留檔案，寫 log |

步驟 1 與 3 呼叫同一個 service 函式判斷 `cmd` 與 `Ver`，所以兩次的規則不會分歧。步驟 3 的結果與步驟 1 不同時（另一個推送在步驟 2 期間寫入），以步驟 3 為準，例如回 `skipped` 或 `DOCID_CONFLICT`。

`cmd=DELETE` 在步驟 1 就封存並結束。沒有附件要上傳時（`IsAttached=false`），步驟 2 沒有事要做，步驟 1 判斷通過之後直接進步驟 3。兩個交易的代價是多讀一次文章。

**步驟 3 為什麼要鎖（PR #463 機器人意見，review 後加上）：** PostgreSQL 預設的 READ COMMITTED 之下，一般的 `SELECT` 不等別的交易的寫入。同一個 DocID 的 Ver 3 與 Ver 2 同時進入步驟 3 時，兩個都讀到舊的 Ver 1 而通過判斷，後寫入的 Ver 2 蓋掉 Ver 3。`FOR UPDATE` 讓第二個交易等第一個 commit，再讀到 Ver 3 而回 `skipped`。鎖只鎖這一篇文章，只持有到交易 2 結束；交易 2 不呼叫外部服務。

**步驟 3 失敗時清理上傳的檔案（使用者 2026-11-06 決定，改掉原本「一律留下孤兒檔案」）：** 確定沒有寫入時，馬上刪除步驟 2 上傳的檔案，不等結果、失敗只記 log。這些檔案的 key 都含新的 UUID，沒有其他資料參照。flow 在寫入都做完、只差 commit 時設一個旗標：之後 commit 回錯誤時，資料庫可能已經寫入（例如連線在送出 COMMIT 之後斷掉），刪檔會讓附件連結失效，所以保留檔案、只寫 log。仍會留下孤兒檔案的情況：上傳之後、交易 2 結束之前處理程序結束；刪除失敗；commit 結果不明。

同一個 DocID 的兩個 `CREATE` 同時進入步驟 3 時，第二個違反 `(tenantId, externalDocId)` 的唯一索引，交易 rollback，回 500 `INGEST_FAILED`。搬遷前的結果相同。合作方以 `Ver` 遞增重送，下一次推送會走 `UPDATE`。

**替代方案：** 整個推送在一個交易內，附件上傳也在交易內。不採用：上傳是外部呼叫（AGENTS.md 結構規則 2），多個附件時會超過交易的 5 秒逾時。

### D5. 批次匯入每篇各自一個交易

flow 對每篇文章各呼叫一次 `inTenant()`，接住這次的錯誤，記進 `errors`，再寫下一篇。檔案上傳（`POST /upload`）的每個檔案也各自一個交易。

**替代方案：** 整批一個交易。不採用（使用者 2026-11-06 決定）：一篇失敗時其他篇也不寫，`imported` 變成 0，這是可以觀察到的行為改變。同一個交易內接住錯誤再繼續也不行：PostgreSQL 在第一個錯誤之後拒絕這個交易的所有查詢（規劃 6.1）。

### D6. 需要外部呼叫的讀取在交易外

| 路由 | 做法 |
| --- | --- |
| `POST /search` | flow 以 `tenantScopedClient()` 呼叫 `generateEmbedding()` 與 `searchSimilarArticles()`。`semanticSearch()` 從 `knowledge.service.ts` 移到 flow |
| `GET /embedding-status` | flow 以 `tenantScopedClient()` 呼叫 `checkOllamaHealth()` |
| `POST /bulk-embed` | 交易內計算已發布的篇數，之後以 `tenantScopedClient()` 開始 `bulkReembed()`，不等結果（行為不變） |
| `POST /:id/embed` | 交易內確認文章屬於本租戶，不存在時回 404；之後在交易外呼叫 `embed()`，等結果再回應（行為不變） |

`GET /models`、`POST /models/refresh` 呼叫 `ai/model-registry.service.ts`，它只讀資料庫，flow 在 `inTenant()` 內傳 `scope.tx`。模組內有記憶體快取，快取命中時仍會開一個交易。這個模組隨 `ai` 一起搬，到時候把快取移到 flow。

### D7. webhook 收訊改呼叫 flow

`recordKbFeedback` 改收 `TenantCtx`。新增 `recordKbFeedbackFlow(deps: { prisma }, tenantId, input)`，webhook 以 `{ prisma: ctx.prisma }` 呼叫，寫法同 webhook 呼叫 `addTagToTargetFlow()`。

**替代方案：** 照 `relabelCsatReplyMessage` 傳 `{ tx: ctx.prisma, tenantId }`。不採用：`ctx.prisma` 是 `prismaAdmin`，不是交易，這樣組成的 `TenantCtx` 沒有 `TenantCtx` 的保證（RLS、同一個交易）。

### D8. 路由的參數以 Zod 解析

`:id` 用 `z.string().uuid()`。`GET /` 用 `paginationSchema.extend({ limit: ...default(50), status, category, source, tag, q })`，`limit` 上限沿用 `MAX_PAGE_SIZE`（100）。`GET /feedback` 的 `status` 用 `z.enum(['open', 'resolved'])`。

`partner-ingest` 的錯誤格式（自己回 `{ success: false, error }`）與英文訊息不變：這個端點的呼叫端是合作方的機器。

### D9. 讀取路由逐條加上 `requirePermission('knowledge.view')`

在 9 條讀取路由各自的 `preHandler` 加上檢查，與寫入路由的 `knowledge.manage`、`knowledge.admin` 寫法相同。寫入路由不另外加 `knowledge.view`：註冊表的 `dependsOn` 讓有 `knowledge.manage` 或 `knowledge.admin` 的角色一定也有 `knowledge.view`。

`requirePermission` 檢查的是有效權限（角色權限與方案天花板的交集），所以同一個檢查也擋下方案不含知識庫的租戶。這一批的測試只寫角色的情況；有效權限的計算（含方案天花板）由 `tests/feature/guards/permission-check.test.ts` 涵蓋。

**替代方案：** 在模組的 `addHook('preHandler')` 一律檢查 `knowledge.view`。不採用：`partner-ingest` 也經過這個 hook。Partner API 金鑰只放行白名單內的權限碼，`knowledge.view` 不在白名單內（`permission-check.test.ts`「白名單外的權限碼被拒」），hook 一律檢查會擋掉合作方推送。

## Risks / Trade-offs

- [處理程序在 commit 之後、向量化完成之前結束] → 文章沒有新的向量，自動回覆與語意搜尋找不到它。列表的 `hasEmbedding` 顯示，管理員用重新向量化補上。行為和搬遷前相同（D2）。
- [處理程序在 commit 之後、刪除檔案之前結束，或刪除失敗] → 舊檔案留在 S3，佔用空間，不影響功能。log 有失敗的 key。
- [合作方推送上傳之後，處理程序在交易 2 結束之前結束，或 commit 結果不明，或刪除失敗] → 新上傳的檔案留在 S3（D4）。確定沒有寫入的其他情況，檔案會被刪除。
- [`POST /models` 快取命中時仍開交易] → 多一個短交易。隨 `ai` 搬遷時修正（D6）。
- [`tenantScopedClient()` 是要刪除的舊寫法] → 只在 flow 呼叫還沒搬的 `embedding` 函式時使用。`check-tenant-ctx.mjs` 不數這個寫法，搬 `embedding` 時以 `grep tenantScopedClient` 找出這些呼叫。
- [文章列表的 `q` 上限 200 字、`category` 上限 100 字（D8）] → 搜尋框沒有長度限制，輸入超過 200 字時從「查無結果」變成 400。合作方推送的 `Source` 寫進 `category`，長度沒有限制，超過 100 字的分類在下拉選單選了之後會回 400。2026-11-06 查 UAT，分類與來源最長 16 字。review-loop 第 1 輪記錄，不修。
- [`feat/claude-design-skin` 依賴現在的回應格式] → feature 測試斷言回應的欄位（`data`、`meta.total`、`meta.limit`、`imported`、`failed`、`errors`、`attachmentsLinked`）。

## Migration Plan

沒有 migration。部署之後在 UAT 確認：

1. 建立一篇文章，數秒後列表的 `hasEmbedding` 變成 `true`。
2. 合作方以較新的 `Ver` 覆蓋有附件的文章，MinIO 上舊附件的檔案不見，新附件的檔案存在。
3. 重跑規劃 6.2 的量測，加上 `GET /knowledge?page=1&limit=20`。

回復：revert 這個 PR。沒有資料格式的改變。

## Open Questions

（無）
