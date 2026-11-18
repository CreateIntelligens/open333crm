## MODIFIED Requirements

### Requirement: Contact Merging
The system SHALL merge two contact records through a single merge engine used by every merge path (manual merge, approved merge suggestion, binding code, email registration, comment private reply). The merge SHALL run inside the caller's tenant-bound transaction, move every record that references the merged contact to the survivor, archive the merged contact instead of deleting it, and write a `ContactMergeLog` entry listing the moved record ids.

#### Scenario: Merging duplicates
- **WHEN** a supervisor selects Contact A to be merged into Contact B
- **THEN** channel identities, conversations, cases, long-term memories, portal submissions, identity map entries, click logs, flow executions, KB feedback, broadcast recipients and comment authors of A SHALL point to B; A's point balance SHALL be transferred to B through a transfer-out entry on A and a transfer-in entry on B (the append-only ledger's existing entries stay with their owner); tags, attributes and broadcast recipients SHALL be de-duplicated with B's existing values taking precedence; A SHALL be archived with `mergedIntoId = B`; and a merge log with source `MANUAL` SHALL be written

#### Scenario: Point balances are summed
- **WHEN** B has 100 points and A has 50 points and A is merged into B
- **THEN** B's point balance SHALL be 150 and A's SHALL be 0

#### Scenario: Merge with records protected by restrictive foreign keys
- **WHEN** Contact A has point transactions and portal submissions and is merged into B through email registration
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

#### Scenario: Comment private reply joins the contact created from a comment
- **WHEN** a comment created Contact A with no channel identity, and the private reply's `recipient_id` is already an identity of Contact B on that channel
- **THEN** A SHALL be merged into B with merge log source `COMMENT_REPLY`, A's comment author SHALL point to B, and A SHALL be archived with `mergedIntoId = B`

### Requirement: Merge Reversal Moves Records Back
Reversal SHALL move back every record listed in the merge log that still points to the survivor, or to whoever the survivor was later merged into: channel identities, conversations, cases, long-term memories, portal submissions, point transactions, identity map entries, click logs, flow executions, KB feedback, broadcast recipients and comment authors. Tags and attributes SHALL NOT be taken back.

#### Scenario: Points transferred back on reversal
- **WHEN** a merge that transferred 50 points is reverted and the survivor has spent all but 30 of its points since
- **THEN** 30 points SHALL be transferred back and the survivor's balance SHALL NOT go negative

#### Scenario: Long-term memory is not left with the other person
- **WHEN** a binding made with a forwarded code is reverted
- **THEN** the merged contact's long-term memories SHALL move back and SHALL NOT remain on the survivor

#### Scenario: Comment author moved back on reversal
- **WHEN** a merge with source `COMMENT_REPLY` moved a comment author from A to B and the merge is reverted
- **THEN** the comment author SHALL point to A again, and the comment reply logs of that author SHALL show A
