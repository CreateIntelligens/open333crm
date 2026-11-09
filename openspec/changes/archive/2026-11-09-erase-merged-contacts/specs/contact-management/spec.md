## MODIFIED Requirements

### Requirement: Merge Reversal
The system SHALL allow a user with `contact.merge` permission to revert any non-reverted merge log entry. Reversal SHALL un-archive the merged contact, and the log SHALL record `revertedAt` and `revertedBy`.

Reversal SHALL be rejected with HTTP 409 and `error.code` `CONTACT_ERASED` when the merged contact, the survivor, or any contact the survivor was later merged into has a `completed` data erasure request. The rejection SHALL change nothing. The same check SHALL apply when a customer reverts a binding. Before the check, the system SHALL lock these contacts, so that a reversal and an erasure of the same contacts run one after the other.

#### Scenario: Agent reverts a binding
- **WHEN** an agent reverts the merge log that bound a LINE identity into a FB contact
- **THEN** the LINE contact SHALL be restored as an active separate contact with its LINE identity and the conversations recorded in the log

#### Scenario: Revert without permission
- **WHEN** a user whose role lacks `contact.merge` calls the revert endpoint
- **THEN** the system SHALL respond 403 and change nothing

#### Scenario: Already reverted
- **WHEN** a merge log that is already reverted is reverted again
- **THEN** the system SHALL reject the request and change nothing

#### Scenario: Revert after erasure
- **WHEN** contact A was merged into B, B was then anonymized or hard deleted by a completed data erasure request, and an agent reverts that merge log
- **THEN** the system SHALL respond 409 with `error.code` `CONTACT_ERASED`, A SHALL stay archived, and the merge log SHALL stay not reverted

#### Scenario: Revert while erasure is pending
- **WHEN** contact A was merged into B, a data erasure request for B is still `pending`, and an agent reverts that merge log
- **THEN** the reversal SHALL succeed and A SHALL be restored
