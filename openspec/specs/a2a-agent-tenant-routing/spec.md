# a2a-agent-tenant-routing Specification

## Purpose

讓外部 A2A 任務進入 Open333CRM 時具有明確、可驗證且不可跨租戶的執行上下文，避免以訊息內容或未驗證 metadata 推測租戶身分。

## Requirements

### Requirement: Explicit A2A Agent to tenant binding

Every A2A bridge identity SHALL be bound to an explicitly configured Open333CRM tenant before it can process an inbound task. The tenant SHALL NOT be inferred from the task text, requester display name, Agent Card, or untrusted message metadata.

#### Scenario: Valid tenant binding
- **WHEN** the bridge starts with a valid Agent identity and one active tenant binding
- **THEN** inbound tasks SHALL be eligible for execution only within that bound tenant context

#### Scenario: Missing or invalid tenant binding
- **WHEN** the bridge has no valid tenant binding or the bound tenant is inactive
- **THEN** the bridge SHALL reject new tasks with a bounded authorization error and SHALL not query or mutate tenant data

### Requirement: Tenant-safe Agent execution boundary

The system SHALL invoke A2A-originated Agent execution through the same tenant-safe application boundary as other Agent runs. All tenant reads, writes, usage records, tool traces, and audit records SHALL be scoped to the bound tenant.

#### Scenario: A2A task invokes the Agent runtime
- **WHEN** an authenticated A2A task is accepted for a valid bound tenant
- **THEN** the resulting Agent run and all related records SHALL carry that tenant context and SHALL use the tenant-isolated database path

#### Scenario: Cross-tenant identifier supplied by a task
- **WHEN** an inbound task contains a conversation, contact, case, or agent identifier belonging to another tenant
- **THEN** the identifier SHALL be rejected or resolve as not found, and no cross-tenant record or tool action SHALL be performed

### Requirement: Untrusted A2A message handling

The system SHALL treat all peer Agent messages, task text, Agent Cards, and optional metadata as untrusted input. A2A content SHALL NOT grant shell execution, database bypass, elevated RBAC, or access to tools outside the configured allowlist.

#### Scenario: Prompt injection in a peer message
- **WHEN** an inbound A2A message asks the Agent to ignore policy, disclose credentials, or execute arbitrary commands
- **THEN** the Agent SHALL apply local safety policy and tool allowlists, and SHALL not perform the requested unsafe action

#### Scenario: Untrusted Agent Card capability
- **WHEN** a peer Agent Card declares a capability not approved by the local configuration
- **THEN** the system SHALL treat the capability as informational and SHALL not enable a local tool or permission because of it

### Requirement: Credential and task audit redaction

The system SHALL keep operational audit data sufficient to trace A2A connection and task lifecycle events while redacting Hub keys, Agent Tokens, authorization headers, and sensitive task content. Logs SHALL identify the tenant and task using non-secret identifiers only.

#### Scenario: Connection event is logged
- **WHEN** the bridge connects, reconnects, authenticates, or enters degraded state
- **THEN** the log SHALL include a safe event name, Agent identity suffix or hash, tenant identifier, and reason without logging credentials

#### Scenario: Task payload is persisted
- **WHEN** an inbound or outbound task is persisted for retry or audit
- **THEN** the stored content SHALL obey configured retention and size limits, and credential-like fields SHALL be redacted
