## Purpose

規定行銷活動的期間與廣播的排程時間要合理：活動結束日不可早於開始日，廣播不可排程到過去，避免建出永遠不在期間內的活動，或因為填錯時間而立即發送給客人的廣播。

## ADDED Requirements

### Requirement: Campaign End Date Is Not Before Start Date
When a marketing campaign is created or updated, the system SHALL reject with 400 naming `endDate` a campaign whose end date is earlier than its start date. On update the system SHALL compare the dates the campaign will have after the update. A date string that cannot be parsed SHALL be rejected with 400.

#### Scenario: Create with reversed dates
- **WHEN** a user creates a campaign with `startDate = 2026-12-31` and `endDate = 2026-01-01`
- **THEN** the system SHALL respond 400 naming `endDate` and SHALL NOT create the campaign

#### Scenario: Update only the end date
- **WHEN** a campaign starts on 2026-06-01 and a user updates only `endDate` to 2026-05-01
- **THEN** the system SHALL respond 400 naming `endDate` and the campaign SHALL not change

#### Scenario: Same day
- **WHEN** a user creates a campaign whose start and end dates are both 2026-06-01
- **THEN** the campaign SHALL be created

### Requirement: Broadcast Schedule Is In The Future
When a broadcast is created with `scheduledAt`, the system SHALL require a parseable time later than now; otherwise it SHALL respond 400 naming `scheduledAt` and SHALL NOT create the broadcast. This applies to every caller of broadcast creation, including the REST API and MCP tools.

#### Scenario: Schedule in the past
- **WHEN** a user creates a broadcast with `scheduledAt = 2020-01-01T00:00`
- **THEN** the system SHALL respond 400 naming `scheduledAt` and no broadcast SHALL be created or sent

#### Scenario: Schedule in the future
- **WHEN** a user creates a broadcast scheduled one hour from now
- **THEN** the broadcast SHALL be created with status `scheduled`

#### Scenario: No schedule
- **WHEN** a user creates a broadcast without `scheduledAt`
- **THEN** the broadcast SHALL be created as a draft
