## Purpose

讓 Knowledge Base 的內容管理、搜尋、回報調教、Embedding 與 Chat & Prompt 成為可直接理解與直達的功能節點，避免重要 AI 設定被藏在第五個頂部分頁。

## ADDED Requirements

### Requirement: Knowledge Base feature tree

The Knowledge Base navigation SHALL expose separate named destinations for article management, semantic search, feedback tuning, Embedding settings, and Chat & Prompt. These destinations SHALL appear as sibling or intentionally grouped tree nodes under Knowledge Base.

#### Scenario: User opens Knowledge Base
- **WHEN** the user selects Knowledge Base from the dashboard tree
- **THEN** the tree SHALL reveal its feature destinations and SHALL not require the user to inspect an unlabeled or position-dependent tab strip

#### Scenario: User opens Chat & Prompt
- **WHEN** the user selects Chat & Prompt from the Knowledge Base tree
- **THEN** the application SHALL navigate directly to the Chat & Prompt canonical route and render the settings without first rendering Article Management as an intermediate state

#### Scenario: User opens Embedding settings
- **WHEN** the user selects Embedding from the Knowledge Base tree
- **THEN** the application SHALL navigate directly to the Embedding canonical route with its own active navigation state

### Requirement: Knowledge Base canonical routes

Each Knowledge Base feature SHALL have a stable canonical URL. Existing `/dashboard/knowledge` links SHALL remain compatible through a default landing destination or redirect, and legacy tab query parameters SHALL be migrated or interpreted without losing the selected feature.

#### Scenario: Direct link to a feature
- **WHEN** a user opens a copied canonical URL for Search, Feedback, Embedding, or Chat & Prompt
- **THEN** the corresponding feature SHALL render directly and the Knowledge Base tree SHALL identify it as active

#### Scenario: Legacy Knowledge Base URL
- **WHEN** a user opens the existing Knowledge Base URL or a legacy tab query URL
- **THEN** the application SHALL resolve it to a canonical destination while preserving the intended feature where one is specified

### Requirement: Knowledge Base content and settings separation

The tree and page layout SHALL visually distinguish content work from AI runtime configuration. Article management, semantic search, and feedback SHALL form the content/quality branch; Embedding and Chat & Prompt SHALL form the AI configuration branch.

#### Scenario: User scans Knowledge Base navigation
- **WHEN** the user views the expanded Knowledge Base tree
- **THEN** the user SHALL be able to identify which nodes edit knowledge content and which nodes configure AI behavior without opening each page

#### Scenario: Permission-restricted AI settings
- **WHEN** a user can view Knowledge Base content but lacks permission to manage AI settings
- **THEN** content nodes SHALL remain available and restricted configuration nodes SHALL not be actionable

### Requirement: A2A connection visibility in settings

The redesigned tree SHALL place A2A connection status and non-secret configuration under a visible Settings > Integrations > A2A destination. The UI SHALL never display `A2A_HUB_KEY` or `A2A_AGENT_TOKEN` values.

#### Scenario: A2A is configured
- **WHEN** the user with integration-management permission opens Settings > Integrations > A2A
- **THEN** the page SHALL show safe status information such as connection state, Agent ID mask, tenant binding state, last successful connection, and last error without exposing credentials

#### Scenario: A2A is not configured
- **WHEN** the A2A bridge is disabled or missing required runtime secrets
- **THEN** the page SHALL show a clear setup/inactive state and SHALL not offer a browser-side Hub key input as a replacement for deployment secret configuration
