# channel-billing Specification

## Purpose
TBD - created by archiving change multi-channel-billing. Update Purpose after archive.
## Requirements
### Requirement: Channel Limit Configuration
The system SHALL support granular channel configuration in License JSON, including enable/disable status, quantity limits, and per-message fees.

#### Scenario: Boolean Channel Flag
- **WHEN** License JSON has `features.channels.telegram: true`
- **THEN** the channel SHALL be enabled without quantity limits

#### Scenario: Channel with Quantity Limit
- **WHEN** License JSON has `features.channels.telegram: { enabled: true, maxCount: 3 }`
- **THEN** the tenant SHALL be able to create up to 3 Telegram channels

#### Scenario: Channel Quantity Exceeded
- **WHEN** a tenant attempts to create a 4th Telegram channel but maxCount is 3
- **THEN** the channel creation SHALL be rejected with error code CHANNEL_LIMIT_EXCEEDED

### Requirement: Message Fee Configuration
The system SHALL support per-message fee configuration for channels that charge additional costs.

#### Scenario: Message Fee Configured
- **WHEN** License JSON has `features.channels.whatsapp: { enabled: true, messageFee: 0.005, messageFeeCurrency: "USD" }`
- **THEN** each outbound message on WhatsApp SHALL incur a $0.005 fee

#### Scenario: No Message Fee
- **WHEN** License JSON has `features.channels.line: true` without messageFee
- **THEN** outbound LINE messages SHALL NOT incur additional fees

### Requirement: License Service Channel Methods
The LicenseService SHALL provide methods to check channel limits and fees.

#### Scenario: Check Channel Enabled
- **WHEN** licenseService.isChannelEnabled('telegram') is called
- **THEN** it SHALL return true if the channel is enabled in the license

#### Scenario: Check Channel Count
- **WHEN** licenseService.getChannelCount('telegram') is called
- **THEN** it SHALL return the number of active Telegram channels for the tenant

#### Scenario: Get Message Fee
- **WHEN** licenseService.getMessageFee('whatsapp') is called
- **THEN** it SHALL return the fee configuration { amount: number, currency: string } or null

### Requirement: Channel Creation Validation
The channel creation API SHALL validate against license limits before creating a channel.

#### Scenario: Valid Channel Creation
- **WHEN** POST /api/v1/channels/telegram is called with valid credentials
- **AND** the license allows creating this channel type
- **THEN** the channel SHALL be created successfully

#### Scenario: Unlicensed Channel Creation
- **WHEN** POST /api/v1/channels/telegram is called but telegram is not enabled in license
- **THEN** the request SHALL be rejected with 402 FEATURE_NOT_ENABLED

#### Scenario: Limit Exceeded Creation
- **WHEN** POST /api/v1/channels/telegram is called but channel count limit is reached
- **THEN** the request SHALL be rejected with error code CHANNEL_LIMIT_EXCEEDED

### Requirement: Message Fee Deduction
The system SHALL record or deduct message fees when sending messages on channels with configured fees.

#### Scenario: Fee Recording
- **WHEN** a message is sent on a channel with messageFee configured
- **THEN** the system SHALL create a ChannelUsage record with the fee amount

#### Scenario: Insufficient Credits for Fees
- **WHEN** a message is to be sent on a channel with messageFee but credits are insufficient
- **THEN** the message send SHALL be rejected with 402 INSUFFICIENT_CREDITS

