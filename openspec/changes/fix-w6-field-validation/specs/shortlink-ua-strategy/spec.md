## ADDED Requirements

### Requirement: LIFF ID Format Is Validated On Save
When a channel's settings are saved with `liffConfig.liffId`, the system SHALL trim it and SHALL accept only the LIFF ID format: 10 digits, a hyphen, and 8 letters or digits (for example `1234567890-AbcdEfgh`). Other values SHALL be rejected with 400 and the settings SHALL not change. An empty string SHALL clear the LIFF ID.

#### Scenario: Valid LIFF ID
- **WHEN** an admin saves a LINE channel with `liffConfig.liffId = "1234567890-AbcdEfgh"`
- **THEN** the channel's `settings.liffConfig.liffId` SHALL be `1234567890-AbcdEfgh`

#### Scenario: Invalid LIFF ID
- **WHEN** an admin saves `liffConfig.liffId = "<script>alert(1)</script>"`
- **THEN** the system SHALL respond 400 and the channel settings SHALL not change
