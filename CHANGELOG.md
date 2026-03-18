# Changelog

All notable changes to the **open333CRM** project will be documented in this file.

## [0.1.0] - 2026-03-18

### Added
- **Brain Module**: New `@open333crm/brain` package for KM and LTM logic.
- **Hybrid Search**: Implemented LanceDB + BM25 FTS for semantic and keyword search.
- **Multimodal Ingestion**: Integrated `markitdown` (Python) and `Whisper` for PDF/Docx/Audio to Markdown conversion.
- **Long-Term Memory (LTM)**: Added contact-specific conversation summarization and similarity-triggered retrieval (0.82 threshold).
- **Persistent Workspace**: Configured bind-mount for `/workspace` in Docker to persist vector data.
- **Monorepo Architecture**: Initialized with `pnpm` workspaces and `Turborepo`.
- **Database Layer**: Prisma schema implementation for 20+ entities with `pgvector` support (`packages/database`).
- **Automation Core**: Integrated `json-rules-engine` for Drools-like rule evaluation (`packages/automation`).
- **API Skeleton**: Fastify server with JWT, CORS, and WebSocket support (`apps/api`).
- **Web Skeleton**: Next.js 15 (App Router) dashboard with Tailwind CSS (`apps/web`).
- **Platform Billing (Taishang Huang)**: Implemented `LicenseService` for instance-level feature flags and credit management.
- **Infrastructure**: `docker-compose.yml` for PostgreSQL, Redis, MinIO, and Caddy.
- **CI Pipeline**: GitHub Actions for automated linting and building.

### Changed
- **Architectural Pivot**: Moved from record-level multi-tenancy (`tenantId` per row) to a **Single-tenant Group Mode**.
- **Schema Evolution**: Added `KmArticle` versioning, `teamId` isolation, and a new `LongTermMemory` model.
- **Schema Simplification**: Removed all `tenantId` fields; added `teamId` to `Conversation` for departmental isolation (B-1 Option).

### Fixed
- **ESM Support**: Resolved module resolution issues for top-level await and `.js` extensions in imports.
- **Turbo 2.0 Compatibility**: Updated `turbo.json` with correct task syntax.
