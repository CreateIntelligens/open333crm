## ADDED Requirements

### Requirement: Hybrid Search (Semantic + BM25)
The brain service SHALL perform a hybrid search that combines vector similarity from LanceDB with keyword relevance from a BM25 index to ensure high retrieval quality for both semantic meaning and specific technical terms.

#### Scenario: Technical term matching
- **WHEN** a user query contains specific model numbers or technical jargon
- **THEN** the BM25 index ensures these terms receive high relevance weight in the final result set.

### Requirement: Metadata Filtering for Versioning and Teams
The search engine SHALL support strict metadata filtering based on `version` and `teamId` to ensure the AI only cites knowledge relevant to the specific product version and department context.

#### Scenario: Department-isolated search
- **WHEN** a search request is initiated with a `teamId` constraint
- **THEN** the system filters out all KM articles that do not belong to that team or the global namespace.
