## MODIFIED Requirements

### Requirement: Channel Limit Configuration
The system SHALL support granular channel configuration from the normalized license snapshot, including enable/disable status, quantity limits, and per-message fees. Channel configuration SHALL be available from any active LicenseService provider strategy.

#### Scenario: Channel omitted by allow-all provider
- **WHEN** the active provider is allow-all and no channel configuration exists for a channel type
- **THEN** the channel SHALL be treated as enabled without quantity limits

#### Scenario: Channel with Quantity Limit
- **WHEN** the active provider resolves `features.channels.telegram` to `{ enabled: true, maxCount: 3 }`
- **THEN** the tenant SHALL be able to create up to 3 Telegram channels

#### Scenario: Channel Quantity Exceeded
- **WHEN** a tenant attempts to create a 4th Telegram channel but maxCount is 3
- **THEN** the channel creation SHALL be rejected with error code `CHANNEL_LIMIT_EXCEEDED`

#### Scenario: Channel disabled by provider
- **WHEN** the active provider resolves a channel type to disabled
- **THEN** new channel creation for that channel type SHALL be rejected with `FEATURE_NOT_ENABLED`

### Requirement: Message Fee Configuration
The system SHALL support per-message fee configuration for channels that charge additional costs. Message fee configuration SHALL come from the normalized license snapshot rather than a hard-coded mock license.

#### Scenario: Message Fee Configured
- **WHEN** the active provider resolves `features.channels.whatsapp` to `{ enabled: true, messageFee: 0.005, messageFeeCurrency: "USD" }`
- **THEN** each outbound message on WhatsApp SHALL use the configured fee for credit checks or usage recording

#### Scenario: No Message Fee
- **WHEN** the active provider enables a channel without `messageFee`
- **THEN** outbound messages on that channel SHALL NOT require additional fee credits

#### Scenario: Allow-all provider fee default
- **WHEN** the active provider is allow-all and no channel fee is configured
- **THEN** outbound messages SHALL NOT be blocked for fee-related reasons

### Requirement: License Service Channel Methods
The LicenseService SHALL provide methods to check channel limits and fees using the selected provider strategy.

#### Scenario: Check Channel Enabled
- **WHEN** `licenseService.isChannelEnabled('telegram', context)` is called
- **THEN** it SHALL return true if the selected provider resolves the channel as enabled

#### Scenario: Check Channel Count Limit
- **WHEN** `licenseService.getChannelMaxCount('telegram', context)` is called
- **THEN** it SHALL return the configured max count or null for unlimited

#### Scenario: Get Message Fee
- **WHEN** `licenseService.getMessageFee('whatsapp', context)` is called
- **THEN** it SHALL return the fee configuration `{ amount: number, currency: string }` or null

#### Scenario: Tenant context ignored by local provider
- **WHEN** a local provider receives a tenant context
- **THEN** it MAY ignore tenant-specific lookup
- **AND** it SHALL still return a deterministic channel decision

### Requirement: Channel Creation Validation
The channel creation API SHALL validate against LicenseService channel decisions before creating a channel.

#### Scenario: Valid Channel Creation
- **WHEN** a channel creation request is made for a channel type allowed by the active provider
- **AND** the configured channel limit is not exceeded
- **THEN** the channel SHALL be created successfully

#### Scenario: Unlicensed Channel Creation
- **WHEN** a channel creation request is made for a channel type disabled by the active provider
- **THEN** the request SHALL be rejected with `FEATURE_NOT_ENABLED`

#### Scenario: Limit Exceeded Creation
- **WHEN** a channel creation request is made after the channel count limit is reached
- **THEN** the request SHALL be rejected with error code `CHANNEL_LIMIT_EXCEEDED`

### Requirement: Message Fee Deduction
The system SHALL check or record message fees when sending messages on channels with configured fees, using the active LicenseService provider strategy.

#### Scenario: Fee Recording
- **WHEN** a message is sent on a channel with messageFee configured
- **THEN** the system SHALL create or preserve usage evidence for that fee decision

#### Scenario: Insufficient Credits for Fees
- **WHEN** a message is to be sent on a channel with messageFee but the active provider reports insufficient credits
- **THEN** the message send SHALL be rejected with `INSUFFICIENT_CREDITS`

#### Scenario: Provider without destructive deduction
- **WHEN** a message is sent through a provider that supports checks but not destructive deduction
- **THEN** the system SHALL allow the send if credits are sufficient
- **AND** it SHALL NOT mutate credit balances
