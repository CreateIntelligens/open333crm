## 1. Schema & Infrastructure

- [x] 1.1 Update `packages/database` schema for `KmArticle` (versioning, teamId, metadata)
- [x] 1.2 Create `packages/brain` package with basic structure and dependencies (lancedb, markitdown)
- [x] 1.3 Configure Docker volumes for `/workspace` persistence and map to container

## 2. KM Ingestion Engine

- [x] 2.1 Implement `MarkitdownService` for PDF/Docx to Markdown conversion
- [x] 2.2 Implement `WhisperService` (via API or local) for Audio to Markdown transcription
- [x] 2.3 Implement automated semantic chunking logic for large documents

## 3. Vector & Search Core

- [x] 3.1 Implement `LanceDBService` for basic vector storage and retrieval
- [x] 3.2 Implement `BM25Service` (or LanceDB FTS) for keyword-based indexing
- [x] 3.3 Create a `HybridSearchService` that merges, weights, and re-ranks results from both engines

## 4. Long-Term Memory (LTM)

- [x] 4.1 Implement asynchronous summarization worker for closed conversations
- [x] 4.2 Implement `MemoryService` for storing and retrieving contact-specific history in LanceDB
- [x] 4.3 Implement similarity-triggered retrieval logic in the suggestion pipeline (threshold 0.82)

## 5. API Integration & Guards

- [x] 5.1 Add `POST /api/v1/km/ingest` endpoint for file uploads and processing
- [x] 5.2 Add `POST /api/v1/brain/suggest` endpoint with hybrid search and LTM integration
- [x] 5.3 Apply departmental `teamId` filtering to all brain search requests
