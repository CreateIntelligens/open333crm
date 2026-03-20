## ADDED Requirements

### Requirement: Audience Group management
The system SHALL manage LINE Audience Groups to enable Narrowcast targeting.

#### Scenario: Create audience from segment
- **WHEN** a Broadcast/Campaign with Narrowcast strategy is approved for sending
- **THEN** the system calls `POST /v2/bot/audienceGroup/upload` with the resolved LINE userIds from the segment
- **THEN** the returned `audienceGroupId` is stored in the `Broadcast` record

#### Scenario: Update audience
- **WHEN** a segment's membership changes and a Narrowcast is re-scheduled
- **THEN** the system calls `POST /v2/bot/audienceGroup/{id}/users` to sync new members

#### Scenario: Delete stale audience
- **WHEN** a Campaign is cancelled or completed
- **THEN** the system schedules deletion of the associated Audience Group via `DELETE /v2/bot/audienceGroup/{id}`

---

### Requirement: Click-based and impression-based audience
The system SHALL support creating retargeting audiences based on prior campaign interactions.

#### Scenario: Click-based audience
- **WHEN** a marketer selects "users who clicked campaign X" as audience source
- **THEN** the system calls `POST /v2/bot/audienceGroup/click` with the relevant `requestId` from campaign X

#### Scenario: Impression-based audience
- **WHEN** a marketer selects "users who received campaign X" as audience source
- **THEN** the system calls `POST /v2/bot/audienceGroup/impression` with the relevant `requestId`

---

### Requirement: Narrowcast progress tracking
The system SHALL track Narrowcast delivery progress until completion.

#### Scenario: Poll progress
- **WHEN** a Narrowcast is sent and `requestId` is returned
- **THEN** a BullMQ job polls `GET /v2/bot/message/progress/narrowcast?requestId=` every 5 minutes
- **THEN** when `sendingComplete` is received, the Broadcast status is updated to `delivered`

#### Scenario: Cancel in-flight Narrowcast
- **WHEN** an administrator cancels a pending Narrowcast
- **THEN** the system calls `DELETE /v2/bot/message/narrowcast?requestId=` and marks the Broadcast as `cancelled`
