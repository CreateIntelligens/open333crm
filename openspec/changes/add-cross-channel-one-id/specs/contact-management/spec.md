## MODIFIED Requirements

### Requirement: Contact Merging
The system SHALL merge two contact records through a single merge engine used by every merge path (manual merge, approved merge suggestion, LINE Login, FB Login, binding code). The merge SHALL run inside the caller's tenant-bound transaction, move every record that references the merged contact to the survivor, archive the merged contact instead of deleting it, and write a `ContactMergeLog` entry listing the moved record ids.

#### Scenario: Merging duplicates
- **WHEN** a supervisor selects Contact A to be merged into Contact B
- **THEN** channel identities, conversations, cases, long-term memories, portal submissions, point transactions, identity map entries, click logs, flow executions, KB feedback and broadcast recipients of A SHALL point to B; tags, attributes and broadcast recipients SHALL be de-duplicated with B's existing values taking precedence; A SHALL be archived with `mergedIntoId = B`; and a merge log with source `MANUAL` SHALL be written

#### Scenario: Merge with records protected by restrictive foreign keys
- **WHEN** Contact A has point transactions and portal submissions and is merged into B through LINE Login
- **THEN** the merge SHALL succeed, those records SHALL belong to B, and A SHALL be archived rather than deleted

#### Scenario: Survivor fills blank fields
- **WHEN** B has no phone and A has phone `0912345678`
- **THEN** B's phone SHALL become `0912345678`; fields B already has SHALL remain unchanged

#### Scenario: Cross-tenant merge rejected
- **WHEN** a merge is requested for two contacts that do not both belong to the caller's tenant
- **THEN** the system SHALL reject the merge and change nothing

#### Scenario: Pending suggestions superseded
- **WHEN** A is merged into B and a pending merge suggestion references A
- **THEN** that suggestion SHALL be marked `SUPERSEDED`

## ADDED Requirements

### Requirement: Merge Reversal
The system SHALL allow a user with `contact.merge` permission to revert any non-reverted merge log entry. Reversal SHALL un-archive the merged contact and move back every record listed in the log that still points to the survivor (or to whoever the survivor was later merged into): channel identities, conversations, cases, long-term memories, portal submissions, point transactions, identity map entries, click logs, flow executions, KB feedback and broadcast recipients. Conversations and cases created on the survivor after the merge on a channel whose identity is moved back SHALL also move back. Tags and attributes SHALL NOT be taken back. The log SHALL record `revertedAt` and `revertedBy`.

#### Scenario: Agent reverts a binding
- **WHEN** an agent reverts the merge log that bound a LINE identity into a FB contact
- **THEN** the LINE contact SHALL be restored as an active separate contact with its LINE identity and the conversations recorded in the log

#### Scenario: Revert without permission
- **WHEN** a user whose role lacks `contact.merge` calls the revert endpoint
- **THEN** the system SHALL respond 403 and change nothing

#### Scenario: Long-term memory is not left with the other person
- **WHEN** a binding made with a forwarded code is reverted
- **THEN** the merged contact's long-term memories SHALL move back and SHALL NOT remain on the survivor

#### Scenario: Conversation opened after the merge
- **WHEN** the customer started a new FB conversation after the merge and the merge is then reverted
- **THEN** that conversation SHALL move back to the restored contact together with the FB identity

#### Scenario: Already reverted
- **WHEN** a merge log that is already reverted is reverted again
- **THEN** the system SHALL reject the request and change nothing

### Requirement: Contact Merge History Display
The contact detail page SHALL list the contact's merge history (source, time, actor, merged contact's channel identities) and show a revert action for each non-reverted entry to users with `contact.merge` permission.

#### Scenario: Viewing merge history
- **WHEN** an agent opens a contact that was bound via binding code
- **THEN** the page SHALL show an entry with source 綁定代碼 and a 解除 action
