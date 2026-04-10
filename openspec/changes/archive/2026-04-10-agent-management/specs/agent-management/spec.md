## ADDED Requirements

### Requirement: Create Agent
The API SHALL provide `POST /api/v1/agents` to create a new agent within the authenticated tenant. This endpoint SHALL be accessible only to agents with role `ADMIN` or `SUPERVISOR`. If the email already exists within the tenant, the API SHALL return HTTP 409.

#### Scenario: Admin creates agent successfully
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /api/v1/agents` is called with `{ name, email, role, password }`
- **THEN** the response SHALL be HTTP 201 with the new agent object (excluding `passwordHash`)

#### Scenario: Supervisor creates agent successfully
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /api/v1/agents` is called with `{ name, email, role: "AGENT", password }`
- **THEN** the response SHALL be HTTP 201 with the new agent object

#### Scenario: Supervisor attempts to create ADMIN agent
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `POST /api/v1/agents` is called with `{ role: "ADMIN" }`
- **THEN** the response SHALL be HTTP 403 with body `{ code: "FORBIDDEN", message: "Supervisors cannot create ADMIN agents" }`

#### Scenario: AGENT role is rejected
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `POST /api/v1/agents` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: Duplicate email within tenant
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `POST /api/v1/agents` is called with an email that already exists in the tenant
- **THEN** the response SHALL be HTTP 409 with body `{ code: "CONFLICT", message: "Email already in use" }`

---

### Requirement: Assign Agent Role
The API SHALL provide `PATCH /api/v1/agents/:id/role` to update a specific agent's role. This endpoint SHALL be accessible only to agents with role `ADMIN` or `SUPERVISOR`. A `SUPERVISOR` SHALL NOT be permitted to set a target agent's role to `ADMIN`.

#### Scenario: Admin promotes agent to Supervisor
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called with `{ role: "SUPERVISOR" }`
- **THEN** the response SHALL be HTTP 200 with the updated agent object

#### Scenario: Admin promotes agent to Admin
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called with `{ role: "ADMIN" }`
- **THEN** the response SHALL be HTTP 200 with the updated agent object

#### Scenario: Supervisor assigns AGENT role
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called with `{ role: "AGENT" }`
- **THEN** the response SHALL be HTTP 200 with the updated agent object

#### Scenario: Supervisor attempts to set role to ADMIN
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called with `{ role: "ADMIN" }`
- **THEN** the response SHALL be HTTP 403 with body `{ code: "FORBIDDEN", message: "Supervisors cannot assign ADMIN role" }`

#### Scenario: AGENT role is rejected
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called
- **THEN** the response SHALL be HTTP 403

#### Scenario: Target agent not found
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** `PATCH /api/v1/agents/:id/role` is called with a non-existent agent ID
- **THEN** the response SHALL be HTTP 404

---

### Requirement: Change Own Password
The API SHALL provide `PATCH /api/v1/agents/me/password` to allow any authenticated agent to change their own password. The request SHALL require the current password for verification. If the current password does not match, the API SHALL return HTTP 400.

#### Scenario: Agent changes password successfully
- **GIVEN** a request is authenticated as any agent
- **WHEN** `PATCH /api/v1/agents/me/password` is called with `{ currentPassword, newPassword }`
- **THEN** the response SHALL be HTTP 200 with body `{ message: "Password updated" }`
- **AND** subsequent logins SHALL use the new password

#### Scenario: Wrong current password
- **GIVEN** a request is authenticated as any agent
- **WHEN** `PATCH /api/v1/agents/me/password` is called with an incorrect `currentPassword`
- **THEN** the response SHALL be HTTP 400 with body `{ code: "INVALID_PASSWORD", message: "Current password is incorrect" }`

#### Scenario: New password too short
- **GIVEN** a request is authenticated as any agent
- **WHEN** `PATCH /api/v1/agents/me/password` is called with `newPassword` shorter than 8 characters
- **THEN** the response SHALL be HTTP 400 with a validation error
