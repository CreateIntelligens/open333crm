# Team License

## ADDED Requirements

### Requirement: Team License Structure
The License JSON SHALL support team-based licensing with independent channel configurations and credits.

#### Scenario: Team License Exists
- **WHEN** License JSON contains a `teams` array with team configurations
- **THEN** each team SHALL have its own `teamId`, `teamName`, `channels`, and `credits`

#### Scenario: Default Team Fallback
- **WHEN** a message is routed but no teamId is matched
- **THEN** the system SHALL use the `defaultTeam` configuration if provided

### Requirement: Team Identification in Messages
The system SHALL associate messages with teams for license enforcement.

#### Scenario: Team Assignment via Channel
- **WHEN** a message arrives on a channel bound to team A
- **THEN** the message SHALL be associated with team A's license configuration

#### Scenario: Team ID in Context
- **WHEN** processing a request with X-Team-Id header
- **THEN** the system SHALL use that teamId for license checks

### Requirement: Team-Based Channel Limits
Each team SHALL have independent channel limits enforced.

#### Scenario: Team Channel Limit
- **WHEN** team A has `channels.whatsapp: { enabled: true, maxCount: 2 }`
- **THEN** team A SHALL be limited to 2 WhatsApp channels

#### Scenario: Different Teams Different Limits
- **WHEN** team A has limit of 2 WhatsApp channels and team B has limit of 5
- **THEN** each team SHALL enforce their own respective limits

### Requirement: Team-Based Credits
Each team SHALL have independent credit allocations.

#### Scenario: Team Credit Check
- **WHEN** team A attempts to send an AI-suggested reply
- **THEN** the system SHALL check team A's credit balance, not the global balance

#### Scenario: Team Credit Exhausted
- **WHEN** team A's llmTokens credits are depleted
- **THEN** AI features SHALL be disabled for team A while other teams remain unaffected

### Requirement: Team License Service Methods
The LicenseService SHALL provide team-aware methods.

#### Scenario: Get Team License
- **WHEN** licenseService.getTeamLicense(teamId) is called
- **THEN** it SHALL return the license configuration for that team

#### Scenario: Check Feature for Team
- **WHEN** licenseService.isFeatureEnabledForTeam(teamId, 'ai.llmSuggestReply') is called
- **THEN** it SHALL return the feature status for that specific team

#### Scenario: Check Credits for Team
- **WHEN** licenseService.hasCreditsForTeam(teamId, 'llmTokens', 1000) is called
- **THEN** it SHALL return true if the team has sufficient credits

#### Scenario: Deduct Credits for Team
- **WHEN** licenseService.deductCreditsForTeam(teamId, 'llmTokens', 500) is called
- **THEN** it SHALL deduct from the team's credit pool and return the updated balance

### Requirement: Team Channel Binding
Channels SHALL be bound to specific teams during creation.

#### Scenario: Create Channel for Team
- **WHEN** POST /api/v1/channels with X-Team-Id header is called
- **THEN** the channel SHALL be created and associated with that team

#### Scenario: List Team Channels
- **WHEN** GET /api/v1/channels is called with X-Team-Id header
- **THEN** only channels belonging to that team SHALL be returned
