## ADDED Requirements

### Requirement: LINE Text Message Body Is Text
When a `line_text` material is created, or updated with a new body, the system SHALL reject with 400 naming `body.text` a body whose `text` is not a string. The check SHALL run before the LINE validate API is called, and SHALL apply when the tenant has no active LINE channel.

#### Scenario: Numeric text
- **WHEN** a user saves a `line_text` material through the API with `text = 12345` (a number)
- **THEN** the system SHALL respond 400 naming `body.text`, SHALL NOT call the LINE validate API and SHALL NOT save the material

#### Scenario: String text
- **WHEN** a user saves a `line_text` material with `text = "12345"` (a string)
- **THEN** the system SHALL pass the body to the LINE validate API as before

### Requirement: FB Coupon Code Has No Whitespace
When an `fb_coupon` material is created, or updated with a new body, the system SHALL reject with 400 naming `body.coupon_code` a `coupon_code` that is not a string or that contains whitespace. An empty string, `null` or missing `coupon_code` SHALL be accepted.

#### Scenario: Coupon code with a space
- **WHEN** a user saves an `fb_coupon` material through the API with `coupon_code = "AB C"`
- **THEN** the system SHALL respond 400 naming `body.coupon_code` and SHALL NOT save the material

#### Scenario: Coupon code without whitespace
- **WHEN** a user saves an `fb_coupon` material with `coupon_code = "E2E90"`
- **THEN** the material SHALL be saved

#### Scenario: Empty coupon code
- **WHEN** a user saves an `fb_coupon` material without a `coupon_code`
- **THEN** the material SHALL be saved
