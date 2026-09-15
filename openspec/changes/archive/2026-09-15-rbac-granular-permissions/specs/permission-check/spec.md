## ADDED Requirements

### Requirement: requirePermission Guard Factory
The API SHALL provide a `requirePermission(code: string)` Fastify preHandler factory exported from `apps/api/src/guards/rbac.guard.ts` that returns HTTP 403 if the authenticated agent's effective permission set does not contain `code`. It SHALL be placed after `fastify.authenticate` in the `preHandler` array.

#### Scenario: Agent with the permission passes through
- **GIVEN** a request is authenticated and the agent's role holds `channel.create`
- **WHEN** `requirePermission('channel.create')` runs as a preHandler
- **THEN** the request SHALL proceed to the route handler

#### Scenario: Agent without the permission is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `channel.create`
- **WHEN** `requirePermission('channel.create')` runs as a preHandler
- **THEN** the response SHALL be HTTP 403 with body `{ code: 'FORBIDDEN', message: 'Insufficient permission' }`

#### Scenario: Guard ordering
- **WHEN** a route uses `requirePermission(...)`
- **THEN** the `preHandler` array SHALL list `fastify.authenticate` before the permission guard

### Requirement: Effective Permission Set Resolution
The system SHALL resolve an agent's effective permission set as the union of (a) the explicit RolePermission codes of the agent's assigned role and (b) the transitive closure of all `implies` relationships of those codes. `dependsOn` prerequisites are already present as explicit rows and require no additional resolution.

#### Scenario: Explicit permissions included
- **GIVEN** a role holds explicit permissions `case.view` and `case.assign`
- **WHEN** the effective set is resolved
- **THEN** it SHALL contain `case.view` and `case.assign`

#### Scenario: Implied permissions added transitively
- **GIVEN** a role holds `case.assign` which implies `agent.view`, and `agent.view` implies nothing further
- **WHEN** the effective set is resolved
- **THEN** it SHALL contain `case.assign` and `agent.view`

### Requirement: Effective Permission Set Caching
The system SHALL cache the resolved effective permission set per role in Redis under key `perms:role:{roleId}` with a TTL of at most 10 minutes. The cache entry SHALL be invalidated (deleted) whenever that role's RolePermission assignments change.

#### Scenario: Cache hit avoids DB query
- **GIVEN** a role's effective permission set is already cached
- **WHEN** a permission check runs for an agent of that role
- **THEN** the check SHALL read from the cache without querying the database

#### Scenario: Cache invalidated on assignment change
- **GIVEN** a role's effective permission set is cached
- **WHEN** the role's RolePermission assignments are modified
- **THEN** the cache key `perms:role:{roleId}` SHALL be deleted before the modifying request returns

### Requirement: 403 Response Shape
When a permission check fails, the API SHALL respond with HTTP 403 and JSON body `{ code: 'FORBIDDEN', message: 'Insufficient permission' }`, consistent with the existing API error envelope.

#### Scenario: Permission check failure response
- **GIVEN** a request reaches a guarded route without the required permission
- **WHEN** the permission guard evaluates
- **THEN** the status SHALL be 403 and the body SHALL be `{ "code": "FORBIDDEN", "message": "Insufficient permission" }`

### Requirement: Current User Permission Endpoint
The API SHALL expose an endpoint (e.g. `GET /me/permissions`) that returns the authenticated agent's effective permission set as a list of codes, for the frontend to gate UI elements. It SHALL reflect the current cached/resolved set.

#### Scenario: Endpoint returns effective permissions
- **GIVEN** an authenticated agent whose role holds `inbox.view` and `inbox.reply`
- **WHEN** `GET /me/permissions` is called
- **THEN** the response SHALL include `inbox.view` and `inbox.reply`

### Requirement: Frontend Permission Gating
The frontend SHALL provide a `usePermission(code)` mechanism that returns whether the current user holds a permission, based on the set loaded from the current-user permission endpoint. Sidebar navigation entries and permission-gated action buttons SHALL be shown only when the corresponding permission is held. Frontend gating is a UX affordance only; the backend guard remains the authoritative enforcement.

#### Scenario: Menu entry hidden without permission
- **GIVEN** the current user does not hold `analytics.view`
- **WHEN** the sidebar renders
- **THEN** the Analytics navigation entry SHALL NOT be shown

#### Scenario: Menu entry shown with permission
- **GIVEN** the current user holds `analytics.view`
- **WHEN** the sidebar renders
- **THEN** the Analytics navigation entry SHALL be shown

#### Scenario: Backend remains authoritative
- **GIVEN** a user bypasses frontend gating and calls a guarded API without the permission
- **WHEN** the request reaches the backend
- **THEN** the backend guard SHALL still return HTTP 403
