## ADDED Requirements

### Requirement: Case Deletion API
The system SHALL provide an authenticated, tenant-scoped API endpoint to delete a Case by id.

#### Scenario: Delete an existing Case
- **WHEN** an authenticated agent deletes a Case that belongs to the agent's tenant
- **THEN** the system removes the Case, removes dependent Case events and notes, unlinks related Conversations, emits `case.deleted` to the tenant room, and returns success

#### Scenario: Delete a Case from another tenant
- **WHEN** an authenticated agent attempts to delete a Case that does not belong to the agent's tenant
- **THEN** the system rejects the request with a not found response and does not delete the Case

### Requirement: Case Status Transition Validation
The system SHALL validate every public Case status change using the shared Case status transition rules.

#### Scenario: Reject closed to in progress transition
- **WHEN** an authenticated agent attempts to change a Case from `CLOSED` directly to `IN_PROGRESS`
- **THEN** the system rejects the request with an invalid transition error and leaves the Case status unchanged

#### Scenario: Allow closed to open reopen transition
- **WHEN** an authenticated agent reopens a Case from `CLOSED`
- **THEN** the system changes the Case status to `OPEN` and records a status change event

### Requirement: Case Conversation Linking
The system SHALL support linking multiple Conversations to one Case while ensuring each Conversation is linked to at most one Case.

#### Scenario: Create Case from Conversation
- **WHEN** an authenticated agent creates a Case from an unlinked Conversation
- **THEN** the system creates the Case, links the triggering Conversation to the Case atomically, emits `case.created`, and returns the created Case

#### Scenario: Reject duplicate Case creation from linked Conversation
- **WHEN** an authenticated agent attempts to create a new Case from a Conversation that already has a linked Case
- **THEN** the system rejects the request with a conflict response and does not create another Case

#### Scenario: Link another Conversation to existing Case
- **WHEN** an authenticated agent links a second unlinked Conversation from the same tenant to an existing Case
- **THEN** the system links the Conversation to that Case and the Case detail exposes both linked Conversations

#### Scenario: Reject cross-tenant Conversation link
- **WHEN** an authenticated agent attempts to link a Conversation from another tenant to a Case
- **THEN** the system rejects the request with a not found response and does not change either record
