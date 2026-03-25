## 1. Database and Schema Foundation

- [x] 1.1 Setup PostgreSQL database with `pgvector` extension in Docker Compose
- [x] 1.2 Initialize Prisma ORM in the project
- [x] 1.3 Create Prisma schema for `Contact`, `ChannelIdentity`, and `ContactRelation`
- [x] 1.4 Create Prisma schema for `Conversation`, `Message`, `Case`, and `CaseEvent`
- [x] 1.5 Create Prisma schema for `AutomationRule`, `Trigger`, `Condition`, and `Action`
- [x] 1.6 Generate and apply initial Prisma migration

## 2. Platform Infrastructure

- [x] 2.1 Set up Redis caching and BullMQ connection utilities
- [x] 2.2 Construct the Event Bus mechanism (using Redis Pub/Sub or Streams)
- [x] 2.3 Implement the Storage Layer abstract interface (`StorageProvider`)
- [x] 2.4 Implement the MinIO concrete `StorageProvider` for local environments
- [x] 2.5 Implement the `LicenseService` singleton to fetch and cache tenant capabilities

## 3. Core Services

- [x] 3.1 Implement `core-inbox` service to handle universal message ingestion and WebSocket broadcasting
- [x] 3.2 Implement `contact-management` service for identity merging and tagging
- [x] 3.3 Implement `case-management` service for case lifecycle and SLA monitoring (via BullMQ delayed jobs)
- [x] 3.4 Implement the `automation-engine` to evaluate rules against the Event Bus
- [x] 3.5 Implement `channel-plugins` interface for webhook handling and routing to `core-inbox`

## 4. Initialization and API Gateway

- [x] 4.1 Set up the main API Gateway server (e.g. using Fastify/Express)
- [x] 4.2 Register core service routes (CRUD for cases, contacts, auto-rules)
- [x] 4.3 Configure webhook endpoints for future channel bindings
- [x] 4.4 Set up basic WebSocket server attached to the API Gateway
