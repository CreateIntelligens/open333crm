# marketing-scheduling Specification

## Purpose
規定行銷活動的期間與廣播的排程時間要合理：活動結束日不可早於開始日，廣播不可排程到過去，避免建出永遠不在期間內的活動，或因為填錯時間而立即發送給客人的廣播。

## Requirements

### Requirement: Campaign End Date Is Not Before Start Date
When a marketing campaign is created or updated, the system SHALL reject with 400 naming `endDate` a campaign whose end date is earlier than its start date. On update the system SHALL check only when `startDate` or `endDate` is changed, comparing the dates the campaign will have after the update. A date string that cannot be parsed SHALL be rejected with 400.

#### Scenario: Create with reversed dates
- **WHEN** a user creates a campaign with `startDate = 2026-12-31` and `endDate = 2026-01-01`
- **THEN** the system SHALL respond 400 naming `endDate` and SHALL NOT create the campaign

#### Scenario: Update only the end date
- **WHEN** a campaign starts on 2026-06-01 and a user updates only `endDate` to 2026-05-01
- **THEN** the system SHALL respond 400 naming `endDate` and the campaign SHALL not change

#### Scenario: Update status only on a legacy campaign
- **WHEN** a campaign created before this rule has an end date earlier than its start date, and a user changes only its status to `cancelled`
- **THEN** the update SHALL succeed

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
- **WHEN** a user creates a broadcast without `scheduledAt`, or with an empty `scheduledAt`
- **THEN** the broadcast SHALL be created as a draft

### Requirement: Scheduling A Broadcast Requires The Broadcast Permission
When a broadcast is created with a non-empty `scheduledAt`, the system SHALL require the `marketing.broadcast` permission in addition to `marketing.manage`. Without it the system SHALL respond 403 with `error.details.requiredPermission = 'marketing.broadcast'` and SHALL NOT create the broadcast. A broadcast created without `scheduledAt` (a draft) SHALL need only `marketing.manage`.

#### Scenario: Schedule without the broadcast permission
- **WHEN** a member with `marketing.view` and `marketing.manage` but without `marketing.broadcast` creates a broadcast scheduled one hour from now
- **THEN** the system SHALL respond 403 with `error.details.requiredPermission = 'marketing.broadcast'` and no broadcast SHALL be created

#### Scenario: Draft without the broadcast permission
- **WHEN** the same member creates a broadcast without `scheduledAt`
- **THEN** the broadcast SHALL be created as a draft

#### Scenario: Schedule with the broadcast permission
- **WHEN** a member with `marketing.manage` and `marketing.broadcast` creates a broadcast scheduled one hour from now
- **THEN** the broadcast SHALL be created with status `scheduled`

#### Scenario: Create form without the broadcast permission
- **WHEN** a member without `marketing.broadcast` opens the create broadcast form
- **THEN** the schedule field SHALL be disabled and the form SHALL say that scheduling needs the broadcast permission

### Requirement: Permissions Needed To Send A Broadcast
A broadcast without a coupon SHALL need `marketing.broadcast` to be sent. A coupon broadcast from the broadcast page SHALL need `marketing.broadcast` and `coupon.issue`. A batch issue from the coupon page SHALL need only `coupon.issue`. The scheduler SHALL use these sets when it rechecks a due broadcast.

#### Scenario: Batch issue needs only the coupon permission
- **GIVEN** a batch issue was queued by a member with `coupon.issue` and without `marketing.broadcast`
- **WHEN** the scheduler reaches the batch issue
- **THEN** the batch issue SHALL be sent

### Requirement: The Scheduler Rechecks The Scheduling Member's Permissions
Before the scheduler sends a due broadcast, and before the `coupon-broadcast` queue job sends a coupon broadcast, the system SHALL check the current effective permissions of the member who scheduled the send (`scheduledById`, or the creator when it is empty). The queue job checks too, because a retry or a delayed outbox delivery can run it after the member lost a permission. When the member no longer exists, is deactivated, or lacks a needed permission, the system SHALL NOT send, SHALL set the broadcast to `failed`, and SHALL store a `failureCode` and a Chinese `failureReason` that names the cause.

#### Scenario: Creator lost the broadcast permission
- **GIVEN** a broadcast was scheduled by a member who had `marketing.broadcast`
- **WHEN** the member's role loses `marketing.broadcast` and the scheduler reaches the broadcast
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, and `failureCode` SHALL be `SCHEDULED_SENDER_FORBIDDEN`

#### Scenario: Creator deactivated
- **GIVEN** a broadcast was scheduled by a member who is deactivated before it is due
- **WHEN** the scheduler reaches the broadcast
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, and `failureCode` SHALL be `SCHEDULED_SENDER_INACTIVE`

#### Scenario: Coupon broadcast and the creator lost the coupon permission
- **GIVEN** a coupon broadcast was scheduled by a member who had `marketing.broadcast` and `coupon.issue`
- **WHEN** the member's role loses `coupon.issue` and the scheduler reaches the broadcast
- **THEN** no coupon SHALL be issued, no message SHALL be sent, and the broadcast SHALL be `failed` with `failureCode = 'SCHEDULED_SENDER_FORBIDDEN'`

#### Scenario: Member with the permissions
- **WHEN** the scheduler reaches a due broadcast whose scheduling member still has the needed permissions
- **THEN** the broadcast SHALL be sent

#### Scenario: Sender lost the coupon permission before the queued job ran
- **GIVEN** a member with `marketing.broadcast` and `coupon.issue` sent a coupon broadcast now, and the system queued the `coupon-broadcast` job
- **WHEN** the member's role loses `coupon.issue` before the job runs
- **THEN** the job SHALL NOT issue a coupon or send a message, and the broadcast SHALL be `failed` with `failureCode = 'SCHEDULED_SENDER_FORBIDDEN'`

#### Scenario: Coupon broadcast sent now by another member
- **GIVEN** member A without `marketing.broadcast` created a coupon broadcast draft
- **WHEN** member B with `marketing.broadcast` and `coupon.issue` presses send, and the scheduler picks up the queued broadcast
- **THEN** the scheduler SHALL check member B and the broadcast SHALL be sent

### Requirement: The Scheduler Does Not Send Broadcasts Of A Disabled Tenant
Before the scheduler sends a due broadcast, and before the `coupon-broadcast` queue job sends a coupon broadcast, the system SHALL check that the tenant is active. This check runs before the permission recheck. When the tenant is disabled, including a trial that expired, the system SHALL NOT send, SHALL set the broadcast to `failed` instead of leaving it `scheduled`, and SHALL store `failureCode = TENANT_DISABLED` and a Chinese `failureReason` that says the tenant is disabled.

#### Scenario: Active tenant sends the due broadcast (control)
- **WHEN** the scheduler reaches a due broadcast of an active tenant whose scheduling member has the permissions
- **THEN** the broadcast SHALL be `completed` and messages SHALL be sent

#### Scenario: Due broadcast of a disabled tenant
- **GIVEN** a broadcast was scheduled and the tenant is disabled before it is due
- **WHEN** the scheduler reaches the broadcast
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, `failureCode` SHALL be `TENANT_DISABLED`, and `failureReason` SHALL say that the tenant is disabled

#### Scenario: Due coupon broadcast of a disabled tenant
- **GIVEN** a coupon broadcast was scheduled and the tenant is disabled before it is due
- **WHEN** the scheduler reaches the broadcast
- **THEN** no message and no coupon SHALL be sent, and the broadcast SHALL be `failed` with `failureCode = TENANT_DISABLED`

#### Scenario: Queued coupon broadcast job of a disabled tenant
- **GIVEN** a coupon broadcast is queued and the tenant is disabled before the job runs
- **WHEN** the `coupon-broadcast` job runs
- **THEN** no coupon SHALL be sent, and the broadcast SHALL be `failed` with `failureCode = TENANT_DISABLED`
