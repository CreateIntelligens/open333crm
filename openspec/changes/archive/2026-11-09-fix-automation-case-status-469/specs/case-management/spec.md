## ADDED Requirements

### Requirement: Automation Case Status Changes Follow The Transition Rules
The `update_case_status` automation action SHALL change a Case status only when the shared Case transition rules allow the change. A valid change SHALL record a `status_changed` Case event and SHALL emit the same `case.resolved` or `case.closed` event as a change by an agent. A rejected change SHALL leave the Case unchanged and SHALL record the reason on the Case timeline.

#### Scenario: Automation cannot resolve an open case
- **WHEN** an automation rule with `update_case_status` and status `RESOLVED` runs for a Case whose status is `OPEN`
- **THEN** the Case stays `OPEN` with a null `resolvedAt`, and the Case timeline has an `automation_status_skipped` event whose payload names the rule, `from: OPEN` and `to: RESOLVED`

#### Scenario: Automation records a valid status change
- **WHEN** an automation rule with `update_case_status` and status `RESOLVED` runs for a Case whose status is `IN_PROGRESS`
- **THEN** the Case becomes `RESOLVED`, the Case timeline has a `status_changed` event with `actorType: automation` and payload `from: IN_PROGRESS`, `to: RESOLVED`, `source: automation`, a `case.resolved` event is written to the outbox, and the `case.updated` socket event has `source: automation`

#### Scenario: Automation closes a case
- **WHEN** an automation rule with `update_case_status` and status `CLOSED` runs for a Case whose status is `IN_PROGRESS`
- **THEN** a `case.closed` event with the same payload fields as a close by an agent is written to the outbox

#### Scenario: Automation sets the current status
- **WHEN** an automation rule with `update_case_status` sets the status that the Case already has
- **THEN** the Case is unchanged and no Case event and no outbox event is written
