## ADDED Requirements

### Requirement: Single Authoritative API Entrypoint
The API service SHALL use `apps/api/src/index.ts` as its sole authoritative runtime bootstrap entrypoint.

#### Scenario: Development runtime starts API service
- **WHEN** a developer starts the API service in local development
- **THEN** the process SHALL bootstrap the server from `apps/api/src/index.ts`

#### Scenario: Production runtime starts API service
- **WHEN** the built API service starts in production
- **THEN** the process SHALL bootstrap the server from the build output generated from `apps/api/src/index.ts`

### Requirement: Transitional Entrypoints Must Delegate
Any retained transitional bootstrap file, including `apps/api/src/main.ts`, SHALL delegate into `apps/api/src/index.ts` and MUST NOT construct an independent server bootstrap.

#### Scenario: Compatibility file remains in repository
- **WHEN** `apps/api/src/main.ts` is retained for compatibility
- **THEN** it SHALL delegate to `apps/api/src/index.ts` without defining a second plugin, route, or worker registration path

### Requirement: Bootstrap Consolidation Preserves Active Runtime Behavior
The authoritative `apps/api/src/index.ts` bootstrap SHALL preserve all active route, plugin, channel registration, and worker setup behavior that was reachable from the previous production bootstrap.

#### Scenario: Entrypoint consolidation is completed
- **WHEN** the API bootstrap is moved under `apps/api/src/index.ts`
- **THEN** every route module, channel plugin, scheduler, and worker that was actively registered in the prior runtime path SHALL remain registered from `apps/api/src/index.ts`
