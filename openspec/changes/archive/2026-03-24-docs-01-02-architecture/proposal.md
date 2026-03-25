## Why

We need to translate the high-level domain model and system architecture defined in `docs/01_DOMAIN_MODEL.md` and `docs/02_SYSTEM_ARCHITECTURE.md` into concrete technical implementations. This foundational architecture will establish the core services, data models, and communication patterns required for the open333CRM platform to operate, serving as the base for all subsequent features like channels, LLM integrations, and marketing campaigns.

## What Changes

- Implement the core PostgreSQL database schema using Prisma/TypeORM or raw SQL (to be decided in design) with `pgvector` support.
- Set up the Redis infrastructure for caching, rate limiting, WebSocket broadcasting, and BullMQ task queues.
- Implement the internal Event Bus and WebSocket pushing mechanisms.
- Establish the base modules for `Core Inbox`, `Case Service`, `Contact Service`, and `Automation Engine`.
- Define the standard interfaces for the `Channel Plugin Layer` and `Storage Layer`.
- Construct the `LicenseService` infrastructure for tenant capability management.

## Capabilities

### New Capabilities
- `core-inbox`: Message receiving, conversation lifecycle management, and WebSocket broadcasting.
- `case-management`: Case CRUD operations, status machine, assignment logic, and SLA monitoring.
- `contact-management`: Identity resolution across channels, tagging, and contact attributes.
- `automation-engine`: Rule storage, event listening, and action execution (e.g., auto-reply, auto-tag).
- `channel-plugins`: Universal interface for messaging adapters (Webhook receiving and sending).
- `storage-layer`: Abstract interface for local (MinIO) and remote (S3/GCS) media storage.
- `license-service`: Tenant capability parsing, feature guarding, and token limitation.

### Modified Capabilities

## Impact

This will create the core backend structure for the MVP API server and Workers. All external channels (LINE, FB) and internal business logic (Marketing, RAG) will strictly depend on these services. It establishes the database schema for PostgreSQL and Redis queues, affecting all future development in this repository.
