## MODIFIED Requirements

### Requirement: Guard Factory
The API SHALL provide a permission-based `requirePermission(code: string)` Fastify preHandler factory exported from `apps/api/src/guards/rbac.guard.ts` that returns HTTP 403 if the authenticated agent's effective permission set does not contain `code`. The legacy `requireRole(allowedRoles)` factory MAY be retained during migration but new routes SHALL use `requirePermission`. Guards SHALL be placed after `fastify.authenticate` in the `preHandler` array.

#### Scenario: Agent holding the permission passes through
- **GIVEN** a request has been authenticated and the agent's role holds `channel.create`
- **WHEN** `requirePermission('channel.create')` is invoked as a preHandler
- **THEN** the request continues to the route handler

#### Scenario: Agent lacking the permission is rejected
- **GIVEN** a request has been authenticated and the agent's role does not hold `channel.create`
- **WHEN** `requirePermission('channel.create')` is invoked as a preHandler
- **THEN** the handler responds with HTTP 403 and body `{ code: 'FORBIDDEN', message: 'Insufficient permission' }`

#### Scenario: Guard ordering
- **WHEN** a route uses `requirePermission(...)`
- **THEN** the `preHandler` array SHALL be `[fastify.authenticate, requirePermission(...)]` — authenticate first, permission guard second

### Requirement: Agent Management Access
Managing Agents SHALL be gated by permission points rather than fixed roles. Creating and updating Agents SHALL require `agent.manage`; deleting Agents SHALL require `agent.delete`; listing and viewing Agents SHALL require `agent.view`. Assigning an agent a role SHALL require `agent.role.assign`, and a user SHALL NOT assign a role whose permission set exceeds their own effective permission set (privilege-escalation guard replacing the old "SUPERVISOR cannot create ADMIN" rule).

#### Scenario: User without agent.view cannot list agents
- **GIVEN** a request is authenticated and the agent's role does not hold `agent.view`
- **WHEN** `GET /agents` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User without agent.delete cannot delete
- **GIVEN** a request is authenticated and the agent's role does not hold `agent.delete`
- **WHEN** `DELETE /agents/:id` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: Privilege escalation prevented
- **GIVEN** a user whose effective permission set does not include `channel.delete`
- **WHEN** they attempt to assign another agent a role that includes `channel.delete`
- **THEN** the response SHALL be HTTP 403

#### Scenario: Authorized assignment succeeds
- **GIVEN** a user holding `agent.role.assign` and whose effective permissions are a superset of the target role's permissions
- **WHEN** they assign that role to an agent
- **THEN** the request SHALL reach the route handler

### Requirement: Channel Management Access
Channel endpoints SHALL be gated by permission points. Viewing and listing Channels SHALL require `channel.view`; creating SHALL require `channel.create`; updating SHALL require `channel.update`; deleting SHALL require `channel.delete`.

#### Scenario: User without channel.view is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `channel.view`
- **WHEN** `GET /channels` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with channel.create creates a channel
- **GIVEN** a request is authenticated and the agent's role holds `channel.create`
- **WHEN** `POST /channels` is called with a valid body
- **THEN** the request SHALL reach the route handler

### Requirement: Automation Rule Access
Automation endpoints SHALL be gated by permission points. Viewing Automation Rules SHALL require `automation.view`; creating, editing, and deleting SHALL require `automation.manage`.

#### Scenario: User without automation.view is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `automation.view`
- **WHEN** `GET /automation/rules` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with automation.manage creates a rule
- **GIVEN** a request is authenticated and the agent's role holds `automation.manage`
- **WHEN** `POST /automation/rules` is called with a valid body
- **THEN** the request SHALL reach the route handler

### Requirement: Settings Access
Settings endpoints (SLA policies, office hours, etc.) SHALL require the `settings.manage` permission.

#### Scenario: User without settings.manage is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `settings.manage`
- **WHEN** any Settings endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with settings.manage accesses Settings
- **GIVEN** a request is authenticated and the agent's role holds `settings.manage`
- **WHEN** any Settings endpoint is called
- **THEN** the request SHALL reach the route handler

### Requirement: Analytics Access
Analytics and report endpoints SHALL require the `analytics.view` permission.

#### Scenario: User without analytics.view is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `analytics.view`
- **WHEN** any Analytics or reports endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with analytics.view accesses Analytics
- **GIVEN** a request is authenticated and the agent's role holds `analytics.view`
- **WHEN** any Analytics or reports endpoint is called
- **THEN** the request SHALL reach the route handler

### Requirement: Marketing Access
Campaign and broadcast endpoints SHALL be gated by permission points. Viewing SHALL require `marketing.view`; managing campaigns/broadcasts SHALL require `marketing.manage`.

#### Scenario: User without marketing.view is rejected
- **GIVEN** a request is authenticated and the agent's role does not hold `marketing.view`
- **WHEN** any Marketing or broadcast endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: User with marketing.manage accesses Marketing
- **GIVEN** a request is authenticated and the agent's role holds `marketing.manage`
- **WHEN** a Marketing or broadcast management endpoint is called
- **THEN** the request SHALL reach the route handler

## REMOVED Requirements

### Requirement: Convenience Guards
**Reason**: `requireAdmin()` and `requireSupervisor()` hard-code role whitelists, which the permission-based model replaces. Authorization is now expressed per feature via `requirePermission(code)`, so fixed-role convenience wrappers no longer describe the system's behavior.
**Migration**: Replace `requireAdmin()` with the specific `requirePermission(...)` of the guarded action, and `requireSupervisor()` likewise. The default RolePermission seed grants the three system roles (`admin`/`supervisor`/`agent`) the permissions equivalent to their previous access, so behavior is preserved after migration. The wrapper functions MAY be kept temporarily as thin shims during the phased rollout but SHALL be removed once all routes use `requirePermission`.

### Requirement: 403 Response Shape
**Reason**: Superseded by the permission-based 403 shape defined in the `permission-check` capability (`{ code: 'FORBIDDEN', message: 'Insufficient permission' }`), which replaces the role-oriented `'Insufficient role'` message.
**Migration**: Clients that matched on the literal message `'Insufficient role'` SHALL match on the `code` field `'FORBIDDEN'` instead; the HTTP status remains 403 and the `code` is unchanged.
