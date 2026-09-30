## ADDED Requirements

### Requirement: Meta webhook events are routed by account ID
For FB and Instagram webhooks, the system SHALL determine the target channel and tenant of each event from the payload `entry.id` (FB Page ID / Instagram professional account ID), not from the channel ID in the webhook URL. The FB and Instagram plugins SHALL expose `entry.id` on every parsed event as `accountId`. A single payload MAY contain entries for several accounts; each group SHALL be processed with its own target channel's credentials and tenant.

#### Scenario: Two pages share one Meta App
- **WHEN** a Meta App's callback URL points to channel A (page P1, tenant T1) and the App delivers a message for page P2 that is connected as channel B in tenant T2
- **THEN** the message SHALL be written to channel B in tenant T2, and SHALL NOT appear in tenant T1

#### Scenario: Batched payload with two pages
- **WHEN** one webhook payload contains an entry for P1 and an entry for P2
- **THEN** each entry SHALL be processed with its own channel and tenant

#### Scenario: Account not connected to any channel
- **WHEN** the payload's `entry.id` does not match any channel and the URL channel already has a different external account ID
- **THEN** the event SHALL be dropped, SHALL NOT be written to any tenant, and the URL channel SHALL record a visible routing warning with the unmatched account ID

#### Scenario: Legacy channel without account ID
- **WHEN** the URL channel has no external account ID yet and no channel claims the event's `entry.id`
- **THEN** the event SHALL be processed by the URL channel as before, and the URL channel SHALL show a warning that its account ID has not been obtained

### Requirement: Routed target must belong to the same Meta App
When an event is routed to a channel other than the URL channel, the system SHALL process it only if the target channel's App Secret equals the secret used to verify the webhook signature. Otherwise the event SHALL be dropped and a routing warning recorded.

#### Scenario: Signature from a different App
- **WHEN** a payload signed with App X's secret contains an `entry.id` connected to a channel that uses App Y
- **THEN** the event SHALL be dropped

### Requirement: Downstream forwarding only for single-channel payloads
Downstream webhook forwarding of the raw payload SHALL happen only when every entry in the payload is routed to the URL channel itself; otherwise forwarding SHALL be skipped and a routing warning recorded, so that events of other channels or tenants are never forwarded.

#### Scenario: Mixed payload with downstream configured
- **WHEN** the URL channel has a downstream webhook and the payload also contains an entry for another channel
- **THEN** the raw payload SHALL NOT be forwarded

### Requirement: External account ID is stored in plain text and unique platform-wide
Each FB and Instagram channel SHALL store its external account ID (FB Page ID; Instagram professional account ID) in a plain-text column, unique per channel type across all tenants. Channel verification SHALL obtain and store it automatically. Creating, updating or verifying a channel whose account is already connected elsewhere SHALL fail with `CHANNEL_ACCOUNT_ALREADY_LINKED` (HTTP 409) and a Traditional Chinese message.

#### Scenario: Same page connected twice
- **WHEN** a tenant verifies a FB channel whose Page ID is already stored on another channel (in any tenant)
- **THEN** the request SHALL fail with 409 `CHANNEL_ACCOUNT_ALREADY_LINKED` and the account ID SHALL NOT be written

#### Scenario: Verification stores the Page ID
- **WHEN** a FB channel is verified successfully
- **THEN** its external account ID SHALL equal the Page ID returned by Graph `/me`
