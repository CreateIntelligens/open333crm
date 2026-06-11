## MODIFIED Requirements

### Requirement: Centralized License Validation
The system SHALL resolve license and billing state through a centralized LicenseService backed by a selectable provider strategy. The system SHALL NOT require a remote license server to boot or allow feature access during this phase.

#### Scenario: Default allow-all provider
- **WHEN** the API starts without `LICENSE_PROVIDER` configured
- **THEN** the LicenseService SHALL use the allow-all provider
- **AND** feature, limit, channel, and credit checks SHALL allow access unless a configured provider explicitly denies access

#### Scenario: Environment provider selected
- **WHEN** `LICENSE_PROVIDER=env` is configured with valid license JSON overrides
- **THEN** the LicenseService SHALL resolve feature flags, limits, credits, and channel settings from environment configuration

#### Scenario: Cache provider selected
- **WHEN** `LICENSE_PROVIDER=cache` is configured
- **THEN** the LicenseService SHALL first read a normalized license snapshot from the cache layer
- **AND** it SHALL fall back to the configured source provider when the cache entry is missing

#### Scenario: Remote server unavailable
- **WHEN** no remote license server is configured
- **THEN** the LicenseService SHALL still initialize successfully
- **AND** it SHALL use the selected local strategy or allow-all fallback

### Requirement: Global Feature Toggling
The system SHALL consult the LicenseService before allowing access to gated features or consuming gated credits. Feature gates SHALL be independent of business logic and usable from route pre-handlers or shared module helpers.

#### Scenario: Checking enabled feature allowance
- **WHEN** an API route checks a feature path that resolves to enabled
- **THEN** the LicenseService SHALL return an allow decision
- **AND** the route SHALL continue to its business handler

#### Scenario: Checking disabled feature allowance
- **WHEN** an API route checks a feature path that resolves to disabled
- **THEN** the route SHALL reject the request with `FEATURE_NOT_ENABLED`
- **AND** the response SHALL include the denied feature path

#### Scenario: Missing feature with allow-all provider
- **WHEN** a route checks an unknown feature path while the allow-all provider is active
- **THEN** the LicenseService SHALL treat the feature as enabled

#### Scenario: Missing feature with strict provider
- **WHEN** a strict provider cannot resolve a feature path
- **THEN** the LicenseService SHALL return the provider's configured default decision
- **AND** the decision SHALL be represented consistently to callers

## ADDED Requirements

### Requirement: Strategy Provider Selection
The system SHALL select exactly one license provider strategy at startup from configuration.

#### Scenario: Select allow-all provider
- **WHEN** `LICENSE_PROVIDER` is absent or set to `allow-all`
- **THEN** the LicenseService SHALL use the allow-all provider

#### Scenario: Select env provider
- **WHEN** `LICENSE_PROVIDER=env`
- **THEN** the LicenseService SHALL parse and validate environment license overrides during startup

#### Scenario: Select cache provider
- **WHEN** `LICENSE_PROVIDER=cache`
- **THEN** the LicenseService SHALL use the cache-backed provider
- **AND** the provider SHALL be able to use another local provider as its fallback source

#### Scenario: Unknown provider
- **WHEN** `LICENSE_PROVIDER` is set to an unsupported value
- **THEN** application startup SHALL fail with a configuration error

### Requirement: Normalized License Snapshot
The system SHALL normalize provider output into a consistent license snapshot before route guards or business services read it.

#### Scenario: Normalize env data
- **WHEN** env configuration provides feature, limit, credit, or channel values
- **THEN** the LicenseService SHALL expose them through the same public methods as any other provider

#### Scenario: Include provider metadata
- **WHEN** a license summary is requested
- **THEN** the summary SHALL include the active provider name and snapshot load metadata
- **AND** it SHALL NOT expose secrets

### Requirement: Credit Decision Behavior
The system SHALL support credit availability checks without requiring real billing deduction in providers that do not support mutation.

#### Scenario: Unlimited credits
- **WHEN** the active provider marks a credit type as unlimited or leaves credits unspecified under allow-all behavior
- **THEN** `hasCredits` SHALL allow the operation

#### Scenario: Insufficient credits
- **WHEN** the active provider reports remaining credits below the requested amount
- **THEN** `requireCredits` SHALL reject the request with `INSUFFICIENT_CREDITS`

#### Scenario: Non-destructive deduction
- **WHEN** the active provider does not implement credit deduction
- **THEN** `deductCredits` SHALL return a successful non-destructive decision for allowed credit types

#### Scenario: Provider-backed deduction
- **WHEN** the active provider implements credit deduction
- **THEN** `deductCredits` SHALL delegate to the provider and return the provider decision
