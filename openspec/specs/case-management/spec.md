## Case Management Requirements

### Requirement: Case Creation
The system SHALL support creating a case manually or automatically from a conversation.

#### Scenario: Auto-create case from keyword rule
- **WHEN** an automation rule matches the keyword "complaint"
- **THEN** a new Case is created and linked to the triggering Conversation

### Requirement: Case Assignment
The system SHALL allow assigning a case to an agent or team.

#### Scenario: Assigning case to agent
- **WHEN** a supervisor assigns Case `C-1001` to Agent `A-12`
- **THEN** the case's `assignee_id` is updated and a `CaseEvent` is recorded

### Requirement: Case Merge
The system SHALL support merging duplicate or related cases.

#### Scenario: Merging child cases
- **WHEN** Agent merges Case `C-1002` into Case `C-1001`
- **THEN** `C-1002` is marked as merged, and its events are preserved
