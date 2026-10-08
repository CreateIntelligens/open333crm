## MODIFIED Requirements

### Requirement: Contact Merging
The system SHALL merge two contact records through a single merge engine used by every merge path (manual merge, approved merge suggestion, binding code, email registration). The merge SHALL run inside the caller's tenant-bound transaction, move every record that references the merged contact to the survivor, archive the merged contact instead of deleting it, and write a `ContactMergeLog` entry listing the moved record ids.

#### Scenario: Merging duplicates
- **WHEN** a supervisor selects Contact A to be merged into Contact B
- **THEN** channel identities, conversations, cases, long-term memories, portal submissions, identity map entries, click logs, flow executions, KB feedback and broadcast recipients of A SHALL point to B; A's point balance SHALL be transferred to B through a transfer-out entry on A and a transfer-in entry on B (the append-only ledger's existing entries stay with their owner); tags, attributes and broadcast recipients SHALL be de-duplicated with B's existing values taking precedence; A SHALL be archived with `mergedIntoId = B`; and a merge log with source `MANUAL` SHALL be written

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
