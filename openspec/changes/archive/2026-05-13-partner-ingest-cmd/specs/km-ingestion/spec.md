## ADDED Requirements

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
