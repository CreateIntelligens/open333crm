## Why

The open333CRM needs a sophisticated brain to provide accurate, context-aware assistance. Currently, there is no centralized repository for product knowledge or a way to remember past interactions with specific contacts. Implementing a RAG-based system using LanceDB and BM25 hybrid search will enable the AI to suggest highly relevant replies based on both company documentation and individual contact history, significantly improving customer service quality and efficiency.

## What Changes

- **New `@open333crm/brain` Package**: A shared package to encapsulate embedding logic, LanceDB interactions, and BM25 indexing.
- **Enhanced KM Schema**: Refactoring the `KmArticle` model to support versioning (co-existence), departmental (team) isolation, and model-specific metadata.
- **Markitdown Integration**: Implementing an automated pipeline to convert multi-modal inputs (PDF, Docx, Audio) into standardized Markdown for RAG.
- **Hybrid Search Engine**: Providing a search service that combines semantic vector search (LanceDB) with keyword matching (BM25).
- **On-demand Long-Term Memory (LTM)**: A retrieval mechanism that triggers historical conversation lookup only when a "似曾相識" (similarity) threshold is met.

## Capabilities

### New Capabilities
- `km-ingestion`: Automating the conversion of diverse file types to Markdown and their subsequent vectorization.
- `brain-search`: A hybrid search service (Semantic + Keyword) with strict metadata filtering for versions and departments.
- `long-term-memory`: A specialized retrieval service that fetches and summarizes contact-specific history based on semantic similarity triggers.

## Impact

- **Database**: Significant updates to `packages/database` schema and Prisma client.
- **API**: New endpoints for knowledge management and AI-assisted reply generation.
- **Dependencies**: New dependencies on `lancedb`, `markitdown`, and embedding providers (Gemini/OpenAI/Ollama).
- **Storage**: Use of workspace-bound storage for LanceDB files and original uploaded documents.
