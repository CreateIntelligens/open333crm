## ADDED Requirements

### Requirement: Centralized License Validation
The system SHALL periodically fetch and cache an encrypted License JSON from the central platform server.

#### Scenario: Fetching license updates
- **WHEN** the 60-minute refresh interval elapses
- **THEN** the LicenseService queries `license.open333crm.com` and caches the result

### Requirement: Global Feature Toggling
The system SHALL consult the LicenseService before allowing access to premium features or consuming AI credits.

#### Scenario: Checking feature allowance
- **WHEN** an API route tries to execute a premium function
- **THEN** the LicenseService verifies if `isFeatureEnabled()` returns true, blocking the request if false
