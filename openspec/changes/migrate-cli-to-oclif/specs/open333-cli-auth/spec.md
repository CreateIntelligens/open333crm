## ADDED Requirements

### Requirement: CLI login issues a CLI-scoped token
The system SHALL provide a CLI login endpoint that accepts host-side email/password credentials through the API, validates them using the existing agent login rules, and returns a raw CLI-scoped token exactly once.

#### Scenario: Successful CLI login
- **WHEN** a user runs `open333 login` with a reachable host and valid email/password
- **THEN** the CLI SHALL call the API login endpoint and receive a CLI token, agent identity, tenant identity, scopes, and expiry metadata

#### Scenario: Invalid CLI login credentials
- **WHEN** a user runs `open333 login` with an invalid email/password
- **THEN** the API SHALL return HTTP 401 and the CLI SHALL NOT store any token locally

### Requirement: CLI tokens are stored hashed and revocable
The system SHALL persist CLI sessions server-side with a hashed token secret, visible prefix/suffix metadata, agent and tenant ownership, scope metadata, expiry, revocation state, and last-used tracking.

#### Scenario: Raw token is returned once
- **WHEN** the API creates a CLI session
- **THEN** the raw `cli_` token SHALL be returned in the create response and SHALL NOT be persisted in plaintext

#### Scenario: Revoked CLI token is rejected
- **WHEN** a CLI request uses a token whose session has been revoked
- **THEN** the API SHALL reject the request with HTTP 401

#### Scenario: Expired CLI token is rejected
- **WHEN** a CLI request uses a token whose session expiry is in the past
- **THEN** the API SHALL reject the request with HTTP 401

### Requirement: CLI stores credentials locally
The CLI SHALL store the raw CLI token in the operating system keychain when available and store only non-secret profile metadata in local config.

#### Scenario: Keychain storage succeeds
- **WHEN** `open333 login` receives a CLI token and the OS keychain is available
- **THEN** the CLI SHALL write the raw token to the keychain and write host/profile/agent metadata to local config

#### Scenario: Keychain storage unavailable
- **WHEN** `open333 login` receives a CLI token but keychain storage fails
- **THEN** the CLI SHALL fail closed by default and SHALL NOT silently write the raw token to plaintext config

### Requirement: CLI status verifies server health and identity
The CLI SHALL provide `open333 status` that first checks the configured host health endpoint and then checks the current identity using the stored CLI credential.

#### Scenario: Healthy server and valid CLI token
- **WHEN** a user runs `open333 status` with a configured host and valid stored token
- **THEN** the CLI SHALL call `/health`, then `/api/v1/auth/me`, and display server status plus current agent identity

#### Scenario: Health endpoint unavailable
- **WHEN** a user runs `open333 status` and `/health` is unreachable or unhealthy
- **THEN** the CLI SHALL report the health failure and SHALL NOT claim the user identity is valid

#### Scenario: Stored token invalid
- **WHEN** a user runs `open333 status` and `/api/v1/auth/me` rejects the stored token
- **THEN** the CLI SHALL report that the local login is invalid or expired

### Requirement: CLI API discovery lists custom endpoint metadata
The CLI SHALL provide `open333 apis` that calls an authenticated API discovery endpoint and lists custom-defined endpoints, capability groups, routes, params, example values, and scopes available to the current CLI token.

#### Scenario: Token has CLI discovery scope
- **WHEN** a user runs `open333 apis` with a valid stored token
- **THEN** the CLI SHALL display the token scopes and available endpoint metadata returned by the API

#### Scenario: Endpoint metadata is defined by the API registry
- **WHEN** the API discovery endpoint returns an available CLI endpoint
- **THEN** each endpoint SHALL include a name, description, HTTP method, path, parameter descriptions, parameter example values, and required scopes

#### Scenario: Token lacks CLI discovery scope
- **WHEN** a user runs `open333 apis` with a token that lacks the required discovery scope
- **THEN** the API SHALL return HTTP 403 and the CLI SHALL report insufficient scope

### Requirement: CLI tokens do not replace browser auth
The system SHALL keep browser JWT/refresh-cookie auth and partner API key auth behavior unchanged while adding CLI-specific authentication.

#### Scenario: Browser login still uses refresh cookie
- **WHEN** a browser user logs in through the existing web login endpoint
- **THEN** the API SHALL continue returning a browser access token and setting the refresh-token HttpOnly cookie

#### Scenario: Partner API key verification unchanged
- **WHEN** a partner integration calls an endpoint that accepts partner API keys
- **THEN** existing partner API key verification SHALL continue to work without requiring a CLI session

### Requirement: CLI package is npm publishable
The CLI SHALL be packaged as an npm-publishable package that installs a runnable `open333` binary and includes only files required for runtime use.

#### Scenario: Package dry run succeeds
- **WHEN** maintainers run an npm package dry run for the CLI package
- **THEN** the generated package contents SHALL include the compiled binary, runtime files, README/license metadata, and SHALL exclude tests, local credentials, and workspace-only artifacts

#### Scenario: Installed package exposes open333 binary
- **WHEN** a user installs the published CLI package globally from npm
- **THEN** the package SHALL expose an `open333` command that can run `open333 --help`, `open333 login`, `open333 status`, and `open333 apis`
