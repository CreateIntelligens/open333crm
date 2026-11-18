## MODIFIED Requirements

### Requirement: Case Status Transition Validation
The system SHALL validate every public Case status change using the shared Case transition rules. The rules keep two transitions that leave a finished Case: reopen (`CLOSED` to `OPEN`), used when the customer says that the problem is not solved, and back to in progress (`RESOLVED` to `IN_PROGRESS`), used when an agent resolved the Case by mistake. Every path that changes a Case status, including automation actions, SHALL maintain `resolvedAt` with the shared rule: a change to `RESOLVED` sets it; a change from `RESOLVED` to `CLOSED` keeps it; a change to `CLOSED` from any other status leaves it null; a change to any other status clears it. Existing rows SHALL NOT be backfilled. A change to `RESOLVED` SHALL also apply the CSAT survey fields that csat-survey "工單重新解決時的問卷" defines.

#### Scenario: Reject closed to in progress transition
- **WHEN** an authenticated agent attempts to change a Case from `CLOSED` directly to `IN_PROGRESS`
- **THEN** the system rejects the request with an invalid transition error and leaves the Case unchanged

#### Scenario: Allow closed to open reopen transition
- **WHEN** an authenticated agent reopens a Case from `CLOSED`
- **THEN** the system changes the Case status to `OPEN` and records a status change event

#### Scenario: Resolved case reopened to in progress
- **WHEN** an agent changes a Case from `RESOLVED` to `IN_PROGRESS`
- **THEN** the Case `resolvedAt` is null

#### Scenario: Closed case reopened
- **WHEN** an agent reopens a Case from `CLOSED` to `OPEN`
- **THEN** the Case `resolvedAt` is null

#### Scenario: Case closed directly
- **WHEN** an agent closes a Case from `IN_PROGRESS` without resolving it first
- **THEN** the Case has `closedAt` and its `resolvedAt` is null

#### Scenario: Resolved case closed
- **WHEN** an agent closes a Case from `RESOLVED`
- **THEN** the Case has `closedAt` and keeps the `resolvedAt` that it had

#### Scenario: Automation changes the case status
- **WHEN** an automation rule with the `update_case_status` action changes a Case from `RESOLVED` to `IN_PROGRESS`, or from `IN_PROGRESS` to `RESOLVED`
- **THEN** the Case `resolvedAt` follows the same rule as a change by an agent: null after the first change, set after the second
