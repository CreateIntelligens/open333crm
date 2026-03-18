## Context

The open333CRM project requires a sophisticated "Brain" module to power its AI-assisted customer service. The current infrastructure supports a single-tenant (one instance per group) model, which makes file-based vector storage like LanceDB an ideal choice for high performance without the overhead of a managed vector database service.

## Goals / Non-Goals

**Goals:**
- **Hybrid Search**: Implement a retrieval system that combines semantic vector search (LanceDB) with keyword matching (BM25).
- **Multi-modal Ingestion**: Support automated conversion of PDFs, Docx, and Audio files into searchable Markdown using Markitdown and Whisper.
- **Contextual Memory**: Implement an on-demand "Long-Term Memory" (LTM) that retrieves relevant past conversations based on semantic similarity triggers.
- **Isolation & Versioning**: Support strict filtering of knowledge based on product version and departmental team ownership using metadata.

**Non-Goals:**
- **Real-time Training**: This design excludes fine-tuning or training LLMs; it focuses entirely on RAG-based retrieval.
- **Self-Service Customer Bot**: The primary focus is assisting human agents, not replacing them with a standalone customer-facing chatbot.

## Decisions

- **LanceDB + BM25 Hybrid**: We will use LanceDB's native vector storage for semantic search and augment it with a side-car BM25 index (or LanceDB's FTS if applicable) to handle product codes and technical jargon that vector embeddings often miss.
- **Similarity-Triggered LTM**: To minimize token consumption and prompt noise, contact-specific history is only retrieved when the current query's similarity score to existing memory entries meets or exceeds 0.82.
- **Workspace Local Storage**: Persistent data (LanceDB tables, Markdown files) will be stored in a root `/workspace` directory, mapped via Docker volumes to ensure data longevity and easy debugging.
- **Embedding Provider Abstraction**: Implement a factory pattern to switch between local (BGE-M3 via Ollama/Local) and cloud (Gemini 2 / OpenAI) embedding models based on the group's license tier.

## Risks / Trade-offs

- **[Risk] Embedding Model Drift** → [Mitigation] We will store the `embeddingModel` used for each article and memory entry in its metadata. If the system-wide model changes, we will trigger a re-indexing job.
- **[Risk] Performance Bottleneck in BM25** → [Mitigation] Keep the BM25 index lightweight and focused on top-k candidates before re-ranking with the vector results.
- **[Risk] Low Search Quality in Specific Languages** → [Mitigation] Default to `BGE-M3` or `Gemini` which have strong multi-lingual (Traditional Chinese) support.
