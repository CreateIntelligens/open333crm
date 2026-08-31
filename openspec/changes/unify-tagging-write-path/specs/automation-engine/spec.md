## ADDED Requirements

### Requirement: Unified Contact Tagging Emits contact.tagged

All contact-tagging write paths — manual tagging, short-link click auto-tag, and automation `add_tag` — SHALL result in a `contact.tagged` event being emitted, so that automation rules triggered by tagging fire consistently regardless of which path added the tag. Tagging SHALL remain idempotent (adding an existing tag SHALL NOT duplicate). The `contact.tagged` event SHALL carry a `source` field ('agent' | 'system' | 'automation') indicating which path added it.

#### Scenario: Short-link click auto-tag emits event

- **WHEN** a contact clicks a short link with `tagOnClick` set
- **THEN** the tag is added (idempotently) and a `contact.tagged` event with source 'system' is emitted

#### Scenario: Automation add_tag emits event

- **WHEN** an automation `add_tag` action tags a contact
- **THEN** a `contact.tagged` event with source 'automation' is emitted (bridged from the worker process to the API event bus)

#### Scenario: Manual tagging still emits event

- **WHEN** an agent manually tags a contact
- **THEN** a `contact.tagged` event with source 'agent' is emitted (existing behaviour preserved)

### Requirement: Tagging Write Path Is Shared Where Possible

Within the API process, contact-tagging SHALL go through a single shared function (`addTagToTarget`) rather than duplicated find-then-create logic. The shared function SHALL accept a tag source ('agent' | 'system' | 'automation'), defaulting to 'agent' so existing callers are unaffected; agent id SHALL be optional (non-agent sources have no agent).

#### Scenario: Click path uses the shared tagging function

- **WHEN** the short-link click path adds a tag
- **THEN** it calls the shared `addTagToTarget` with source 'system', not its own create logic

#### Scenario: Existing manual callers unaffected

- **WHEN** an existing manual-tagging caller invokes `addTagToTarget` without specifying source
- **THEN** the source defaults to 'agent' and behaviour is unchanged

### Requirement: Tagging Loop Protection

The system SHALL prevent infinite tagging loops. A `contact.tagged` event whose source is 'automation' SHALL NOT itself trigger further automation `add_tag` actions (self-triggering is broken). Human ('agent') and click ('system') tagging MAY trigger automation.

#### Scenario: Automation-sourced tag does not re-trigger tagging

- **WHEN** an automation rule adds a tag, emitting `contact.tagged` with source 'automation'
- **THEN** that event does not trigger another add_tag, preventing an infinite loop

#### Scenario: Human/click tag can trigger automation

- **WHEN** a tag is added by an agent or by a short-link click
- **THEN** the resulting `contact.tagged` may trigger automation rules
