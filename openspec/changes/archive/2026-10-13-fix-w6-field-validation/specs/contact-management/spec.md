## ADDED Requirements

### Requirement: Contact Phone Format
When a contact's phone is written through the contacts API, the system SHALL trim leading and trailing whitespace and SHALL accept at most 30 characters consisting only of digits, spaces, `+`, `-`, `(`, `)` and `#`. Other values SHALL be rejected with 400 naming the `phone` field. An empty string after trimming SHALL clear the phone.

#### Scenario: Taiwan and international numbers
- **WHEN** an agent saves the phone `0912-345-678`, then `+886 912 345 678`, then `+1 (415) 555-0100 #12`
- **THEN** each value SHALL be saved as given after trimming

#### Scenario: Invalid characters
- **WHEN** an agent saves the phone `<script>alert(1)</script>`
- **THEN** the system SHALL respond 400 naming `phone` and the phone SHALL not change

#### Scenario: Too long
- **WHEN** an agent saves a phone of 31 digits
- **THEN** the system SHALL respond 400 naming `phone`

#### Scenario: Clearing the phone
- **WHEN** an agent saves the phone `"   "`
- **THEN** the contact's phone SHALL become empty
