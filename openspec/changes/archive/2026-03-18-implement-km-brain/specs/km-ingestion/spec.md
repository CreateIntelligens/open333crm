## ADDED Requirements

### Requirement: Multi-modal Ingestion via Markitdown
The system SHALL support converting PDF, Docx, and Audio files to Markdown using the Markitdown library (or equivalent utility) to ensure a standardized text format for the RAG pipeline.

#### Scenario: Audio file ingestion
- **WHEN** an audio file is uploaded to the KM ingestion endpoint
- **THEN** the system uses a transcription service (like Whisper) to generate a Markdown file and saves it to the workspace.

### Requirement: Automated Vectorization and Indexing
The system SHALL automatically generate embeddings for new or updated KM articles and store them in the LanceDB vector store.

#### Scenario: Successful vectorization
- **WHEN** a Markdown file is processed for ingestion
- **THEN** the system splits it into semantic chunks, generates embeddings using the configured provider, and upserts them into LanceDB along with metadata.
