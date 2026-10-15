## ADDED Requirements

### Requirement: SLA Outcome Recorded Once Per Deadline
The SLA worker SHALL record each SLA outcome of a Case at most once per deadline. It SHALL skip a warning or breach when a CaseEvent of the same type exists at or after the warning time or deadline, and a customer-waiting breach when one exists after the last agent reply. A skipped outcome SHALL enqueue no notification.

#### Scenario: Breached case is scanned again on a later day
- **WHEN** a Case passed its resolution deadline, the worker already recorded a `sla_breached` CaseEvent after the deadline, and the worker scans the Case again more than 24 hours later
- **THEN** the worker creates no new `sla_breached` CaseEvent and enqueues no notification for the Case

#### Scenario: Resolution deadline changes after a breach
- **WHEN** the only `sla_breached` CaseEvent of a Case was created before the current resolution deadline, and the current deadline has passed
- **THEN** the worker creates one new `sla_breached` CaseEvent and enqueues its notifications

#### Scenario: Customer keeps waiting after an agent reply
- **WHEN** a `customer_waiting_breached` CaseEvent exists from before the last agent reply, and the customer has since sent three messages without an agent reply
- **THEN** the worker creates one new `customer_waiting_breached` CaseEvent
