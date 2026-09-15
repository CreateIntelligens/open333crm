## MODIFIED Requirements

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
