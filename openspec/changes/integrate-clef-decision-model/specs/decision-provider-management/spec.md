# Spec Delta

## Purpose

Let each tenant administrator configure decision-provider instances and their fallback order while keeping endpoint credentials encrypted, tenant-isolated, and masked in the management interface.

## ADDED Requirements

### Requirement: Tenant administrators manage provider instances
The system SHALL let a tenant administrator manage multiple provider instances from the AI settings surface, including multiple local Clef instances and OpenAI and JEV instances.

#### Scenario: Configure multiple providers
- **WHEN** an administrator saves two Clef instances and OpenAI/JEV instances with names, base URLs, model identifiers, credentials, enablement, and timeout values
- **THEN** the system persists each instance under that administrator's tenant and exposes its non-secret configuration in the settings response

#### Scenario: OpenAI and JEV credentials are required to enable
- **WHEN** an administrator enables an OpenAI or JEV instance without a configured API key or base URL
- **THEN** the API rejects the update with a field validation error and leaves the instance disabled

#### Scenario: Settings require permission
- **WHEN** a user without `settings.manage` reads or changes provider settings
- **THEN** the API rejects the request with HTTP 403

### Requirement: Provider credentials are encrypted and write-only
The system SHALL encrypt provider API keys at rest, SHALL never return plaintext keys, and SHALL exclude key values from logs and audit records.

#### Scenario: Read configured credentials
- **WHEN** an administrator reads provider settings
- **THEN** the response includes only whether a key is configured and a masked representation

#### Scenario: Replace or clear a credential
- **WHEN** an administrator submits a replacement key or explicitly clears a key
- **THEN** the system encrypts the replacement or removes the stored credential and returns only masked status

#### Scenario: Credential update is audited
- **WHEN** an administrator changes a provider credential
- **THEN** the audit record identifies the provider instance and set/clear operation without storing the key, base URL query secrets, or request body

### Requirement: Administrators control fallback order
The system SHALL persist an explicit per-tenant ordering of enabled provider instances and apply that order to all configured decision features.

#### Scenario: Reorder providers
- **WHEN** an administrator changes the order to local Clef A, local Clef B, OpenAI, then JEV
- **THEN** the settings response and the next decision chain use that exact order

#### Scenario: Disabled provider is skipped
- **WHEN** a provider instance is disabled
- **THEN** it remains visible in settings but is excluded from decision attempts

#### Scenario: Invalid order is rejected
- **WHEN** an update contains duplicate, missing, or foreign-tenant provider instance IDs
- **THEN** the API rejects the update and preserves the existing order

### Requirement: Provider connectivity can be tested safely
An administrator SHALL be able to test a configured provider instance and receive a bounded health result without exposing provider response bodies or credentials.

#### Scenario: Provider is reachable
- **WHEN** an administrator tests a valid configured provider
- **THEN** the response reports reachability, selected model, and measured latency

#### Scenario: Provider is unavailable
- **WHEN** a provider test times out or fails
- **THEN** the response reports a sanitized failure and settings remain saved

#### Scenario: Provider test uses saved credentials
- **WHEN** an administrator tests a configured OpenAI or JEV instance
- **THEN** the health check uses that instance's saved credential and base URL and does not return the credential or raw provider response body

### Requirement: Provider configuration is tenant-isolated
Provider instances and ordering SHALL be stored and queried with the active tenant ID, and the provider configuration table SHALL be covered by ENABLE and FORCE ROW LEVEL SECURITY.

#### Scenario: Tenant cannot read another tenant's providers
- **WHEN** an administrator reads or reorders provider instances while authenticated as tenant A
- **THEN** the system returns and changes only tenant A's provider instances

#### Scenario: RLS rejects a cross-tenant provider write
- **WHEN** a tenant-bound database operation attempts to create or update a provider instance for tenant B
- **THEN** Postgres RLS rejects the write and tenant B's configuration remains unchanged
