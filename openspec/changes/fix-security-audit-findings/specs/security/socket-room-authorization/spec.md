## Purpose

Protect realtime tenant and resource data by making every authenticated Socket.IO room subscription explicit, validated, and authorized before a connection can receive events.

## ADDED Requirements

### Requirement: Room subscriptions are server-authorized
The system SHALL accept only recognized subscription targets and SHALL authorize each target using the authenticated agent identity, tenant, role, and resource access before joining a Socket.IO room. Client input SHALL NOT be passed directly to a room-join operation.

#### Scenario: Agent subscribes to an authorized conversation
- **WHEN** an authenticated agent requests a conversation room for a conversation in the agent's tenant and permitted team or channel scope
- **THEN** the system joins the agent to the canonical conversation room and acknowledges success

#### Scenario: Agent requests another tenant's conversation
- **WHEN** an authenticated agent requests a conversation room whose conversation belongs to another tenant
- **THEN** the system rejects the request, does not join the room, and returns a safe authorization error

#### Scenario: Client submits an arbitrary room name
- **WHEN** a connected client submits a room name that is not a recognized subscription target
- **THEN** the system rejects the request and does not call a room join operation for that value

### Requirement: Tenant and agent rooms enforce identity scope
The system SHALL allow a tenant-wide room only for the authenticated tenant and SHALL allow an agent-specific room only when it represents the authenticated agent or an explicitly authorized administrative scope.

#### Scenario: Agent requests its own tenant room
- **WHEN** an authenticated agent requests the canonical room for its own tenant
- **THEN** the system joins the tenant room for the socket's authenticated tenant

#### Scenario: Agent requests another tenant room
- **WHEN** an authenticated agent requests a tenant room for a different tenant identifier
- **THEN** the system rejects the request and the socket receives no events from that tenant

#### Scenario: Agent requests another agent's private room
- **WHEN** an agent without an administrative scope requests another agent's private room
- **THEN** the system rejects the request and does not join the private room

### Requirement: Subscription failures are observable without leaking data
The system SHALL return a deterministic error acknowledgement for malformed, unknown, or unauthorized subscription requests and SHALL NOT disclose whether an unauthorized resource exists beyond the minimum error contract.

#### Scenario: Malformed subscription request
- **WHEN** a client sends a missing, incorrectly typed, or invalid resource identifier
- **THEN** the system returns a validation error and leaves the socket's existing authorized room memberships unchanged

#### Scenario: Repeated subscription attempts exceed the limit
- **WHEN** a socket sends subscription requests above the configured per-connection limit
- **THEN** the system rejects further subscription requests for the protection window and records a security-relevant event without joining additional rooms
