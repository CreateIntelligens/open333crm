### Requirement: Guard Factory
The API SHALL provide a `requireRole(allowedRoles: AgentRole[])` Fastify preHandler factory exported from `apps/api/src/guards/rbac.guard.ts` that returns HTTP 403 if `request.agent.role` is not in `allowedRoles`.

#### Scenario: Allowed role passes through
- **GIVEN** a request has been authenticated and `request.agent.role` is `ADMIN`
- **WHEN** `requireRole([AgentRole.ADMIN])` is invoked as a preHandler
- **THEN** the handler calls `done()` with no error and the request continues to the route handler

#### Scenario: Disallowed role is rejected
- **GIVEN** a request has been authenticated and `request.agent.role` is `AGENT`
- **WHEN** `requireRole([AgentRole.ADMIN, AgentRole.SUPERVISOR])` is invoked as a preHandler
- **THEN** the handler responds with HTTP 403 and body `{ code: 'FORBIDDEN', message: 'Insufficient role' }`

#### Scenario: Multiple allowed roles — one matches
- **GIVEN** a request has been authenticated and `request.agent.role` is `SUPERVISOR`
- **WHEN** `requireRole([AgentRole.ADMIN, AgentRole.SUPERVISOR])` is invoked as a preHandler
- **THEN** the handler calls `done()` with no error and the request continues

---

### Requirement: Convenience Guards
The API SHALL provide `requireAdmin()` and `requireSupervisor()` as convenience wrapper functions exported from `apps/api/src/guards/rbac.guard.ts`.

`requireAdmin()` SHALL be equivalent to `requireRole([AgentRole.ADMIN])`.
`requireSupervisor()` SHALL be equivalent to `requireRole([AgentRole.ADMIN, AgentRole.SUPERVISOR])`.

#### Scenario: requireAdmin blocks SUPERVISOR
- **GIVEN** a request has been authenticated and `request.agent.role` is `SUPERVISOR`
- **WHEN** `requireAdmin()` is used as a preHandler
- **THEN** the handler responds with HTTP 403 and body `{ code: 'FORBIDDEN', message: 'Insufficient role' }`

#### Scenario: requireAdmin allows ADMIN
- **GIVEN** a request has been authenticated and `request.agent.role` is `ADMIN`
- **WHEN** `requireAdmin()` is used as a preHandler
- **THEN** the request proceeds to the route handler

#### Scenario: requireSupervisor blocks AGENT
- **GIVEN** a request has been authenticated and `request.agent.role` is `AGENT`
- **WHEN** `requireSupervisor()` is used as a preHandler
- **THEN** the handler responds with HTTP 403 and body `{ code: 'FORBIDDEN', message: 'Insufficient role' }`

#### Scenario: requireSupervisor allows SUPERVISOR
- **GIVEN** a request has been authenticated and `request.agent.role` is `SUPERVISOR`
- **WHEN** `requireSupervisor()` is used as a preHandler
- **THEN** the request proceeds to the route handler

#### Scenario: requireSupervisor allows ADMIN
- **GIVEN** a request has been authenticated and `request.agent.role` is `ADMIN`
- **WHEN** `requireSupervisor()` is used as a preHandler
- **THEN** the request proceeds to the route handler

---

### Requirement: Guard Ordering
RBAC guards SHALL always be placed after `fastify.authenticate` in the `preHandler` array. An RBAC guard SHALL never appear as the first entry in a `preHandler` array on any route.

#### Scenario: Correct preHandler ordering
- **GIVEN** a route requires authentication and a minimum role
- **WHEN** the route is defined
- **THEN** the `preHandler` array SHALL be `[fastify.authenticate, requireRole(...)]` — authenticate first, RBAC guard second

---

### Requirement: 403 Response Shape
When a role check fails, the API SHALL respond with HTTP 403 and a JSON body of `{ code: 'FORBIDDEN', message: 'Insufficient role' }`, consistent with the existing API error envelope.

#### Scenario: Role check failure response
- **GIVEN** a request arrives at a guarded route with an insufficient role
- **WHEN** the RBAC guard evaluates the role
- **THEN** the HTTP response status SHALL be `403`
- **AND** the response body SHALL be `{ "code": "FORBIDDEN", "message": "Insufficient role" }`

---

### Requirement: Agent Management Access
Creating, updating, and deleting Agents SHALL require the `ADMIN` role. Listing and viewing Agents is allowed for all authenticated roles (`AGENT`, `SUPERVISOR`, `ADMIN`).

#### Scenario: AGENT attempts to create an Agent
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `POST /agents` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: AGENT attempts to delete an Agent
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `DELETE /agents/:id` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR attempts to create an Agent
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /agents` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: ADMIN creates an Agent
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /agents` is called with a valid body
- **THEN** the request SHALL reach the route handler (guard allows it)

#### Scenario: AGENT lists Agents
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `GET /agents` is called
- **THEN** the request SHALL reach the route handler (no role restriction on read)

---

### Requirement: Channel Management Access
Creating, updating, and deleting Channels SHALL require the `ADMIN` role. Viewing and listing Channels SHALL require at minimum the `SUPERVISOR` role.

#### Scenario: AGENT attempts to view Channels
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `GET /channels` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR views Channels
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `GET /channels` is called
- **THEN** the request SHALL reach the route handler

#### Scenario: SUPERVISOR attempts to create a Channel
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /channels` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: ADMIN creates a Channel
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /channels` is called with a valid body
- **THEN** the request SHALL reach the route handler

---

### Requirement: Automation Rule Access
Viewing Automation Rules SHALL require at minimum the `SUPERVISOR` role. Creating, editing, and deleting Automation Rules SHALL require the `ADMIN` role.

#### Scenario: AGENT attempts to view Automation Rules
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `GET /automation/rules` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR views Automation Rules
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `GET /automation/rules` is called
- **THEN** the request SHALL reach the route handler

#### Scenario: SUPERVISOR attempts to create an Automation Rule
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /automation/rules` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: ADMIN creates an Automation Rule
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /automation/rules` is called with a valid body
- **THEN** the request SHALL reach the route handler

---

### Requirement: Settings Access
SLA policies, office hours, and other settings endpoints SHALL require at minimum the `SUPERVISOR` role.

#### Scenario: AGENT attempts to access Settings
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any Settings endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR accesses Settings
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any Settings endpoint is called
- **THEN** the request SHALL reach the route handler

---

### Requirement: Analytics Access
Analytics and report endpoints SHALL require at minimum the `SUPERVISOR` role.

#### Scenario: AGENT attempts to access Analytics
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any Analytics or reports endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR accesses Analytics
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any Analytics or reports endpoint is called
- **THEN** the request SHALL reach the route handler

---

### Requirement: Marketing Access
Campaign and broadcast management endpoints SHALL require at minimum the `SUPERVISOR` role.

#### Scenario: AGENT attempts to access Marketing endpoints
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any Marketing or broadcast endpoint is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: SUPERVISOR accesses Marketing endpoints
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any Marketing or broadcast endpoint is called
- **THEN** the request SHALL reach the route handler
