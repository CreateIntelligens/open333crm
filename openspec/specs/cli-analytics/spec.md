## Purpose
Expose a read-only, scope-gated CLI analytics facade for aggregate CRM statistics, backed by existing dashboard analytics calculations and discoverable only by CLI sessions with explicit analytics scope.

## Requirements

### Requirement: CLI analytics endpoints are read-only and scope gated
The system SHALL expose CLI-facing analytics endpoints that accept only valid CLI sessions with `cli:analytics:read` scope and SHALL reject CLI sessions that lack that scope.

#### Scenario: Token has analytics read scope
- **WHEN** a CLI request uses a valid token with `cli:analytics:read`
- **THEN** the API SHALL allow access to CLI analytics endpoints for that token's tenant

#### Scenario: Token lacks analytics read scope
- **WHEN** a CLI request uses a valid token without `cli:analytics:read`
- **THEN** the API SHALL return HTTP 403 with an insufficient scope error

#### Scenario: Token is invalid
- **WHEN** a CLI analytics request uses an invalid, revoked, expired, or malformed CLI token
- **THEN** the API SHALL return HTTP 401 and SHALL NOT return analytics data

### Requirement: CLI analytics exposes curated aggregate statistics
The system SHALL provide CLI-facing endpoints for overview statistics, message trends, case statistics, channel analytics, and current-agent performance using tenant-scoped aggregate data.

#### Scenario: Read overview statistics
- **WHEN** a scoped CLI token requests overview statistics with an optional date range
- **THEN** the API SHALL return aggregate CRM metrics for the token's tenant and SHALL NOT return raw conversations or contact records

#### Scenario: Read message trend statistics
- **WHEN** a scoped CLI token requests message trend statistics with a date range and grouping value
- **THEN** the API SHALL return grouped message counts for the token's tenant

#### Scenario: Read case statistics
- **WHEN** a scoped CLI token requests case statistics with an optional date range
- **THEN** the API SHALL return aggregate case metrics for the token's tenant

#### Scenario: Read channel analytics
- **WHEN** a scoped CLI token requests channel analytics with an optional date range
- **THEN** the API SHALL return aggregate channel metrics for the token's tenant

#### Scenario: Read current-agent performance
- **WHEN** a scoped CLI token requests current-agent performance
- **THEN** the API SHALL return performance metrics for the authenticated agent represented by the CLI session

### Requirement: CLI analytics reuses dashboard analytics calculations
The system SHALL calculate CLI analytics from the same analytics service logic used by dashboard analytics, with CLI-specific route handlers responsible for authentication, scope checks, parameter parsing, and response shaping.

#### Scenario: Shared analytics calculation
- **WHEN** the CLI overview endpoint calculates metrics for the same tenant and date range as the dashboard overview endpoint
- **THEN** the underlying aggregate values SHALL be derived from the same service calculation logic

#### Scenario: CLI response shaping
- **WHEN** an analytics service result includes fields that are not part of the CLI contract
- **THEN** the CLI route SHALL omit or summarize those fields before returning the response

### Requirement: CLI API discovery lists analytics only for scoped tokens
The system SHALL include CLI analytics endpoint metadata in API discovery only when the current CLI token has `cli:analytics:read`.

#### Scenario: Analytics scope visible in discovery
- **WHEN** a CLI token with `cli:analytics:read` calls the CLI API discovery endpoint
- **THEN** the response SHALL include analytics capability metadata, endpoint routes, required scopes, parameter descriptions, and example values

#### Scenario: Analytics scope hidden from discovery
- **WHEN** a CLI token without `cli:analytics:read` calls the CLI API discovery endpoint
- **THEN** the response SHALL omit analytics capability metadata and analytics routes

### Requirement: CLI provides a statistics command
The CLI SHALL provide a command for reading statistics from the configured host/profile using the stored CLI token.

#### Scenario: Print statistics in text mode
- **WHEN** a user runs the statistics command with a valid profile and analytics-scoped token
- **THEN** the CLI SHALL print a concise human-readable statistics summary

#### Scenario: Print statistics in JSON mode
- **WHEN** a user runs the statistics command with JSON output enabled
- **THEN** the CLI SHALL print structured JSON suitable for scripts and agent workflows

#### Scenario: Statistics command lacks scope
- **WHEN** a user runs the statistics command with a valid token that lacks `cli:analytics:read`
- **THEN** the CLI SHALL report insufficient scope and SHALL NOT claim analytics data is available
