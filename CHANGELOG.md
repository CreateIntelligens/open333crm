# Changelog

All notable changes to the **open333CRM** project will be documented in this file.

## [Unreleased] — 0.2.0 (multi-channel-billing)

> **\u72c0\u614b**\uff1aOpenSpec \u958b\u653e\u4e2d\uff0c\u5be6\u4f5c\u9707\u524d\u3002\u8b8a\u66f4\u7531 `openspec/changes/multi-channel-billing` \u7ba1\u7406\u3002

### Planned: Added
- **Telegram Channel Plugin** \u2014 \u652f\u63f4\u6587\u5b57\u3001\u5716\u7247\u3001\u8cbc\u5716\u3001\u4f4d\u7f6e\u3001Callback Query\uff08\u6309\u9215\uff09\u6536\u767c
- **Threads Channel Plugin** \u2014 \u652f\u63f4 Instagram Threads / DM \u6587\u5b57\u3001\u5716\u7247\u3001Story Reply\u3001Like \u53cd\u61c9
- **ChannelType enum** \u2014 \u65b0\u589e `TELEGRAM`\u3001`THREADS` \u5000\u8207 `packages/types`
- **Channel-Team Access (ChannelTeamAccess)** \u2014 Channel \u591a\u90e8\u9580\u5171\u7528\u6388\u6b0a\uff0c\u652f\u63f4 `full` / `read_only` \u5b58\u53d6\u5c64\u7d1a
- **Channel Billing** \u2014 License JSON \u6e20\u9053\u6578\u91cf\u9650\u5236\uff08`maxCount`\uff09\u3001\u6bcf\u5247\u8a0a\u606f\u8cbb\u7528\uff08`messageFee`\uff09\u8a55\u4f30
- **Team License (multi-dept)** \u2014 License JSON \u652f\u63f4 `teams[]` \u96a3\u5217\uff0c\u5404\u90e8\u9580\u72ec\u7acb\u6e20\u9053\u984d\u5ea6\u8207 Credits
- **ChannelUsage tracking** \u2014 \u6bcf\u5247\u8a0a\u606f\u8a08\u8cbb\u8a18\u9304\uff08\u6e20\u9053 / \u90e8\u9580 / \u65b9\u5411 / \u8cbb\u7528\uff09
- **Channel Usage Report API** \u2014 \u6e20\u9053\u7528\u91cf / \u8cbb\u7528\u5206\u6524\u5831\u8868\u8207 CSV \u532f\u51fa

### Planned: Changed
- **LicenseService** \u2014 \u65b0\u589e `getTeamLicense()`, `isFeatureEnabledForTeam()`, `hasCreditsForTeam()`, `deductCreditsForTeam()` \u591a\u90e8\u9580\u65b9\u6cd5
- **Channel creation API** \u2014 \u652f\u63f4 `defaultTeamId`\uff0c\u5efa\u7acb\u6642\u81ea\u52d5\u5efa\u7acb 1 \u7b46 ChannelTeamAccess
- **Credits system** \u2014 \u6539\u70ba team-aware \u5224\u65b7\uff0c\u8cbb\u7528\u5f52\u5c6c\u5c0d\u61c9\u90e8\u9580

### Planned: DB Schema
- **New**: `channel_team_accesses` \u8868\uff08Channel \u591a\u5c0d\u591a Team\uff09
- **New**: `channel_usages` \u8868\uff08\u8a0a\u606f\u8a08\u8cbb\u8a18\u9304\uff09
- **Modified**: `teams` \u8868\u65b0\u589e `licenseTeamId` \u6b04\u4f4d\uff08\u5c0d\u61c9 License JSON teamId\uff09

---

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
