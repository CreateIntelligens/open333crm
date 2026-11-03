## ADDED Requirements

### Requirement: CLI token expiry from the settings page is bounded
`POST /api/v1/settings/cli-sessions` SHALL accept `expiresInDays` only as an integer from 1 to 365. When the request does not send `expiresInDays`, or sends `null`, the token SHALL expire 30 days after it is created. For any other value, the API SHALL return HTTP 400 `VALIDATION_ERROR` with `error.details.issues` that names `expiresInDays`, and SHALL NOT create a CLI session.

#### Scenario: Maximum expiry is accepted
- **WHEN** a member with `settings.manage` creates a CLI token with `expiresInDays: 365`
- **THEN** the API returns HTTP 201, and `session.expiresAt` is 365 days after the time of creation

#### Scenario: Expiry is not sent
- **WHEN** a member with `settings.manage` creates a CLI token without `expiresInDays`, or with `expiresInDays: null`
- **THEN** the API returns HTTP 201, and `session.expiresAt` is 30 days after the time of creation

#### Scenario: Expiry is out of range
- **WHEN** a member with `settings.manage` creates a CLI token with `expiresInDays` set to `0`, `366`, `3650000` or `1.5`
- **THEN** the API returns HTTP 400 `VALIDATION_ERROR`, `error.details.issues` names `expiresInDays`, and the tenant has no new CLI session
