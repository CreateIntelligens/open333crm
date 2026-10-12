## Purpose

Contact management maintains tenant-scoped customer profiles, channel identities, duplicate handling, and contacts dashboard list behavior.

## Requirements

### Requirement: Identity Resolution
The system SHALL automatically link channel identities based on common identifiers (phone/email).

#### Scenario: Linking LINE user via Phone
- **GIVEN** an existing Contact with phone `0912345678`
- **WHEN** a new LINE message arrives from a user who has previously shared their phone `0912345678` in a lead form
- **THEN** the LINE identity is linked to the existing Contact instead of creating a new one

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

### Requirement: Contact List Channel Provider Display
The system SHALL expose and display provider metadata for each contact channel identity in the contacts list.

#### Scenario: Listing contacts with channel provider metadata
- **WHEN** an authenticated user requests the contacts list
- **THEN** each returned channel identity includes its channel type and the related provider channel's display name when a provider channel exists

#### Scenario: Displaying provider type and provider name
- **WHEN** a contact row has one or more channel identities with provider channel metadata
- **THEN** `/dashboard/contacts` displays both the provider type and the provider display name in the channel column for each identity

#### Scenario: Missing provider metadata fallback
- **WHEN** a contact channel identity does not include related provider channel metadata
- **THEN** `/dashboard/contacts` still displays the identity channel type without breaking the contacts table

### Requirement: Contact List WebChat Channel Visibility
The system SHALL support requesting contact list results that exclude WebChat-only contacts and omit WebChat identities from returned contact channel identity payloads.

#### Scenario: Contact list API excludes WebChat-only contacts and WebChat identities
- **WHEN** an authenticated user requests `/api/v1/contacts` with a filter that excludes `WEBCHAT` channel identities
- **THEN** returned contacts include only contacts that have at least one non-WebChat channel identity
- **AND** returned contacts omit `WEBCHAT` identities from each contact's `channelIdentities` array
- **AND** pagination counts are calculated from the same WebChat-excluding contact filter

#### Scenario: Contacts dashboard requests WebChat-excluded results
- **WHEN** `/dashboard/contacts` loads the contacts list
- **THEN** it calls `/api/v1/contacts` with the WebChat-exclusion filter
- **AND** the channel column displays only the channel identities returned by the API

#### Scenario: Contact has only WebChat identities
- **WHEN** a contact has only WebChat channel identities
- **THEN** `/dashboard/contacts` does not include that contact in the contacts list response
- **AND** the contact can still be accessed through non-list contact detail APIs when addressed directly

#### Scenario: Contact details keep WebChat identity data
- **WHEN** a user opens or requests a contact detail view for a contact with WebChat identities
- **THEN** WebChat identities remain available outside the contacts list channel-column display

### Requirement: Contacts Dashboard Pagination
The system SHALL expose pagination controls on `/dashboard/contacts` backed by `/api/v1/contacts` pagination metadata.

#### Scenario: Rendering contact list pagination
- **WHEN** `/dashboard/contacts` receives a paginated contact list response with more than one page
- **THEN** the page displays pagination controls and current total information

#### Scenario: Changing contact list page
- **WHEN** a user changes page from `/dashboard/contacts`
- **THEN** the next `/api/v1/contacts` request includes the selected `page` and configured `limit`

#### Scenario: Searching contacts resets pagination
- **WHEN** a user submits a new contact search query
- **THEN** `/dashboard/contacts` resets to page 1 before requesting results

### Requirement: Merge Reversal
The system SHALL allow a user with `contact.merge` permission to revert any non-reverted merge log entry. Reversal SHALL un-archive the merged contact, and the log SHALL record `revertedAt` and `revertedBy`.

#### Scenario: Agent reverts a binding
- **WHEN** an agent reverts the merge log that bound a LINE identity into a FB contact
- **THEN** the LINE contact SHALL be restored as an active separate contact with its LINE identity and the conversations recorded in the log

#### Scenario: Revert without permission
- **WHEN** a user whose role lacks `contact.merge` calls the revert endpoint
- **THEN** the system SHALL respond 403 and change nothing

#### Scenario: Already reverted
- **WHEN** a merge log that is already reverted is reverted again
- **THEN** the system SHALL reject the request and change nothing

### Requirement: Merge Reversal Moves Records Back
Reversal SHALL move back every record listed in the merge log that still points to the survivor, or to whoever the survivor was later merged into: channel identities, conversations, cases, long-term memories, portal submissions, point transactions, identity map entries, click logs, flow executions, KB feedback and broadcast recipients. Tags and attributes SHALL NOT be taken back.

#### Scenario: Points transferred back on reversal
- **WHEN** a merge that transferred 50 points is reverted and the survivor has spent all but 30 of its points since
- **THEN** 30 points SHALL be transferred back and the survivor's balance SHALL NOT go negative

#### Scenario: Long-term memory is not left with the other person
- **WHEN** a binding made with a forwarded code is reverted
- **THEN** the merged contact's long-term memories SHALL move back and SHALL NOT remain on the survivor

### Requirement: Merge Reversal Moves Later Conversations Back
Conversations and cases created on the survivor after the merge, on a channel whose identity is moved back, SHALL also move back to the restored contact.

#### Scenario: Conversation opened after the merge
- **WHEN** the customer started a new FB conversation after the merge and the merge is then reverted
- **THEN** that conversation SHALL move back to the restored contact together with the FB identity

#### Scenario: Survivor's own conversations stay
- **WHEN** both contacts had an identity on the same channel and the survivor opened a new conversation on it after the merge
- **THEN** reversal SHALL NOT move that conversation

### Requirement: Contact Merge History Display
The contact detail page SHALL list the contact's merge history (source, time, actor, merged contact's channel identities) and show a revert action for each non-reverted entry to users with `contact.merge` permission.

#### Scenario: Viewing merge history
- **WHEN** an agent opens a contact that was bound via binding code
- **THEN** the page SHALL show an entry with source 綁定代碼 and a 解除 action
