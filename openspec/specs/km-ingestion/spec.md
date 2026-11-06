## Purpose

Define multi-modal document ingestion, automated vectorization, and partner document mutation commands for open333CRM knowledge management.

## Requirements

### Requirement: Multi-modal Ingestion via Markitdown
The system SHALL support converting PDF, DOCX, XLSX, and supported office documents to Markdown using an HTTP-based AnyDoc parsing service (2md) with multi-node resilient fallback as the primary ingestion engine, eliminating mandatory host-level Python runtime dependencies.

#### Scenario: Document ingestion via 2md AnyDoc API
- **WHEN** a document file is submitted to `MarkitdownService` for KM ingestion
- **THEN** the service sends the file to the 2md AnyDoc endpoint via multipart form-data
- **AND** returns the converted Markdown text for chunking and vectorization

#### Scenario: Audio file ingestion
- **WHEN** an audio file is uploaded to the KM ingestion endpoint
- **THEN** the system uses a transcription service (like Whisper) to generate a Markdown file and saves it to the workspace.

#### Scenario: Fallback on API unavailability
- **WHEN** all configured 2md remote parsing endpoints are unreachable or return an error
- **AND** a local python environment is configured
- **THEN** the service MAY attempt local python markitdown execution as a secondary fallback, or return an explicit conversion error

### Requirement: Automated Vectorization and Indexing
The system SHALL automatically generate embeddings for new or updated KM articles and store them in the LanceDB vector store.

#### Scenario: Successful vectorization
- **WHEN** a Markdown file is processed for ingestion
- **THEN** the system splits it into semantic chunks, generates embeddings using the configured provider, and upserts them into LanceDB along with metadata.

### Requirement: Partner Doc Mutation Command

The `POST /api/v1/knowledge/partner-ingest` endpoint SHALL accept a **required** `cmd` field with values `CREATE`, `UPDATE`, or `DELETE` (case-insensitive after trim) that explicitly specifies the intended mutation. Missing or invalid `cmd` MUST be rejected with HTTP 400 `INVALID_CMD`.

#### Scenario: CREATE on new DocID
- **GIVEN** no `KmArticle` exists with `(tenantId, externalDocId)`
- **WHEN** the partner sends `cmd=CREATE` with required fields
- **THEN** a new `KmArticle` is created with `status=PUBLISHED`
- **AND** the response is HTTP 200 with `data.status="created"`

#### Scenario: CREATE on existing PUBLISHED DocID
- **GIVEN** a `KmArticle` exists with `status=PUBLISHED`
- **WHEN** the partner sends `cmd=CREATE` for the same DocID
- **THEN** the existing article is left untouched
- **AND** the response is HTTP 409 with `error.code="DOCID_CONFLICT"`

#### Scenario: CREATE on existing ARCHIVED DocID (revive)
- **GIVEN** a `KmArticle` exists with `status=ARCHIVED` and `externalVer` equal to V0
- **WHEN** the partner sends `cmd=CREATE` with `Ver` strictly greater than V0
- **THEN** the article's `status` is set to `PUBLISHED`, content fields and attachments are replaced, embedding is recalculated
- **AND** the response is HTTP 200 with `data.status="revived"`

#### Scenario: UPDATE missing DocID
- **GIVEN** no `KmArticle` exists, OR an existing one has `status=ARCHIVED`
- **WHEN** the partner sends `cmd=UPDATE`
- **THEN** the response is HTTP 404 with `error.code="DOCID_NOT_FOUND"`

#### Scenario: UPDATE with newer Ver
- **GIVEN** a `KmArticle` with `status=PUBLISHED` and `externalVer` equal to V0
- **WHEN** the partner sends `cmd=UPDATE` with `Ver` strictly greater than V0
- **THEN** content fields are overwritten, all attachments are deleted and the new attachments uploaded, embedding is recalculated
- **AND** the response is HTTP 200 with `data.status="updated"`

#### Scenario: UPDATE with stale Ver
- **GIVEN** a `KmArticle` with `externalVer` equal to V0
- **WHEN** the partner sends `cmd=UPDATE` (or `cmd=CREATE` for ARCHIVED) with `Ver` ≤ V0
- **THEN** the article is left untouched
- **AND** the response is HTTP 200 with `data.status="skipped"` and `data.reason` indicating stale Ver

#### Scenario: DELETE soft-delete an existing PUBLISHED DocID
- **GIVEN** a `KmArticle` with `status=PUBLISHED`
- **WHEN** the partner sends `cmd=DELETE`
- **THEN** the article's `status` is set to `ARCHIVED`, its `embedding` is set to NULL, attachments are **retained**
- **AND** the response is HTTP 200 with `data.status="deleted"`

#### Scenario: DELETE idempotency for missing or already-archived DocID
- **GIVEN** no `KmArticle` exists, OR an existing one already has `status=ARCHIVED`
- **WHEN** the partner sends `cmd=DELETE`
- **THEN** no mutation occurs
- **AND** the response is HTTP 200 with `data.status="deleted"` and `data.reason` indicating idempotent no-op

#### Scenario: Invalid or missing cmd
- **WHEN** the partner sends a request whose `cmd` field is missing, empty, or not one of `CREATE` / `UPDATE` / `DELETE` (case-insensitive)
- **THEN** the response is HTTP 400 with `error.code="INVALID_CMD"`
- **AND** no mutation occurs

### Requirement: Archived Articles Excluded from Retrieval

KM retrieval pathways — semantic search (`semanticSearch`) and bulk re-embed (`bulkReembed`) — SHALL filter on `status = 'PUBLISHED'`. Articles with `status = 'ARCHIVED'` MUST NOT appear in AI/search responses, even if their embeddings exist.

#### Scenario: ARCHIVED article is not returned by semantic search
- **GIVEN** a `KmArticle` with `status=ARCHIVED` whose content semantically matches the query
- **WHEN** a user calls `POST /api/v1/knowledge/search`
- **THEN** the article does not appear in the returned results

#### Scenario: ARCHIVED article is skipped by bulk re-embed
- **WHEN** `POST /api/v1/knowledge/bulk-embed` runs
- **THEN** only articles with `status=PUBLISHED` are counted and re-embedded; ARCHIVED articles are skipped

### Requirement: CSV import decodes UTF-8 and Big5 text
When a tenant uploads a CSV file to the knowledge base (`POST /api/v1/knowledge/upload`), the system SHALL decode the file text before it parses the rows. A file that starts with a UTF-8 BOM SHALL be decoded as UTF-8 without the BOM. A file without a BOM SHALL be decoded as UTF-8 when its bytes are valid UTF-8, and otherwise as Big5. XLSX files SHALL be parsed as before.

#### Scenario: CSV import decodes UTF-8 without BOM
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header is `問題,答案` and whose row is `退貨要幾天,七天內可退貨`
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import decodes UTF-8 with BOM
- **WHEN** a tenant uploads the same CSV with the bytes `EF BB BF` at the start
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import decodes Big5 from Taiwan Excel
- **WHEN** a tenant uploads the same CSV encoded in Big5
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV import with English headers keeps Chinese content intact
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header is `question,answer` and whose row is `退貨要幾天,七天內可退貨`
- **THEN** the system creates one published article with title `退貨要幾天` and content `七天內可退貨`

#### Scenario: CSV without QA headers is imported as one article with readable Chinese
- **WHEN** a tenant uploads a UTF-8 CSV without a BOM whose header has no question or answer column
- **THEN** the system creates one draft article whose Markdown table contains the Chinese header and cell text unchanged

### Requirement: CSV import rejects text that cannot be decoded
When a knowledge-base CSV upload cannot be decoded as UTF-8 or Big5, or the decoded text contains the replacement character U+FFFD, the system SHALL write no article from that file. It SHALL report that file as failed with code `CSV_ENCODING_UNREADABLE` and a Traditional Chinese reason that tells the user to save the file as "CSV UTF-8". Other files in the same upload SHALL be processed as before.

#### Scenario: CSV that cannot be decoded is rejected and nothing is written
- **WHEN** a tenant uploads a CSV whose bytes are valid in neither UTF-8 nor Big5
- **THEN** the upload result for that file has `success: false`, `code: CSV_ENCODING_UNREADABLE` and a Chinese error that mentions UTF-8
- **AND** no article is created from that file

#### Scenario: CSV that already contains replacement characters is rejected
- **WHEN** a tenant uploads a UTF-8 CSV whose text contains U+FFFD
- **THEN** the file is rejected with code `CSV_ENCODING_UNREADABLE` and no article is created from that file

### Requirement: 知識庫管理只作用在本租戶的資料
文章與回報的查詢、修改、發布、封存、刪除與重新向量化 SHALL 只作用在操作者租戶的資料。文章或回報不存在，或屬於另一個租戶時，系統 SHALL 回 404 `NOT_FOUND`，而且 MUST NOT 修改任何資料。

#### Scenario: 列出文章
- **WHEN** A 租戶的成員呼叫 `GET /api/v1/knowledge`，A、B 兩個租戶都有文章
- **THEN** 回應只包含 A 租戶的文章，`meta.total` 只計算 A 租戶的文章

#### Scenario: 讀取另一個租戶的文章
- **WHEN** A 租戶的成員以 B 租戶的文章 id 呼叫 `GET /api/v1/knowledge/:id`
- **THEN** 系統回 404，B 租戶文章的 `viewCount` 不變

#### Scenario: 修改另一個租戶的文章
- **WHEN** A 租戶的成員以 B 租戶的文章 id 呼叫 `PATCH /api/v1/knowledge/:id`、`POST /api/v1/knowledge/:id/publish`、`POST /api/v1/knowledge/:id/archive` 或 `DELETE /api/v1/knowledge/:id`
- **THEN** 每個端點都回 404，B 租戶的文章的內容與狀態不變，文章仍存在

#### Scenario: 重新向量化不存在或另一個租戶的文章
- **WHEN** 成員以不存在的文章 id，或 B 租戶的文章 id，呼叫 `POST /api/v1/knowledge/:id/embed`
- **THEN** 系統回 404 `NOT_FOUND`，沒有呼叫向量化服務

#### Scenario: 處理另一個租戶的回報
- **WHEN** A 租戶的成員以 B 租戶的回報 id 呼叫 `PATCH /api/v1/knowledge/feedback/:id/resolve`
- **THEN** 系統回 404，B 租戶的回報仍是 `open`

### Requirement: 文章寫入在 commit 之後才開始向量化
建立、修改標題或內容或摘要、發布沒有向量的文章、批次匯入、檔案上傳與合作方推送寫入文章之後，系統 SHALL 在寫入的交易 commit 之後才開始向量化這篇文章。每篇文章每次寫入 SHALL 最多開始一次。交易 rollback 時，系統 MUST NOT 開始向量化。回應 MUST NOT 等待向量化完成。

開始之前或向量化途中處理程序結束時，這篇文章沒有新的向量，之後沒有程式會自動重做。這是已知的限制，管理員可以用重新向量化補上。

#### Scenario: commit 之後開始向量化
- **WHEN** 成員呼叫 `POST /api/v1/knowledge` 建立文章，交易 commit
- **THEN** 系統以這篇文章的 id 開始向量化一次，開始時讀得到這篇文章

#### Scenario: rollback 時不開始向量化
- **WHEN** 寫入文章的交易在文章寫入之後 rollback
- **THEN** 系統沒有開始向量化，資料庫沒有這篇文章

#### Scenario: 向量化失敗不影響回應
- **WHEN** 向量化服務回錯誤
- **THEN** 建立文章的回應仍是 201，文章存在而且沒有向量，失敗寫進 log

#### Scenario: 只改分類或標籤時不重新向量化
- **WHEN** 成員以 `PATCH /api/v1/knowledge/:id` 只修改 `category` 或 `tags`
- **THEN** 系統沒有開始向量化

### Requirement: 合作方推送的附件在交易外上傳
合作方推送 SHALL 在寫入文章的交易開始之前上傳附件，交易內 MUST NOT 呼叫儲存服務。單一附件的內容偵測或上傳失敗時，系統 SHALL 略過這個附件，照樣寫入文章，`attachmentsLinked` 不計算這個附件。

寫入的交易 SHALL 先鎖住同一個 DocID 的既有文章，再檢查一次 `Ver`。這時文章的 `externalVer` 已經大於或等於這次的 `Ver` 時，系統 SHALL 回 `skipped`，MUST NOT 修改文章。

#### Scenario: 一個附件上傳失敗
- **WHEN** 合作方以 `IsAttached=true` 推送兩個附件，其中一個上傳失敗
- **THEN** 系統回 200，文章寫入，`data.attachmentsLinked` 是 1，文章只有成功的那個附件

#### Scenario: 上傳期間另一個推送寫入較新的版本
- **WHEN** 這次推送的附件上傳期間，同一個 DocID 的另一個推送以較大的 `Ver` 寫入完成
- **THEN** 這次推送回 200 `data.status="skipped"`，文章維持另一個推送寫入的內容

#### Scenario: 兩個推送同時寫入同一篇文章
- **WHEN** 文章是 Ver 1，Ver 3 的推送在寫入的交易內、還沒 commit 時，Ver 2 的推送進入寫入的交易
- **THEN** Ver 2 的推送等 Ver 3 commit 之後才判斷，回 200 `data.status="skipped"`；文章是 Ver 3 的內容

### Requirement: 合作方推送沒有寫入時刪除這次上傳的檔案
合作方推送確定沒有寫入文章時，系統 SHALL 從儲存服務刪除這次上傳的檔案，每個檔案最多刪除一次。確定沒有寫入的情況是：寫入的交易回 `skipped`、寫入的交易丟出錯誤之後 rollback。刪除失敗時，系統 SHALL 寫 log，回應不受影響。

寫入的交易都執行完、commit 卻回錯誤時，資料庫可能已經寫入，系統 MUST NOT 刪除這些檔案。開始寫入之前處理程序結束時，檔案留在儲存服務。

#### Scenario: 寫入文章失敗
- **WHEN** 附件上傳成功之後，寫入文章的交易丟出錯誤
- **THEN** 系統回 500 `INGEST_FAILED`，資料庫沒有這次的文章與附件資料列，系統從儲存服務刪除這次上傳的檔案

#### Scenario: 回 skipped 時刪除這次上傳的檔案
- **WHEN** 這次推送上傳附件之後，寫入的交易判斷版本不夠新，回 `skipped`
- **THEN** 系統從儲存服務刪除這次上傳的檔案

#### Scenario: commit 結果不明時保留檔案
- **WHEN** 寫入的交易都執行完，commit 回錯誤
- **THEN** 系統沒有刪除這次上傳的檔案，錯誤寫進 log

### Requirement: 刪除附件資料列之後刪除 S3 上的檔案
合作方推送以新版本覆蓋文章，或成員以 `DELETE /api/v1/knowledge/:id` 刪除文章時，系統 SHALL 在交易 commit 之後，從儲存服務刪除被刪掉的附件資料列的檔案。每個檔案 SHALL 最多刪除一次。刪除失敗時，系統 SHALL 寫 log，回應不受影響，檔案留在儲存服務。交易 rollback 時，系統 MUST NOT 刪除檔案。

合作方以 `cmd=DELETE` 封存文章時，附件與檔案依「Partner Doc Mutation Command」保留。

#### Scenario: 覆蓋文章時刪除舊附件的檔案
- **WHEN** 文章有附件 X，合作方以較新的 `Ver` 推送 `cmd=UPDATE` 與新附件 Y
- **THEN** commit 之後，系統從儲存服務刪除 X 的檔案；文章只有附件 Y，Y 的檔案仍在

#### Scenario: 刪除文章時刪除附件的檔案
- **WHEN** 成員以 `DELETE /api/v1/knowledge/:id` 刪除有附件的文章
- **THEN** 系統回 200 `data.deleted=true`，commit 之後從儲存服務刪除這些附件的檔案

#### Scenario: 刪除檔案失敗
- **WHEN** 儲存服務刪除檔案時回錯誤
- **THEN** 覆蓋或刪除的回應仍成功，失敗寫進 log

#### Scenario: 寫入失敗時不刪除舊檔案
- **WHEN** 覆蓋文章的交易 rollback
- **THEN** 舊附件的資料列與檔案都還在

### Requirement: 批次匯入的每篇文章各自寫入
`POST /api/v1/knowledge/import`，以及 `POST /api/v1/knowledge/upload` 把 QA 表拆成多篇文章時，系統 SHALL 分別寫入每篇文章。一篇寫入失敗時，其他篇 SHALL 照樣寫入。回應 SHALL 以 `imported` 計算寫入成功的篇數，以 `failed` 計算失敗的篇數，`errors` 列出每篇失敗的標題與原因。

#### Scenario: 一篇寫入失敗
- **WHEN** 成員匯入三篇文章，第二篇寫入資料庫時失敗
- **THEN** 系統回 200，`data.imported` 是 2，`data.failed` 是 1，`data.errors` 有第二篇的標題；資料庫有第一篇與第三篇

### Requirement: 知識庫路由驗證查詢參數與路徑參數
知識庫的路由 SHALL 在讀寫資料之前驗證下列參數，不合法時回 400 `VALIDATION_ERROR`，MUST NOT 讀寫資料：

- 文章與回報的 `:id` 必須是 UUID。
- `GET /api/v1/knowledge` 的 `page` 必須是正整數，`limit` 必須是 1 到 100 的整數；沒有給 `limit` 時預設 50。
- `GET /api/v1/knowledge/feedback` 的 `articleId` 必須是 UUID，`status` 只能是 `open` 或 `resolved`。

#### Scenario: 文章 id 格式錯誤
- **WHEN** 成員以不是 UUID 的值當作 `:id` 呼叫任一個文章端點
- **THEN** 系統回 400 `VALIDATION_ERROR`

#### Scenario: 分頁參數超出範圍
- **WHEN** 成員以 `page=0` 或 `limit=101` 呼叫 `GET /api/v1/knowledge`
- **THEN** 系統回 400 `VALIDATION_ERROR`

#### Scenario: 沒有給每頁筆數
- **WHEN** 成員呼叫 `GET /api/v1/knowledge` 而沒有 `limit`
- **THEN** 回應的 `meta.limit` 是 50

#### Scenario: 回報的篩選值不合法
- **WHEN** 成員以 `status=closed` 或不是 UUID 的 `articleId` 呼叫 `GET /api/v1/knowledge/feedback`
- **THEN** 系統回 400 `VALIDATION_ERROR`

### Requirement: 讀取知識庫需要檢視權限
下列讀取路由 SHALL 要求成員的有效權限包含 `knowledge.view`：`GET /api/v1/knowledge`、`GET /api/v1/knowledge/:id`、`GET /api/v1/knowledge/sources`、`GET /api/v1/knowledge/categories`、`POST /api/v1/knowledge/search`、`GET /api/v1/knowledge/embedding-status`、`GET /api/v1/knowledge/models`、`GET /api/v1/knowledge/feedback/counts`、`GET /api/v1/knowledge/feedback`。有效權限不含 `knowledge.view` 時，系統 SHALL 回 403 `FORBIDDEN`，`error.details.requiredPermission` 是 `knowledge.view`，MUST NOT 讀取資料。

#### Scenario: 角色沒有檢視權限
- **WHEN** 角色只有 `inbox.view` 的成員呼叫上述任一條路由
- **THEN** 系統回 403 `FORBIDDEN`，`error.details.requiredPermission` 是 `knowledge.view`

#### Scenario: 角色有檢視權限
- **WHEN** 角色只有 `knowledge.view` 的成員呼叫 `GET /api/v1/knowledge`
- **THEN** 系統回 200
