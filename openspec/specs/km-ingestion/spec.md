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
