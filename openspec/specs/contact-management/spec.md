## ADDED Requirements

### Requirement: Cross-Channel Identity Resolution
The system SHALL support linking multiple channel-specific identities (like a LINE UID and FB PSID) to a single Contact entity.

#### Scenario: Merging identities
- **WHEN** a user is identified as the same person across two different channels
- **THEN** their channel histories are merged under a single `Contact` record

### Requirement: Custom Attributes
The system SHALL allow attaching arbitrary key-value JSON attributes to a contact profile.

#### Scenario: Setting custom attribute
- **WHEN** an automation rule or agent updates a contact's "membership_tier" attribute
- **THEN** the attribute is stored in the `attributes` JSONB column of the contact record
