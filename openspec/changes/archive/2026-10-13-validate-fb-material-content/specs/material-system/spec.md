## ADDED Requirements

### Requirement: FB Material Required Fields And Lengths
When an `fb_*` material is created, or updated with a new body, the system SHALL reject with 400 naming the field a body that leaves a required field empty after trimming or exceeds a length limit: `fb_text` text (1–2000), `fb_button` text (1–640), card and coupon `title` (1–80), `subtitle` (≤80), button `title` (1–20), `fb_receipt` `recipient_name` and `order_number`.

#### Scenario: Empty required field
- **WHEN** a user saves an `fb_coupon` material whose `title` is empty
- **THEN** the system SHALL respond 400 naming `body.title` and SHALL NOT save the material

#### Scenario: Valid default content
- **WHEN** a user saves any `fb_*` material with the editor's default content
- **THEN** the material SHALL be saved

### Requirement: FB Material Card And Button Counts
An `fb_generic` material SHALL have 1 to 10 cards, each with at most 3 buttons; an `fb_button` material SHALL have 1 to 3 buttons; an `fb_media` material SHALL have at most 1 button. Otherwise the system SHALL respond 400 naming the field instead of letting the FB plugin silently drop the extra items when sending.

#### Scenario: Too many buttons
- **WHEN** a user saves an `fb_button` material with 4 buttons
- **THEN** the system SHALL respond 400 naming `body.buttons`

#### Scenario: No cards
- **WHEN** a user saves an `fb_generic` material with no cards
- **THEN** the system SHALL respond 400 naming `body.elements`

### Requirement: FB Material Button Types
Every button of an `fb_*` material SHALL have `type` `web_url` or `postback`; a `postback` button SHALL have a non-empty `payload`. Otherwise the system SHALL respond 400 naming the button field.

#### Scenario: Unsupported button type
- **WHEN** a user saves an `fb_button` material whose first button has `type = "phone_number"`
- **THEN** the system SHALL respond 400 naming `body.buttons.0.type`

### Requirement: FB Material URLs Use Safe Schemes
Every URL field of an `fb_*` material that is sent to FB (image and video `url`, card `image_url`, `web_url` button `url`, coupon `image_url`) SHALL be an `http://` or `https://` URL or a site path starting with a single `/`. Other values SHALL be rejected with 400 naming the field. `fb_image` and `fb_video` SHALL require a URL; `fb_media` SHALL require a URL or an `attachment_id`.

#### Scenario: javascript scheme
- **WHEN** a user saves an `fb_image` material with `url = "javascript:alert(1)"`
- **THEN** the system SHALL respond 400 naming `body.url`

#### Scenario: http URL without a host
- **WHEN** a user saves an `fb_image` material with `url = "http:///a.jpg"`
- **THEN** the system SHALL respond 400 naming `body.url` with a message saying a host must follow `http(s)://`

#### Scenario: Sample image path
- **WHEN** a user saves an `fb_generic` card whose `image_url` is `/material-samples/product.jpeg`
- **THEN** the material SHALL be saved

### Requirement: FB Material Numbers And Enumerations
When present, these `fb_*` fields SHALL use only these values, otherwise the system SHALL respond 400 naming the field: `fb_media` `media_type` is `image` or `video`; `fb_receipt` `currency` is three uppercase letters; `fb_feedback` `question_type` is `csat`, `nps` or `ces`, and `expires_in_days` is an integer from 1 to 7. `fb_receipt` `summary.total_cost` SHALL always be a number not less than 0.

#### Scenario: Negative total
- **WHEN** a user saves an `fb_receipt` material with `summary.total_cost = -1`
- **THEN** the system SHALL respond 400 naming `body.summary.total_cost`

#### Scenario: Feedback expiry out of range
- **WHEN** a user saves an `fb_feedback` material with `expires_in_days = 9999`
- **THEN** the system SHALL respond 400 naming `body.expires_in_days`

#### Scenario: Free-text media type
- **WHEN** a user saves an `fb_media` material with `media_type = "abc"`
- **THEN** the system SHALL respond 400 naming `body.media_type`

#### Scenario: Missing field shown with an editor default
- **WHEN** a user saves an `fb_receipt` material without `currency`, which the editor shows as `TWD`
- **THEN** the material SHALL be saved

### Requirement: Restoring An FB Material Version Is Validated
When a user restores an `fb_*` material to an earlier version, the system SHALL apply the FB content rules to that version's body and SHALL respond 400 without changing the material when the body does not comply.

#### Scenario: Restore a version saved before validation
- **WHEN** a user restores an `fb_coupon` material to a version whose `image_url` is `javascript:alert(1)`
- **THEN** the system SHALL respond 400 naming `body.image_url` and the material SHALL not change
