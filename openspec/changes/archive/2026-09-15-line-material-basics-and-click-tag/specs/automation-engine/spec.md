## ADDED Requirements

### Requirement: Short Link Click Trigger Event

The automation engine SHALL recognize `link.clicked` as a valid trigger event, emitted when a short link is clicked. The event SHALL be selectable as a rule trigger in the automation UI and pass contract validation. The event SHALL provide `tenant` and `contact` scopes; when the click cannot be resolved to a contact (anonymous click), contact-scoped actions SHALL be skipped without failing the rule.

#### Scenario: link.clicked is a valid trigger

- **WHEN** an automation rule is composed with trigger `link.clicked`
- **THEN** contract validation accepts it (does not reject as unknown event)
- **AND** the automation UI lists "短連結被點擊" as a selectable trigger

#### Scenario: Rule fires on short link click

- **WHEN** a contact clicks a short link that resolves to a known contact
- **THEN** the `link.clicked` event fires and any matching automation rule executes

#### Scenario: Anonymous click does not break the rule

- **WHEN** a short link click cannot be resolved to a contact
- **THEN** the rule's contact-scoped actions are skipped and the rule does not error

### Requirement: Short Link Click Facts

The `link.clicked` event SHALL provide facts including `shortLinkId`, `slug`, and (when available) `contactId`, so rule conditions can target which specific short link was clicked.

#### Scenario: Condition on specific short link

- **WHEN** a rule condition is "slug equals a specific value"
- **THEN** the rule only executes for clicks on that short link, not others

### Requirement: Add Tag Worker Action

The worker-side automation action executor SHALL support an `add_tag` action that adds a tag to the triggering contact. The action SHALL be idempotent (adding an already-present tag SHALL NOT create a duplicate). When no contact is available in context, the action SHALL be skipped with a log entry and SHALL NOT error. The tag write SHALL go through the tenant-bound connection (SHALL NOT bypass RLS).

#### Scenario: Add tag to contact on rule execution

- **WHEN** a rule with an `add_tag` action executes for a contact
- **THEN** the specified tag is added to that contact

#### Scenario: Adding an existing tag is idempotent

- **WHEN** an `add_tag` action targets a contact that already has the tag
- **THEN** no duplicate tag association is created

#### Scenario: Missing contact skips gracefully

- **WHEN** an `add_tag` action executes with no contact in context
- **THEN** the action is skipped with a log entry and the rule does not fail

### Requirement: End-to-End Click-to-Tag Rule Path

The system SHALL support the full path: a short link click emits `link.clicked` → a matching automation rule runs → an `add_tag` action tags the clicking contact. This path SHALL coexist with the existing direct `tagOnClick` field on short links; both may apply to the same click, and idempotent tagging SHALL prevent duplicates.

#### Scenario: Click-to-tag via automation rule

- **WHEN** a contact clicks a short link and a rule with trigger `link.clicked` + action `add_tag` exists
- **THEN** the contact receives the tag via the rule path

#### Scenario: Direct path and rule path coexist

- **WHEN** a short link has both `tagOnClick` set and a matching `link.clicked` rule
- **THEN** both paths run and the contact ends with the tag(s) without duplicates
