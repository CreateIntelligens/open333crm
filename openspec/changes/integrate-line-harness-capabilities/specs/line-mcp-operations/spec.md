# Spec Delta

## Purpose

Exposes useful LINE operations through the existing Open333CRM MCP endpoint while preserving tenant isolation, scoped credentials, RBAC, and explicit control over message-sending side effects.

## ADDED Requirements

### Requirement: Tenant-bound LINE MCP context

Every LINE MCP operation SHALL execute in the authenticated CLI session's tenant context and SHALL limit channels, contacts, conversations, broadcasts, and delivery results to that tenant.

#### Scenario: Tenant reads a LINE conversation
- **WHEN** an authenticated MCP client requests a LINE conversation by ID
- **THEN** the system SHALL return the conversation only when it belongs to the caller's tenant

#### Scenario: Cross-tenant object access
- **WHEN** an MCP client supplies an object ID belonging to another tenant
- **THEN** the system SHALL return the standard not-found or forbidden result without exposing the object

### Requirement: Read-only LINE operations

The MCP endpoint SHALL provide read-only operations for listing LINE conversations, retrieving a conversation, searching LINE contacts, and retrieving delivery or broadcast status. Read-only operations SHALL not send messages or mutate CRM data.

#### Scenario: List conversations
- **WHEN** an MCP client invokes the conversation listing operation with supported filters and pagination
- **THEN** the system SHALL return tenant-scoped results with stable pagination metadata

### Requirement: Authorized direct LINE send

The MCP endpoint SHALL require an explicit write scope (`mcp:line:send`), the caller's applicable RBAC permission, and 2-phase confirmation before dispatching a direct LINE message. The operation SHALL accept a conversation identifier or channel and contact identifiers, and return a pending confirmation result with a signed confirmation token unless confirmed with that token.

#### Scenario: Read-only token attempts to send
- **WHEN** an MCP client without the LINE send scope invokes a direct send operation
- **THEN** the system SHALL reject the operation with an insufficient-scope error and SHALL not call LINE

#### Scenario: Direct send requires confirmation token
- **WHEN** an authorized MCP client invokes a direct send without a valid confirmation token
- **THEN** the system SHALL return status `PENDING_CONFIRMATION` with a target preview and a short-lived signed confirmation token without dispatching to LINE

#### Scenario: Confirmed direct send
- **WHEN** an authorized MCP client invokes direct send with a valid confirmation token and explicit confirmation
- **THEN** the system SHALL dispatch one logical delivery operation through the existing message delivery service and LINE channel plugin, emit real-time socket events, and return its delivery status

### Requirement: Authorized LINE broadcast initiation

The MCP endpoint SHALL require an explicit broadcast scope (`mcp:line:broadcast`), applicable RBAC permission, existing quota validation, and 2-phase confirmation before initiating a LINE broadcast. The MCP operation SHALL invoke the existing marketing broadcast workflow instead of directly bypassing recipient tracking.

#### Scenario: Broadcast initiation requires confirmation token
- **WHEN** an authorized MCP client invokes broadcast initiation without a valid confirmation token
- **THEN** the system SHALL validate the audience and quota, and return status `PENDING_CONFIRMATION` with an audience count preview and confirmation token without dispatching to LINE

#### Scenario: Broadcast confirmation succeeds
- **WHEN** an authorized MCP client invokes broadcast initiation with a valid confirmation token and explicit confirmation
- **THEN** the system SHALL initiate the existing broadcast workflow and return the broadcast identifier and initial status

#### Scenario: Broadcast quota is exceeded
- **WHEN** an MCP broadcast attempt fails the existing LINE quota check
- **THEN** the system SHALL reject the operation with the existing quota error and SHALL not initiate the broadcast


### Requirement: MCP write auditability

Every successful or rejected LINE MCP write attempt SHALL be attributable to the authenticated CLI session, agent, tenant, requested operation, target channel or contact, and outcome. Secrets and raw channel credentials SHALL not be returned in MCP responses or audit payloads.

#### Scenario: Direct send is audited
- **WHEN** a direct LINE send is confirmed through MCP
- **THEN** the audit record SHALL contain the authenticated actor and delivery outcome without storing the channel access token

