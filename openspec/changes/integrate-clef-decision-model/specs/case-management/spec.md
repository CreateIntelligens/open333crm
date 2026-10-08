# Spec Delta

## ADDED Requirements

### Requirement: Decision-assisted case classification
When an eligible new Case has no category, the system SHALL use a valid, confident Clef category decision and SHALL preserve an existing category selected by an agent or automation rule.

#### Scenario: New case receives a confident category
- **WHEN** a new Case has no category and Clef returns an allowed category at or above the configured confidence threshold
- **THEN** the system stores the selected category on that Case

#### Scenario: Case already has a category
- **WHEN** a new Case already has a category selected by an agent or automation rule
- **THEN** the Clef decision does not replace that category

#### Scenario: Category decision is unavailable or uncertain
- **WHEN** Clef is unavailable, returns an invalid category, or returns confidence below the configured threshold
- **THEN** the system uses the existing issue-classification and keyword-fallback path without surfacing an error to the customer

### Requirement: Decision-assisted case urgency
For an eligible new Case without an explicitly supplied priority, the system SHALL map a valid Clef ordered urgency score to the Case priority using the configured ordered criteria.

#### Scenario: Confident urgency updates an unset priority
- **WHEN** a new Case has no explicitly supplied priority and Clef returns an allowed urgency score at or above the configured confidence threshold
- **THEN** the system stores the mapped priority on the Case

#### Scenario: Explicit priority is preserved
- **WHEN** a user or automation supplies a Case priority during creation
- **THEN** the Clef urgency result does not replace that priority

#### Scenario: Urgency decision is unavailable or uncertain
- **WHEN** Clef is unavailable, returns an invalid score, or returns confidence below the configured threshold
- **THEN** the Case keeps its existing priority and creation continues without a decision error

#### Scenario: Urgency score maps to the most probable priority
- **WHEN** Clef returns a valid urgency score whose highest probability is the `HIGH` legend entry
- **THEN** the system maps that entry to Case priority `HIGH` when priority was omitted

### Requirement: Tenant-scoped team recommendation for case assignment
When a new Case has no explicitly selected team, the system SHALL request a team recommendation using only active teams eligible for the Case tenant and channel, and SHALL validate the result against that candidate set before assignment.

#### Scenario: Valid team recommendation
- **WHEN** Clef returns an allowed team recommendation above the configured confidence threshold
- **THEN** the Case uses that team and the existing assignment logic selects an agent eligible for that team and channel

#### Scenario: Team recommendation is unavailable or uncertain
- **WHEN** Clef is unavailable, returns a team outside the candidate set, or returns confidence below the configured threshold
- **THEN** the Case uses the existing assignment path and case creation continues without a decision error

#### Scenario: Explicit team is preserved
- **WHEN** a user or automation supplies a team during Case creation
- **THEN** the Clef recommendation does not replace the selected team

#### Scenario: No eligible team candidates
- **WHEN** the Case tenant and channel have no active eligible team candidates
- **THEN** the system skips team recommendation and uses the existing assignment path
