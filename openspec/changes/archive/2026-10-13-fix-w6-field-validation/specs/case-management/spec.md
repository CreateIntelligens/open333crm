## ADDED Requirements

### Requirement: Escalation Notify Targets Are Validated
`POST /api/v1/cases/:id/escalate` SHALL accept `notifyTargets` only as an array of `supervisor`, `original_assignee` and `team`; any other value SHALL be rejected with 400 and the case SHALL not change. `team` is accepted but currently notifies no one.

#### Scenario: Invalid notify target
- **WHEN** an agent escalates a case with `notifyTargets: ["everyone"]`
- **THEN** the system SHALL respond 400 and the case SHALL not change

### Requirement: Escalation Notifies The Selected Targets
After escalation the system SHALL notify, for `supervisor`, every active supervisor and admin of the tenant, and for `original_assignee`, the active agent assigned before the escalation. The agent who escalated SHALL NOT be notified, and each agent SHALL receive at most one notification. When `notifyTargets` is omitted, only supervisors and admins SHALL be notified.

#### Scenario: Notify the original assignee
- **WHEN** agent A escalates a case previously assigned to agent B with `notifyTargets: ["original_assignee"]`
- **THEN** agent B SHALL receive a case-escalated notification and no supervisor SHALL be notified

#### Scenario: Notify supervisors and the original assignee
- **WHEN** a case assigned to agent B is escalated with `notifyTargets: ["supervisor", "original_assignee"]` and agent B is also a supervisor
- **THEN** every active supervisor and admin SHALL be notified, and agent B SHALL receive exactly one notification

#### Scenario: Escalating agent is the original assignee
- **WHEN** agent B escalates a case assigned to agent B with `notifyTargets: ["original_assignee"]`
- **THEN** no notification SHALL be sent to agent B

#### Scenario: No notify targets given
- **WHEN** a case is escalated without `notifyTargets`
- **THEN** every active supervisor and admin SHALL be notified

#### Scenario: Empty notify targets
- **WHEN** a case is escalated with `notifyTargets: []`
- **THEN** no escalation notification SHALL be sent

#### Scenario: Supervisor escalates a case
- **WHEN** supervisor S escalates a case with `notifyTargets: ["supervisor"]`
- **THEN** every other active supervisor and admin SHALL be notified, and S SHALL NOT be notified

#### Scenario: Escalation dialog selects notify team
- **WHEN** an agent escalates a case from the escalation dialog with `notifyTargets: ["supervisor", "original_assignee", "team"]`
- **THEN** the escalation SHALL succeed
