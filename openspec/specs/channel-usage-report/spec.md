# channel-usage-report Specification

## Purpose
TBD - created by archiving change multi-channel-billing. Update Purpose after archive.
## Requirements
### Requirement: Channel Usage Tracking
The system SHALL record channel usage data for billing and analytics purposes.

#### Scenario: Outbound Message Tracked
- **WHEN** an outbound message is sent on a channel
- **THEN** a ChannelUsage record SHALL be created with channelId, direction='outbound', and timestamp

#### Scenario: Inbound Message Tracked
- **WHEN** an inbound message is received on a channel
- **THEN** a ChannelUsage record SHALL be created with channelId, direction='inbound'

#### Scenario: Fee Tracked
- **WHEN** a message is sent on a channel with messageFee configured
- **THEN** the ChannelUsage record SHALL include the fee amount

### Requirement: Usage Report API
The system SHALL provide APIs to retrieve channel usage reports.

#### Scenario: Get Channel Usage Summary
- **WHEN** GET /api/v1/reports/channel-usage is called with date range
- **THEN** it SHALL return usage grouped by channel including message counts and fees

#### Scenario: Get Team Usage Report
- **WHEN** GET /api/v1/reports/channel-usage is called with X-Team-Id header
- **THEN** it SHALL return usage only for that team's channels

#### Scenario: Get Usage by Channel
- **WHEN** GET /api/v1/reports/channel-usage?channelId=xxx is called
- **THEN** it SHALL return detailed usage for that specific channel

### Requirement: Fee Summary Report
The system SHALL provide a summary of fees per channel for billing purposes.

#### Scenario: Monthly Fee Summary
- **WHEN** GET /api/v1/reports/channel-fees?period=monthly is called
- **THEN** it SHALL return total fees per channel for the month

#### Scenario: Fee Breakdown by Team
- **WHEN** a tenant admin views the fee report
- **THEN** it SHALL show fee breakdown by team if multi-team is enabled

### Requirement: Usage Visualization
The system SHALL provide usage data suitable for dashboard visualization.

#### Scenario: Usage Trend Data
- **WHEN** GET /api/v1/analytics/channel-usage/trend is called
- **THEN** it SHALL return daily message counts per channel for the past 30 days

#### Scenario: Channel Health Metrics
- **WHEN** GET /api/v1/analytics/channel-health is called
- **THEN** it SHALL return delivery success rates and error rates per channel

### Requirement: Export Usage Data
The system SHALL support exporting usage data for external accounting.

#### Scenario: Export CSV
- **WHEN** GET /api/v1/reports/channel-usage/export?format=csv is called
- **THEN** it SHALL return a CSV file with usage data

#### Scenario: Export Date Range
- **WHEN** export is requested with startDate and endDate parameters
- **THEN** the export SHALL include only data within that range

