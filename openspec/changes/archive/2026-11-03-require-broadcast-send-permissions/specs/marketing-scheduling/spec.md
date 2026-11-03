## ADDED Requirements

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
Before the scheduler sends a due broadcast, the system SHALL check the current effective permissions of the member who scheduled the send (`scheduledById`, or the creator when it is empty). When the member no longer exists, is deactivated, or lacks a needed permission, the system SHALL NOT send, SHALL set the broadcast to `failed`, and SHALL store a `failureCode` and a Chinese `failureReason` that names the cause.

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

#### Scenario: Coupon broadcast sent now by another member
- **GIVEN** member A without `marketing.broadcast` created a coupon broadcast draft
- **WHEN** member B with `marketing.broadcast` and `coupon.issue` presses send, and the scheduler picks up the queued broadcast
- **THEN** the scheduler SHALL check member B and the broadcast SHALL be sent
