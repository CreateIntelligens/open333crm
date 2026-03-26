## Contact Management Requirements

### Requirement: Identity Resolution
The system SHALL automatically link channel identities based on common identifiers (phone/email).

#### Scenario: Linking LINE user via Phone
- **GIVEN** an existing Contact with phone `0912345678`
- **WHEN** a new LINE message arrives from a user who has previously shared their phone `0912345678` in a lead form
- **THEN** the LINE identity is linked to the existing Contact instead of creating a new one

### Requirement: Contact Merging
The system SHALL support manual merging of two contact records.

#### Scenario: Merging duplicates
- **WHEN** a supervisor selects Contact A to be merged into Contact B
- **THEN** all tags, attributes, and channel identities from A are moved to B, and A is deleted
