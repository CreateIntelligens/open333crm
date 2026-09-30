## ADDED Requirements

### Requirement: Platform-owned Meta App webhook endpoint
The platform SHALL expose `GET/POST /api/v1/webhooks/meta` configured by platform environment variables (App ID, App Secret, verify token). GET SHALL answer the Meta verification challenge using the platform verify token. POST SHALL verify the signature with the platform App Secret, map `object` (`page` → FB, `instagram` → Instagram) and route every entry by `entry.id` to channels connected in platform mode; entries with no matching channel SHALL be dropped and logged.

#### Scenario: Event for a platform-connected page
- **WHEN** the platform endpoint receives a signed `page` event whose `entry.id` matches a platform-mode FB channel
- **THEN** the event SHALL be processed with that channel and its tenant

#### Scenario: Endpoint not configured
- **WHEN** the platform Meta environment variables are not set
- **THEN** the endpoint SHALL respond 503 and SHALL NOT process events

### Requirement: Tenants connect pages with Facebook Login
A tenant user with `channel.manage` SHALL be able to connect FB pages by authorizing with Facebook Login for Business. The system SHALL keep the OAuth state in Redis bound to tenant and user (single use, 10 minutes), SHALL keep user and page tokens server-side only (encrypted), SHALL show the pages the user manages with whether each is already connected, and on selection SHALL create a platform-mode channel, store the Page ID as the external account ID, and subscribe the page to the platform App with the messaging fields. If subscription fails, no channel SHALL remain.

#### Scenario: Connect a page
- **WHEN** an admin authorizes and selects page P
- **THEN** a FB channel in platform mode SHALL be created for P with a long-lived page token, and `POST /{P}/subscribed_apps` SHALL have succeeded

#### Scenario: Page already connected
- **WHEN** the selected page is already connected to any channel
- **THEN** the page SHALL be shown as unavailable and selecting it SHALL fail with `CHANNEL_ACCOUNT_ALREADY_LINKED`

#### Scenario: Tampered or expired state
- **WHEN** the callback carries an unknown, used or expired state
- **THEN** the flow SHALL stop with an error and no token SHALL be stored
