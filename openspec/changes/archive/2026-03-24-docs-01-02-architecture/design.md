## Context

The open333CRM platform needs a foundational system architecture established before downstream features (channels, LLM, marketing) can be built. This architecture is defined in `docs/01_DOMAIN_MODEL.md` and `docs/02_SYSTEM_ARCHITECTURE.md`. The current state is essentially an empty repository, and we need to translate the documented concepts into a physical backend structure.

## Goals / Non-Goals

**Goals:**
- Establish the PostgreSQL database schema with `pgvector` for core entities.
- Integrate Redis for caching, WebSockets, and BullMQ task queues.
- Standardize the API gateway and routing structure.
- Define plugin interfaces for Channels and Storage to allow decoupled development.

**Non-Goals:**
- We will NOT implement specific channels (like LINE or FB) in this change.
- We will NOT implement the UI/Frontend interfaces.
- We will NOT write the complete logic for complex automation scenarios (just the engine foundation).

## Decisions

1. **Database ORM**: We will use Prisma ORM for database modeling and migrations.
   - *Rationale*: Prisma provides excellent TypeScript safety, a single source of truth for schema, and robust support for PostgreSQL.
   - *Alternatives considered*: TypeORM (more verbose), raw SQL (harder to maintain schema).
2. **Message Queue**: We will use BullMQ on Redis.
   - *Rationale*: Native TypeScript support, built-in retry and cron features, works smoothly for automation engine and broadcast workers.
3. **Event Bus**: Intra-service events will be broadcast using Redis Streams or Pub/Sub.
   - *Rationale*: Allows decoupled microservices/workers to react to events like `message.received` or `case.created` asynchronously.
4. **Storage Abstraction**: Use an interface-driven approach for Storage (`upload`, `getPublicUrl`) to easily default to MinIO and swap to S3 in production.
   - *Rationale*: Satisfies the requirement of portable on-premise deployments.

## Risks / Trade-offs

- [Risk] **High WebSocket Concurrency**: If thousands of concurrent connections are open, the Node server might become a bottleneck.
  - *Mitigation*: Start with sticky sessions and Redis adapter for Socket.io scaling.
- [Risk] **Complex Automation Engine Evaluation**: Event-driven rules can cause infinite loops if actions trigger more rules.
  - *Mitigation*: Implement a max depth or cooldown per rule execution per conversation context.
- [Risk] **Schema Migration Overhead**: Rapidly changing models during early development could result in messy Prisma migrations.
  - *Mitigation*: Consolidate the initial schema heavily before creating the first migration.

## Migration Plan

1. Setup Prisma schema and run `prisma db push` locally.
2. Initialize Node environments with fastify/express.
3. Set up Docker compose for Redis, MinIO, and Postgres.
