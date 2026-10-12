# Spec Delta

## ADDED Requirements

### Requirement: Decision-assisted case classification
When an eligible new Case has no category, the system SHALL use a valid, confident decision-chain category answer and SHALL preserve an existing category selected by an agent or automation rule.

#### Scenario: New case receives a confident category
- **WHEN** a new Case has no category and an accepted provider returns an allowed category at or above the configured confidence threshold
- **THEN** the system stores the selected category on that Case

#### Scenario: Case already has a category
- **WHEN** a new Case already has a category selected by an agent or automation rule
- **THEN** no provider decision replaces that category

#### Scenario: Category decision is unavailable or uncertain
- **WHEN** every configured provider is unavailable or returns an invalid category or confidence below the configured threshold
- **THEN** the system uses the existing issue-classification and keyword-fallback path without surfacing an error to the customer

### Requirement: Decision-assisted case urgency
For an eligible new Case without an explicitly supplied priority, the system SHALL map a valid ordered urgency score from the decision chain to the Case priority using the configured ordered criteria.

#### Scenario: Confident urgency updates an unset priority
- **WHEN** a new Case has no explicitly supplied priority and an accepted provider returns an allowed urgency score at or above the configured confidence threshold
- **THEN** the system stores the mapped priority on the Case

#### Scenario: Explicit priority is preserved
- **WHEN** a user or automation supplies a Case priority during creation
- **THEN** no provider urgency result replaces that priority

#### Scenario: Urgency decision is unavailable or uncertain
- **WHEN** every configured provider is unavailable or returns an invalid score or confidence below the configured threshold
- **THEN** the Case keeps its existing priority and creation continues without a decision error

#### Scenario: Urgency score maps to the most probable priority
- **WHEN** an accepted provider returns a valid urgency score whose highest probability is the `HIGH` legend entry
- **THEN** the system maps that entry to Case priority `HIGH` when priority was omitted

### Requirement: Tenant-scoped team recommendation for case assignment
When a new Case has no explicitly selected team, the system SHALL request a team recommendation using only active teams eligible for the Case tenant and channel, and SHALL validate each provider result against that candidate set before assignment.

#### Scenario: Valid team recommendation
- **WHEN** an accepted provider returns an allowed team recommendation above the configured confidence threshold
- **THEN** the Case uses that team and the existing assignment logic selects an agent eligible for that team and channel

#### Scenario: Team recommendation is unavailable or uncertain
- **WHEN** every configured provider is unavailable or returns a team outside the candidate set or confidence below the configured threshold
- **THEN** the Case uses the existing assignment path and case creation continues without a decision error

#### Scenario: Explicit team is preserved
- **WHEN** a user or automation supplies a team during Case creation
- **THEN** no provider recommendation replaces the selected team

#### Scenario: No eligible team candidates
- **WHEN** the Case tenant and channel have no active eligible team candidates
- **THEN** the system skips team recommendation and uses the existing assignment path
