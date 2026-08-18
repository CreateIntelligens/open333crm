## ADDED Requirements

### Requirement: Platform Superuser Authentication Path
The API SHALL provide a platform superuser authentication path separate from all tenant authentication paths. It SHALL attach `request.agent` with `role: 'PLATFORM_SUPERUSER'` and no tenant scope (`tenantId: null`). A tenant JWT SHALL NEVER produce the `PLATFORM_SUPERUSER` role.

#### Scenario: Platform token authenticates as superuser
- **WHEN** a request presents a valid platform credential
- **THEN** `request.agent.role` SHALL be `PLATFORM_SUPERUSER`
- **AND** `request.agent.tenantId` SHALL be null

#### Scenario: Tenant JWT cannot become superuser
- **GIVEN** a normal tenant login JWT
- **WHEN** it is verified
- **THEN** `request.agent.role` SHALL be one of the tenant roles, never `PLATFORM_SUPERUSER`

### Requirement: requirePlatformSuperuser Guard
The API SHALL provide a `requirePlatformSuperuser()` Fastify preHandler that returns HTTP 403 unless the request is authenticated as `PLATFORM_SUPERUSER`. All `/api/v1/platform/*` routes SHALL use it.

#### Scenario: Tenant admin blocked from platform routes
- **GIVEN** a request authenticated as a tenant `ADMIN`
- **WHEN** it calls any `/api/v1/platform/*` endpoint
- **THEN** the response SHALL be HTTP 403

#### Scenario: Superuser allowed
- **GIVEN** a request authenticated as `PLATFORM_SUPERUSER`
- **WHEN** it calls a platform endpoint
- **THEN** the request SHALL reach the handler

### Requirement: PlatformUser Model
Platform operators SHALL be stored in a global `PlatformUser` table (no tenantId), separate from `Agent`. Platform login SHALL be a distinct flow from tenant login.

#### Scenario: Platform user is not an Agent
- **WHEN** a PlatformUser authenticates
- **THEN** the identity SHALL come from `PlatformUser`, not from the tenant-scoped `Agent` table

### Requirement: Platform Audit Log
Every platform write operation (plan change, override set, quota change, key management, request approval, tenant creation) SHALL record a row in `PlatformAuditLog` with `actorId`, `action`, `targetTenantId`, `payload` (no secrets), and `createdAt`.

#### Scenario: Plan change is audited
- **WHEN** a superuser changes a tenant's plan
- **THEN** a `PlatformAuditLog` row SHALL be written with action `tenant.plan.change` and the target tenant id

#### Scenario: Secrets are not logged
- **WHEN** a superuser sets a tenant's AI key
- **THEN** the audit payload SHALL NOT contain the plaintext key

### Requirement: Superuser Has No Tenant Data-Plane Access
A platform superuser SHALL NOT automatically gain any tenant's data-plane permissions. Accessing a tenant's customer data requires a normal tenant login.

#### Scenario: Superuser cannot read tenant inbox via platform identity
- **GIVEN** a request authenticated only as `PLATFORM_SUPERUSER`
- **WHEN** it calls a tenant data-plane endpoint (e.g. conversations)
- **THEN** the request SHALL NOT be authorized by the platform identity
