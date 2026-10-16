## ADDED Requirements

### Requirement: Broadcast Failure Reason Is Recorded
When a broadcast send by a user or by the scheduler ends in `failed`, the system SHALL store a reason in Chinese in the `failureReason` field of the broadcast. An `AppError` SHALL give its message as the reason. Any other error SHALL give a general Chinese reason without the internal error text. When at least one recipient succeeds, `failureReason` SHALL be null.

#### Scenario: Scheduled broadcast with an empty audience
- **WHEN** the scheduler sends a broadcast whose tag audience resolves to no channel identity
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL be the Chinese message of the `BROADCAST_NO_RECIPIENTS` error

#### Scenario: Unexpected error during a send
- **WHEN** a send throws an error that is not an `AppError`
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL be a general Chinese message that does not contain the error text

#### Scenario: Every recipient fails
- **WHEN** the channel returns an error for every recipient of a broadcast
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL contain the number of failed recipients and the first channel error

#### Scenario: Some recipients fail
- **WHEN** at least one recipient succeeds and at least one recipient fails
- **THEN** the broadcast SHALL be `completed` and `failureReason` SHALL be null

### Requirement: Failure Reason Is Cleared When A Broadcast Is Sent Again
When a send starts, the system SHALL set `failureReason` to null in the same update that sets the status to `sending`.

#### Scenario: Resend a failed broadcast successfully
- **WHEN** a broadcast with a `failureReason` is sent again and a recipient succeeds
- **THEN** the broadcast SHALL be `completed` and `failureReason` SHALL be null

### Requirement: Failed Broadcasts Show The Reason And Can Be Resent
The broadcast list and the broadcast table of a campaign SHALL show the `failureReason` of each `failed` broadcast next to its status. When a `failed` broadcast has no `failureReason`, the list SHALL say that no reason was recorded. The broadcast list SHALL show a resend button for each `failed` broadcast.

#### Scenario: Failed broadcast in the list
- **WHEN** the broadcast list shows a `failed` broadcast with a `failureReason`
- **THEN** the reason SHALL be visible in the row and a resend button SHALL be shown

#### Scenario: Old failed broadcast without a reason
- **WHEN** the broadcast list shows a `failed` broadcast whose `failureReason` is null
- **THEN** the row SHALL say that no reason was recorded
