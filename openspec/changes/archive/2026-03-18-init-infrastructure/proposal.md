## Why

The current CRM system faces severe architectural limitations including tight coupling with PHP/HTML, lack of external APIs, and a monolithic structure that makes adding new channels (e.g., FB, WhatsApp) nearly impossible. To solve these problems and achieve the vision of a "Channel Agnostic, Event-Driven, Plugin-First" CRM, we need a modern Monorepo foundation that supports rapid, parallel development across Backend and Frontend teams.

## What Changes

- Initialize a **Monorepo** structure using `pnpm` and `Turborepo` to manage multiple packages and apps.
- Define the **Core Database Schema** using Prisma globally based on `16_DB_SCHEMA.md`, ensuring all tables support `tenant_id` and necessary indices.
- Integrate a **JSON-based Rule Engine** (Fact/Rule logic) for the automation module, supporting Drools-like pattern matching.
- Set up a **Local Development Environment** using Docker Compose (PostgreSQL with pgvector, Redis, MinIO).
- Establish a **CI Pipeline** with GitHub Actions for automated linting and building.
- Bootstrap the **Next.js Admin Dashboard** with a tailwind-based design system and `shadcn/ui`.

## Capabilities

### New Capabilities
- `monorepo-setup`: Structural foundation using pnpm workspace and Turbo for build orchestration.
- `database-schema`: Full data modeling based on `16_DB_SCHEMA.md` including pgvector for KM.
- `automation-engine-core`: Core logic for the Drools-like JSON rule engine supporting facts and rules.
- `local-environment`: Containerized infrastructure (DB, Cache, Storage) for consistent development.
- `ci-pipeline`: Automated quality gates for code standards and buildability.
- `frontend-skeleton`: Main UI framework with navigation, auth integration, and shared components.

### Modified Capabilities
<!-- No existing capabilities to modify in initial setup -->

## Impact

- **Codebase**: New directory structure (`apps/`, `packages/`).
- **Dev Workflow**: Developers will use `pnpm dev` to start all services locally.
- **Infrastructure**: Requirement for Docker and Node.js on developer machines.
