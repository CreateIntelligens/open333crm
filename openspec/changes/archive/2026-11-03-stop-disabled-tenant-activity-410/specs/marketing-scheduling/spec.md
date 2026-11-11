## ADDED Requirements

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
