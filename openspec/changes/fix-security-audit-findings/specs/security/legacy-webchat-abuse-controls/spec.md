## Purpose

Prevent anonymous WebChat traffic from creating unbounded contacts, conversations, uploads, and automation or AI work while preserving a controlled migration path for existing embedded widgets.

## ADDED Requirements

### Requirement: Public WebChat requests are bound to server state
The system SHALL require every public WebChat message and media request to present a valid, unexpired, non-revoked server-issued session and page claim bound to the target channel. A client-generated identifier alone SHALL NOT authorize a request. A public WebChat session SHALL have a configurable lifetime that MUST NOT exceed three days.

#### Scenario: Valid claimed visitor sends a message
- **WHEN** a visitor submits a message with a valid session, matching claim, active channel, and valid payload
- **THEN** the system accepts and processes the message for the session's tenant and conversation

#### Scenario: Visitor submits an arbitrary identifier
- **WHEN** a visitor submits a client-generated or otherwise unbound visitor identifier without a valid server claim
- **THEN** the system rejects the request and does not create a contact, conversation, message, automation job, or AI job

#### Scenario: Visitor uses a session for another channel
- **WHEN** a valid session is presented against a channel different from the session's bound channel
- **THEN** the system rejects the request without revealing channel or conversation data

#### Scenario: Public session exceeds the maximum lifetime
- **WHEN** an operator configures a public WebChat session lifetime greater than three days
- **THEN** the system caps or rejects the configuration so that no issued public session remains valid beyond three days

### Requirement: Legacy public routes cannot bypass the secure contract
After the embedded widget migration is enabled, the legacy public message and media routes SHALL either be disabled with a documented deprecation response or enforce the same verified session and claim checks as the secure chatbox routes. No compatibility mode SHALL accept an arbitrary visitor token without equivalent server-side binding.

#### Scenario: Legacy route is disabled
- **WHEN** a client calls a retired legacy message or media route
- **THEN** the API returns the documented deprecation status and performs no persistence, upload, automation, or AI work

#### Scenario: Legacy route remains during staged rollout
- **WHEN** a staged rollout keeps a legacy route enabled and the request lacks a valid secure session and claim
- **THEN** the API rejects the request before contact or conversation resolution

#### Scenario: Migrated widget sends a message
- **WHEN** the migrated widget submits through the secure contract
- **THEN** the message reaches the existing inbound WebChat pipeline without weakening tenant or channel checks

### Requirement: Public WebChat workload is bounded
The system SHALL enforce configured maximums for text length, JSON or multipart request size, media size and type, requests per IP, requests per session, uploads per session, and automation or AI work triggered by a visitor. Rejected requests SHALL not create durable business records or downstream work.

#### Scenario: Text exceeds the configured maximum
- **WHEN** a visitor submits text longer than the configured limit
- **THEN** the API returns a validation error before persistence or automation dispatch

#### Scenario: Visitor exceeds a rate limit
- **WHEN** an IP address or active session exceeds its configured message or upload rate
- **THEN** the API returns a rate-limit response with retry information and does not process the request

#### Scenario: Media violates type or size policy
- **WHEN** a visitor uploads unsupported media or media above the configured size limit
- **THEN** the API rejects the upload before durable storage and does not permit a message referencing it

#### Scenario: AI or automation quota is exhausted
- **WHEN** a valid visitor request would exceed the configured per-session or per-channel automation or AI budget
- **THEN** the system records the bounded rejection and does not enqueue additional automation or AI work

### Requirement: Abuse controls preserve tenant isolation
The system SHALL derive tenant, channel, conversation, and contact ownership from the verified session and server-side records rather than trusting request body identifiers. Logs and rate-limit keys SHALL avoid storing raw session secrets.

#### Scenario: Request attempts cross-tenant identifiers
- **WHEN** a visitor includes identifiers for a different tenant in a message or media request
- **THEN** the system ignores or rejects those identifiers and performs work only within the verified session scope

#### Scenario: Security event is logged
- **WHEN** the system rejects an invalid, replayed, or rate-limited public request
- **THEN** the security log contains an event category and non-secret correlation data without the raw session token
