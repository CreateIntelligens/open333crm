## ADDED Requirements

### Requirement: Similarity-triggered LTM Retrieval
The system SHALL implement an on-demand retrieval strategy for contact-specific conversation history, triggering the lookup only when the current query's semantic similarity to past topics exceeds a configurable threshold (default 0.82).

#### Scenario: "似曾相識" (Similarity) trigger
- **WHEN** a new message's embedding has a similarity score >= 0.82 with archived conversation summaries for that contact
- **THEN** the system retrieves the relevant past context and includes it in the LLM prompt.

### Requirement: Conversation Summarization for Vectorization
The system SHALL periodically and asynchronously summarize finished conversations and store these summaries as vector embeddings in a contact-specific memory space.

#### Scenario: Automated summarization
- **WHEN** a conversation is marked as 'CLOSED'
- **THEN** a background job generates a concise summary and indexes it as a "Long-Term Memory" entry for the associated contact.
