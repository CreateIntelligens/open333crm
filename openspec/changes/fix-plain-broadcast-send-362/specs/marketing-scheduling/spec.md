## MODIFIED Requirements

### Requirement: The Scheduler Rechecks The Scheduling Member's Permissions
Before the scheduler sends a due broadcast, and before the `coupon-broadcast` queue job sends a broadcast with or without a coupon, the system SHALL check the current effective permissions of the member who scheduled the send (`scheduledById`, or the creator when it is empty). The queue job checks too, because a retry or a delayed outbox delivery can run it after the member lost a permission. When the member no longer exists, is deactivated, or lacks a needed permission, the system SHALL NOT send, SHALL set the broadcast to `failed`, and SHALL store a `failureCode` and a Chinese `failureReason` that names the cause.

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

#### Scenario: Sender lost the broadcast permission before the queued plain broadcast job ran
- **GIVEN** a member with `marketing.broadcast` sent a broadcast without a coupon now, and the system queued the `coupon-broadcast` job
- **WHEN** the member's role loses `marketing.broadcast` before the job runs
- **THEN** the job SHALL NOT send a message, and the broadcast SHALL be `failed` with `failureCode = 'SCHEDULED_SENDER_FORBIDDEN'`

### Requirement: The Scheduler Does Not Send Broadcasts Of A Disabled Tenant
Before the scheduler sends a due broadcast, and before the `coupon-broadcast` queue job sends a broadcast with or without a coupon, the system SHALL check that the tenant is active. This check runs before the permission recheck. When the tenant is disabled, including a trial that expired, the system SHALL NOT send, SHALL set the broadcast to `failed` instead of leaving it `scheduled`, and SHALL store `failureCode = TENANT_DISABLED` and a Chinese `failureReason` that says the tenant is disabled.

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

#### Scenario: Queued plain broadcast job of a disabled tenant
- **GIVEN** a broadcast without a coupon is queued and the tenant is disabled before the job runs
- **WHEN** the `coupon-broadcast` job runs
- **THEN** no message SHALL be sent, and the broadcast SHALL be `failed` with `failureCode = TENANT_DISABLED`

## ADDED Requirements

### Requirement: 排程器以綁定租戶的連線發送且兩期不重疊
排程器 SHALL 只以跨租戶的連線查詢到期的廣播清單（`id`、`tenantId`），每一則以綁定該廣播租戶的連線（RLS 依 `app.current_tenant`）讀寫廣播與收件紀錄並發送。發送時讀廣播 SHALL 同時比對 `id` 與 `tenantId`：以其他租戶的廣播 ID 發送時 SHALL 回 404 `NOT_FOUND`，不送出訊息。排程 SHALL 以 `withoutOverlapping` 註冊，上一期還沒結束時下一期不開始。

#### Scenario: 排程器以租戶連線發送一般群發
- **WHEN** 排程器處理一則到期的一般群發
- **THEN** 廣播、收件紀錄與渠道的讀寫都經由綁定該租戶的連線，跨租戶的連線只查到期清單；廣播為 `completed`

#### Scenario: 以其他租戶的廣播 ID 發送
- **WHEN** 以租戶 A 的身分發送租戶 B 的廣播 ID
- **THEN** 回 404 `NOT_FOUND`，沒有送出訊息，租戶 B 的廣播狀態不變

#### Scenario: 兩期排程不重疊
- **WHEN** 註冊群發排程
- **THEN** 排程 `broadcast-scheduled` 每 60 秒一期，並設定 `withoutOverlapping`
