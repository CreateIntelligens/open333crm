## ADDED Requirements

### Requirement: Prisma ORM
The project SHALL use Prisma as the primary ORM for database interactions, supporting type-safe queries and migrations.

#### Scenario: Prisma client generation
- **WHEN** running `npx prisma generate`
- **THEN** the Prisma client is generated based on the schema and available for use in the codebase

### Requirement: Core Entities
The database schema SHALL include all entities defined in `16_DB_SCHEMA.md`: `Agent`, `Team`, `Channel`, `Contact`, `ChannelIdentity`, `ContactAttribute`, `ContactRelation`, `Tag`, `ContactTag`, `Conversation`, `Message`, `Case`, `CaseEvent`, `CaseNote`, `SlaPolicy`, `AutomationRule`, `AutomationLog`, `KmArticle`, `MessageTemplate`, `MarketingCampaign`, `Broadcast`, `Segment`, and `WebhookSubscription`.

#### Scenario: Database migration
- **WHEN** running `npx prisma migrate dev`
- **THEN** all tables defined in `16_DB_SCHEMA.md` are created correctly

### Requirement: Group Sharing and Departmental Isolation
The database schema SHALL support a single-tenant group model where contacts are shared across the entire instance. Isolation between departments SHALL be handled at the `Conversation` and `Case` level using `teamId`.

#### Scenario: Departmental inbox filtering
- **WHEN** a conversation is assigned to a department
- **THEN** the `teamId` is set, allowing filtered views for that department's agents
